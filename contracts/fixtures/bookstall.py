# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

"""Bookstall: sells a work only once Lineage has agreed on its sources, and pays their authors in the same call.

One bookstall is bound, at deployment, to one Lineage contract. The author of a
work on that contract may offer it here at a price. Anybody may buy a copy, and
the sale is decided by Lineage's own view of the work, read here and now in the
same call:

    status "judged"        -> ROYALTY_BPS of the price (30%) is split equally over the royalty set Lineage
                              publishes for the work, the integer remainder and the rest of the price go to
                              the author, and the buyer holds the copy
    "unclear", "retracted" -> refused, and everything the buyer sent comes back
    or anything Lineage
    cannot answer

The royalty set is the authors of the listed sources the network agreed the
work really draws on, and of the sources an uncredited author proved it draws
on: at most six. A work whose set is empty pays its author everything. So a
work whose list of sources the network could not settle is never sold here, and
every sale of a work that settled pays the authors it was found to draw on.

The bookstall binds the Lineage address its deployer knows independently. The
seller and the price are fixed by the offer, and the offer is the author's: the
stall asks Lineage who wrote the work and refuses anybody else. Nothing is held
here between calls: every price is paid out in the call that took it. Lineage
reads sales_of(work) from its registered consumer, so a work sold here can no
longer be retracted there.

No model runs here. It is a fixture: small on purpose, and here to be read.
"""

import json
import typing
from dataclasses import dataclass

from genlayer import *


ERROR_EXPECTED = "[EXPECTED]"
GEN = 10 ** 18
MIN_PRICE, MAX_PRICE = GEN // 10, 20 * GEN    # 0.1 to 20 GEN
ROYALTY_BPS = 3000                            # of every price, split equally over the royalty set
BPS = 10000
MAX_ROYALTY = 6                               # seats in a Lineage royalty set, listed and claimed together
PAGE_CAP = 20
ZERO = "0x0000000000000000000000000000000000000000"
HEX = "0123456789abcdef"
DIGITS = "0123456789"

SELLABLE = "judged"                           # the only status under which Lineage marks a work sellable
NEVER_SELLABLE = ("retracted",)               # final on Lineage: an offer of one is refused outright

NOT_YET = {
    "unclear": "the network could not settle which of its listed sources it draws on; it can be bought once a "
               "reread on Lineage settles it",
    "retracted": "its author retracted it on Lineage; it is never sold here",
}


@gl.evm.contract_interface
class _Payee:
    class View:
        pass

    class Write:
        pass


def _fail(message: str) -> typing.NoReturn:
    raise gl.vm.UserError(ERROR_EXPECTED + " " + message)


def _low(address: typing.Any) -> str:
    return (address.as_hex if hasattr(address, "as_hex") else str(address)).lower()


def _is_address(text: typing.Any) -> bool:
    if not isinstance(text, str):
        return False
    s = text.strip().lower()
    return len(s) == 42 and s.startswith("0x") and all(ch in HEX for ch in s[2:]) and s != ZERO


def _is_work_id(text: str) -> bool:
    """Exactly the ids Lineage assigns: W, then 1 to 9 ASCII digits with no leading zero."""
    digits = text[1:]
    return (2 <= len(text) <= 10 and text[0] == "W" and digits[0] != "0"
            and all(ch in DIGITS for ch in digits))


def _whole(raw: typing.Any) -> int:
    """A non-negative whole number from an int or a string of ASCII digits, or -1. Never raises."""
    if isinstance(raw, bool):
        return -1
    if isinstance(raw, int):
        return raw if raw >= 0 else -1
    if isinstance(raw, str):
        s = raw.strip()
        if s and len(s) <= 40 and all(ch in DIGITS for ch in s):
            return int(s)
    return -1


def _is_mask(text: typing.Any, count: int) -> bool:
    """True when the text is exactly `count` characters, each 0 or 1: a settled lineage."""
    return isinstance(text, str) and len(text) == count and text.replace("0", "").replace("1", "") == ""


def _no_float(raw: str) -> typing.NoReturn:
    """The json.loads hook: a fraction, NaN or Infinity in Lineage's answer is refused, never built."""
    raise ValueError("no fractions: " + str(raw)[:20])


def _split(price: int, payees: int) -> typing.Tuple[int, int]:
    """(each royalty share, what the author gets). The integer remainder of the royalty goes to the author."""
    if payees <= 0:
        return 0, price
    share = price * ROYALTY_BPS // BPS // payees
    return share, price - share * payees


def _payees(seen: typing.Dict[str, typing.Any]) -> typing.Tuple[bool, typing.List[str]]:
    """(True, the royalty set's addresses) from Lineage's answer, or (False, []) when it is not a set this stall pays.

    A set longer than MAX_ROYALTY, or holding anything but an address, is
    refused whole, never cut short: a sale either pays the set Lineage
    published or does not happen.
    """
    raw = seen.get("royalty", None)
    if not isinstance(raw, list) or len(raw) > MAX_ROYALTY:
        return False, []
    out = []
    count = min(len(raw), MAX_ROYALTY)
    for i in range(count):
        if not _is_address(raw[i]):
            return False, []
        out.append(raw[i].strip().lower())
    return True, out


def _settled(seen: typing.Dict[str, typing.Any]) -> bool:
    """True when Lineage's answer carries a settled lineage: a mask of one 0 or 1 per listed source."""
    listed = seen.get("listed", None)
    return isinstance(listed, list) and len(listed) <= MAX_ROYALTY and _is_mask(seen.get("mask", None), len(listed))


@allow_storage
@dataclass
class Offer:
    work: str
    seller: Address
    price: u256
    sales: u32
    to_author: u256
    royalty_paid: u256
    number: u32


@allow_storage
@dataclass
class Sale:
    work: str
    buyer: Address
    seller: Address
    price: u256
    payees: u32
    share: u256
    to_author: u256


class Bookstall(gl.Contract):
    lineage: Address
    offer_rows: TreeMap[str, Offer]     # "W4"           -> the author's offer of W4
    order_rows: TreeMap[str, str]       # "3"            -> "W4", the third work offered here
    sale_rows: TreeMap[str, Sale]       # "W4:<address>" -> that address bought a copy of W4
    offer_count: u32
    sale_count: u32
    refusal_count: u32
    paid_total: u256
    royalty_total: u256

    def __init__(self, lineage: str) -> None:
        if not _is_address(lineage):
            _fail("the Lineage contract is a 0x address of 40 hex digits")
        self.lineage = Address(lineage.strip())
        self.offer_count = u32(0)
        self.sale_count = u32(0)
        self.refusal_count = u32(0)
        self.paid_total = u256(0)
        self.royalty_total = u256(0)

    @gl.public.write
    def offer(self, work_id: str, price_atto: str) -> str:
        """The author of a work on Lineage offers it here, or changes its price. Only that author.

        Not payable, so a refusal raises. A work Lineage has already marked
        retracted is refused: it could never be bought. An unclear one may be
        offered, and sells once a reread settles it.
        """
        wid = work_id.strip() if isinstance(work_id, str) else ""
        if not _is_work_id(wid):
            _fail("a work id is W followed by digits, as Lineage assigns it")
        price = _whole(price_atto)
        if not (MIN_PRICE <= price <= MAX_PRICE):
            _fail("the price is " + str(MIN_PRICE) + " to " + str(MAX_PRICE) + " atto (0.1 to 20 GEN), in digits")
        seen = self._seen(wid)
        if not seen or str(seen.get("work", "")) != wid:
            _fail("Lineage has no work " + wid)
        if _low(gl.message.sender_address) != str(seen.get("author", "")).lower():
            _fail("only the author of " + wid + " on Lineage may offer it")
        status = str(seen.get("status", ""))
        if status in NEVER_SELLABLE:
            _fail(wid + " is " + status + " on Lineage: " + NOT_YET[status])
        if wid in self.offer_rows:
            o = self.offer_rows[wid]
            o.price = u256(price)
        else:
            self.offer_count = u32(int(self.offer_count) + 1)
            self.offer_rows[wid] = Offer(work=wid, seller=gl.message.sender_address, price=u256(price),
                                         sales=u32(0), to_author=u256(0), royalty_paid=u256(0),
                                         number=u32(int(self.offer_count)))
            self.order_rows[str(int(self.offer_count))] = wid
        return json.dumps({"ok": True, "work": wid, "price": str(price), "status_on_lineage": status})

    @gl.public.write.payable
    def buy(self, work_id: str) -> str:
        """Pay exactly the price and hold a copy. Anyone; refused, with a refund, unless Lineage says judged.

        Never raises after taking value. Lineage is asked here, in this call,
        for the work's status, author and royalty set; only "judged" sells, and
        the royalty shares and the author's part are paid in the same call, so
        the stall never holds money.
        """
        value = int(gl.message.value)
        sender = gl.message.sender_address
        wid = work_id.strip() if isinstance(work_id, str) else ""
        o = self.offer_rows[wid] if wid in self.offer_rows else None
        payees, readable = [], False
        problem = ""
        if not _is_work_id(wid):
            problem = "a work id is W followed by digits, as Lineage assigns it"
        elif o is None:
            problem = wid + " is not offered here"
        elif (wid + ":" + _low(sender)) in self.sale_rows:
            problem = "this address already holds a copy of " + wid
        elif value != int(o.price):
            problem = "send exactly the price of " + wid + ", " + str(int(o.price)) + " atto; this call sent " + str(value)
        else:
            seen = self._seen(wid)
            status = str(seen.get("status", ""))
            readable, payees = _payees(seen)
            if not seen or str(seen.get("work", "")) != wid:
                problem = "Lineage could not answer for " + wid + "; nothing was sold"
            elif str(seen.get("author", "")).lower() != _low(o.seller):
                problem = "Lineage names another author for " + wid + " than the one who offered it here"
            elif status != SELLABLE:
                problem = (wid + " is " + (status or "unknown")[:16] + " on Lineage, not judged: "
                           + NOT_YET.get(status, "only a work whose sources were judged is sold here"))
            elif not _settled(seen):
                problem = "Lineage's mask for " + wid + " is not a settled lineage; nothing was sold"
            elif not readable:
                problem = "Lineage's royalty set for " + wid + " is not a list of at most 6 addresses; nothing was sold"
        if problem:
            return self._refuse(sender, value, problem)
        share, to_author = _split(value, len(payees))
        royalty = share * len(payees)
        self.sale_rows[wid + ":" + _low(sender)] = Sale(work=wid, buyer=sender, seller=o.seller, price=u256(value),
                                                        payees=u32(len(payees)), share=u256(share),
                                                        to_author=u256(to_author))
        o.sales = u32(int(o.sales) + 1)
        o.to_author = u256(int(o.to_author) + to_author)
        o.royalty_paid = u256(int(o.royalty_paid) + royalty)
        self.sale_count = u32(int(self.sale_count) + 1)
        self.paid_total = u256(int(self.paid_total) + value)
        self.royalty_total = u256(int(self.royalty_total) + royalty)
        # The money moves after everything above is written: one share per entry of the set, then the author.
        count = min(len(payees), MAX_ROYALTY)
        for i in range(count):
            _Payee(Address(payees[i])).emit_transfer(value=u256(share))
        _Payee(o.seller).emit_transfer(value=u256(to_author))
        return json.dumps({"ok": True, "work": wid, "price": str(value), "royalty": str(royalty),
                           "share": str(share), "paid_to": payees, "to_author": str(to_author),
                           "author": _low(o.seller), "status_on_lineage": SELLABLE})

    # ----------------------------------------------------------------- views

    @gl.public.view
    def listing(self, work_id: str) -> str:
        wid = work_id.strip() if isinstance(work_id, str) else ""
        if wid not in self.offer_rows:
            return json.dumps({"error": wid[:12] + " is not offered here"})
        o = self.offer_rows[wid]
        return json.dumps({"work": wid, "seller": _low(o.seller), "price": str(int(o.price)), "sales": int(o.sales),
                           "to_author": str(int(o.to_author)), "royalty_paid": str(int(o.royalty_paid))})

    @gl.public.view
    def sales_of(self, work_id: str) -> str:
        """How many copies of one work were sold here: what Lineage reads before it lets a work be retracted."""
        wid = work_id.strip() if isinstance(work_id, str) else ""
        sales = int(self.offer_rows[wid].sales) if wid in self.offer_rows else 0
        return json.dumps({"work": wid[:12], "sales": sales})

    @gl.public.view
    def holding(self, work_id: str, who: str) -> str:
        """Whether one address holds a copy of one work, and how its price was divided."""
        wid = work_id.strip() if isinstance(work_id, str) else ""
        addr = who.strip().lower() if isinstance(who, str) else ""
        key = wid + ":" + addr
        if key not in self.sale_rows:
            return json.dumps({"work": wid[:12], "who": addr[:42], "holds": False})
        s = self.sale_rows[key]
        return json.dumps({"work": wid, "who": addr, "holds": True, "price": str(int(s.price)),
                           "payees": int(s.payees), "share": str(int(s.share)), "to_author": str(int(s.to_author)),
                           "seller": _low(s.seller)})

    @gl.public.view
    def listings(self, offset: int, limit: int) -> str:
        """One page of offers, oldest first. `limit` is at most 20, so a reply always has a size."""
        n = int(self.offer_count)
        start = max(_whole(offset), 0)
        size = min(max(_whole(limit), 1), PAGE_CAP)
        count = min(max(n - start, 0), size, PAGE_CAP)
        rows = []
        for i in range(count):
            o = self.offer_rows[str(self.order_rows[str(start + 1 + i)])]
            rows.append({"work": str(o.work), "price": str(int(o.price)), "sales": int(o.sales)})
        return json.dumps({"total": n, "offset": start, "limit": size, "rows": rows})

    @gl.public.view
    def stall(self) -> str:
        return json.dumps({"lineage": _low(self.lineage), "offers": int(self.offer_count),
                           "sales": int(self.sale_count), "refused": int(self.refusal_count),
                           "paid_total": str(int(self.paid_total)), "royalty_total": str(int(self.royalty_total)),
                           "sells_only": SELLABLE, "royalty_bps": ROYALTY_BPS, "max_royalty_set": MAX_ROYALTY,
                           "price_atto": [str(MIN_PRICE), str(MAX_PRICE)]})

    # --------------------------------------------------------------- helpers

    def _seen(self, wid: str) -> typing.Dict[str, typing.Any]:
        """Lineage's own view of one work, read now, or {} when it cannot be read. Never raises."""
        try:
            seen = json.loads(str(gl.get_contract_at(self.lineage).view().work(wid)),
                              parse_float=_no_float, parse_constant=_no_float)
        except Exception:
            return {}
        return seen if isinstance(seen, dict) else {}

    def _refuse(self, sender: typing.Any, value: int, reason: str) -> str:
        """Return everything that was sent and say why. Never raises."""
        self.refusal_count = u32(int(self.refusal_count) + 1)
        if value > 0:
            _Payee(sender).emit_transfer(value=u256(value))
        return json.dumps({"ok": False, "reason": reason, "returned": str(value)})
