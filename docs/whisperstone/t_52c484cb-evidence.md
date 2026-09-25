Whisperstone t_52c484cb — stat totals + filled/empty slot count in the game context
=================================================================================
Evidence log. Commit c46019b on main. All output below is verbatim tool output.

1. WHAT CHANGED
---------------
addon/WoWAI/WoWAI.lua — WoWAI.GameContext() gains two lines, inserted ahead of the
Talents/Professions lines:

    Stats: HP 1450, Mana 820, Armor 512, Str 68, Agi 95, Sta 74, Int 61, Spi 52
    Gear: 7 of 19 slots filled (12 empty)

New helper Plain()/Secret() gates every read: type() must say number AND issecretvalue()
must not flag it, else the field is dropped. Never `or 0`.

Placement is deliberate. WoWAI.lua:1186 enforces the 700-byte cap with
    if #s > CONTEXT_MAX then s = s:sub(1, CONTEXT_MAX) end
a silent tail-first cut with no marker. Appended ahead of Talents/Professions, an
overflow costs the two lines that are legitimately absent for a low-level character
anyway, not the gear data the agent needs.

2. RED — new tests against the pre-change addon
-----------------------------------------------
addon/WoWAI/WoWAI.lua restored to its 2bab866 content, tests/addon_test.js at c46019b:

    $ git checkout 2bab866 -- addon/WoWAI/WoWAI.lua
    $ node --test --test-reporter=tap tests/addon_test.js
    not ok 3 - the game context describes the character and rides on the hello, then only when it changes or is turned off
    not ok 6 - the game context sends stat totals and a filled/empty slot count, and stays inside the byte budget
    # tests 28
    # pass 26
    # fail 2

Test 6's failure message prints the block it actually got — no Stats line, no Gear line:

    error: |-
      Game: World of Warcraft: Forever (client 1.60.1.69913, interface 16001)
      Character: Testchar on Test Realm, level 23 Night Elf Hunter (Alliance), guild <Test Guild>
      Location: Duskwood - Darkshire
      Position: 45.2, 67.8 (map 1431)
      Money: 1g 23s 45c; XP: 1234/5000
      Talents: Beast Mastery 14
      Professions: Skinning 75/75, First Aid 40/75

3. GREEN — with the change
--------------------------
    $ node --test --test-reporter=tap tests/addon_test.js
    #       context block: 444 bytes of 700 (slack 256); +114 of it the two new lines
    # tests 28
    # pass 28
    # fail 0

    ok 3 - the game context describes the character and rides on the hello, then only when it changes or is turned off
    ok 6 - the game context sends stat totals and a filled/empty slot count, and stays inside the byte budget

4. FULL SUITE
-------------
    $ npm test
    #       context block: 444 bytes of 700 (slack 256); +114 of it the two new lines
    not ok 50 - resolveCwd: empty is the default, relative joins it, ~ is home, absolute wins
    not ok 52 - describeToolUse gives one short line per tool call
    # tests 57
    # pass 55
    # fail 2

Both failures are PRE-EXISTING and unrelated: verified by stashing the whole diff and
running at HEAD 2bab866, which produced the same two (then numbered 49 and 51) and
"# pass 54 / # fail 2". Root cause is POSIX-vs-Windows path handling in the assertions,
and the suite runs on Linux — not a path assumption this card introduced:

    not ok 9 - resolveCwd: ...
      + '/home/jnick/Whisperstone/C:\\work\\proj/D:\\elsewhere'
      - '/home/jnick/Whisperstone/D:\\elsewhere'
    not ok 11 - describeToolUse ...
      + 'edit C:\\x\\player.gd'
      - 'edit player.gd'

5. BYTE BUDGET — measured, not asserted
---------------------------------------
The block the real addon code produces, dumped through the same fengari VM the suite
uses (scratch script loads tests/wow_stub.lua + Codec/Inbox/WoWAI.lua unmodified):

  --- normal character (7 of 19 slots, all stats readable) ---
   1: [ 71 B] Game: World of Warcraft: Forever (client 1.60.1.69913, interface 16001)
   2: [ 91 B] Character: Testchar on Test Realm, level 23 Night Elf Hunter (Alliance), guild <Test Guild>
   3: [ 30 B] Location: Duskwood - Darkshire
   4: [ 31 B] Position: 45.2, 67.8 (map 1431)
   5: [ 32 B] Money: 1g 23s 45c; XP: 1234/5000
   6: [ 75 B] Stats: HP 1450, Mana 820, Armor 512, Str 68, Agi 95, Sta 74, Int 61, Spi 52
   7: [ 37 B] Gear: 7 of 19 slots filled (12 empty)
   8: [ 25 B] Talents: Beast Mastery 14
   9: [ 44 B] Professions: Skinning 75/75, First Aid 40/75
  TOTAL 444 bytes of CONTEXT_MAX 700 (slack 256) | 444 chars

  The two new lines are 75 + 37 = 112 B plus 1 newline each = 114 B, which is the
  figure the test prints. Under the 700 cap with 256 B of slack.

6. ABSENCE OVER ZEROS — the two hard-failure modes, measured
------------------------------------------------------------
  --- restricted map: all stat reads return a secret ---
  (STUB.stats = secrets; STUB.healthMax, STUB.powerMax, STUB.armor = secrets)
  6: [ 37 B] Gear: 7 of 19 slots filled (12 empty)
  TOTAL 368 bytes — NO Stats line at all, and no "Str 0".

  --- no equipped reader at all ---
  (GetInventoryItemLink = nil)
  6: [ 75 B] Stats: HP 1450, ... Spi 52
  TOTAL 406 bytes — NO Gear line. Not "Gear: 0 of 19 slots filled", which would read
  as a naked character rather than an unreadable one.

The test asserts both, plus the partial case (one secret Stat among five leaves the
other four in place and omits only that field).

7. API FACTS VERIFIED AGAINST BLIZZARD SOURCE, NOT ASSUMED
----------------------------------------------------------
Fetched Gethe/wow-ui-source@forever (raw.githubusercontent.com, HTTP 200) rather than
trusting the card's citations:

- Blizzard_APIDocumentationGenerated/UnitDocumentation.lua contains EXACTLY 11
  SecretWhenUnitStatsRestricted flags, at lines 337,647,666,684,1049,1071,2946,2964,
  3134,3200,3427 — the card's list, reproduced.
- Which functions those are (attributed by walking back to each block's Name):
  GetUnitSpeed, UnitArmor, UnitAttackPower, UnitAttackSpeed, UnitDamage, UnitDefenseSkill,
  UnitRangedAttackPower, UnitRangedDamage, UnitSpellHaste, UnitStat, UnitWeaponAttackPower.
- CORRECTION to the card's framing, and to this diff's own first draft: UnitHealthMax
  (:1472) and UnitPowerMax (:2801) are restricted too, but under DIFFERENT predicates
  (SecretWhenUnitHealthMaxRestricted / SecretWhenUnitPowerMaxRestricted), not the
  SecretWhenUnitStatsRestricted one. A guard written against a single named predicate
  would miss them. The comments in WoWAI.lua, tests/wow_stub.lua and tests/addon_test.js
  have been corrected to say this; Plain() gates by asking issecretvalue() directly, so
  it covers all of them regardless of flag.
- Return lists confirmed: UnitStat -> currentStat, effectiveStat, posBuff, negBuff (:3198);
  UnitArmor -> base, effective, real, bonus (:645). The addon reads effectiveStat and
  effective, which is what Blizzard's own character sheet displays
  (Camelot/PaperDollFrame.lua:694 `stat, effectiveStat, posBuff, negBuff = UnitStat(unit, statIndex)`).
- issecretvalue is documented at FrameScriptDocumentation.lua:287, "Returns true if a
  supplied value is a secret value" — reached through _G and pcall'd, so an older client
  without it degrades to no gate rather than an error.
- GetInventoryItemLink is a bare global with no C_Item twin, called unnamespaced by
  Blizzard's camelot PaperDollFrame.lua:2140 (`HandleModifiedItemClick(GetInventoryItemLink("player", self:GetID()), itemLocation)`).
- NUM_INVSLOTS is walked unguarded by the camelot-only character frame
  (Camelot/CharacterFrame.lua:38, `for i = 1, NUM_INVSLOTS do`) but is not defined by any
  camelot-loaded file, so the addon guards it: Plain(NUM_INVSLOTS) or Plain(INVSLOT_LAST_EQUIPPED)
  or 19 (INVSLOT_HEAD=1..INVSLOT_TABARD=19). A client reporting 12 slots reads as 12.

8. INSTALLED TO THE BETA CLIENT
-------------------------------
    $ sha256sum addon/WoWAI/WoWAI.lua ".../_classic_beta_/Interface/AddOns/WoWAI/WoWAI.lua"
    d6c44e16244c278b751a1def63a5939be05c33abd967171126a5ed62014af630  addon/WoWAI/WoWAI.lua
    d6c44e16244c278b751a1def63a5939be05c33abd967171126a5ed62014af630  .../AddOns/WoWAI/WoWAI.lua

9. NOT VERIFIED, AND NOT VERIFIABLE HERE
----------------------------------------
- In-game. No run has been performed with this block against the live client; every
  number above comes from the harness. The live block should read 444 bytes minus
  whatever the real character's lines cost (the live character carries no Talents line,
  being below level 10, and its Guild segment is absent).
- Whether UnitStat/UnitArmor actually return secrets on the maps this character plays.
  The gate is defensive: it behaves correctly either way, but nothing here proves the
  restriction bites in the open world. Settles it in game: `/dump issecretvalue(UnitStat("player", 1))`.
- No freshness timestamp was added, deliberately: the context only rides a record when it
  differs from the one the bridge last acknowledged (ContextToSend, WoWAI.lua:1193), so a
  stamp that moves would force a resend on every message. The cost of adding one was not
  measured because the design avoids needing it; §6 trap 1 of the scoping doc is why.

10. OUT OF SCOPE, UNTOUCHED
---------------------------
bridge/*.js, the itemised gear list, bags, the bank, the minimap button, the pixel-strip
transport and the slot pool — none modified. git diff --stat for the commit:
  addon/WoWAI/WoWAI.lua, docs/ARCHITECTURE.md, docs/WOW-ADDON-PRIMER.md,
  docs/whisperstone/PROJECT-NOTES.md, tests/addon_test.js, tests/wow_stub.lua

11. LIVE CLIENT, READ WHILE WRITING THIS
-----------------------------------------
The game is running and bridge/state.json was fresh (context.at 2026-09-25T22:03:28.124Z),
so the real block could be read instead of only modelled. Verbatim:

   1: [ 71 B] Game: World of Warcraft: Forever (client 1.60.1.70009, interface 16001)
   2: [ 84 B] Character: Longhairs on Classic Beta PvE, level 10 Windshaper Skyborne Rogue (Horde)
   3: [ 43 B] Location: Zephras Isle - Gustberry Lowlands
   4: [ 31 B] Position: 55.2, 75.8 (map 2521)
   5: [ 28 B] Money: 41s 18c; XP: 262/7600
   6: [ 16 B] Talents: Rogue 0
   7: [ 39 B] Professions: Fishing 4/75, Cooking 1/75
   318 bytes as sent, of the 700 cap.

Two things this live read settles:

- The parent cards WORK IN GAME. The Talents line is present and non-empty
  ("Talents: Rogue 0") at level 10, and the Professions line is present
  ("Professions: Fishing 4/75, Cooking 1/75"). Both were absent from the 234-byte block
  quoted in the card body, and the talents card's own handoff flagged in-game
  verification as not performable below level 10. It is now level 10 and the line
  renders. (Card body's live sample also names a different character, Nous / level 9
  Undead Warlock; the running character is now Longhairs, level 10 Rogue.)
- No Stats or Gear line in the live block, because the client still has the PRE-CHANGE
  addon in memory. Addon Lua is read at load, so the copy installed in section 8 needs
  a /reload (or a client restart) before it runs. Until then the live block is untouched
  by this change — which is also why this is not claimed as in-game verification of the
  new lines.

Projected live size once loaded: 318 + 112 (the two lines) + 2 (their newlines) = 432
bytes of 700 — 61% of the cap, 268 B of slack, consistent with the harness figure of 444
on a fixture whose Game/Character lines are longer and whose guild segment is present.

