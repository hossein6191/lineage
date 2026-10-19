# Contracts

Two files. `contracts/lineage.py`, class `Lineage`, is the contract.
`contracts/fixtures/bookstall.py`, class `Bookstall`, is the consumer that reads
it and moves money on its answer.

## Lineage

### Purpose

A register of short works, each with the list of earlier works it says it draws
on. Before a work can earn anything, the network marks which of its listed
sources it really draws on. An author the work draws on without listing can
prove it, and wins the work's author bond and a seat in its royalty set. Every
sale through a consumer pays the authors of the sources in that set. A text is
registered once, and a judged work retracted while its bond is held pays that
bond to the sources it was found to draw on. Every claim
is settled in the call that judges it, each pair is judged once, and every loop
is bounded by a constant, so no settlement grows with the number of works or
claims.

### Consensus

Two rounds, each one `gl.vm.run_nondet_unsafe(leader_fn, validator_fn)` block
with four sequential askings in its leader closure. All eight
`gl.nondet.exec_prompt` calls in the file are inside those two closures. Nothing
is nested.

**The lineage round.** `_lineage_round(new_title, new_text, sources)` runs in
`submit_work()` when at least one source is listed, and in `reread()`. Its
askings are built by `_lineage_task(new_title, new_text, sources, framing,
order)`:

| `ASKED_LINEAGE` | framing | order | numbering |
|---|---|---|---|
| `listed/draws` | `FRAMING_DRAWS` | `ORDER_LISTED` | SOURCE_k is the k-th source listed |
| `reversed/draws` | `FRAMING_DRAWS` | `ORDER_REVERSED` | SOURCE_k is the k-th source from the end of the list |
| `listed/without` | `FRAMING_WITHOUT` | `ORDER_LISTED` | as listed |
| `reversed/without` | `FRAMING_WITHOUT` | `ORDER_REVERSED` | reversed |

The questions are `DRAWS_LIST` ("Which numbered SOURCES does the NEW WORK really
draw on? Drawing on a source means reusing its specific ideas, structure,
wording, examples or facts; sharing only a topic is not drawing on it. Answer
with the list of those numbers, for example [1, 3], or [] for none.") and
`WITHOUT_LIST` ("Which numbered SOURCES does the NEW WORK take none of the
specific ideas, structure, wording, examples or facts from? Sharing only a topic
with a source is taking none of them. Answer with the list of those numbers, for
example [2], or [] for none."): the plain negation of DRAWS, one condition each.
Every block shows its work whole; the door caps every text at `MAX_TEXT`
(1,500 characters), so the round judges all of each listed source.

`_read_numbers(raw, count, order)` reads one answer as a mask over the listed
order: `{"answer": [...]}` with whole numbers 1 to `count`, each at most once; a
number in a reversed asking is mapped back as `count - number`. Anything else is
`""`. `_combine_lineage(draws_1, draws_2, without_1, without_2)` returns the
DRAWS mask only when both DRAWS answers are the same non-empty mask, both
WITHOUT answers are the same mask, and the WITHOUT mask is the DRAWS mask turned
round (`_flip`); otherwise `unclear`. The stored value is `{"mask": ...}`.

**The claim round.** `_claim_round(new_title, new_text, source_title,
source_text)` runs in `claim()`. Its askings are built by `_claim_task(...,
framing, order)`: `DRAWS_ONE` ("Does the NEW WORK really draw on the SOURCE?")
and `WITHOUT_ONE` ("Does the NEW WORK take none of the specific ideas,
structure, wording, examples or facts from the SOURCE?"), each with the new
work first (`ORDER_NEW_FIRST`) and with the source first (`ORDER_SOURCE_FIRST`).
Each states what `yes` and `no` mean and offers `unclear`. Both texts are shown whole.
`_read_answer` reads `yes`, `no`, `unclear` (and a JSON boolean); anything else
is `""`. `_combine_claim`: DRAWS yes twice and WITHOUT no twice is `drawn`; DRAWS
no twice and WITHOUT yes twice is `not_drawn`; anything else is `unclear`. The
stored value is `{"v": ...}`.

**The comparison.** Each `validator_fn` is one line, `return
_agrees(leaders_res, leader_fn, key)` with `key` `"mask"` or `"v"`. `_agrees`
returns `False` for a leader that raised and for a result that is not a
dictionary, reruns the whole leader closure inside `try/except` (its own failure
is a disagreement), and compares the stored value by exact string equality.

**The readings in the result.** Each leader also returns `r`, its four answers
joined by commas. Only the stored key is compared and stored.
`_clean_lineage_readings` and `_clean_claim_readings` turn `r` into an object
keyed by asking for the call's result, and return `{}` unless there are exactly
four well-formed answers that combine to the agreed value.

**The prompt boundary.** `_block(label, text)` fences the text and writes it
between `<<<LABEL tag>>>` and `<<<END LABEL tag>>>`, `tag` being the first 16 hex
characters of the sha256 of the fenced body; it is the only place a delimiter is
written. The labels are the contract constants `NEW_WORK`, `SOURCE` and
`SOURCE_1` to `SOURCE_4`. Before the blocks each prompt says every block is
untrusted, that what a block says about the task or itself counts for nothing,
and that the numbering or the block order carries no meaning. No amount and no
address is a parameter of any task or round.

### State

Two storage dataclasses of scalars only (a collection inside a storage dataclass
kills the VM):

| `Work` field | type | what it is |
|---|---|---|
| `author`, `number` | `Address`, `u32` | who registered it, and its place in the register |
| `title`, `text`, `digest`, `length` | `str`, `str`, `str`, `u32` | the work as judged, the sha256 of its text, and its length |
| `listed`, `listed_count` | `str`, `u32` | the listed source ids, comma-joined, at most `MAX_LISTED` |
| `mask` | `str` | the stored lineage value: one `0` or `1` per listed source, `""` for none listed, or `unclear` |
| `added`, `added_count` | `str`, `u32` | source ids seated by agreed drawn claims: at most the seats the listed sources do not hold |
| `displaced` | `u32` | drawn claims whose source took the seat of a later added one |
| `status` | `str` | `judged`, `unclear` or `retracted` |
| `rereads` | `u32` | times the lineage was read again (at most `REREADS`) |
| `claims`, `drawn`, `not_drawn`, `unclear` | `u32` | judged claims, by verdict |
| `bond`, `bond_state`, `bond_to` | `u256`, `str`, `Address` | the author bond held, where it went (`held`, `to_claimant`, `released`, `returned`, `forfeited`) and to whom (zero when forfeited to several) |
| `opened_at`, `closed_at` | `u64` | when it was registered and retracted, on the message clock |

| `Claim` field | type | what it is |
|---|---|---|
| `work`, `source`, `n`, `claimant` | `str`, `str`, `u32`, `Address` | the pair, which judged claim on the work it was, and who claimed |
| `verdict` | `str` | `drawn`, `not_drawn` or `unclear`: the stored consensus value |
| `bond`, `won`, `to_author` | `u256` | the claim bond, the author bond it won, and what went to the work's author |
| `displaced` | `str` | the later source whose seat a drawn claim took when none was free, or `""` |
| `at` | `u64` | when it was judged |

| map | key | value |
|---|---|---|
| `work_rows` | `W1`, `W2`, ... (contract-assigned) | the `Work` |
| `claim_rows` | `W4:W3` | the one judged claim that W4 draws on W3 |
| `claim_index` | `W4:1`, `W4:2`, ... | the key of the n-th judged claim on W4 |
| `credit_rows` | `<address>` | that address's credit, in atto |
| `text_rows` | the sha256 of a text with capitals, spaces and punctuation taken out | the work that registered it, retracted or not |

`owner` is the deployer and `consumer` the registered consumer (the zero address
until named). `bonds_held` and `credits_held` are what the contract owes, and
their sum equals its balance after every call.

### Key methods

| method | kind | what it does |
|---|---|---|
| `deposit()` | payable write | credits the value to the sender; asks no model; a call that sends nothing returns `ok: false` and the value |
| `withdraw(amount_atto)` | write | part or all of the sender's credit, one transfer |
| `submit_work(title, text, sources_json)` | write, takes no value | the doors (title 3 to 80, text 200 to 1,500, ASCII on one line; a JSON list of 0 to 4 distinct existing ids; a text not yet registered; a clock; the author bond in credit) raise before any model; then the lineage round if anything is listed; stores the work, registers its text and takes the author bond from credit |
| `reread(work_id)` | write | the author of an unclear work, at most once: the lineage round again over the same sources |
| `claim(work_id, source_id)` | write, takes no value | the doors (only the source's author; not on their own work; not a retracted work; the source earlier and not listed; the pair not yet judged; a free seat, or a source earlier than the latest one a claim added; a clock; the claim bond in credit) raise before any model; then the claim round, settled in this call: drawn takes a free seat, or the seat of that latest added source |
| `retract(work_id)` | write | the author, while the registered consumer reports no sale: the work is never sold again; a held author bond goes back to the author's credit when the lineage is unclear or marks no listed source drawn, and otherwise to the credit of the authors of the listed sources it marks drawn, in equal shares |
| `release_bond(work_id)` | write | the author, `BOND_HOLD` after registering: the author bond back to credit |
| `register_consumer(address)` | write | the deployer, once |
| `work(work_id)` | view | the work without its text: status, mask, listed and added sources, the royalty set as addresses and ids, the bond and the counts |
| `text(work_id)` | view | the title and text |
| `royalty(work_id)` | view | the royalty set: up to six source ids, each with its author and `listed` or `claimed` |
| `claims_of(work_id, offset, limit)` | view | a page of at most 20 judged claims on one work |
| `works(offset, limit)` | view | a page of at most 20 works |
| `credit(who)` | view | one address's credit |
| `stats()` | view | counts, `bonds_held`, `credits_held`, `balance_owed`, the owner and the consumer |
| `rules()` | view | both questions word for word, the askings, both combine rules, what is compared, the money, the bounds, who may do what, every limit |

Every view takes ids, small integers or an address: a Studio read fails once the
encoded call passes 256 bytes.

### Bounds

| constant | value | what it bounds |
|---|---|---|
| `MAX_LISTED` | 4 | listed sources; the loops of `_read_sources`, `_unknown`, `_sources`, `_lineage_task`, `_read_numbers`, `_drawn_authors`, `_credit_shares` and the listed part of `_royalty` |
| `MAX_ROYALTY` | 6 | the seats of a royalty set, listed and claimed together; the loops of `work()`, `royalty()`, `_royalty_ids`, `_latest` and the claimed part and whole of `_royalty` |
| `PAGE_CAP` | 20 | rows per page of `works()` and `claims_of()` |

`claim()`, `retract()`, `release_bond()`, `withdraw()` and `deposit()` contain no
loop of their own; what they reach runs at most six times. The only other loops read the characters of one capped argument or the
parts of the message clock. A static test fails on any other loop, and on any
loop a write can reach that may run more than six times.

### Reuse

`work(id)` is the reusable answer: `status` `judged` means the network settled
which listed sources the work really draws on, and `royalty` lists the authors
every sale should pay, including those who proved they were left out. A shop, a
course platform or a licence contract reads it and pays accordingly. The rounds
are reusable on their own: `_lineage_round` marks which of a list of texts a
new text draws on, and `_claim_round` decides it for one pair, each with every
disagreement stored as `unclear` rather than smoothed away.

### Limits

- Texts are at most 1,500 characters, so every round reads every source whole.
- At most six sources pay: the listed ones marked drawn, then the earliest
  sources claims proved drawn.
- The author bond pays only the first drawn claim, and only until it is
  released, a day after registering; that claim can come from the author's own
  second address.
- A text is registered once; capitals, spaces and punctuation do not make it
  another, but changed words do.
- An unclear lineage is read again once; then the work is not sold.
- The consumer whose sales freeze a work is named once, by the deployer.
- English texts in printable ASCII on one line.
- A transaction with no readable clock is refused, never guessed.

## Bookstall

### Purpose

The consequence. One Bookstall is bound to one Lineage address at deployment.
The author of a work offers it at a price; anybody buys a copy. The sale is
decided by Lineage's own view of the work, read in the same call: only a
`judged` work with a settled mask sells, and 30% of the price is split equally
over the royalty set Lineage publishes, the integer remainder and the other 70%
going to the work's author.

### State

`Offer` (`work`, `seller`, `price`, `sales`, `to_author`, `royalty_paid`,
`number`) and `Sale` (`work`, `buyer`, `seller`, `price`, `payees`, `share`,
`to_author`), scalars only. `offer_rows` keyed by work id, `order_rows` keyed by
offer number, `sale_rows` keyed `W4:<buyer>`, the bound `lineage` address and
scalar counters. The stall holds nothing between calls.

### Key methods

| method | kind | what it does |
|---|---|---|
| `offer(work_id, price_atto)` | write | the author on Lineage, 0.1 to 20 GEN; a retracted work is refused; the same author may change the price |
| `buy(work_id)` | payable write | checks the id, the offer, a first copy for this buyer and the exact price, then reads `work(id)` on Lineage inside `try/except`; refuses with a full refund unless the row is this work's, names the offer's seller, is `judged`, has a mask of one 0 or 1 per listed source, and a royalty set of at most six addresses; then pays every share and the author in this call |
| `sales_of(work_id)` | view | copies sold here: what Lineage reads before a retract |
| `listing(work_id)`, `holding(work_id, who)`, `listings(offset, limit)`, `stall()` | views | one offer, whether an address holds a copy and how its price was divided, a page of at most 20 offers, the binding and the totals |

### What it trusts

Only the bound Lineage address, and only a reply that is a JSON object for the
work asked about. A reply it cannot read, a row for another id, an author other
than the offer's seller, a mask that is not settled, or a royalty set that is
not a list of at most six addresses is a refusal with the price returned, never
a raise inside a payable call.
