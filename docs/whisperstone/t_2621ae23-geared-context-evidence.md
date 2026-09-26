Whisperstone t_2621ae23 — the context block at a fully-geared character
=======================================================================
Evidence log. All output below is verbatim tool output. Commands and their raw
results, in the order they were run. Nothing here is recalled or estimated.

    Question the card asked: does the 700-byte context block still work at a
    fully-geared character, and if it breaks, fix the packing and prove it.

    Answer: it did NOT hold. The packing had an arithmetic hole -- the two
    inventory lines' separators were not both charged -- and at a geared
    character the assembled block reached 701 bytes, at which point the
    last-resort per-line cut amputated a whole real line to recover ONE byte.
    Fixed, with the measurement behind the change. A second question the card
    asked (the deferred-context threshold) is answered with a wire measurement.


1. WHAT WAS MEASURED
--------------------
Two things, both through the real addon Lua in the same fengari VM the suite
uses (tests/wow_stub.lua + Codec.lua + Inbox.lua + WoWAI.lua, unmodified):

  (a) the byte size of the block at a fully-geared character, line by line;
  (b) whether the reserved Talents/Professions tail survives, and whether the
      "+N more" marker appears on both lists.

Fixture provenance, because the shapes have to be REAL rather than invented.
Item names come from the project's own offline corpus,
StatForge-App/data/item-data.json (38,294 records, Classic Era), filtered to
requiredLevel <= 60 and itemId < 24000 (the manifest's own
eraMaxItemIdExclusive). Measured over 12,518 wearable names in that band:

    name length  p10 = 13, p50 = 18, p90 = 26, max = 44

Two fixtures were built from it: a MEDIAN-name set (a typical geared character)
and a MAX-name set (the longest real names the corpus can produce). Generator:
.hermes-verify/make_fixture.js. Both runs are below.


2. THE GEARED MEASUREMENT (the card's item 1)
---------------------------------------------
Command: node .hermes-verify/probe_geared.js

  === GEARED level 60, 17 worn MAX-length real names, bag with 20 real wearable items
      :: 687 bytes of 700 (slack 13) ===
    [  72] Game: World of Warcraft: Forever (client 1.60.1.69913, interface 16001)
    [  92] Character: Testchar on Test Realm, level 60 Night Elf Hunter (Alliance), guild <Test Guild>
    [  52] Location: Eastern Plaguelands - Light's Hope Chapel
    [  44] Position: 45.2, 67.8 on Duskwood (map 1431)
    [  33] Money: 1g 23s 45c; XP: 1234/5000
    [  76] Stats: HP 1450, Mana 820, Armor 512, Str 68, Agi 95, Sta 74, Int 61, Spi 52
    [  38] Gear: 17 of 19 slots filled (2 empty)
    [  68] Worn: Head Lieutenant Commander's Dragonhide Headguard(R), +16 more
    [ 142] Bags: 17 of 20 items wearable -- Head Lieutenant Commander's Dragonhide Headguard(R),
           Neck Twilight Cultist Medallion of Station(C), +15 more
    [  26] Talents: Beast Mastery 14
    [  45] Professions: Skinning 75/75, First Aid 40/75
    -- Worn +N more: YES
    -- Bags +N more: YES
    -- Talents line present: YES
    -- Professions line present: YES

So the shape the card worried about -- a 19-slot character whose lists are long
enough to overflow -- does NOT break the cap on its own: it packs to 687, the
"+N more" marker appears on BOTH lists, and both reserved lines survive.

Note what "17 worn" means: EQUIP_SLOT has no entry for Shirt (4) or Tabard
(19) -- a shirt can never be an upgrade -- so a 19/19 character contributes at
most 17 Worn entries. 17/17 is the fully-geared case for this line, not a
fixture shortfall.

The two lines cost 68 + 142 = 210 of the 700 bytes here. The lists are packed
to the remaining room and truncate with an explicit counter, which is the
behaviour the design intended, and it is measurably intact.


3. THE DEFECT — found by measurement, not by reading
----------------------------------------------------
The geared sweep in section 4 (678 shapes) failed on HEAD. The mechanism is
exact, and the instrumentation below prints every term.

Command: node .hermes-verify/probe_budget.js   (instrumented COPY of WoWAI.lua,
         written to .hermes-verify/; addon/WoWAI/WoWAI.lua is never touched)

  A. suite fixture (2-profession stub default)
    S (#existing lines, incl. their newlines) = 373
    reserved (tail bytes + 1)                = 71
    budget before bags                       = 256
    budget after bags, bagLine, wornLine     = 121, 134, 100
    assembled length BEFORE the cut          = 680   (CONTEXT_MAX = 700, over by -20)
    final block                              = 680 bytes, 11 lines

  B. four professions at max rank
    S                                        = 373
    reserved                                 = 113
    budget before bags                       = 214
    assembled length BEFORE the cut          = 701   (CONTEXT_MAX = 700, OVER by 1)
    final block                              = 614 bytes, 10 lines
    -> last line dropped: 87 bytes

The assembled block is ONE byte over the cap, and recovering that one byte
costs 87 bytes: the whole "Professions: ..." line. The block comes out at 614
with the tail gone -- 13% of the block, and the user's real data, spent on a
rounding error.

The arithmetic, and why the term was missing:

    final  = S + 1 + worn + 1 + bag + reserved      (each line needs a separator)
    budget = CONTEXT_MAX - S - reserved             <- only ONE separator charged
    worn  <= budget - (bag + 1)
    => final <= CONTEXT_MAX + 1                     <- so the block can reach 701

Two separators are needed (one per list) and only the bag line's was charged.
The worn line's was never accounted for anywhere, so a packing that computed to
exactly 700 assembled to 701 and fell through to the last-resort per-line cut.

Reproduced through the wire, against HEAD and against the fix, on the same
fixture (node .hermes-verify/probe_prefix_numbers.js; the pre-fix source is
read straight out of `git show HEAD:addon/WoWAI/WoWAI.lua`, not retyped):

  === PRE-FIX (git HEAD) :: worn=17/17, one bag item, live four professions ===
    ... 
    [ 171] Worn: Head Worn Helmxxxxxxxxxxx(U), ... , +12 more
    [  51] Bags: 1 of 1 items wearable -- Chest Dragonhide(R)
    [  26] Talents: Beast Mastery 14
    total 621 bytes, 10 lines
    Professions line present: false
    the line that was lost costs 80 bytes including its newline

  === WITH THE FIX :: same shape ===
    ...
    [ 140] Worn: Head Worn Helmxxxxxxxxxxx(U), ... , +13 more
    [  51] Bags: 1 of 1 items wearable -- Chest Dragonhide(R)
    [  26] Talents: Beast Mastery 14
    [  80] Professions: Blacksmithing 53/150, Mining 98/150, First Aid 67/75, Cooking 7/75
    total 670 bytes, 11 lines
    Professions line present: true

The trade is visible and is the intended one: the Worn list gives up one entry
(its +12 becomes +13) and the reserved Professions line survives. That is the
priority the block's own comments state -- "an inventory list that grew until
they fell off would be spending someone else's field to buy its own" -- and it
is now actually true at the size where it matters.

A word on how reachable this is. The trigger needs the assembled length to land
EXACTLY on 701, so it is alignment-sensitive rather than constant -- across the
678-shape sweep it fires on 24 shapes. But it is not exotic: it fires at the
corpus MEDIAN name length as well as the max, and it fires on the live
character's own four professions. The sweep that found it sweeps bag-name
length one byte at a time precisely because that is the lever that slides the
block through the boundary, and a character's bags change on their own.

  RED  wornCount{17,12,7} x bagLen 8..120 x profs{MAXED_TWO,LIVE_FOUR}, bags=1: 24/678 failures
       {"wornCount":17,"wornLen":20,"bagLen":10,"bags":1,"profs":4,"bytes":621,"hasPro":false,"whole":true}
       {"wornCount":17,"wornLen":20,"bagLen":11,"bags":1,"profs":2,"bytes":652,"hasPro":false,"whole":true}
       {"wornCount":17,"wornLen":20,"bagLen":41,"bags":1,"profs":2,"bytes":652,"hasPro":false,"whole":true}
       ...

`whole: true` is the tell: the surviving lines are intact, so the tail was not
chopped mid-value -- a whole line was dropped by the per-line cut, which is the
degradation path the packing was supposed to make unreachable.


4. THE FIX
----------
addon/WoWAI/WoWAI.lua, in WoWAI.GameContext()'s inventory block, three lines:

    -       local budget = CONTEXT_MAX - #table.concat(lines, "\n") - reserved
    +       local budget = CONTEXT_MAX - #table.concat(lines, "\n") - reserved - 2

plus the comment that records why: `reserved` pays for the separator in front of
the tail, and the two inventory lines need one separator EACH on top of it.
Charging both makes the bound exact:

    final = S + 2newlines + worn + 1 + bag + 1 + reserved
    budget = CONTEXT_MAX - S - reserved - 2
    worn + bag + 2 <= budget          =>   final <= CONTEXT_MAX   (as intended)

Nothing else about the packing changed: the order (bag first), the two-thirds
cap, the "+N more" reservation inside PackLine, and the reserved tail all
behave exactly as before. A first attempt restructured more than this and was
discarded for being larger than the defect -- the final change is one
subtraction.


5. THE INVARIANT, OVER EVERY SHAPE (the card's item 2 and item 3)
-----------------------------------------------------------------
New test in tests/addon_test.js:
  "a fully-geared character still fits, and the packing never overshoots the cap"

It sweeps 678 deterministic shapes (worn counts 17/12/7 x bag-name length
8..120 x two profession sets) and asserts, for each:
  * the block is never over CONTEXT_MAX (700);
  * every line is a complete "Key: value" line -- the per-line cut never fires;
  * the reserved Talents and Professions lines are never spent;
  * the bag line's own count and list add up (listed + "+N more" == the count).

RED, against HEAD (fix stashed, test kept):

    $ git stash push -- addon/WoWAI/WoWAI.lua
    $ node --test --test-reporter=tap tests/addon_test.js
    not ok 9 - a fully-geared character still fits, and the packing never overshoots the cap
        worn=17/17 bagNameLen=10 profs=4: the reserved Professions line was spent on list detail
    # tests 31
    # pass 30
    # fail 1

GREEN, with the fix:

    #       geared sweep: 678 shapes, worst block 699 bytes of 700 (slack 1), reserved tail spent 0 times
    #       worst shape: worn=17/17 bagNameLen=9 profs=4
    # tests 31
    # pass 31
    # fail 0

Two further sweeps, run outside the suite to widen the search well past what a
test file should carry:

  node .hermes-verify/probe_boundary.js -- 36,000 shapes, varying worn/bag name
  length and count, guild length 0..24, professions 0/2/4:
      shapes fuzzed: 36000
      max block seen: 699 bytes  (wornLen=12 bagLen=18 bags=8 profs=4 guild=0 -> 699B)
      over 700: 0
      shapes where the Professions line VANISHED though professions were readable: 0

  node .hermes-verify/probe_worn_reach2.js -- 7,200 realistic shapes (worn counts
  17/12/7, worn name lengths 8..44, bag name length 6..64, bag counts 1..44,
  guild 0/24, professions present/absent):
      shapes: 7200
      Worn absent: 0 (0.00%)   Bags absent: 0   Professions absent (tail spent): 0

  A parallel run of the same idea (11,328 shapes) agreed on every count:
      shapes: 11328, max block 699B
      Worn line absent:  0 (0.0%)
      Bags line absent:  0 (0.0%)
      Professions line absent with professions readable (the reserved tail spent): 0

So: a measured PASS with real headroom. The worst block the test's own sweep
produces is 699 of 700 (slack 1); the wider boundary probe reaches 700 exactly
in some shape families and never exceeds it. The margin is honest in the sense
that matters -- it is the margin of a bound that is now exact, not of a packing
that stops one byte early by luck. Before the fix the same sweeps produced
blocks that measured 700 while really being 701.


6. THE DEFERRED-CONTEXT THRESHOLD (the card's item 4)
-----------------------------------------------------
The second failure mode is not truncation: `ContextToSend(limit - #text)`
refuses to attach the context at all when it will not fit beside the message,
the bridge keeps serving the PREVIOUS context out of state.json, and the agent
goes on answering about gear the player has already replaced. The card asks for
the number. It is measured on the wire -- through WoWAI.SendFromInput() and read
back off the pixel strip, not derived from the formula.

Command: node .hermes-verify/probe_deferred.js
  (a fresh VM per message length, because the strip drops records when they pile
   up; the context is made to CHANGE first, since ContextToSend's equality gate
   is what a live player's moving money/XP/position defeats.)

  geared context block: 673 bytes of 700
  record limit = Codec.MAX_PAYLOAD - 300 = 2900
  formula: ContextToSend(room = 2900 - #text) defers when #text > 2227

  #text   ctx?   frameB
   2223   YES    2961
   2224   YES    2962
   2225   YES    2963
   2226   YES    2964
   2227   YES    2965
   2228   no     2291
   2229   no     2292
   2230   no     2293

  LAST length that carried the context: 2227
  FIRST length that did not:            2228

So at a geared character's block size the context stops riding along at a
message of 2228 bytes. Against the card's framing: the trigger is not a long
typed message (2228 bytes is ~30 lines of text) but a long message plus
shift-clicked item tooltips, which are the realistic filler -- LINK_BYTES_MAX is
900 bytes PER LINK, so three linked items overflow it on their own. The
in-test measurement, on the suite's own geared fixture (680-byte block),
confirms the same arithmetic at its own size:

    deferred-context boundary: the geared block is 680 bytes; a message of
    2220 bytes still carries it, 2221 does not (limit 2900 = MAX_PAYLOAD 3200 - 300)

Both numbers are asserted in the new test, so a future packing change cannot
silently move the boundary without the test saying so.


7. WHAT ELSE WAS CHECKED, AND WHAT WAS NOT
------------------------------------------
Checked and clean:
  * 36,000 + 7,200 + 11,328 + 678 shapes: no block over the cap, no partial
    line, the reserved tail never spent, the bag line's arithmetic always adds
    up (listed + "+N more" == the stated count).
  * The "+N more" marker appears on BOTH lists at a geared character
    (section 2), and on neither when the list fits -- the counter is present
    exactly when it is true.
  * The counts-only form of the bag line ("Bags: 2 of 2 items wearable, +2 more")
    still appears when nothing can be listed, and still accounts for the whole
    shortfall -- the two defects its own comments record as fixed.
  * docs/WOW-ADDON-PRIMER.md is at 8958 chars / 8984 bytes, under the 9000-char
    cap enforced by tests/bridge_test.js:81. This card did not edit it, because
    the primer's description of the two lists ("truncated to fit ... say so with
    `, +N more`", "Either line can be absent") is still accurate -- the packing
    fix changes no observable behaviour the primer describes.

NOT checked, stated plainly rather than implied:
  * No in-game run. The WoW client and the bridge were left running and were
    not restarted, per the card's constraint; every measurement here is in the
    harness. The live client's own block (694 bytes at 10/19 slots, four
    professions) is the starting point the card supplied, and it is consistent
    with the harness numbers rather than contradicting them.
  * The Worn line CAN be absent in an extreme shape (a 6-digit stat block, a
    24-char guild, a 12-char name and five maxed professions all at once, with a
    first bag entry long enough to consume the shared budget before Worn is
    packed). Measured in .hermes-verify/probe_why_worn.js: budget 122, bag cap
    81, counts-only floor line 70, so PackLine accepts one entry and charges 71
    off the budget, leaving 51 where the worn line's first entry needs ~56.
    That behaviour is IDENTICAL before and after this fix (.hermes-verify/
    probe_maxweight_compare.js shows both at the same sizes with the same lines
    present or absent) -- it is pre-existing, not a regression, and it is not
    reachable at realistic numbers: 0 of 7,200 realistic shapes and 0 of 11,328
    in the wider sweep hit it. It is named here rather than silently fixed,
    because the fix for it (charging the bag line's real cost against the worn
    line's room before Worn is packed) is a redesign of the two-thirds split and
    belongs on its own card with its own measurement.
  * The 20-item bag fixture is a single bag; a real character spreads items over
    five containers. The reader walks bags 0..4 either way and the shape is
    unchanged, but that specific arrangement was not separately exercised.


8. THE SUITE
------------
    $ npm test
    not ok 53 - resolveCwd: empty is the default, relative joins it, ~ is home, absolute wins
    not ok 55 - describeToolUse gives one short line per tool call
    # tests 60
    # pass 58
    # fail 2

Exactly the two pre-existing failures the card names, and no others. They were
NOT touched: the card forbids it and both are unrelated (PATH handling in
bridge/protocol.js under Linux). Before this card the suite reported 59 tests
(57 pass / 2 fail, per the parent card's handoff); it now reports 60 (58 pass /
2 fail). The +1 is the geared test added here, and the two failures are at
positions 53 and 55 -- the same two, renumbered by the insertion.
