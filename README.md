# Lineage

A new work's list of sources is checked before it earns a coin: validators mark
which listed sources it really draws on, an uncredited author can prove they
were left out, and every sale splits its royalty over the sources the network
agreed on.

An author registers a short work (a how-to, a recipe note, an essay of up to
1,500 characters) in the register, together with up to four earlier works of
the register it says it draws on, and stakes an author bond of 0.2 GEN from
credit deposited beforehand. Before the work can be sold, the network reads it
against the sources it lists and decides, for each one, whether the new work
really draws on it: reuses its specific ideas, structure, wording, examples or
facts, rather than sharing a topic. The answer is stored as a mask, one
character per listed source.

An author whose earlier work the new one draws on without listing it can prove
it. A claim is open only to the author of that earlier work, stakes 0.05 GEN,
and is judged once. If the network agrees the new work draws on it, the source
takes a seat in the work's royalty set and the claimant wins the work's author
bond: the price of leaving a source out. If it agrees it does not, the claim bond goes to
the work's author.

A consumer contract, `contracts/fixtures/bookstall.py`, sells a work only while
its lineage is settled, and pays 30% of every price, in the same call, in equal
shares to the authors of the sources in its royalty set.

## How consensus is used

There are two rounds, each one `gl.vm.run_nondet_unsafe(leader_fn,
validator_fn)` block with four askings inside it.

### The lineage round, when a work is registered

Two questions, each the plain negation of the other, about the listed sources:

> **DRAWS.** Which numbered SOURCES does the NEW WORK really draw on? Drawing on
> a source means reusing its specific ideas, structure, wording, examples or
> facts; sharing only a topic is not drawing on it. Answer with the list of
> those numbers, for example [1, 3], or [] for none.

> **WITHOUT.** Which numbered SOURCES does the NEW WORK take none of the
> specific ideas, structure, wording, examples or facts from? Sharing only a
> topic with a source is taking none of them. Answer with the list of those
> numbers, for example [2], or [] for none.

Each question is asked twice: with the sources numbered in the order the author
listed them, and with the order reversed and the numbers relabelled. The
answers are mapped back to the listed order in code:

| asking | numbering | question |
|---|---|---|
| `listed/draws` | SOURCE_1 is the first source listed | DRAWS |
| `reversed/draws` | SOURCE_1 is the last source listed | DRAWS |
| `listed/without` | SOURCE_1 is the first source listed | WITHOUT |
| `reversed/without` | SOURCE_1 is the last source listed | WITHOUT |

Every source, and the new work, is shown whole: the door caps every text at
1,500 characters, so the round judges all of each listed source. A list answer is read strictly: `{"answer": [...]}` holding
whole numbers from 1 to the number of sources, each at most once. A string, a
fraction, a boolean, a repeat, a number out of range or `"unclear"` reads as
unclear.

| the four answers | stored |
|---|---|
| both DRAWS orders give the same set, both WITHOUT orders give the same set, and DRAWS is exactly the complement of WITHOUT | `{"mask": "10"}`: one character per listed source, `1` drawn on, `0` not |
| anything else | `{"mask": "unclear"}` |

A reader led by the numbers rather than the texts, one that always names source
1, names a different source in the reversed numbering, and lands in `unclear`.
So does a reader that calls one source both drawn on and taken nothing from, or
neither. A work that lists no source asks nothing: its lineage is empty and it
is sellable.

### The claim round, when a left-out author claims

> **DRAWS.** Does the NEW WORK really draw on the SOURCE? Drawing on a source
> means reusing its specific ideas, structure, wording, examples or facts;
> sharing only a topic is not drawing on it. Answer "yes" if it draws on the
> SOURCE. Answer "no" if it does not. Answer "unclear" if you cannot tell.

> **WITHOUT.** Does the NEW WORK take none of the specific ideas, structure,
> wording, examples or facts from the SOURCE? Answer "yes" if it takes none of
> them: at most it shares a topic with the SOURCE. Answer "no" if it takes some
> of them. Answer "unclear" if you cannot tell.

Neither question joins a second condition: WITHOUT is DRAWS turned round, word
for word, so an honest reader's two answers are exact opposites.

Each asked with the new work first and with the source first:

| DRAWS, both orders | WITHOUT, both orders | stored | what happens in the same transaction |
|---|---|---|---|
| yes, yes | no, no | `drawn` | the source takes a free seat in the royalty set, or, with none free, the seat of the latest source a claim added (always later than it); the claim bond stays in the claimant's credit; the work's author bond goes to the claimant, once per work and only while it is held |
| no, no | yes, yes | `not_drawn` | the claim bond goes from the claimant's credit to the work's author |
| anything else | | `unclear` | nothing moves |

### Agreement

Every validator reruns all four askings of its round and compares the stored
value, the mask or the claim word, by exact string equality. A validator whose
own rerun raises disagrees, and a leader that raised is never agreed with, so no
error is ever stored as if it were an answer. Every `gl.nondet` call is inside
the two leader closures; nothing is nested.

The leader's four answers come back in the result, keyed by asking, so a run
shows why it landed where it did (`{"listed/draws": "10", "reversed/draws":
"10", "listed/without": "01", "reversed/without": "01"}`). They are not
compared and never stored, and the contract returns them only when they are
well formed and combine to the value that was agreed.

### The prompt boundary

Every title and text reaches the model fenced (`<` and `>` replaced, never
deleted) between delimiter lines tagged with the sha256 of the block's own
fenced text, after a paragraph that declares every block untrusted. The door
only admits printable ASCII on one line, so no look-alike bracket can draw a
delimiter the fence does not know. The model never sees an amount or an
address. The largest possible prompt, four sources and a new work all at full
length, is 9,380 characters.

## Who may do what

| call | who | refused how |
|---|---|---|
| `deposit()` | anyone, for their own credit | a call that sends nothing returns `ok: false` with everything sent |
| `withdraw(amount_atto)` | anyone, from their own credit | raises `[EXPECTED] ...`; nothing was sent |
| `submit_work(title, text, sources_json)` | anyone; the sender is the author | raises `[EXPECTED] ...` before any model is asked: a source id that does not exist or repeats, a text already registered (capitals, spaces and punctuation aside), a missing author bond, no clock |
| `reread(work_id)` | the author of an unclear work, once | raises `[EXPECTED] ...` |
| `claim(work_id, source_id)` | only the author of the earlier source | raises `[EXPECTED] ...` before any model is asked: a listed source, a newer source, the claimant's own work, a retracted work, a pair already judged, no free seat and a source later than every one a claim added, a missing claim bond |
| `retract(work_id)` | the author, while the work was never sold through the registered consumer | raises `[EXPECTED] ...` |
| `release_bond(work_id)` | the author, a day after registering | raises `[EXPECTED] ...` |
| `register_consumer(address)` | the deployer, once | raises `[EXPECTED] ...` |

`submit_work` and `claim` take no value. A consensus round can end with nothing
stored, and value sent with such a call is not safely returned, so bonds come
from `deposit()`, which asks no model, and are taken only once the round has
produced a value. A round that stores nothing leaves the credit where it was.

## The money

| moment | from | to | amount |
|---|---|---|---|
| `deposit` | anyone | contract, credited to them | what they send |
| `submit_work` | the author's credit | the work's author bond | 0.2 GEN |
| `claim`, read `drawn` | the work's author bond | the claimant | 0.2 GEN, once per work, while it is held |
| `claim`, read `not_drawn` | the claimant's credit | the work's author | 0.05 GEN |
| `retract`, an unclear work or one drawing on no listed source | the author bond, if held | the author's credit | 0.2 GEN |
| `retract`, a judged work drawing on listed sources | the author bond, if held | the credit of the authors of those sources, in equal shares | 0.2 GEN |
| `release_bond`, after a day | the author bond, if held | the author's credit | 0.2 GEN |
| `withdraw` | contract | the depositor | any part of their credit |
| Bookstall `buy` | the buyer | each author in the royalty set, and the work's author | 30% of the price in equal shares; the integer remainder and the other 70% to the work's author |

The contract therefore holds only author bonds and credit, and `stats()`
publishes the sum as `balance_owed`. The offline suite checks it against the
contract's books after every step of forty seeded random journeys.

### Every settlement is bounded

- `claim()` judges one pair, writes one row and makes at most one transfer;
  it reads no earlier claim.
- `retract()`, `release_bond()` and `withdraw()` read one row (a retract that
  forfeits also writes at most four credit rows); the first two move nothing
  out at all.
- Every loop runs over at most four listed sources, six royalty seats or one
  page of twenty rows. `claims_of` and `works` page at 20.
- The Bookstall's payout loop runs over the royalty set: at most six.
- **No count of claims closes a work.** Each pair is judged once and only the
  author of the earlier source may claim it, so nobody can burn somebody
  else's claim. The one cap a claim meets is the six seats of the royalty set:
  the listed sources the network marked drawn hold theirs, and every other
  seat is open, so a work that lists nothing has six. Only claims the network
  agreed were drawn take a seat, and with none free a source earlier than the
  latest one a claim added is still judged and takes that seat. A copy is
  always registered after what it copies, so copies can never keep the
  original out.

A static test parses both contracts and fails on any loop whose bound is not a
named constant or a page clamp, and on any loop a write can reach that may run
more than six times.

## The consumer: Bookstall

`contracts/fixtures/bookstall.py` is bound, at deployment, to one Lineage
address. It is the contract that acts on the answer:

| call | who | what |
|---|---|---|
| `offer(work_id, price_atto)` | the work's author on Lineage | lists it at 0.1 to 20 GEN; a retracted work is refused |
| `buy(work_id)` | anyone, sending exactly the price | reads `work(id)` on the bound Lineage now; refused with a full refund unless its status is `judged` with a settled mask; otherwise 30% of the price is split equally over the royalty set Lineage publishes (at most six), the integer remainder and the rest go to the author, all in this call |
| `sales_of(work_id)` | view | what Lineage reads before it lets a work be retracted |

A work with an empty royalty set pays its author everything. Nothing is held
between calls.

## Why this has to be on GenLayer

Whether one text really draws on another is a judgement about meaning: W4 below
and W2 are both bread, both full of flour, dough, proving and baking, yet W4
takes nothing W2 says; W4 never mentions the hydration table W3, yet it reuses
W3's numbers and its test. No string match tells those apart. A single model call is one
reading its caller controls. Here every validator reads for itself, both
questions in both orders, and only a value they agree on moves money.

## Who uses it

- **A shared library of guides, recipes or course notes** where contributors
  build on each other and want credit to follow the reuse automatically.
- **Any marketplace contract** that reads `work(id).status` and `royalty`, as
  the Bookstall does, and pays the sources it was found to draw on.
- **Authors who were left out**: a claim costs 0.05 GEN and, when it holds,
  wins the 0.2 GEN author bond and a share of every later sale.

## The limits, stated plainly

- **Texts are at most 1,500 characters.** That is what lets every round read
  every source whole, so a listed source's verdict covers all of it.
- **A royalty set has six seats.** A work that draws on more than six sources
  pays the listed ones it was found to draw on and, of the rest, the earliest
  proven. An author who wants to shut a seventh source out has to write a work
  that really draws on six earlier ones.
- **The author bond pays only the first drawn claim, and only for a day.** That
  first claim can be the author's own second address, with a copy made before
  the work; the bond then comes home. The seat is what nobody can keep an
  original out of, and a copy is itself claimable by the original's author.
  After `release_bond` a drawn claim still wins its place, which is the lasting
  part.
- **A lineage is re-rolled only at a price.** A text is registered once
  (capitals, spaces and punctuation do not make it another), and a judged work
  retracted while its bond is held pays the bond to the sources it was found to
  draw on. New words with a fresh bond still get a fresh round.
- **An unclear lineage may be read once more, then the work is not sold.** Its
  author takes the bond back with `retract`.
- **A sold work cannot be retracted.** It can still have its bond released.
- **The deployer names the consumer whose sales freeze a work, once.** Before it
  is named, every author may retract.
- **English, in ASCII, on one line.** The door refuses anything else.
- **No readable clock, no work, claim, retract or release.** The clock is the
  message clock, `gl.message_raw["datetime"]`.

## What is in this repository

```
contracts/lineage.py                the contract
contracts/fixtures/bookstall.py     the consumer that reads it and moves money on its answer
tests/test_pure.py                  the offline suite, both contracts, both rounds with scripted models
tests/MUTATIONS.md                  every defence removed in turn, and the test that caught it
tests/on_chain/smoke.mjs            a throwaway-account run against Studio, both contracts
tools/mutate.py                     the generator that writes MUTATIONS.md and refuses to if anything survives
CONTRACTS.md                        purpose, consensus, state, methods, bounds, reuse and limits
DECISIONS.md                        why each rule is the way it is, and what is verified and what is not
```

## Running it

```
pip install -r requirements-dev.txt
pytest tests/ -q                                         # no network, no Studio
genvm-lint check contracts/lineage.py                    # the package is genvm-linter, the command genvm-lint
genvm-lint check contracts/fixtures/bookstall.py
python tools/mutate.py                                   # rewrites tests/MUTATIONS.md; exits 1 if a mutant survives
```

- `pytest tests/ -q` gives **261 passed** in a few seconds, with nothing
  installed but pytest.
- `genvm-lint check` version 0.11.0 prints `Lint passed (3 checks)` and
  `Validation passed` for both files, reads Lineage as 16 methods (8 view, 8
  write) and the Bookstall as 7 (5 view, 2 write), and exits 0.
- `python tools/mutate.py` removes or inverts **266 defences** one at a time,
  224 in the contract and 42 in the fixture, and **none survives**;
  `tests/MUTATIONS.md` names the test that failed for each.

The on-chain run generates its own keys and funds them over the network's own
RPC; it never touches a wallet of anybody's own:

```
npm ci
node tests/on_chain/smoke.mjs                  # the whole run, about 25 to 40 minutes
RESUME=1 node tests/on_chain/smoke.mjs         # continue a run that was cut off
STATE=run.json RESUME=1 node tests/on_chain/smoke.mjs
```

It plays five generated accounts. A writes W1, "Keeping a wild yeast starter"
(the 1:5:5 feeding ratio, the discard rule, the float test, the signs of a
hungry starter), and deploys both contracts; B writes W2, "Plaiting an
enriched loaf" (an egg and butter dough, a three-rope plait, a sesame crust:
bread, like W4, and nothing W4 uses); C writes W3, "Dough hydration at a glance" (what 65, 70, 75 and 80
percent feel like, and the windowpane test); D writes W4, "Your first weekend
sourdough", which plainly uses W1's feeding and float test and W3's 75 percent
and windowpane test, shares only its topic with W2, and lists W1 and W2 but not
W3. The network marks W4's lineage `10`. A stranger's
claim on W4 is refused, and so is A's claim for W1, which W4 lists. C claims
W3 and it is read `drawn`: C wins D's author bond. D offers W4 at 1 GEN and a
buyer pays it: 0.15 GEN to A, 0.15 GEN to C, 0.70 GEN to D, nothing to B. W1,
which lists no source, sells with everything to A. B retracts W2, never sold,
takes the bond back and withdraws it, and the Bookstall refuses to sell W2; D
is refused a retract of W4, which has sold. It prints one PASS or FAIL line per
check, reads every account's balance against the receipts, and compares the
deployed code of both contracts with these files byte for byte. Every step is
saved to the state file as it is made, so a run that outlives its process
continues where it stopped without sending anything twice.

## Network

Studio, chain 61999. RPC `https://studio.genlayer.com/api`, explorer
`https://explorer-studio.genlayer.com`. Both contracts pin the runner
`py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6` in their
first line.

## Evidence

Run on 19 October 2026 on GenLayer Studio (chain 61999) by `tests/on_chain/smoke.mjs`, from generated accounts funded from the
Studio faucet, none of them anybody's wallet: **A**, **B**, **C** and **D** write works, **S** is a stranger who writes nothing and buys. **43 passed, 0 failed**; transactions: 24 in 24 steps; sent a second time: none.
The whole log is `tests/on_chain/smoke-run.log`. W4 lists W1 and W2; the network agreed it draws on W1 and not W2 (mask 10), C proved W4 draws on the unlisted W3, and a 1 GEN sale paid 0.15 GEN to A, 0.15 GEN to C and 0.70 GEN to D in one transaction.

- `lineage` deployed at [`0x9D0C87720e03D55f0C568a009c747eD9DA70be0d`](https://explorer-studio.genlayer.com/address/0x9D0C87720e03D55f0C568a009c747eD9DA70be0d)
- `bookstall` deployed at [`0x43fA819C117b99F838bDc34D663FE1DF3b69Ab82`](https://explorer-studio.genlayer.com/address/0x43fA819C117b99F838bDc34D663FE1DF3b69Ab82)

- the code deployed at 0x9D0C87720e03D55f0C568a009c747eD9DA70be0d is byte for byte contracts/lineage.py: 72235 bytes, sha256 9537e24cf1d39fb24c1e5c83f1059f78b0f6ae8929c5f3a7e64ba52c3795480c
- the code deployed at 0x43fA819C117b99F838bDc34D663FE1DF3b69Ab82 is byte for byte contracts/fixtures/bookstall.py: 16236 bytes, sha256 572d03c59811196ae5a1f8025780e67d2429db0d74be5849f1b4462c2e810a15

| step | by | transactions | votes |
|---|---|---|---|
| A, the deployer, names the Bookstall as Lineage's consumer | A | [0xef2eeb00…](https://explorer-studio.genlayer.com/tx/0xef2eeb00343d2271ff5212b3dc9ac833d3e5d2bb96394f1ffd9af07c0ee58777), [0x3e9a3d67…](https://explorer-studio.genlayer.com/tx/0x3e9a3d6702daac941e428cc18bc469c6057773d651b363831f0fde7767baa0cc), [0xd4d2c3d9…](https://explorer-studio.genlayer.com/tx/0xd4d2c3d9b3d58c59a2de315dc813801fcbad742c470763e07760dba4bcafbc83) | 3 agree, 0 disagree, 2 idle |
| A deposits 0.2 GEN of credit, in a call that asks no model | A | [0x500e2d04…](https://explorer-studio.genlayer.com/tx/0x500e2d04116ff578f9b47ef48d7a5dd76bad2c45139cd8229ccca6875b95fe85) | 5 agree, 0 disagree, 0 idle |
| B deposits 0.2 GEN of credit, in a call that asks no model | B | [0x9ff35d4f…](https://explorer-studio.genlayer.com/tx/0x9ff35d4fcf95b22a26e1ff071ac65785e2916da149c3674e10f54a81c60a35ba) | 5 agree, 0 disagree, 0 idle |
| C deposits 0.25 GEN of credit, in a call that asks no model | C | [0x3fdf325e…](https://explorer-studio.genlayer.com/tx/0x3fdf325e9f8d6e78d62126e6e4be232b062a73567ca1ef4b48590bcd42aa1158) | 3 agree, 0 disagree, 2 idle |
| D deposits 0.2 GEN of credit, in a call that asks no model | D | [0xdf397a93…](https://explorer-studio.genlayer.com/tx/0xdf397a93b92c7ffc16a2821b8e8fa3c96aca548062fd6f4055e9464740ea7a9f) | 3 agree, 0 disagree, 2 idle |
| A registers W1, "Keeping a wild yeast starter", with no sources: nothing is asked and its lineage is empty | A | [0x52ecf1da…](https://explorer-studio.genlayer.com/tx/0x52ecf1da78796d4884a6d4093da670c922af51ffdfd4044ab2b250360452ded1) | 5 agree, 0 disagree, 0 idle |
| B registers W2, "Plaiting an enriched loaf", with no sources: nothing is asked and its lineage is empty | B | [0x1cfc746f…](https://explorer-studio.genlayer.com/tx/0x1cfc746f3c7d4f7d6dc3c0fde80b15126c687cde6a785b974a7cdfb2cb0839a5) | 4 agree, 0 disagree, 1 idle |
| C registers W3, "Dough hydration at a glance", with no sources: nothing is asked and its lineage is empty | C | [0x3988c616…](https://explorer-studio.genlayer.com/tx/0x3988c6166e753389b092776503e3a38f4887dba86b5113964a91919c44139f1c) | 3 agree, 0 disagree, 2 idle |
| D registers W4 listing W1 and W2: the four askings agree on mask "10", W1 drawn on and W2 not | D | [0x0841cea4…](https://explorer-studio.genlayer.com/tx/0x0841cea4663bdc38dcf153691cfeaa36427be5b60463b37a2473df4d32399d9a) | 3 agree, 0 disagree, 2 idle |
| S, who wrote nothing, claims W4 draws on W3 and is refused before any model is asked | S | [0x75fdeb2e…](https://explorer-studio.genlayer.com/tx/0x75fdeb2e338f1f32d0416db3ad0915dee2acc05071f36031797181522b77d82d) | 4 agree, 0 disagree, 1 idle |
| A claims W4 draws on W1 and is refused: W4 lists it and its lineage round judged it | A | [0xb6140078…](https://explorer-studio.genlayer.com/tx/0xb61400784415982b09c18b3f5d1834f530f6bf16f6e56228f6607153b6d03778) | 5 agree, 0 disagree, 0 idle |
| C claims W4 draws on W3: the four askings read it drawn, and W3 joins the royalty set | C | [0x4bd4aa5d…](https://explorer-studio.genlayer.com/tx/0x4bd4aa5dd703ceeac5cda6e35b1955691acd1190720af286bf11a65f4a5b4d41) | 3 agree, 0 disagree, 2 idle |
| D offers W4 at 1 GEN; the Bookstall reads it judged on Lineage | D | [0x201e9bd5…](https://explorer-studio.genlayer.com/tx/0x201e9bd594d66ae7ee7d6bbc17a7438bc8abcb7f7ac06b1411f49ebdedbd7e6e) | 3 agree, 0 disagree, 2 idle |
| S buys W4 for 1 GEN: 0.3 GEN of royalty split over A and C, 0.15 GEN each | S | [0x7d1472f5…](https://explorer-studio.genlayer.com/tx/0x7d1472f5048543739dd051fbe395124008d64439f8f17c8154b0c07562790054) | 3 agree, 0 disagree, 2 idle |
| W1, which lists no source, sells at 0.5 GEN and its author is paid all of it | A S | [0x53e4802f…](https://explorer-studio.genlayer.com/tx/0x53e4802fba57fc8b29a6f90b739f8fe7fd752d8bef73d2b2192241d47d269db5), [0x17fe589a…](https://explorer-studio.genlayer.com/tx/0x17fe589a34b3c3076cb18f7dd728d8a50aea98382ff05efa4a3050adb6db1a5c) | 3 agree, 0 disagree, 2 idle |
| B offers W2 at 0.5 GEN | B | [0x3464c7dc…](https://explorer-studio.genlayer.com/tx/0x3464c7dc3c5067ecb4bc7b34d5cf367751e30bfbee16c76e29d8bd9978f806d5) | 3 agree, 0 disagree, 2 idle |
| B retracts W2: Lineage reads the Bookstall, finds it never sold, and its 0.2 GEN bond comes back to B's credit | B | [0x3752816a…](https://explorer-studio.genlayer.com/tx/0x3752816a6f20db10a454ccbf6161d3bfa9ef7ae85fc83b452760b75fdbeb7440) | 3 agree, 0 disagree, 2 idle |
| S tries to buy the retracted W2: the Bookstall reads "retracted" from Lineage, refuses, and returns the 0.5 GEN | S | [0xd0ef14a6…](https://explorer-studio.genlayer.com/tx/0xd0ef14a64992b4cf9de383a8119b138a5ddacc466c177a205cb9fcb301721444) | 3 agree, 0 disagree, 2 idle |
| D tries to retract W4 and Lineage refuses: the Bookstall says it was sold | D | [0x39ee9033…](https://explorer-studio.genlayer.com/tx/0x39ee90330104ee79059ac010baf77a9ad1dd83d3058b32035937720cd558bb8e) | 3 agree, 0 disagree, 2 idle |
| B withdraws the 0.2 GEN its retracted work returned to credit | B | [0xa2d83eb0…](https://explorer-studio.genlayer.com/tx/0xa2d83eb086464c76dfaaab78728919f77730ab0a7a3be3deff4c4efa25ea1c6a) | 3 agree, 0 disagree, 2 idle |
| C withdraws the 0.05 GEN claim bond its drawn claim left in credit | C | [0x5c4a8083…](https://explorer-studio.genlayer.com/tx/0x5c4a808311b58d6f929d8f6788007b7dfcbaec00d6432a5b3a2d29518c43d506) | 3 agree, 0 disagree, 2 idle |

## Licence

MIT. See `LICENSE`.
