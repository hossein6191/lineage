# Decisions

The boundary first, then the two rounds, the prompt, the storage, the money, why
every settlement is bounded and the doors, the consumer, then what is verified
and what is not.

## 1. The boundary: what the network agrees on

**A mask per work, a word per claim.** The lineage round stores one character
per listed source, `1` drawn on and `0` not, or `unclear`. The claim round
stores `drawn`, `not_drawn` or `unclear`. Both are values from closed sets the
contract wrote. What has to be decided is which earlier works a new one really
draws on, and a bit per source is the coarsest answer that carries it. A score
of how much it draws, a list of reused passages or a share of the royalty per
source would put values in storage that honest nodes could reach differently
while believing the same thing.

**It does not agree on how much a source is worth.** Every source in the royalty
set is paid the same share. Weighting sources by how much was taken would need
a number the network agrees on, and two readers who agree a source was used will
rarely agree on how much.

**What a program can check, the program checks.** Whether a listed id exists,
repeats, or is newer than the work; whether a text is already registered;
whether a claimed source is listed, is newer, is the claimant's own work, or was
already judged; whether a royalty seat is free, and if not whether the source
is earlier than the latest one a claim added; whether a credit holds the bond:
every one of these is decided in code before any model is asked. The network is asked only what code cannot answer:
does this text reuse that one's substance.

**It never sees money or people.** `_lineage_task` and `_claim_task` take titles,
texts, a framing and an order. No bond, no price and no address is a parameter,
and a test checks that none appears in any prompt either round sends.

## 2. Two questions, both orders, one block

**Two framings that negate each other.** The lineage round asks which sources the
new work draws on (DRAWS) and which it takes none of the specific ideas,
structure, wording, examples or facts from (WITHOUT). WITHOUT is DRAWS turned
round over the same five things, so an honest reader gives sets that are exact
complements over the listed sources. A reader that names a source in both
lists, or in neither, has not settled what it believes about that source, and
the round stores `unclear`, never a guess. The claim round does the same for one
pair with two yes/no questions: does it draw on the source; does it take none
of the source's specifics.

An earlier wording asked which sources the work "could have been written
without, because it shares at most a topic with them": a counterfactual joined
to a second condition. A work that names one invented fact from a source draws
on it under DRAWS, and could still have been written without it, so the two
answers stopped being opposites and an honest reader landed in `unclear`. A
test now fails on any question that carries "because", "could" or "without"
before its question mark, and checks that WITHOUT is DRAWS negated over the same
five things.

**Both numberings.** Every node builds the prompts the same way, so a reader that
favours source 1, or the first block, favours it on every node and consensus
alone would never see it. So each framing is asked twice: sources numbered in
the listed order, and reversed with the numbers relabelled. A reader led by the
number names a different source in each, and the two answers, mapped back to
the listed order, differ: `unclear`. The claim round asks each question with the
new work first and with the source first, for the same reason.

**All four in one block.** Nested nondet blocks are not legal, and separate blocks
would be separate rounds that could settle differently. One leader closure asks
all four sequentially and combines them in code, so every disagreement lands in
the stored value. There is no tolerance anywhere: the validators compare the
mask, or the word, by exact string equality.

**One plain thing per question, with what each answer means.** A yes/no
question that joins two conditions reads "unclear" where the honest answer is
clear, because a reader can satisfy one half and not the other. Each question
here asks one thing. The two list questions say what an empty list means; the
two claim questions say what `yes` and `no` mean right after the question.

**Lists parsed strictly.** A list answer counts only as `{"answer": [...]}` with
whole numbers from 1 to the number of sources, each once. A number as a string,
a fraction, a boolean, a repeat or a number out of range is malformed, and a
malformed answer reads as unclear rather than being repaired. A JSON fraction
is refused by the parser hook before it is built.

**The readings in the result.** Each leader also returns its four answers, `r`.
Only the mask or the word is compared and stored; comparing the readings would
turn validators who reached the same `unclear` by different splits into a
failed round. The readings come back in the call's result so a run shows why it
landed where it did, and only when they are well formed and combine to the
agreed value.

**Exact equality, and no agreement with an error.** A validator whose own rerun
raises disagrees; a leader that raised is never agreed with, so an unreachable
model is never stored as an answer.

## 3. The prompt

**The fence and the tag.** Every title and text passes through `_fence`, which
replaces `<` with `(` and `>` with `)` and never deletes. Each block sits between
two delimiter lines tagged with the first 16 hex characters of the sha256 of its
own fenced body. A work is public once registered, so a later author can copy
an earlier block's tag into a text; once fenced, that text holds no angle bracket
and cannot write a line that starts with `<<<`. A test plants a source's genuine
closing line inside a new work and finds exactly the expected delimiters in all
eight askings.

**ASCII on one line at the door.** The fence knows only the two ASCII brackets,
and Unicode has look-alikes a model reads as brackets, so the door refuses
anything outside printable ASCII, line breaks included.

**No cut: every text is short enough to read whole.** An earlier version let
texts run to 2,400 characters and cut each listed source to its first 1,500 in
the lineage round. A work could then reuse only the tail of a long source, list
it, be marked `0` for it, and the source's author could never claim, because a
listed source is not claimed again. So the door now caps every text at 1,500
characters, the length a round reads, and the round shows every source whole:
the verdict on a listed source covers all of it, and "its listing was judged"
is true. The largest possible lineage prompt is 9,380 characters, four sources
and a new work all at full length, under the 12,000 the rounds are kept below;
the largest claim prompt is 4,243.

**The declaration.** Before the blocks each prompt says every block is untrusted
text from authors, that what a block says about the task, the answer or itself
counts for nothing, and that the numbering or the order of the blocks carries no
meaning.

## 4. The storage

Scalars only inside the two `@allow_storage` dataclasses: a collection inside a
storage dataclass kills the VM. A work's listed and added sources are short
comma-joined strings of ids the contract checked, never lists. Claims are rows of
their own keyed `W4:W3`, indexed `W4:1`, `W4:2`, ... in the order they were
judged. Credit is one `u256` row per address. Ids are assigned by the contract
from its counter. The caller's list of sources is capped at 100 characters,
refused if it nests, and parsed with hooks that refuse fractions, NaN and
Infinity; every non-string argument is checked with `isinstance` before a string
method touches it.

## 5. The money

**Bonds come from credit.** `submit_work` and `claim` run consensus rounds, and a
round can end with nothing stored: an unreachable model, or no majority. Value
sent with a call that stores nothing is not safely returned. So neither call
takes value. `deposit()`, which asks no model, credits the sender, and the bond
is taken from that credit only after the round has produced a value. A round
that stores nothing leaves the credit where it was. A test drives a split
majority through each call and finds the state and the credit unchanged.

**The author bond, 0.2 GEN.** It is the price of leaving a source out. The first
claim the network agrees is drawn wins it. It comes back to the author's credit
on `release_bond` a day after registering, and on `retract` for a work never
sold whose lineage is unclear or marks no listed source drawn. After that a
drawn claim still seats its source in the royalty set, which is the lasting
reward; the bond is the incentive to claim promptly and the penalty for an
author caught early. The first drawn claim can be the author's own second
address, claiming with a copy registered before the work; the bond then comes
home. That is why the seat, not the bond, is what this contract protects: a
copy can never keep the original out of a seat (section 6), and a copy is
itself a work the original's author can claim against, for its own bond.

**Re-rolls.** A lineage round over a borderline source can settle differently on
another day, so an author who dislikes a mask would like to ask again. Two
rules make that cost something. A text is registered once: `text_rows` keys the
sha256 of the text with capitals, spaces and punctuation taken out, so the same
words, recased or repunctuated, are refused, whoever sends them and whether or
not the first work was retracted. And a judged work retracted while its author
bond is held pays that bond, in equal shares, to the credit of the authors of
the listed sources its mask marks drawn: exactly the authors a re-roll would
try to cut out. An unclear work, or one that draws on no listed source, gets
its bond back, because there is nothing to re-roll toward. New words with a
fresh bond still get a fresh round; what is gone is the free retry. The
forfeit is credit, not a transfer, so a retract moves nothing out of the
contract and loops over at most four listed sources.

**The claim bond, 0.05 GEN.** A claim that the network agrees is not drawn pays
it to the work's author, whose list was challenged and stood. A drawn claim and
an unclear claim leave it in the claimant's credit: showing that a work draws
on a source is the claimant's burden, but an unclear round shows nothing either
way, and since each pair is judged once there is nothing to re-roll.

**Every transfer is the last thing a call does.** State first, money after, and
tests read the state at the moment of each transfer.

**Conservation.** At every moment the contract holds the author bonds still
behind works and the credit of every address, no more and no less. The suite
checks the books after every step of forty seeded random journeys over both
contracts, and checks that everything drains to zero once every bond is released
and every credit withdrawn.

**Refusals.** The one payable call, `deposit`, refuses only a deposit of nothing,
and returns it with `{"ok": false, "reason", "returned"}`. Every other refusal is
`[EXPECTED] ...` from a call that took no value. A static test follows every
helper `deposit` reaches and finds no `raise`, no `_fail` and no round.

## 6. Why every settlement is bounded, and the one cap that remains

A settlement that walks a list of held bonds grows with the number of people who
joined, and past some count it no longer fits in a transaction.

**Pay as you go.** Each claim is settled in the call that judged it: one round,
one row, at most one transfer. `retract`, `release_bond` and `withdraw` read one
row. A test judges twenty-three claims on one work, replaces the storage maps
with maps that count every read, and finds the next claim reads one claim row,
the dedupe of its own pair; another finds that `retract` and `release_bond` read
none.

**Every loop has a constant bound.** The listed sources (`MAX_LISTED`, 4), the
seats of the royalty set (`MAX_ROYALTY`, 6), a page of `works` or `claims_of`
(`PAGE_CAP`, 20), and in the Bookstall the payout loop over the royalty set
(6). A static test parses both files and fails on any loop
that is not over `range(n)` with `n` assigned once to a `min(...)` holding a
module constant, over a local list appended to only inside such loops, or over
a tuple written out in the source, unless it reads the characters of one capped
argument. It also fails on any loop a write can reach that may run more than
six times.

**No cap a stranger can fill.** There is no cap on claims per work: a claim is
open only to the author of the earlier work it names, each pair is judged once,
and nothing walks the claims. So no address can use up anybody else's claim.
The remaining caps, and who can fill them:

| cap | filled by | why nobody else can fill it |
|---|---|---|
| `MAX_LISTED`, 4 listed sources | the work's author, in the work itself | it is the author's own list |
| `MAX_ROYALTY`, 6 seats | the listed sources the mask marks drawn, then sources claims the network agreed were `drawn` | a `not_drawn` or `unclear` claim takes nothing; with no seat free, an earlier source displaces the latest one claimed |
| `REREADS`, 1 reread | the work's author | only the author may reread |

**The seats.** A royalty set has six seats in all, not four listed and two
added. An earlier version capped the added part at two, so a work that listed
nothing, or listed sources it did not use, shut its third left-out author out
while two seats of a possible six were taken; listing nothing paid better than
listing honestly. Now the listed sources a settled mask marks drawn hold their
seats, every other seat is open to claims, and a work that lists nothing has
six. While a lineage is unclear each listed source keeps a seat, so whatever a
reread decides the set never passes six.

**Displacement, and why the cap is filled only by agreed outcomes on earlier
sources.** When no seat is free, a claim is judged only for a source earlier
than the latest one a claim added; if it is drawn, it takes that seat, and the
claim row names the source it displaced. Over any order of claims the claimed
seats therefore hold the earliest sources the network judged drawn (a seeded
journey checks exactly that). The case this answers: an author's second
address registers near-copies of a rival's text after it (a verbatim copy is
refused at the door), the author writes a work on them, and the second address
claims the open seats with the copies. Every copy is numbered after what it
copies, so the original's claim is still judged and takes a copy's seat. To keep
an author out, the seats must be full of sources earlier than theirs that the
network agreed the work really draws on: the work's author would have to write
a work that genuinely draws on six earlier texts. That is the one way left to
fill the cap, and the README states it as a limit. The seats are bounded at all
because the payout loop must be: a royalty set that could grow without limit
would make every sale a walk over it. A test plays the copy attack through to a
sale that pays the original's author.

## 7. The doors

| rule | why |
|---|---|
| only the author of the source may claim | a claim is the left-out author's; nobody else can spend, or burn, that pair |
| never on your own work | an author who wrote both should have listed it |
| never for a listed source | its listing was judged by the lineage round, which read all of it; a claim would re-roll it |
| never for a newer source | a work cannot draw on what came after it |
| never on a retracted work | it is never sold, so a seat in its royalty set is worth nothing |
| each pair once, whatever it read | no reading is re-rolled until it suits |
| with no seat free, only for a source earlier than the latest one claimed | the earliest sources proven keep the seats; a later one could only lose |
| a text is registered once | the same words cannot be sent again for a fresh lineage round, nor copied verbatim to take a seat |
| the claim bond must be in credit | checked before any model is asked |
| an unclear lineage is read again once, by its author | one more reading for a work the network could not settle, and no more |
| a sold work is not retracted | its buyers paid for a work whose royalty set they can see |
| the consumer is named once, by the deployer | before it is named nothing can have been sold through it; once named it cannot be swapped for one that reports no sales |
| no readable clock, no work, claim, retract or release | the bond hold is measured on the message clock, the same on every node |

**Every refused party has somewhere to go.** An author refused for an unknown
source lists the real one; one refused for a registered text changes the words
or claims against the work that holds them. A claimant refused for want of a
seat keeps the credit and withdraws it. An author whose lineage is unclear rereads; if it
stays unclear, retracts and withdraws the bond. An author who keeps a work
releases the bond after a day. A claimant refused for want of credit deposits
and claims again; one whose round stored nothing claims again or withdraws. A
buyer refused on an unclear work buys once a reread settles it, and one refused
on a retracted work buys what was kept. Each of these is a journey in the suite.

## 8. The consumer

A verdict that is only recorded moves nothing. The Bookstall is the consequence:
money moves, or does not, on Lineage's answer, in the same call.

**It reads the status and the royalty set, nothing else.** `buy` calls
`work(id)` on the bound Lineage address and sells only when the row is this
work's, names the offer's seller, is `judged`, has a mask of one 0 or 1 per
listed source, and carries a royalty set of at most six addresses. A set it
cannot read is refused whole, never cut short. The cheaper checks (the id, the
offer, a first copy, the exact price) come first, so most refusals make no
cross-contract read.

**Equal shares, the remainder to the author.** 30% of the price divided by the
number of entries in the set, in integers; the remainder and the other 70% go to
the work's author. An empty set pays the author everything.

**Lineage reads it back.** `sales_of(work_id)` is what Lineage asks before a
retract. It is the only view Lineage reads, from the one consumer its deployer
named.

## 9. Views

Every view takes ids, small integers or an address. A Studio read fails once the
encoded call passes 256 bytes, so no view takes a text. `works`, `claims_of` and
`listings` page at 20 and say the `total`.

## 10. Verified, and not verified

**Verified here, offline, with no network:** 261 tests, green. Both rounds are
driven with a scripted model per node: all 625 combinations of four list
answers over two sources through the lineage rule, all 256 combinations of four
yes/no answers through the claim rule, a reader led by numbers, a reader led by
block position, readers whose two questions overlap or repeat, malformed list
answers, one validator outvoted, a majority in another world storing nothing, a
validator whose own rerun raises, a leader that raised, and a round that stores
nothing leaving the credit untouched. The Bookstall reads the real Lineage
instance and Lineage reads the real Bookstall through a stubbed cross-contract
call. 266 defences removed or inverted one at a time, 224 in the contract and 42
in the fixture, none surviving, each with the test that caught it named in
`tests/MUTATIONS.md`. `genvm-lint` 0.11.0 passes on both files with exit code 0.

**Verified by construction, through static checks over the parsed source:** the
model is called only inside the two leader closures, four askings each, in every
pairing of the two framings with the two orders, combined through the combine
functions; the readings reach the result and nothing else; there are two rounds,
neither nested, run only in non-payable writes after every refusal and before
every write; each validator is one line delegating to the comparison, which
refuses a leader error first and compares by exact equality; every write either
refuses by sender or is listed with its reason (`deposit`, `submit_work`, `buy`);
the payable writes reach no raise; each cross-contract read is made in one
place, inside `try/except`; the delimiter is written in one place and carries
the body's hash; every value interpolated into a prompt is fenced or a contract
constant; every `json.loads` refuses floats; no float, no true division, no
`datetime`; every loop is bounded by a constant, and every loop a write reaches
runs at most six times; only drawn claims take a seat, and a displacement only
ever replaces the latest claimed source; a retract moves nothing out and
forfeits only to the sources a settled mask marks drawn; the smoke script
carries this suite's demo texts byte for byte; storage holds scalars
only; views take only short arguments; both files pin the runner in their first
line; no personal or internal detail appears anywhere in the repository.

**Verified on chain:** not yet. The on-chain run is recorded in the README once
it has run.

**Not verified:** how a live model reads the demonstration, in particular
whether it treats W2, the plaited loaf, as drawn on because both works are bread
(the honest answer is no: they share flour, dough, proving and an oven, and W4
takes none of W2's quantities, its plait, its glaze or its timings); how often a
borderline pair splits across the four askings; and which model the validators
run.
