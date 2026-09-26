-- A minimal stand-in for the WoW addon environment, enough to load and drive
-- WoWAI.lua outside the game (see addon_test.js). Frames are plain tables:
-- capitalized names that aren't listed below resolve to a no-op method, so any
-- SetFoo/EnableBar call is accepted; lowercase names are ordinary fields.
--
-- STUB collects what the addon did: frames, texts, timers, tickers, prints.

STUB = {
	frames = {}, texts = {}, timers = {}, tickers = {}, prints = {}, bindings = {},
	now = 1000, epoch = 1700000000, sounds = {}, loaded = {}, reloaded = false,
	tooltips = {}, zone = "Duskwood", subzone = "Darkshire", level = 23, money = 12345,
}

local function noop() end

local Methods = {}
local FrameMT = {
	__index = function(t, k)
		if type(k) == "string" and k:match("^%u") then
			return Methods[k] or noop
		end
	end,
}

local function NewObject(kind, name, parent)
	local o = setmetatable({ kind = kind, name = name, parent = parent, scripts = {}, hooks = {}, events = {}, shown = true, textures = {}, children = {} }, FrameMT)
	if name then _G[name] = o end
	if parent and type(parent) == "table" and parent.children then table.insert(parent.children, o) end
	return o
end

function Methods.SetScript(self, name, fn) self.scripts[name] = fn end
function Methods.GetScript(self, name) return self.scripts[name] end
function Methods.HookScript(self, name, fn) self.hooks[name] = self.hooks[name] or {}; table.insert(self.hooks[name], fn) end
function Methods.RegisterEvent(self, ev) self.events[ev] = true end
function Methods.UnregisterEvent(self, ev) self.events[ev] = nil end
function Methods.Show(self) self.shown = true end
function Methods.Hide(self)
	local was = self.shown
	self.shown = false
	if was and self.scripts.OnHide then self.scripts.OnHide(self) end
end
function Methods.SetShown(self, v) if v then self:Show() else self:Hide() end end
function Methods.IsShown(self) return self.shown end
function Methods.IsVisible(self) return self.shown end
function Methods.SetText(self, t) self.text = t; table.insert(STUB.texts, tostring(t)) end
function Methods.GetText(self) return self.text or "" end
function Methods.GetName(self) return self.name end
function Methods.GetParent(self) return self.parent end
function Methods.GetWidth(self) return self.width or 400 end
function Methods.GetHeight(self) return self.height or 300 end
function Methods.SetSize(self, w, h) self.width, self.height = w, h end
function Methods.SetWidth(self, w) self.width = w end
function Methods.SetHeight(self, h) self.height = h end
function Methods.GetSize(self) return self:GetWidth(), self:GetHeight() end
function Methods.GetStringHeight(self) return 14 end
function Methods.GetStringWidth(self) return 100 end
function Methods.GetFontString(self) return self end
function Methods.GetPoint(self) return "CENTER", nil, "CENTER", 0, 0 end
-- Minimap placement: the button reads the minimap's centre, size and scale, and
-- the cursor position while it is dragged.
function Methods.GetCenter(self) return self.centerX or 0, self.centerY or 0 end
function Methods.GetEffectiveScale(self) return self.scale or 1 end
function Methods.GetLeft(self) return (self.centerX or 0) - (self.width or 0) / 2 end
function Methods.GetTop(self) return (self.centerY or 0) + (self.height or 0) / 2 end
function Methods.SetPoint(self, point, rel, relPoint, x, y)
	if type(rel) == "number" then x, y = rel, relPoint end
	self.point, self.rel, self.relPoint = point, rel, relPoint
	self.x, self.y = x or 0, y or 0
end
function Methods.GetVerticalScrollRange(self) return 0 end
function Methods.CreateTexture(self, name, layer)
	local t = NewObject("Texture", name, self)
	table.insert(self.textures, t)
	return t
end
function Methods.CreateFontString(self, name) return NewObject("FontString", name, self) end
function Methods.CreateAnimationGroup(self) return NewObject("AnimationGroup", nil, self) end
function Methods.CreateAnimation(self) return NewObject("Animation", nil, self) end
function Methods.IsPlaying(self) return self.playing or false end
function Methods.Play(self) self.playing = true end
function Methods.Stop(self) self.playing = false end
function Methods.SetColorTexture(self, r, g, b, a) self.color = { r, g, b, a } end
function Methods.SetTexture(self, path) self.texture = path; return true end
function Methods.GetTexture(self) return self.texture end
function Methods.SetBackdrop(self, t)
	-- The real client would silently draw nothing; make it a test failure instead.
	assert(type(t) == "table", "SetBackdrop called with " .. tostring(t) .. " on " .. tostring(self.name or self.kind))
	self.backdrop = t
end
function Methods.SetFocus(self) STUB.focus = self end
function Methods.ClearFocus(self) if STUB.focus == self then STUB.focus = nil end end
function Methods.HasFocus(self) return STUB.focus == self end
function Methods.Insert(self, t) self.text = (self.text or "") .. tostring(t) end
function Methods.GetEditBox(self) return self.editBox end
-- Tooltip scanning: SetHyperlink fills <name>TextLeft<i> / TextRight<i> from
-- STUB.tooltips[link], a list of strings or { left, right } pairs.
function Methods.ClearLines(self) self.lines = {} end
function Methods.NumLines(self) return #(self.lines or {}) end
function Methods.SetHyperlink(self, link)
	self.lines = STUB.tooltips[link] or {}
	for i, l in ipairs(self.lines) do
		local left, right = l, nil
		if type(l) == "table" then left, right = l[1], l[2] end
		local L = NewObject("FontString", self.name .. "TextLeft" .. i, self)
		L.text = left
		local R = NewObject("FontString", self.name .. "TextRight" .. i, self)
		R.text = right
		R.shown = right ~= nil
	end
end

function CreateFrame(kind, name, parent, template)
	local f = NewObject(kind, name, parent)
	f.template = template
	table.insert(STUB.frames, f)
	return f
end

-- Fire an event on every frame that registered for it.
function STUB.FireEvent(ev, ...)
	for _, f in ipairs(STUB.frames) do
		if f.events[ev] and f.scripts.OnEvent then f.scripts.OnEvent(f, ev, ...) end
	end
end

-- Run every C_Timer.After callback that is due, then every ticker once.
function STUB.RunTimers()
	local due = STUB.timers
	STUB.timers = {}
	for _, t in ipairs(due) do t.fn() end
end
function STUB.Tick()
	for _, fn in ipairs(STUB.tickers) do fn() end
end

UIParent = CreateFrame("Frame", "UIParent")
-- Blizzard's minimap: 140x140 by default, placed at a known point so the
-- button's maths can be checked exactly.
Minimap = CreateFrame("Frame", "Minimap")
Minimap:SetSize(140, 140)
Minimap.centerX, Minimap.centerY = 500, 500
-- The shape the client reports; "ROUND" unless a test says otherwise.
function GetMinimapShape() return STUB.minimapShape or "ROUND" end
function GetCursorPosition() return STUB.cursorX or 0, STUB.cursorY or 0 end
GameTooltip = CreateFrame("Frame", "GameTooltip")
UIErrorsFrame = CreateFrame("Frame", "UIErrorsFrame")
ChatFontNormal = {}
OKAY, CANCEL = "Okay", "Cancel"
NUM_CHAT_WINDOWS = 1
StaticPopupDialogs = {}
function StaticPopup_Show(which, a, b, data) STUB.popup = { which = which, data = data } end
SlashCmdList = {}
UISpecialFrames = {}
tinsert = table.insert
function wipe(t) for k in pairs(t) do t[k] = nil end return t end
function hooksecurefunc(a, b, c)
	if type(a) == "table" then
		local orig = a[b]
		a[b] = function(...) local r = orig(...); c(...); return r end
	else
		local orig = _G[a]
		_G[a] = function(...) local r = orig(...); b(...); return r end
	end
end
function InCombatLockdown() return false end
function ReloadUI() STUB.reloaded = true end
function GetTime() return STUB.now end
function time() return STUB.epoch + math.floor(STUB.now) end
function date(fmt, t) return "12:00" end
C_Timer = {
	After = function(delay, fn) table.insert(STUB.timers, { delay = delay, fn = fn }) end,
	NewTicker = function(delay, fn) table.insert(STUB.tickers, fn); return { Cancel = noop } end,
}
C_AddOns = {
	IsAddOnLoaded = function(name) return STUB.loaded[name] or false end,
	LoadAddOn = function(name)
		STUB.loaded[name] = true
		if STUB.onLoadAddOn then STUB.onLoadAddOn(name) end
		return true
	end,
}
C_Texture = { GetAtlasExists = function() return true end }
function PlaySound() end
function PlaySoundFile(path) if STUB.sounds[path] then return true, 1 end return false end
function StopSound() end
function GetPhysicalScreenSize() return 1920, 1080 end
function SetBinding(key, cmd) STUB.bindings[key] = cmd end
function SaveBindings() end
function GetCurrentBindingSet() return 1 end
function SetItemRef() end
-- Nothing of Blizzard's is ever active here, so the link goes nowhere unless the
-- addon takes it. The Forever client's UI code calls ChatFrameUtil.InsertLink;
-- ChatEdit_InsertLink is the older global name.
ChatFrameUtil = { InsertLink = function(text) return false end }
function ChatEdit_InsertLink(text) return ChatFrameUtil.InsertLink(text) end

-- The character, for the game context (WoWAI.GameContext).
function GetBuildInfo() return "1.60.1", "69913", "Sep 1 2026", 16001 end
function UnitName(unit) if unit == "player" then return "Testchar" end end
function GetRealmName() return "Test Realm" end
function UnitLevel(unit) return STUB.level end
function UnitRace(unit) return "Night Elf", "NightElf" end
function UnitClass(unit) return "Hunter", "HUNTER" end
function UnitFactionGroup(unit) return "Alliance", "Alliance" end
function GetGuildInfo(unit) return "Test Guild", "Member", 1 end
function GetZoneText() return STUB.zone end
function GetSubZoneText() return STUB.subzone end
function GetMoney() return STUB.money end
C_Map = {
	GetBestMapForUnit = function(unit) return 1431 end,
	GetPlayerMapPosition = function(mapId, unit) return { x = STUB.posX or 0.452, y = STUB.posY or 0.678 } end,
	GetMapInfo = function(mapId) return { name = "Duskwood", mapID = mapId } end,
}
function UnitXP(unit) return 1234 end
function UnitXPMax(unit) return 5000 end
-- Talents, as Forever exposes them. There is deliberately NO bare GetNumTalentTabs / GetTalentTabInfo
-- / GetTalentInfo here: a stub that invents them makes code that cannot run in game look tested,
-- which is exactly how the Talents line shipped dead.
--
-- What the client actually has: C_SpecializationInfo, called unconditionally by camelot-only UI
-- (Blizzard_UIPanels_Game/Camelot/PaperDollFrame.lua:498,504 and :2420, CharacterFrame.lua:1117).
-- GetSpecialization() returns the one active spec's index and GetSpecializationInfo(specIndex)
-- unpacks specId, name, description, icon, role, primaryStat, pointsSpent, background,
-- previewPointsSpent, isUnlocked (Blizzard_APIDocumentationGenerated/SpecializationInfoDocumentation.lua:237,254).
-- There is no tab count to walk: the namespace has no GetNumTalentTabs equivalent at all.
--
-- The old globals are absent for a documented reason, not by omission. GetNumTalentTabs appears
-- zero times in the whole forever UI tree, and GetTalentTabInfo / GetTalentInfo exist only as
-- deprecated shims in Blizzard_DeprecatedSpecialization, whose .toc carries
-- "## AllowLoadGameType: classic, standard" -- camelot is not in that list, so that addon never
-- loads on Forever and neither shim is ever defined there.
STUB.spec = 1 -- the active specialization index; 0 means the client reports no spec
STUB.specInfo = {
	[1] = { specId = 253, name = "Beast Mastery", pointsSpent = 14 }, -- 23 levels, one point per level from 10
	[2] = { specId = 254, name = "Marksmanship", pointsSpent = 0 },
	[3] = { specId = 255, name = "Survival", pointsSpent = 0 },
}
C_SpecializationInfo = {
	GetSpecialization = function() return STUB.spec end,
	GetSpecializationInfo = function(specIndex)
		local s = STUB.specInfo[specIndex]
		if not s then return nil end
		return s.specId, s.name, "A description", 12345, "DAMAGER", 3, s.pointsSpent, "background", s.pointsSpent, true
	end,
}
-- TRADE_SKILLS is a global string on this client (Blizzard's own Camelot XML uses it as
-- text="TRADE_SKILLS"), though it lives in the locale data rather than the exe's string table.
-- SECONDARY_SKILLS appears nowhere in the forever UI tree or the client, so it is not defined here.
TRADE_SKILLS = "Professions"

-- Professions, as Forever exposes them. The client registers exactly two globals for this:
-- GetProfessions() returns the skill-line indices of the character's trained professions, and
-- GetProfessionInfo(index) unpacks one in the order Blizzard's Camelot professions UI
-- destructures it -- name, texture, rank, maxRank, numSpells, spellOffset, skillLine,
-- rankModifier, specializationIndex, specializationOffset, skillLineName. Both are called
-- unconditionally by camelot-only files (Blizzard_ProfessionsBook/Camelot/...:21,57,
-- Blizzard_Professions/Camelot/...:16,56), i.e. code that only loads on Forever's game type.
--
-- There is deliberately NO bare GetNumSkillLines / GetSkillLineInfo here. The client has no such
-- globals -- skills are C_SkillInfo.GetSkillLineInfo(index), returning one SkillLineAttributes
-- table (and C_SkillInfo.GetNumSkillLines(), which takes no argument), so a stub that invents the
-- bare positional forms makes code that cannot run in game look tested.
STUB.professions = { 393, nil, 129 } -- one primary trained, the other slot empty, one secondary
STUB.professionInfo = {
	[393] = { "Skinning", 75, 75, 393 }, -- name, rank, maxRank, skillLine
	[129] = { "First Aid", 40, 75, 129 },
}
function GetProfessions()
	local p = STUB.professions
	return p[1], p[2], p[3], p[4], p[5], p[6], p[7]
end
-- The full eleven-value form Blizzard's Camelot code destructures, so a caller reading any slot
-- reads the same one it would in game.
function GetProfessionInfo(index)
	local p = STUB.professionInfo[index]
	if not p then return nil end
	local name, rank, maxRank, skillLine = p[1], p[2], p[3], p[4]
	return name, "Interface\\Icons\\Trade_Skinning", rank, maxRank, 0, 0, skillLine, 0, 0, 0, name
end
-- The character sheet and the equipped slots, as Forever exposes them.
--
-- UnitHealthMax / UnitPowerType / UnitPowerMax / UnitArmor / UnitStat and GetInventoryItemLink
-- are all BARE globals here, and that is not an accident of this stub: they are what Blizzard's
-- own camelot-only code calls -- UnitHealthMax and UnitPowerType and UnitPowerMax at
-- Blizzard_UIPanels_Game/Camelot/PaperDollFrame.lua:630,648,649, UnitArmor at
-- Camelot/PaperDollFrameStats.lua:460, UnitStat at Camelot/PaperDollFrame.lua:694, and
-- GetInventoryItemLink at Camelot/PaperDollFrame.lua:2140 (15 call sites tree-wide, none
-- namespaced). The bag and bank pair IS namespaced (C_Container.*), so the asymmetry is real
-- and this harness keeps it: an addon that reaches for C_Item.GetInventoryItemLink finds
-- nothing here, exactly as in game.
-- Every name and return list is from Blizzard_APIDocumentationGenerated/UnitDocumentation.lua
-- (:645 UnitArmor, :1472 UnitHealthMax, :2801 UnitPowerMax, :2859 UnitPowerType, :3198 UnitStat).
--
-- Eleven of those documented unit functions carry SecretWhenUnitStatsRestricted -- UnitStat is
-- one of them, at :3200. UnitHealthMax (:1472) and UnitPowerMax (:2801) are restricted too, but
-- under their own predicates (SecretWhenUnitHealthMaxRestricted / SecretWhenUnitPowerMaxRestricted),
-- so a guard written against one named predicate would miss them. STUB.secret stands in for such a
-- value whichever flag produced it -- it is a NUMBER so that a careless `type(v) == "number"` guard
-- alone cannot pass this harness, and a harness that cannot produce a secret cannot test what the
-- addon does with one.
STUB.secret = -987654
function issecretvalue(v) return v == STUB.secret end
-- Level 23 Night Elf Hunter, so the resource bar is Mana (the token is what the client reports;
-- Blizzard's character sheet looks the display name up as _G[powerToken], Camelot/PaperDollFrame.lua:651).
MANA = "Mana"
STUB.powerType, STUB.powerToken = 0, "MANA"
STUB.healthMax, STUB.armor, STUB.powerMax = 1450, 512, 820
STUB.stats = { 68, 95, 74, 61, 52 } -- strength, agility, stamina, intellect, spirit
function UnitHealthMax(unit) if unit == "player" then return STUB.healthMax end end
function UnitArmor(unit)
	if unit ~= "player" then return nil end
	return STUB.armor - 32, STUB.armor, STUB.armor, 32 -- base, effective, real, bonus
end
function UnitStat(unit, index)
	if unit ~= "player" then return nil end
	local value = STUB.stats[index]
	if value == nil then return nil end
	return value, value, 0, 0 -- currentStat, effectiveStat, posBuff, negBuff
end
function UnitPowerType(unit)
	if unit ~= "player" then return nil end
	return STUB.powerType, STUB.powerToken, 0, 0.5, 1
end
function UnitPowerMax(unit, powerType) if unit == "player" then return STUB.powerMax end end
-- NUM_INVSLOTS is a client global: Blizzard's camelot-only character frame walks it
-- (Camelot/CharacterFrame.lua:38) and no camelot-loaded Lua file in the Forever tree defines it
-- ([Game]\Constants.lua holds only CLASS_SORT_ORDER there; the definitions live in
-- Blizzard_FrameXMLBase/Constants.lua:136-156, gated [AllowLoadGameType mainline]), so the addon
-- guards it and falls back to the 19 slots INVSLOT_HEAD..INVSLOT_TABARD -- the numbering the
-- camelot character frame's own 20 slot buttons use (Camelot/PaperDollFrame.xml).
NUM_INVSLOTS = 19
-- Seven filled slots, twelve empty: a nil link is an EMPTY slot, not a failure. The items are
-- placed in the slots they would really occupy -- a helm in Head (1), a sword in Main Hand (16)
-- -- because the Worn line is what the bag items get compared against, and a fixture that puts a
-- sword in the chest slot would let a wrong slot mapping pass.
STUB.equipped = {
	[1] = "|cff9d9d9d|Hitem:100|h[Worn Helm]|h|r",
	[2] = "|cffffffff|Hitem:120|h[Thick Necklace]|h|r",
	[5] = "|cff1eff00|Hitem:5301|h[Sturdy Tunic]|h|r",
	[6] = "|cffffffff|Hitem:220|h[Loose Belt]|h|r",
	[7] = "|cff1eff00|Hitem:301|h[Sturdy Leggings]|h|r",
	[8] = "|cffffffff|Hitem:410|h[Worn Boots]|h|r",
	[16] = "|cff1eff00|Hitem:2140|h[Fine Longsword]|h|r",
}
function GetInventoryItemLink(unit, slot)
	if unit ~= "player" then return nil end
	return STUB.equipped[slot]
end
-- The same reader, kept under a second name so a test that has to prove the line's ABSENCE
-- (by clearing the global, as a client without it would behave) can put it back.
STUB_EQUIPPED = STUB.equipped
STUB_GetInventoryItemLink = GetInventoryItemLink
-- GetInventoryItemQuality is a BARE global too, called by camelot's own character frame
-- (Camelot/PaperDollFrame.lua:2184: `local quality = GetInventoryItemQuality("player", self:GetID())`).
-- It is what makes the Worn line's quality letters readable without parsing the link, and its
-- values are the ItemQuality indices the client uses (0 Poor .. 5 Legendary).
STUB.quality = {
	[1] = 0, -- Worn Helm, Poor
	[2] = 1, -- Thick Necklace, Common
	[5] = 2, -- Sturdy Tunic, Uncommon
	[6] = 1, -- Loose Belt, Common
	[7] = 2, -- Sturdy Leggings, Uncommon
	[8] = 1, -- Worn Boots, Common
	[16] = 2, -- Fine Longsword, Uncommon
}
function GetInventoryItemQuality(unit, slot)
	if unit ~= "player" then return nil end
	return STUB.quality[slot]
end
STUB_GetInventoryItemQuality = GetInventoryItemQuality
-- The client's own bag enumeration: Enum.BagIndex is a real table on Forever, walked by
-- camelot-only code (Camelot/BankFrame.lua:187, `Enum.BagIndex.Characterbanktab`). Its members
-- are read from the generated documentation rather than chosen here:
-- Backpack = 0, Bag_1..Bag_4 = 1..4, ReagentBag = 5
-- (Blizzard_APIDocumentationGenerated/BagIndexConstantsDocumentation.lua).
Enum = {
	BagIndex = { Backpack = 0, Bag_1 = 1, Bag_2 = 2, Bag_3 = 3, Bag_4 = 4, ReagentBag = 5 },
}
-- The bag API, as Forever exposes it: C_Container with NO bare twin. There is deliberately no
-- global GetContainerNumSlots / GetContainerItemInfo / GetContainerItemLink here. Those names
-- survive in exactly two non-doc places in the whole forever tree, and neither reaches a
-- running client: Blizzard_APIDocumentationGenerated (a union registry, not code) and
-- Blizzard_BoostTutorial/Blizzard_TutorialLogic.lua:200, which is `## LoadOnDemand: 1` and only
-- ever loaded for the level-boost flow. Every unnamespaced container call in code that actually
-- loads on this client is C_Container.* (Camelot/MainMenuBarBagButtons.lua:47,61,65;
-- Camelot/BankFrame.lua:98; Blizzard_ChatFrameBase/Shared/ChatFrameUtil.lua:1206). A stub that
-- invents the bare globals makes a design that cannot work in game look tested.
--
-- GetContainerItemInfo returns ONE ContainerItemInfo table, not positional returns --
-- the namespaced form differs from the old global in this way, and the field list is
-- ContainerDocumentation.lua:766 (iconFileID, stackCount, isLocked, quality, isReadable,
-- hasLoot, hyperlink, isFiltered, hasNoValue, itemID, isBound, itemName).
--
-- The item ids are real low-level vanilla ids with their real equip locations, so an item's
-- wear slot is decided by GetItemInfoInstant rather than by a field this harness invented.
STUB.bags = {
	[0] = {
		{ id = 2140, name = "Fine Longsword", quality = 2 },
		{ id = 1009, name = "Linen Cloth", quality = 1 },       -- trade goods: not wearable
		{ id = 1121, name = "Footpad's Shoes", quality = 2 },
		nil,                                                     -- an empty slot
		{ id = 2589, name = "Linen Cloth", quality = 1 },        -- a second stack
		{ id = 1166, name = "Dented Buckler", quality = 1 },
	},
	[1] = { { id = 2140, name = "Fine Longsword", quality = 2 } },
	[2] = {},                                                    -- an empty bag, size 0
	[3] = { { id = 1009, name = "Linen Cloth", quality = 1 } },
	[4] = {},
	[5] = { { id = 1009, name = "Linen Cloth", quality = 1 } },   -- the REAGENT bag: out of scope
}
STUB.bagSlots = { [0] = 6, [1] = 1, [2] = 0, [3] = 1, [4] = 0, [5] = 1 }
-- Real vanilla equip locations, as C_Item.GetItemInfoInstant reports them: 2140 is a one-hand
-- sword, 1121 is feet, 1166 is a shield (off hand), and the cloth is INVTYPE_NON_EQUIP_IGNORE --
-- which the client does NOT map to a wear slot, exactly like a reagent.
STUB.equipLoc = {
	[2140] = "INVTYPE_WEAPON",
	[1121] = "INVTYPE_FEET",
	[1166] = "INVTYPE_SHIELD",
	[1009] = "INVTYPE_NON_EQUIP_IGNORE",
	[2589] = "INVTYPE_NON_EQUIP_IGNORE",
}
C_Container = {
	GetContainerNumSlots = function(bag) return STUB.bagSlots[bag] or 0 end,
	GetContainerItemInfo = function(bag, slot)
		local bagItems = STUB.bags[bag]
		local item = bagItems and bagItems[slot]
		if not item then return nil end
		local loc = STUB.equipLoc[item.id]
		return {
			iconFileID = 134400,
			stackCount = 1,
			isLocked = false,
			quality = item.quality,
			isReadable = false,
			hasLoot = false,
			hyperlink = "|cff9d9d9d|Hitem:" .. item.id .. "|h[" .. item.name .. "]|h|r",
			isFiltered = false,
			hasNoValue = false,
			itemID = item.id,
			isBound = false,
			itemName = item.name,
			itemEquipLoc = loc,
		}
	end,
}
-- The same tables under second names, so a test that has to prove a line's ABSENCE (by clearing
-- the API, or emptying the bags, as those states occur in game) can put them back afterwards.
STUB_C_CONTAINER = C_Container
STUB_BAGS = STUB.bags
STUB_BAG_SLOTS = STUB.bagSlots
STUB_EQUIP_LOC = STUB.equipLoc
STUB_QUALITY = STUB.quality
STUB_ENUM = Enum
ITEM_QUALITY2_DESC = "Uncommon"
C_Item = {
	GetItemInfo = function(link)
		if tostring(link):find("^item:2140") then return "Fine Longsword", link, 2, 19, 14, "Weapon", "One-Handed Swords" end
	end,
	-- GetItemInfoInstant is the variant that works without the item's data cached, and it is the
	-- one camelot's own character sheet calls to learn an item's equip location
	-- (Camelot/PaperDollFrameStats.lua:637). Its 4th return is the INVTYPE_* token string --
	-- the same tokens Blizzard's own UI compares against
	-- (Blizzard_Collections/Classic/Blizzard_HeirloomCollection.lua:256).
	-- GetItemInfo and GetItemInfoInstant are both on the namespace; there is deliberately no
	-- bare GetItemInfoInstant global here, because none exists on this client.
	GetItemInfoInstant = function(itemInfo)
		local id = itemInfo
		if type(itemInfo) == "string" then id = tonumber(itemInfo:match("item:(%d+)")) end
		if type(id) ~= "number" then return nil end
		local loc = STUB.equipLoc[id]
		if not loc then return nil end
		return id, "Armor", "", loc, 134400, 4, 0
	end,
}
function print(...)
	local parts = {}
	for i = 1, select("#", ...) do parts[i] = tostring((select(i, ...))) end
	table.insert(STUB.prints, table.concat(parts, " "))
end
