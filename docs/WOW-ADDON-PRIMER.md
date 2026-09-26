# WoW: Forever addon and macro primer

Read by the wow-ai bridge and sent with the system prompt on every run (`primerFile` in docs/CONFIGURATION.md); it costs tokens on every message.

## The client

- World of Warcraft: Forever is vanilla content on the current retail engine and UI code (the `Mainline` files, with 12.x-era deprecation shims). Interface number 16001. Lua 5.1.
- Blizzard's own UI code for this client is the `forever` branch of https://github.com/Gethe/wow-ui-source. Check there, or in game (`/dump type(SomeFunction)`), before trusting any function or template.
- Use the modern `C_` namespaces; many old globals are gone or exist only as temporary shims: `C_Item.GetItemInfo` (not `GetItemInfo`), `C_Spell.GetSpellInfo` / `C_Spell.GetSpellCooldown` (tables, not multiple values), `C_UnitAuras.GetAuraDataByIndex(unit, i, "HELPFUL")` (not `UnitBuff`), `C_Container.GetContainerNumSlots` / `GetContainerItemInfo` (tables), `C_AddOns`, `C_Timer`, `C_Map`. Only fall back when you have confirmed the old name exists: `(C_Item and C_Item.GetItemInfo) or GetItemInfo`. Skill lines are namespaced too: there is no bare `GetNumSkillLines` / `GetSkillLineInfo`, and `C_SkillInfo.GetSkillLineInfo(index)` returns one `SkillLineAttributes` table (`name`, `rank`, `maxRank`, …), not positional values. Trained professions: `GetProfessions()` (one skill-line index per slot, `nil` where a slot is empty) then `GetProfessionInfo(index)`. Talents have **no tab loop**: `GetNumTalentTabs` appears nowhere in this client, and `GetTalentTabInfo` / `GetTalentInfo` come only from `Blizzard_DeprecatedSpecialization`, which never loads on Forever (its `.toc` says `## AllowLoadGameType: classic, standard`), so neither shim exists in game. Use `C_SpecializationInfo.GetSpecialization()` then `C_SpecializationInfo.GetSpecializationInfo(specIndex)` → `specId, name, icon, role, pointsSpent, …`, as Blizzard's own Camelot `PaperDollFrame.lua:498,504` does.
- Beta quirk: the client sometimes wipes addon SavedVariables. Do not keep anything irreplaceable only there.

## Reading the game context the bridge hands you

A few `Key: value` lines about the character sit at the top of your prompt.

- `Stats: HP 1450, Mana 820, Armor 512, Str 68, ...` — effective sheet totals. A field can be **absent rather than 0** (secret on some maps), so never read a missing one as 0.
- `Gear: 7 of 19 slots filled (12 empty)` — a **count**, for the shape of the character.
- `Worn: Head Worn Helm(P), Neck Thick Necklace(C), …` — **what is equipped, item by item**: one entry per filled slot, `Slot Name(Q)` with a one-letter quality (P poor, C common, U uncommon, R rare, E epic, L legendary) — what a bag candidate would replace.
- `Bags: 4 of 7 items wearable -- Weapon Fine Longsword(U), …` — the **upgrades** in the backpack and bags 1-4 (a profession tool is not one), each labelled with the slot it competes for. `<n> of <m>` counts upgrades out of items found; `0 of 12 items wearable` is a real answer ("nothing in your bags is gear"), not a missing line.
- Both lists are **truncated to fit** and say so with `, +N more`: a trailing `+N more` means candidates you have not been shown, so never read a short list as complete — ask for the item to be shift-clicked when it matters.
- Either line can be **absent** (an API the client did not provide, or it would not fit beside your message). Absent is not "empty": no `Worn:` line means you do not know what is equipped; no `Bags:` line, what is in the bags.
- `Talents:` / `Professions:` absent is legitimate, not a bug.
- The block is capped and skipped when it will not fit beside a long message; `Position:` is the freshness clue.

## Addon layout

- `Interface\AddOns\<Name>\<Name>.toc` lists the files, in load order:
  ```
  ## Interface: 16001
  ## Title: My Addon
  ## Notes: What it does
  ## SavedVariables: MyAddonDB
  ## SavedVariablesPerCharacter: MyAddonCharDB
  ## Dependencies: OtherAddon
  ## LoadOnDemand: 0
  Core.lua
  UI.xml
  ```
- Files are discovered at client launch only: a new file or addon needs a full restart. Edits to existing Lua/XML files need just `/reload`.
- Every file receives `local addonName, ns = ...` (the addon name and a private table shared by its files). Use `local` for everything; globals are shared with every addon.
- SavedVariables are plain global tables, valid from `ADDON_LOADED` (arg1 == your addon name) and written on logout or `/reload`.

## Sandbox rules

- No networking, no file I/O, no `require`, `io`, `os`, `loadfile`. `time()`, `date()`, `GetTime()`, `print()` (to the chat frame) exist.
- Protected actions (casting, targeting, movement, using items) are never callable from addon code: only from a secure button (`SecureActionButtonTemplate` with `type`/`spell`/`macrotext`) the player presses, or from macros. `InCombatLockdown()` is true in combat: secure frames cannot be created, shown, hidden or re-anchored then — queue the change for `PLAYER_REGEN_ENABLED`.
- `ReloadUI()` and a few others need a hardware event (a real key or click), not a timer.
- Hook Blizzard code with `hooksecurefunc("FunctionName", fn)` (runs after, cannot break taint) instead of replacing functions — replacing a secure function taints it.

## Frames and events

```lua
local f = CreateFrame("Frame", "MyAddonFrame", UIParent, "BackdropTemplate")
f:SetSize(300, 200); f:SetPoint("CENTER")
f:SetBackdrop({ bgFile = "Interface\\Tooltips\\UI-Tooltip-Background", edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border", tile = true, tileSize = 16, edgeSize = 16, insets = { left = 4, right = 4, top = 4, bottom = 4 } })
f:RegisterEvent("PLAYER_LOGIN"); f:RegisterEvent("PLAYER_ENTERING_WORLD")
f:SetScript("OnEvent", function(self, event, ...) end)
local text = f:CreateFontString(nil, "OVERLAY", "GameFontNormal")
C_Timer.After(2, function() end); C_Timer.NewTicker(1, function() end)
SLASH_MYADDON1 = "/myaddon"; SlashCmdList.MYADDON = function(msg) end
```

- Templates: `UIPanelButtonTemplate`, `UIPanelCloseButton`, `UIPanelScrollFrameTemplate`, `InputBoxTemplate`, and `BackdropTemplate` (required for `SetBackdrop`).
- Useful events: `ADDON_LOADED`, `PLAYER_LOGIN`, `PLAYER_ENTERING_WORLD`, `PLAYER_REGEN_DISABLED`/`ENABLED` (combat start/end), `PLAYER_TARGET_CHANGED`, `UNIT_HEALTH`, `UNIT_AURA`, `BAG_UPDATE`, `PLAYER_LEVEL_UP`, `CHAT_MSG_*`, `COMBAT_LOG_EVENT_UNFILTERED` (read with `CombatLogGetCurrentEventInfo()`).
- Unit functions take a unit token: `"player"`, `"target"`, `"pet"`, `"party1"`, `"raid5"`, `"mouseover"`. `UnitName`, `UnitLevel`, `UnitClass` (localized, then token), `UnitHealth`/`UnitHealthMax`, `UnitPower`, `UnitExists`, `UnitIsDead`; auras with `C_UnitAuras.GetAuraDataByIndex(unit, i, "HELPFUL"|"HARMFUL")` or `AuraUtil.ForEachAura`.
- Items and spells: `C_Item.GetItemInfo(idOrLink)`, `C_Spell.GetSpellInfo(idOrName)` (table: name, iconID, castTime, ...), `C_Spell.GetSpellCooldown(id)`, `C_Spell.IsSpellUsable`, `GetInventoryItemLink("player", slot)`, `GetInventoryItemQuality`, bag contents via `C_Container.GetContainerNumSlots(bag)` / `C_Container.GetContainerItemInfo(bag, slot)` (table; bags 0..4).
- Tooltips: `GameTooltip:SetOwner(frame, "ANCHOR_RIGHT")`, then `SetUnit`, `SetHyperlink`, `SetBagItem`, `SetInventoryItem`. Read lines off a hidden tooltip (`MyScanTipTextLeft<i>:GetText()`).
- Text markup: `|cAARRGGBBtext|r` colour, `|Hitem:2140|h[Fine Longsword]|h` link, `|Ttexture:16|t` icon. Handle link clicks with `hooksecurefunc("SetItemRef", fn)`.
- The chat code is the modern `ChatFrameUtil` API: `InsertLink(text)` is what a shift-click calls, `GetActiveWindow()` the active edit box, `OpenChat(text)`. The old `ChatEdit_*` globals are aliases only; hook the table itself (`hooksecurefunc(ChatFrameUtil, "InsertLink", fn)`).
- Helpers Blizzard ships: `strsplit`, `strtrim`, `strjoin`, `tinsert`, `tremove`, `wipe`, `tContains`, `Mixin`, `StaticPopup_Show` with `StaticPopupDialogs["KEY"] = { text=, button1=, button2=, OnAccept=, timeout=0 }`.

## Macros

- 255 characters, one action per hardware press. `#showtooltip`, `/cast Spell`, `/use Item`, `/castsequence reset=combat A, B`, `/target`, `/focus`, `/cancelaura`, `/stopcasting`, `/equip`, `/run <lua>`.
- Conditionals: `[mod:shift]`, `[combat]`, `[harm]`/`[help]`, `[dead]`, `[exists]`, `[stance:1]`, `[@target]`/`[@mouseover]`/`[@player]`, `[nopet]`; combine with commas, separate alternatives with semicolons: `/cast [mod:alt,@player] Heal; [help] Heal; Attack`.
- Spell and item names are localized and must match exactly; ranks as `Spell(Rank 2)`.

## Debugging in game

- `/reload` after editing Lua; `/console scriptErrors 1` to see Lua errors; `/dump expr` to print a value; `/etrace` to watch events; `/fstack` to find the frame under the mouse; `/run` for one-liners.
- With wow-ai, the player is reading your reply in a small in-game window: give the file path and a short "what to do next" (`/reload`, or restart the client if you added a file).
