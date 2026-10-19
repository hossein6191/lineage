/* Lineage and its Bookstall against GenLayer Studio (chain 61999), with throwaway accounts. Deploys its own copies.
 *
 *   npm ci                                                  # genlayer-js 1.1.8 and viem 2.56.8
 *   node tests/on_chain/smoke.mjs                           # the whole run, from a fresh state
 *   RESUME=1 node tests/on_chain/smoke.mjs                  # continue a run that was cut off
 *   STATE=/some/dir/run.json RESUME=1 node tests/on_chain/smoke.mjs   # the same, with the state kept elsewhere
 *
 * Five generated accounts play the story: A writes W1, a guide to keeping a wild yeast starter, and deploys
 * both contracts; B writes W2, a note on plaiting an enriched loaf: bread, like W4, and nothing W4 uses;
 * C writes W3, a table of dough hydrations; D writes W4, a first weekend sourdough, which plainly uses W1's
 * 1:5:5 feeding and float test and W3's 75 percent hydration and windowpane test, shares only its topic
 * with W2, and lists W1 and W2 but not W3; S, a stranger, tries to claim and then buys.
 *
 *   1  deploy Lineage, then the Bookstall bound to it; A names the Bookstall as Lineage's consumer. Both
 *      contracts are read back byte for byte at the end.
 *   2  A, B, C and D deposit credit for their bonds (submit_work and claim take no value). A, B and C
 *      register W1, W2 and W3 with no sources: nothing is asked, the lineage is empty, and each stakes
 *      0.2 GEN from credit. D registers W4 listing W1 and W2: one consensus block asks which listed sources
 *      W4 draws on and which it takes none of the specifics of, each with the sources in the listed order
 *      and reversed, and the mask comes back "10": W1 drawn on, W2 not.
 *   3  S claims that W4 draws on W3 and is refused: only W3's author may. A claims W4 draws on W1 and is
 *      refused: W4 lists W1. C claims W4 draws on W3: four askings over the two texts read it drawn, W3
 *      joins W4's royalty set, C's claim bond stays in credit, and D's 0.2 GEN author bond goes to C in the
 *      same transaction. B claims nothing.
 *   4  D offers W4 at 1 GEN on the Bookstall; S buys it, and in that one transaction 0.15 GEN reaches A,
 *      0.15 GEN reaches C, 0.70 GEN reaches D, and B is paid nothing. A offers W1, which lists no source,
 *      at 0.5 GEN; S buys it and A is paid all of it.
 *   5  B offers W2, then retracts it on Lineage: it was never sold, so its bond comes back to B's credit.
 *      S tries to buy W2 and the Bookstall refuses, reading "retracted" from Lineage, and returns the
 *      0.5 GEN. D tries to retract W4 and Lineage refuses: the Bookstall says it was sold. B and C withdraw
 *      what is left of their credit.
 *   6  the views read back, the deployed code of both contracts compared with the files byte for byte,
 *      both contracts' balances read, and every account's net movement checked against the receipts.
 *
 * Every refusal is a signed transaction. Balances are read after finalisation, because a transfer lands
 * at FINALIZED, not at ACCEPTED. Transactions are polled with eth_getTransactionByHash, never with views.
 * A round no majority carried stores nothing, and since submit_work and claim take no value it strands
 * nothing either: the credit is still there, the call is sent again and both transactions are kept. Every
 * step is saved as it is made, so a run cut off part way continues without sending anything twice. Every
 * id (W1 to W4, both contract addresses) is read from a receipt; a step whose receipt does not carry the id
 * it needs stops the run rather than guess. A whole run takes about 25 to 40 minutes: two deployments
 * and 22 transactions, two of them consensus rounds of four askings each.
 *
 * A state file remembers the sha256 of both contracts it deployed, and a RESUME against a state made from
 * other files stops before sending anything.
 */
import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { generatePrivateKey } from "viem/accounts";
import { getAddress } from "viem";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const RPC = "https://studio.genlayer.com/api";
const STATE = process.env.STATE || join(tmpdir(), "lineage-smoke-state.json");
const RECORD = process.env.RECORD || STATE.replace(/\.json$/, "") + "-record.json";
const FILES = { lineage: "../../contracts/lineage.py", bookstall: "../../contracts/fixtures/bookstall.py" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toISOString().slice(11, 19);
const rpc = async (m, p) => {
  let last;
  for (let i = 0; i < 90; i++) {
    try {
      const r = await fetch(RPC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: m, params: p }) });
      const j = await r.json();
      if (j.error && (j.error.code === -32029 || r.status === 429)) { await sleep(((j.error.data?.retry_after_seconds) || 20) * 1000); continue; }
      if (j.error) { last = new Error(m + ": " + JSON.stringify(j.error).slice(0, 200)); await sleep(6000); continue; }
      return j.result;
    } catch (e) { last = e; await sleep(4000); }
  }
  throw last;
};
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? "  - " + d : ""}`); return !!c; };
const GEN = 10n ** 18n;
const tally = (v) => `${v.agree} agree, ${v.disagree} disagree, ${v.idle} idle`;
const sha = (b) => createHash("sha256").update(b).digest("hex");
const fileOf = (k) => readFileSync(new URL(FILES[k], import.meta.url));

// ---------- state: keys, addresses and every step already made survive a cut-off run ----------
const st = existsSync(STATE) && process.env.RESUME ? JSON.parse(readFileSync(STATE, "utf8")) : {};
st.keys = st.keys || {}; st.steps = st.steps || {}; st.views = st.views || {}; st.order = st.order || []; st.ids = st.ids || {};
st.authors = st.authors || {};
const SOURCE_SHA = { lineage: sha(fileOf("lineage")), bookstall: sha(fileOf("bookstall")) };
if (st.source_sha256 && (st.source_sha256.lineage !== SOURCE_SHA.lineage || st.source_sha256.bookstall !== SOURCE_SHA.bookstall)) {
  console.log(`the state file ${STATE} belongs to a run of other contract files; start a fresh run without RESUME, or name another STATE`);
  process.exit(2);
}
st.source_sha256 = SOURCE_SHA;
const save = () => {
  writeFileSync(STATE, JSON.stringify(st, null, 1));
  const { keys, ...shown } = st;       // the record carries no key
  writeFileSync(RECORD, JSON.stringify(shown, null, 1));
};
const ROLES = {
  a: "A, who writes W1 (the starter guide) and deploys both contracts",
  b: "B, who writes W2 (the plaited loaf, which shares only W4's topic)",
  c: "C, who writes W3 (the hydration table) and is left out of W4",
  d: "D, who writes W4 (the weekend loaf)",
  s: "S, a stranger, who tries to claim and buys",
};
for (const k of Object.keys(ROLES)) st.keys[k] = st.keys[k] || generatePrivateKey();
const acct = {}, client = {};
for (const k of Object.keys(ROLES)) { acct[k] = createAccount(st.keys[k]); client[k] = createClient({ chain: studionet, account: acct[k] }); }
const rd = createClient({ chain: studionet });
st.accounts = Object.fromEntries(Object.keys(ROLES).map((k) => [k, getAddress(acct[k].address)]));
const low = (a) => String(a).toLowerCase();
const roleOf = (addr) => Object.keys(ROLES).find((k) => low(acct[k].address) === low(addr)) || "?";
save();

// an id the run needs, read from a receipt; without it the run stops rather than guess
const need = (value, what) => {
  if (value === undefined || value === null || value === "") {
    ok(`the receipt carries ${what}`, false, "stopping: nothing after this step can be sent without it");
    st.checks = { pass, fail }; save();
    process.exit(1);
  }
  return value;
};

const balance = async (a) => BigInt(await rpc("eth_getBalance", [a, "latest"]) || "0x0");
const nonceOf = async (a) => Number(BigInt(await rpc("eth_getTransactionCount", [a, "latest"]) || "0x0"));
const fundOnce = async (k, whole) => {
  st.funded = st.funded || {};
  if (st.funded[k]) return;
  await rpc("sim_fundAccount", { account_address: getAddress(acct[k].address), amount: whole * 1e18 });   // checksummed; amount in atto, as a number
  for (let i = 0; i < 20 && (await balance(acct[k].address)) === 0n; i++) await sleep(3000);
  st.funded[k] = String(await balance(acct[k].address)); save();
};

// ---------- transactions ----------
const errText = (e) => String(e?.details || e?.shortMessage || e?.cause?.message || e?.message || e);
// A request the network refused or never received is made again. When the failure is ambiguous the
// sender's nonce says whether the transaction landed after all, and its hash is read back, so nothing
// is ever sent twice.
const sendRaw = async (who, what, make) => {
  const addr = acct[who].address;
  for (let i = 0; ; i++) {
    const n0 = await nonceOf(addr);
    try { return await make(); } catch (e) {
      if (i >= 8) throw e;
      console.log(`      ${what} was not taken (${errText(e).slice(0, 70)}); looking again in 20s`);
      await sleep(20000);
      if ((await nonceOf(addr)) > n0) {
        const list = await rpc("sim_getTransactionsForAddress", [addr]);
        const hit = (list || []).find((t) => low(t.from_address) === low(addr) && Number(t.nonce) === n0);
        if (hit?.hash) return hit.hash;
        throw new Error(what + " landed but its hash could not be read back");
      }
    }
  }
};
const countVotes = (t) => { let a = 0, d = 0, idl = 0; for (const k in (t.consensus_data?.votes || {})) { const v = t.consensus_data.votes[k]; if (v === "agree") a++; else if (v === "disagree") d++; else idl++; } return { agree: a, disagree: d, idle: idl }; };
const wait = async (tx) => {
  let stuck = 0;
  for (let i = 0; i < 900; i++) {
    await sleep(4000);
    const t = await rpc("eth_getTransactionByHash", [tx]);
    if (t?.status === "FINALIZED") {
      const lr = t.consensus_data?.leader_receipt, one = Array.isArray(lr) ? lr[0] : lr;
      let msg = "";
      try { msg = Buffer.from(one.result, "base64").toString("utf8").replace(/[^\x20-\x7e]/g, " ").trim(); } catch (e) {}
      const v = countVotes(t);
      return { tx, msg, exec: one?.execution_result || "", votes: v, applied: v.agree * 2 > v.agree + v.disagree + v.idle, address: t.data?.contract_address || t.to_address || "" };
    }
    // a round no majority carried is final as it stands once it has been left alone for ten minutes
    if (t?.status === "UNDETERMINED" && (stuck = stuck + 1) > 150) return { tx, msg: "UNDETERMINED", exec: "", votes: countVotes(t), applied: false, address: "" };
    if (t?.status === "CANCELED") return { tx, msg: "CANCELED", exec: "", votes: { agree: 0, disagree: 0, idle: 0 }, applied: false, address: "" };
    if (i > 0 && i % 75 === 0) console.log(`      [${stamp()}] still ${t?.status || "unknown"} after ${Math.round(i * 4 / 60)} minutes: ${tx}`);
  }
  return { tx, msg: "TIMEOUT", exec: "", votes: { agree: 0, disagree: 0, idle: 0 }, applied: false, address: "" };
};
const jsonOf = (msg) => { const b = String(msg).indexOf("{"); if (b === -1) return null; try { return JSON.parse(String(msg).slice(b)); } catch (e) { return null; } };
const settleBalance = async (a, before, want) => { for (let i = 0; i < 45; i++) { const b = await balance(a); if (b - before === want) return b; await sleep(4000); } return await balance(a); };

// One step: a signed transaction to one of the two contracts, its tally, what it returned, and the
// balances it moved. begin() sends it (once), end() waits for it; call() is both. opt.at names the
// contract ("lineage" or "bookstall"), opt.watch the roles whose balances are read before and after,
// and opt.expect the change each should show: a table, or a function of what the call returned.
const begin = async (id, who, fn, args = [], opt = {}) => {
  const target = opt.at || "lineage";
  if (!st.steps[id]) { st.steps[id] = { id, who, at: target, fn, args: args.map((x) => String(x).slice(0, 80)), value: String(opt.value || 0n), tries: [] }; st.order.push(id); }
  const rec = st.steps[id];
  if (rec.done || rec.pending) return;
  if (!rec.before) { rec.before = {}; for (const k of opt.watch || []) rec.before[k] = String(await balance(acct[k].address)); save(); }
  rec.pending = await sendRaw(who, fn, () => client[who].writeContract({ address: need(st[target], target + "'s address"), functionName: fn, args, ...(opt.value ? { value: opt.value } : {}) }));
  save();
};
const end = async (id, who, fn, args = [], opt = {}) => {
  const rec = st.steps[id];
  if (!rec.done) {
    for (;;) {
      if (!rec.pending) await begin(id, who, fn, args, opt);
      const r = await wait(rec.pending);
      rec.tries.push({ tx: r.tx, votes: r.votes, exec: r.exec, applied: r.applied, msg: r.msg });
      rec.pending = null; save();
      console.log(`      [${stamp()}] ${who.toUpperCase()} ${opt.at || "lineage"}.${fn}(${args.map((x) => String(x).slice(0, 22)).join(", ")})${opt.value ? " +" + Number(opt.value) / 1e18 + " GEN" : ""}  ${r.tx}  ${tally(r.votes)}  ${r.exec}`);
      if (r.msg === "TIMEOUT" || rec.tries.length >= 4) break;
      if (!r.applied) { console.log("      the validators did not carry that round (" + tally(r.votes) + "), so nothing was stored; sending it again"); continue; }
      break;
    }
    const last = rec.tries[rec.tries.length - 1];
    const expect = typeof opt.expect === "function" ? opt.expect(jsonOf(last.msg)) : opt.expect;
    rec.after = {}; rec.delta = {};
    for (const k of opt.watch || []) {
      const before = BigInt(rec.before[k]);
      const want = expect && expect[k] !== undefined ? BigInt(expect[k]) : null;
      const now = want === null ? await balance(acct[k].address) : await settleBalance(acct[k].address, before, want);
      rec.after[k] = String(now); rec.delta[k] = String(now - before);
    }
    rec.done = true; save();
  }
  const last = rec.tries[rec.tries.length - 1];
  return { ...last, j: jsonOf(last.msg), tries: rec.tries, delta: rec.delta || {} };
};
const call = async (id, who, fn, args = [], opt = {}) => { await begin(id, who, fn, args, opt); return end(id, who, fn, args, opt); };
const refused = (r, words) => r.exec === "ERROR" && r.msg.includes(words);
const moved = (r, k, want) => r.delta[k] === String(want);
const votes = (r) => r.tries.map((t) => tally(t.votes)).join(", then ");

const deploy = async (id, who, which, args) => {
  if (!st.steps[id]) { st.steps[id] = { id, who, at: which, fn: "deploy " + FILES[which].split("/").slice(3).join("/"), args: args.map(String), value: "0", tries: [] }; st.order.push(id); }
  const rec = st.steps[id];
  if (!rec.done) {
    const code = fileOf(which);
    for (;;) {
      if (!rec.pending) { rec.pending = await sendRaw(who, "deploy", () => client[who].deployContract({ code, args, leaderOnly: false })); save(); }
      const r = await wait(rec.pending);
      rec.tries.push({ tx: r.tx, votes: r.votes, exec: r.exec, applied: r.applied, msg: r.msg.slice(0, 300) });
      rec.address = r.address; rec.pending = null; save();
      console.log(`      [${stamp()}] ${who.toUpperCase()} deploy ${which}  ${r.tx}  ${tally(r.votes)}  ${r.exec}  ${r.address}`);
      if (r.applied || r.msg === "TIMEOUT" || rec.tries.length >= 3) break;
    }
    rec.done = true; save();
  }
  return need(rec.address, "the address of the deployed " + which + " contract");
};

// ---------- reads: paced, and made again on a 429 instead of failing ----------
let lastRead = 0;
const read = async (target, fn, args = []) => {
  for (let i = 0; i < 30; i++) {
    const gap = 3500 - (Date.now() - lastRead);
    if (gap > 0) await sleep(gap);
    lastRead = Date.now();
    try { return JSON.parse(String(await rd.readContract({ address: st[target], functionName: fn, args }))); } catch (e) {
      if (i === 29) return { error: "VIEW ERROR " + fn + ": " + errText(e).slice(0, 100) };
      await sleep(/rate|429|limit/i.test(errText(e)) ? 25000 : 10000);
    }
  }
};
// a view read once for a check is kept with the run, so a continued run checks what was seen then
const seen = async (id, target, fn, args = []) => { if (!st.views[id]) { st.views[id] = { target, fn, args, at: stamp(), out: await read(target, fn, args) }; save(); } return st.views[id].out; };

// ---------- the demonstration ----------
const ABOND = GEN / 5n, CBOND = GEN / 20n, PRICE4 = 1n * GEN, PRICE1 = GEN / 2n, PRICE2 = GEN / 2n;
const SHARE = (PRICE4 * 3000n / 10000n) / 2n;   // 0.15 GEN to each of the two authors in W4's royalty set
// Four works, one thing each. W4 uses W1's feeding ratio and float test and W3's 75 percent hydration and
// windowpane test; W2 is bread too, and W4 takes nothing it says. The suite checks these are its own texts.
const T1 = "Keeping a wild yeast starter";
const W1_TEXT = "A wild yeast starter is flour and water that has caught the yeasts and bacteria living on grain. Keep about 50 grams of it in a clean jar. Feed it once a day at a ratio of 1:5:5 by weight: 10 grams of old starter, 50 grams of flour and 50 grams of water, at a room temperature of about 24 C. Everything else is discard: before each feeding, throw away or bake with all but those 10 grams, so the jar never grows and the yeast always has fresh food. To know when it is ready, use the float test: drop a teaspoon of starter into a glass of water; if it floats, it is full of gas and will raise bread; if it sinks, wait an hour and test again. A hungry starter tells you so: a layer of grey liquid on top, a sharp smell like nail varnish, and a surface that has risen and fallen back, leaving streaks on the glass. When you see those signs, feed it at once, and feed it twice a day for two days if it has been left alone for a week.";
const T2 = "Plaiting an enriched loaf";
const W2_TEXT = "An enriched dough is one with eggs, butter, sugar and milk in it, and it behaves nothing like a lean one: it is soft, it rises slowly, and it browns fast. For one plaited loaf, warm 180 millilitres of milk to blood heat and stir in 7 grams of dried yeast and 40 grams of sugar. Rub 60 grams of soft butter into 450 grams of plain flour with a pinch of salt, then add the milk and two beaten eggs, keeping back a spoonful of egg for the glaze. Knead for twelve minutes, until the dough no longer sticks to the bowl, and leave it covered for an hour and a half. Divide it into three equal ropes, each as long as your forearm and tapered at both ends. Pinch the tops together, then lift the right rope over the middle one, then the left rope over the new middle one, and keep going, never pulling tight, until you reach the ends; tuck both ends underneath. Prove the plait on a lined tray for forty minutes, brush it with the egg you kept back, scatter it with sesame seeds, and bake it at 190 C for twenty-eight minutes. It is done when the underside sounds hollow; if the top darkens too early, lay a sheet of foil over it for the last ten minutes.";
const T3 = "Dough hydration at a glance";
const W3_TEXT = "Hydration is the weight of water in a dough divided by the weight of flour, written as a percentage: 750 grams of water to 1000 grams of flour is 75 percent. Here is what each common hydration feels like in the hand. At 65 percent the dough is firm and smooth, easy to shape, and bakes into a tight, even crumb for sandwich loaves. At 70 percent it is soft and slightly tacky but still holds a ball on the bench. At 75 percent it is sticky and slack, it spreads a little when you let go, and it needs wet hands and a few sets of stretch and folds, but it rewards you with an open, glossy crumb. At 80 percent it pours more than it holds, and is best baked in a tin or a covered pot. Whatever the hydration, check the gluten with the windowpane test: pinch off a piece of dough the size of a walnut and stretch it slowly between your fingers; if it thins into a sheet you can see light through without tearing, the gluten is developed; if it tears early, knead or fold for another five minutes and test again.";
const T4 = "Your first weekend sourdough";
const W4_TEXT = "This is a plan for your first loaf, from Friday evening to Sunday morning. Friday evening: feed your starter at 1:5:5 by weight, 10 grams of starter, 50 grams of flour and 50 grams of water, and leave it at room temperature. Saturday morning: do the float test, a teaspoon of starter dropped into a glass of water; when it floats, it is ready. Mix 375 grams of water into 500 grams of strong white flour, which is 75 percent hydration: the dough will be sticky and slack and will spread a little when you let go, so keep your hands wet. Any strong white flour will do. Add 100 grams of the floating starter and 10 grams of salt. Over the next two hours give it four sets of stretch and folds, half an hour apart. Then check the gluten with the windowpane test: stretch a walnut-sized piece slowly between your fingers until you can see light through it without a tear; if it tears, fold again and wait twenty minutes. Let it rise until it has grown by half, shape it into a round, put it in a floured basket and leave it in the fridge overnight. Sunday morning: heat a covered pot in the oven at 250 C for forty minutes, tip the dough in, bake twenty minutes with the lid on and twenty-five with it off, and let the loaf cool for an hour before you cut it.";
const ASKED_LINEAGE = ["listed/draws", "reversed/draws", "listed/without", "reversed/without"];
const ASKED_CLAIM = ["new_first/draws", "source_first/draws", "new_first/without", "source_first/without"];
const readingsOf = (j, keys) => keys.map((k) => (j?.readings || {})[k] || "-").join(",");

await fundOnce("a", 3); await fundOnce("b", 2); await fundOnce("c", 2); await fundOnce("d", 2); await fundOnce("s", 4);
if (!st.start) { st.start = {}; for (const k of Object.keys(ROLES)) st.start[k] = String(await balance(acct[k].address)); st.started = new Date().toISOString(); save(); }
console.log(`[${stamp()}] ${Object.keys(ROLES).map((k) => k.toUpperCase() + "  " + st.accounts[k] + "  " + ROLES[k]).join("\n           ")}\n           state ${STATE}`);

// ================================================================ 1
console.log(`\n[${stamp()}] ---- 1: deploy Lineage, then the Bookstall bound to it, and name it the consumer`);
st.lineage = st.lineage || await deploy("deployLineage", "a", "lineage", []);
save();
st.bookstall = st.bookstall || await deploy("deployBookstall", "a", "bookstall", [st.lineage]);
save();
console.log(`      Lineage at ${st.lineage} · Bookstall at ${st.bookstall}`);
{
  const reg = await call("registerConsumer", "a", "register_consumer", [st.bookstall]);
  ok("A, the deployer, names the Bookstall as Lineage's consumer", reg.j?.ok === true && low(reg.j?.consumer) === low(st.bookstall), `${votes(reg)}  ${reg.msg.slice(0, 120)}`);
  const info = await seen("stallAtStart", "bookstall", "stall", []);
  ok("the Bookstall is bound to the Lineage just deployed and sells only judged works", low(info.lineage) === low(st.lineage) && info.sells_only === "judged" && info.royalty_bps === 3000, JSON.stringify({ lineage: info.lineage, sells_only: info.sells_only }));
}

// ================================================================ 2
console.log(`\n[${stamp()}] ---- 2: four works; W4's listed sources are judged`);
{
  for (const [k, amount] of [["a", ABOND], ["b", ABOND], ["c", ABOND + CBOND], ["d", ABOND]]) {
    const dep = await call("deposit" + k.toUpperCase(), k, "deposit", [], { value: amount, watch: [k], expect: { [k]: -amount } });
    ok(`${k.toUpperCase()} deposits ${Number(amount) / 1e18} GEN of credit, in a call that asks no model`, dep.j?.ok === true && dep.j?.deposited === String(amount) && moved(dep, k, -amount), `${votes(dep)}  ${dep.msg.slice(0, 100)}`);
  }
  for (const [k, n, title, text] of [["a", "W1", T1, W1_TEXT], ["b", "W2", T2, W2_TEXT], ["c", "W3", T3, W3_TEXT]]) {
    const w = await call("submit" + n, k, "submit_work", [title, text, "[]"], { watch: [k], expect: { [k]: 0n } });
    st.ids[n] = need(w.j?.work, "the id of " + title); st.authors[st.ids[n]] = k; save();
    ok(`${k.toUpperCase()} registers ${st.ids[n]}, "${title}", with no sources: nothing is asked and its lineage is empty`, w.j?.ok === true && w.j?.status === "judged" && w.j?.mask === "" && w.j?.bond === String(ABOND) && w.j?.credit === (k === "c" ? String(CBOND) : "0") && moved(w, k, 0n), `${votes(w)}  ${w.msg.slice(0, 110)}`);
  }
  const w4 = await call("submitW4", "d", "submit_work", [T4, W4_TEXT, JSON.stringify([st.ids.W1, st.ids.W2])], { watch: ["d"], expect: { d: 0n } });
  st.ids.W4 = need(w4.j?.work, "the id of the weekend loaf"); st.authors[st.ids.W4] = "d"; save();
  ok(`D registers ${st.ids.W4} listing ${st.ids.W1} and ${st.ids.W2}: the four askings agree on mask "10", ${st.ids.W1} drawn on and ${st.ids.W2} not`, w4.j?.mask === "10" && w4.j?.status === "judged", `${votes(w4)}  mask ${w4.j?.mask ?? w4.msg.slice(0, 80)}  readings ${readingsOf(w4.j, ASKED_LINEAGE)}`);
  ok("and D's 0.2 GEN author bond is staked from credit, with no value sent", w4.j?.bond === String(ABOND) && w4.j?.credit === "0" && moved(w4, "d", 0n), JSON.stringify(w4.delta));
}

// ================================================================ 3
console.log(`\n[${stamp()}] ---- 3: the claims`);
{
  const stranger = await call("strangerClaims", "s", "claim", [st.ids.W4, st.ids.W3], { watch: ["s"], expect: { s: 0n } });
  ok(`S, who wrote nothing, claims ${st.ids.W4} draws on ${st.ids.W3} and is refused before any model is asked`, refused(stranger, "only the author of " + st.ids.W3 + " may claim") && moved(stranger, "s", 0n), `${votes(stranger)}  ${stranger.msg.slice(0, 110)}`);
  const listed = await call("listedClaim", "a", "claim", [st.ids.W4, st.ids.W1], { watch: ["a"], expect: { a: 0n } });
  ok(`A claims ${st.ids.W4} draws on ${st.ids.W1} and is refused: ${st.ids.W4} lists it and its lineage round judged it`, refused(listed, "already lists " + st.ids.W1) && moved(listed, "a", 0n), `${votes(listed)}  ${listed.msg.slice(0, 110)}`);
  const c3 = await call("claimW3", "c", "claim", [st.ids.W4, st.ids.W3], { watch: ["c", "d"], expect: (j) => (j?.verdict === "drawn" ? { c: ABOND, d: 0n } : j?.verdict === "not_drawn" ? { c: 0n, d: CBOND } : { c: 0n, d: 0n }) });
  ok(`C claims ${st.ids.W4} draws on ${st.ids.W3}: the four askings read it drawn, and ${st.ids.W3} joins the royalty set`, c3.j?.verdict === "drawn" && JSON.stringify(c3.j?.royalty_sources) === JSON.stringify([st.ids.W1, st.ids.W3]), `${votes(c3)}  ${c3.j?.verdict || c3.msg.slice(0, 80)}  readings ${readingsOf(c3.j, ASKED_CLAIM)}`);
  ok("and D's 0.2 GEN author bond goes to C in the same transaction, C's claim bond still in credit", c3.j?.won === String(ABOND) && c3.j?.credit === String(CBOND) && moved(c3, "c", ABOND) && moved(c3, "d", 0n), JSON.stringify(c3.delta));
}

// ================================================================ 4
console.log(`\n[${stamp()}] ---- 4: the Bookstall sells and splits the royalty`);
{
  const o4 = await call("offerW4", "d", "offer", [st.ids.W4, String(PRICE4)], { at: "bookstall" });
  ok(`D offers ${st.ids.W4} at 1 GEN; the Bookstall reads it judged on Lineage`, o4.j?.ok === true && o4.j?.status_on_lineage === "judged", `${votes(o4)}  ${o4.msg.slice(0, 100)}`);
  const buy4 = await call("buyW4", "s", "buy", [st.ids.W4], { at: "bookstall", value: PRICE4, watch: ["a", "b", "c", "d", "s"], expect: { a: SHARE, b: 0n, c: SHARE, d: PRICE4 - 2n * SHARE, s: -PRICE4 } });
  ok(`S buys ${st.ids.W4} for 1 GEN: 0.3 GEN of royalty split over A and C, 0.15 GEN each`, buy4.j?.ok === true && buy4.j?.share === String(SHARE) && JSON.stringify(buy4.j?.paid_to) === JSON.stringify([low(acct.a.address), low(acct.c.address)]), `${votes(buy4)}  ${buy4.msg.slice(0, 140)}`);
  ok("and in the same transaction A gains 0.15, C 0.15, D 0.70, and B nothing", moved(buy4, "a", SHARE) && moved(buy4, "c", SHARE) && moved(buy4, "d", PRICE4 - 2n * SHARE) && moved(buy4, "b", 0n) && moved(buy4, "s", -PRICE4), JSON.stringify(buy4.delta));
  const o1 = await call("offerW1", "a", "offer", [st.ids.W1, String(PRICE1)], { at: "bookstall" });
  const buy1 = await call("buyW1", "s", "buy", [st.ids.W1], { at: "bookstall", value: PRICE1, watch: ["a", "s"], expect: { a: PRICE1, s: -PRICE1 } });
  ok(`${st.ids.W1}, which lists no source, sells at 0.5 GEN and its author is paid all of it`, o1.j?.ok === true && buy1.j?.ok === true && buy1.j?.royalty === "0" && moved(buy1, "a", PRICE1) && moved(buy1, "s", -PRICE1), `${votes(buy1)}  ${JSON.stringify(buy1.delta)}`);
}

// ================================================================ 5
console.log(`\n[${stamp()}] ---- 5: the routes out, and the refusals`);
{
  const o2 = await call("offerW2", "b", "offer", [st.ids.W2, String(PRICE2)], { at: "bookstall" });
  ok(`B offers ${st.ids.W2} at 0.5 GEN`, o2.j?.ok === true, `${votes(o2)}  ${o2.msg.slice(0, 80)}`);
  const r2 = await call("retractW2", "b", "retract", [st.ids.W2], { watch: ["b"], expect: { b: 0n } });
  ok(`B retracts ${st.ids.W2}: Lineage reads the Bookstall, finds it never sold, and its 0.2 GEN bond comes back to B's credit`, r2.j?.ok === true && r2.j?.status === "retracted" && r2.j?.returned === String(ABOND) && r2.j?.credit === String(ABOND), `${votes(r2)}  ${r2.msg.slice(0, 120)}`);
  const buy2 = await call("buyW2", "s", "buy", [st.ids.W2], { at: "bookstall", value: PRICE2, watch: ["s", "b"], expect: { s: 0n, b: 0n } });
  ok(`S tries to buy the retracted ${st.ids.W2}: the Bookstall reads "retracted" from Lineage, refuses, and returns the 0.5 GEN`, buy2.j?.ok === false && String(buy2.j?.reason).includes("retracted on Lineage") && buy2.j?.returned === String(PRICE2) && moved(buy2, "s", 0n), `${votes(buy2)}  ${buy2.j?.reason || buy2.msg.slice(0, 90)}`);
  const r4 = await call("retractW4", "d", "retract", [st.ids.W4], { watch: ["d"], expect: { d: 0n } });
  ok(`D tries to retract ${st.ids.W4} and Lineage refuses: the Bookstall says it was sold`, refused(r4, "has been sold 1 times through the registered consumer") && moved(r4, "d", 0n), `${votes(r4)}  ${r4.msg.slice(0, 120)}`);
  const wb = await call("withdrawB", "b", "withdraw", [String(ABOND)], { watch: ["b"], expect: { b: ABOND } });
  ok("B withdraws the 0.2 GEN its retracted work returned to credit", wb.j?.ok === true && wb.j?.returned === String(ABOND) && moved(wb, "b", ABOND), `${votes(wb)}  ${wb.msg.slice(0, 90)}`);
  const wc = await call("withdrawC", "c", "withdraw", [String(CBOND)], { watch: ["c"], expect: { c: CBOND } });
  ok("C withdraws the 0.05 GEN claim bond its drawn claim left in credit", wc.j?.ok === true && wc.j?.returned === String(CBOND) && moved(wc, "c", CBOND), `${votes(wc)}  ${wc.msg.slice(0, 90)}`);
}

// ================================================================ 6
console.log(`\n[${stamp()}] ---- 6: the views, the code, and the money`);
{
  const w4 = await seen("W4", "lineage", "work", [st.ids.W4]);
  ok(`work(${st.ids.W4}): judged, mask 10, ${st.ids.W3} added by a claim, royalty to A and C, its bond with C`, w4.status === "judged" && w4.mask === "10" && JSON.stringify(w4.added) === JSON.stringify([st.ids.W3]) && JSON.stringify(w4.royalty) === JSON.stringify([low(acct.a.address), low(acct.c.address)]) && w4.bond_state === "to_claimant" && low(w4.bond_to) === low(acct.c.address) && w4.claims === 1, JSON.stringify({ status: w4.status, mask: w4.mask, added: w4.added, bond_state: w4.bond_state }));
  const roy = await seen("royaltyW4", "lineage", "royalty", [st.ids.W4]);
  ok(`royalty(${st.ids.W4}): ${st.ids.W1} listed, ${st.ids.W3} claimed`, roy.count === 2 && roy.sources?.[0]?.source === st.ids.W1 && roy.sources?.[0]?.how === "listed" && roy.sources?.[1]?.source === st.ids.W3 && roy.sources?.[1]?.how === "claimed", JSON.stringify(roy.sources));
  const cl = await seen("claimsW4", "lineage", "claims_of", [st.ids.W4, 0, 20]);
  ok(`claims_of(${st.ids.W4}, 0, 20): one judged claim, drawn, by C`, cl.total === 1 && cl.limit === 20 && cl.rows?.[0]?.verdict === "drawn" && low(cl.rows?.[0]?.claimant) === low(acct.c.address) && cl.rows?.[0]?.won === String(ABOND), JSON.stringify(cl.rows));
  const w2 = await seen("W2", "lineage", "work", [st.ids.W2]);
  ok(`work(${st.ids.W2}): retracted, not sellable, its bond returned`, w2.status === "retracted" && w2.sellable === false && w2.bond_state === "returned", JSON.stringify({ status: w2.status, bond_state: w2.bond_state }));
  const page = await seen("works", "lineage", "works", [0, 20]);
  ok("works(0, 20): four works, a page of at most 20", page.total === 4 && page.limit === 20 && page.rows?.length === 4, JSON.stringify(page.rows?.map((x) => [x.work, x.status, x.mask])));
  const text4 = await seen("textW4", "lineage", "text", [st.ids.W4]);
  ok(`text(${st.ids.W4}) is the text that was registered`, text4.text === W4_TEXT && text4.title === T4, `${String(text4.text || "").length} characters`);
  const credB = await seen("creditB", "lineage", "credit", [acct.b.address]);
  ok("credit(B): nothing left after the withdraw", credB.credit === "0", JSON.stringify(credB));
  const stats = await seen("stats", "lineage", "stats", []);
  ok("stats(): four works, three judged, one retracted, one drawn claim; A's and C's bonds still held", stats.works === 4 && stats.judged === 3 && stats.retracted === 1 && stats.claims === 1 && stats.drawn === 1 && stats.bonds_held === String(2n * ABOND) && stats.credits_held === "0" && stats.balance_owed === String(2n * ABOND) && low(stats.consumer) === low(st.bookstall), JSON.stringify(stats));
  const rules = await seen("rules", "lineage", "rules", []);
  ok("rules(): both questions word for word, both combine rules, the money and the limits", String(rules.lineage_questions?.draws).startsWith("Which numbered SOURCES does the NEW WORK really draw on?") && String(rules.claim_questions?.without).startsWith("Does the NEW WORK take none of the specific") && rules.limits?.royalty_set === 6 && rules.limits?.page === 20 && String(rules.compared).includes("exact string equality"), Object.keys(rules).join(","));
  const listing = await seen("listingW4", "bookstall", "listing", [st.ids.W4]);
  ok(`listing(${st.ids.W4}): one sale, 0.70 GEN to the author, 0.30 GEN of royalty paid`, listing.sales === 1 && listing.to_author === String(PRICE4 - 2n * SHARE) && listing.royalty_paid === String(2n * SHARE), JSON.stringify(listing));
  const holds = await seen("holdingW4", "bookstall", "holding", [st.ids.W4, acct.s.address]);
  ok(`holding(${st.ids.W4}, S): S holds a copy`, holds.holds === true && holds.payees === 2, JSON.stringify(holds));
  const sold = await seen("salesW4", "bookstall", "sales_of", [st.ids.W4]);
  ok(`sales_of(${st.ids.W4}): what Lineage read before it refused the retract`, sold.sales === 1 && sold.work === st.ids.W4, JSON.stringify(sold));
  const info = await seen("stall", "bookstall", "stall", []);
  ok("stall(): two sales, one refused, nothing held", info.sales === 2 && info.refused === 1 && info.royalty_total === String(2n * SHARE), JSON.stringify(info));
  const lineageBalance = await balance(st.lineage), stallBalance = await balance(st.bookstall);
  ok("the Lineage contract holds exactly what it owes: the two author bonds still behind W1 and W3", lineageBalance === 2n * ABOND && String(lineageBalance) === stats.balance_owed, String(lineageBalance));
  ok("the Bookstall holds nothing", stallBalance === 0n, String(stallBalance));

  st.code = {};
  for (const which of ["lineage", "bookstall"]) {
    const file = fileOf(which);
    const chain = Buffer.from(String(await rpc("gen_getContractCode", [st[which]])), "base64");
    st.code[which] = { address: st[which], bytes: chain.length, sha256: sha(chain), file_bytes: file.length, file_sha256: sha(file), identical: Buffer.compare(chain, file) === 0 };
    save();
    ok(`the code deployed at ${st[which]} is byte for byte contracts/${FILES[which].split("contracts/")[1]}`, st.code[which].identical, `${chain.length} bytes, sha256 ${st.code[which].sha256}`);
  }

  st.end = {}; for (const k of Object.keys(ROLES)) st.end[k] = String(await balance(acct[k].address));
  st.ended = new Date().toISOString(); save();
  // what each account should have gained or lost, read off the receipts: a deposit leaves its sender and a
  // withdraw returns it; a drawn claim pays the claimant the author bond it won; a failed claim pays the
  // work's author; a sale takes the price from the buyer and pays each share and the author's part to
  // whoever the receipt names; refusals move nothing
  const want = { a: 0n, b: 0n, c: 0n, d: 0n, s: 0n };
  for (const id of st.order) {
    const s = st.steps[id], j = jsonOf(s.tries.at(-1)?.msg || "");
    if (!j || j.ok !== true) continue;
    if (s.fn === "deposit") want[s.who] -= BigInt(j.deposited);
    if (s.fn === "withdraw") want[s.who] += BigInt(j.returned);
    if (s.fn === "claim") { want[s.who] += BigInt(j.won); if (BigInt(j.to_author) > 0n) want[st.authors[j.work]] += BigInt(j.to_author); }
    if (s.fn === "buy") { want[s.who] -= BigInt(j.price); for (const p of j.paid_to) want[roleOf(p)] += BigInt(j.share); want[roleOf(j.author)] += BigInt(j.to_author); }
  }
  const net = (k) => BigInt(st.end[k]) - BigInt(st.start[k]);
  ok("over the run every account ends exactly where the receipts say", Object.keys(want).every((k) => net(k) === want[k]), Object.keys(want).map((k) => k.toUpperCase() + " " + Number(net(k)) / 1e18 + " (receipts " + Number(want[k]) / 1e18 + ")").join("  "));
}

st.checks = { pass, fail }; save();
console.log(`\n${pass} passed, ${fail} failed`);
console.log("Lineage:  ", st.lineage);
console.log("Bookstall:", st.bookstall);
console.log("transactions:", st.order.reduce((n, id) => n + st.steps[id].tries.length, 0), "in", st.order.length, "steps; sent a second time:", st.order.filter((id) => st.steps[id].tries.length > 1).join(", ") || "none");
for (const id of st.order) { const s = st.steps[id], j = jsonOf(s.tries.at(-1)?.msg || ""); if (j?.mask !== undefined && s.fn === "submit_work" && j.listed?.length) console.log(`${id.padEnd(14)} ${s.tries.map((t) => t.tx + " " + tally(t.votes)).join(" | ")}  mask ${j.mask}  readings ${readingsOf(j, ASKED_LINEAGE)}`); if (j?.verdict) console.log(`${id.padEnd(14)} ${s.tries.map((t) => t.tx + " " + tally(t.votes)).join(" | ")}  ${j.verdict} ${j.claim}  readings ${readingsOf(j, ASKED_CLAIM)}`); }
console.log("record:", RECORD);
process.exit(fail ? 1 : 0);
