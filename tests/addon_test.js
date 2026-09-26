// Runs the real addon Lua (Codec.lua + WoWAI.lua) in a Lua VM with a stub
// WoW API (wow_stub.lua) and drives it through a session: login, hello, a sent
// message read back off the pixel strip, a reply delivered through a slot, the
// bridge's default folder and agent, a chat that picks another agent, a
// permission denial with Allow, and a restore.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const fengari = require('fengari');
const { lua, lauxlib, lualib, to_luastring, to_jsstring } = fengari;

const ADDON = path.join(__dirname, '..', 'addon', 'WoWAI');
const CELLS_PER_ROW = 200;

function newVM() {
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  const run = (code, arg) => {
    if (lauxlib.luaL_loadstring(L, to_luastring(code)) !== lua.LUA_OK) throw new Error('Lua load: ' + to_jsstring(lua.lua_tostring(L, -1)));
    let nargs = 0;
    if (arg !== undefined) { lua.lua_pushstring(L, to_luastring(arg)); nargs = 1; }
    if (lua.lua_pcall(L, nargs, 0, 0) !== lua.LUA_OK) throw new Error('Lua error: ' + to_jsstring(lua.lua_tostring(L, -1)));
  };
  // Evaluate an expression and bring it back as a string (or nil).
  const evaluate = (expr) => {
    run(`local v = (${expr}); if v == nil then RESULT = nil else RESULT = tostring(v) end`);
    lua.lua_getglobal(L, to_luastring('RESULT'));
    const isNil = lua.lua_isnil(L, -1);
    const s = isNil ? null : to_jsstring(lua.lua_tolstring(L, -1));
    lua.lua_pop(L, 1);
    return s;
  };
  const num = (expr) => Number(evaluate(expr));
  run(fs.readFileSync(path.join(__dirname, 'wow_stub.lua'), 'utf8'));
  for (const f of ['Codec.lua', 'Inbox.lua', 'WoWAI.lua']) run(fs.readFileSync(path.join(ADDON, f), 'utf8'), 'WoWAI');
  return { run, evaluate, num };
}

// Read the strip the addon drew, exactly like capture.ps1: 3 bits per cell,
// [C7 1A] [id] [len] [payload] [fletcher]. Returns { id, text } or null.
function decodeStrip(vm) {
  if (vm.evaluate('WoWAIStrip and WoWAIStrip.shown') !== 'true') return null;
  vm.run(`
    local parts = {}
    for _, t in ipairs(WoWAIStrip.textures) do
      if t.shown and t.color then
        local c, r = math.floor(t.x / 4), math.floor(-t.y / 4)
        local v = (t.color[1] >= 0.5 and 4 or 0) + (t.color[2] >= 0.5 and 2 or 0) + (t.color[3] >= 0.5 and 1 or 0)
        parts[#parts + 1] = (r * ${CELLS_PER_ROW} + c) .. ":" .. v
      end
    end
    RESULT = table.concat(parts, ",")`);
  const cells = [];
  for (const p of vm.evaluate('RESULT').split(',')) { const [i, v] = p.split(':').map(Number); cells[i] = v; }
  const bytes = [];
  let acc = 0, nbits = 0;
  for (let i = 0; i < cells.length; i++) {
    acc = (acc << 3) | (cells[i] || 0); nbits += 3;
    while (nbits >= 8) { bytes.push((acc >> (nbits - 8)) & 0xff); nbits -= 8; acc &= (1 << nbits) - 1; }
  }
  assert.equal(bytes[0], 0xc7); assert.equal(bytes[1], 0x1a);
  const id = bytes[2] * 256 + bytes[3];
  const len = bytes[4] * 256 + bytes[5];
  let s1 = 0, s2 = 0;
  for (let k = 2; k < 6 + len; k++) { s1 = (s1 + bytes[k]) % 255; s2 = (s2 + s1) % 255; }
  assert.equal(bytes[6 + len], s1, 'fletcher s1'); assert.equal(bytes[7 + len], s2, 'fletcher s2');
  return { id, text: Buffer.from(bytes.slice(6, 6 + len)).toString('utf8') };
}

function stripRecords(vm) {
  const frame = decodeStrip(vm);
  if (!frame) return [];
  return frame.text.split('\x1E').map(r => {
    const p = r.split('\x1F');
    const withCtx = p[4].split(';').includes('c'); // a "c" flag means field 7 is the game context
    const rec = { session: p[0], chat: p[1], id: Number(p[2]), cwd: p[3], flags: p[4], name: p[5], text: p.slice(withCtx ? 7 : 6).join('\x1F') };
    if (withCtx) rec.ctx = p[6];
    return rec;
  });
}

// Make the next LoadAddOn deliver this slot data (a Lua table literal body).
function nextSlot(vm, luaBody) {
  vm.run(`STUB.onLoadAddOn = function(name) WoWAI_SlotData = ${luaBody} end`);
}

function login(vm) {
  vm.run('STUB.FireEvent("ADDON_LOADED", "WoWAI")');
  vm.run('STUB.FireEvent("PLAYER_LOGIN")');
}

// Let the bridge answer the login hello: its slot carries a fresh clock, which is
// what makes the addon consider itself connected (Send is gated on that).
function connect(vm) {
  vm.run('STUB.RunTimers()'); // C_Timer.After(3, SayHello)
  nextSlot(vm, '{ now = time(), cwd = "", replies = {} }');
  vm.run('STUB.now = STUB.now + 6; STUB.Tick()'); // hello poll 5 s later
  assert.equal(vm.evaluate('WoWAI.IsConnected()'), 'true', 'connected after the hello slot');
}

test('addon loads, builds its UI and creates a first chat', () => {
  const vm = newVM();
  login(vm);
  assert.equal(vm.num('#WoWAIDB.chats'), 1);
  assert.equal(vm.evaluate('WoWAIDB.chats[1].name'), 'Chat 1');
  assert.equal(vm.evaluate('WoWAIFrame ~= nil'), 'true');
  assert.equal(vm.evaluate('WoWAIMini ~= nil'), 'true');
  assert.equal(vm.num('#STUB.tickers'), 1);
  assert.equal(vm.evaluate('SlashCmdList.WOWAI ~= nil'), 'true');
  assert.deepEqual([1, 2, 3, 4, 5].map(i => vm.evaluate('SLASH_WOWAI' + i)), ['/wow-ai', '/wowai', '/wow-claude', '/ai', '/ask'], 'the old command name and the short forms are aliases');
  assert.equal(vm.evaluate('SlashCmdList.WOWAIASK'), null, '/ai is an alias of the one command, not a handler of its own');
});

test('hello goes out on the strip after login', () => {
  const vm = newVM();
  login(vm);
  vm.run('STUB.RunTimers()'); // C_Timer.After(3, SayHello)
  const recs = stripRecords(vm);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].flags, 'h;c', 'a hello always carries the game context');
  assert.equal(recs[0].text, '');
  assert.equal(recs[0].session, vm.evaluate('WoWAIDB.session'));
});

test('the game context describes the character and rides on the hello, then only when it changes or is turned off', () => {
  const vm = newVM();
  login(vm);
  vm.run('STUB.RunTimers()');
  const hello = stripRecords(vm)[0];
  assert.deepEqual(hello.ctx.split('\n'), [
    'Game: World of Warcraft: Forever (client 1.60.1.69913, interface 16001)',
    'Character: Testchar on Test Realm, level 23 Night Elf Hunter (Alliance), guild <Test Guild>',
    'Location: Duskwood - Darkshire',
    'Position: 45.2, 67.8 (map 1431)',
    'Money: 1g 23s 45c; XP: 1234/5000',
    // Stats and gear are inserted here, ahead of Talents/Professions: the block is truncated
    // tail-first with no marker, so the lines that must survive an overflow are the ones the
    // agent needs for gear advice. Both have tests of their own.
    'Stats: HP 1450, Mana 820, Armor 512, Str 68, Agi 95, Sta 74, Int 61, Spi 52',
    'Gear: 7 of 19 slots filled (12 empty)',
    // Inventory awareness, the subject of its own test: what is worn item-by-item and the
    // wearable items in the bags. They are the two halves of "do I have an upgrade?", and the
    // order matters -- see the test named "the game context sends what is worn and what is in
    // the bags" for what each half is built from and why.
    'Worn: Head Worn Helm(P), Neck Thick Necklace(C), Chest Sturdy Tunic(U), Waist Loose Belt(C), +3 more',
    "Bags: 4 of 7 items wearable -- Weapon Fine Longsword(U), Feet Footpad's Shoes(U), Off Hand Dented Buckler(C), Weapon Fine Longsword(U)",
    // Talents have a test of their own: the line is built from C_SpecializationInfo, because the
    // vanilla tab globals are not callable on Forever.
    'Talents: Beast Mastery 14',
    // Professions have a test of their own: the line is built from a different API family
    // (GetProfessions/GetProfessionInfo, not the removed tab loop), and its absence in game has
    // more than one possible cause.
    'Professions: Skinning 75/75, First Aid 40/75',
  ]);
  // The bridge answers the hello: the context is now known to be on its side.
  nextSlot(vm, '{ now = time(), cwd = "", replies = {} }');
  vm.run('STUB.now = STUB.now + 6; STUB.Tick()');
  assert.equal(vm.evaluate('WoWAI.IsConnected()'), 'true');
  vm.run('WoWAI.Send("hello world")');
  let rec = stripRecords(vm).find(r => r.text === 'hello world');
  assert.equal(rec.flags, '', 'unchanged context is not repeated');
  assert.equal(rec.ctx, undefined);
  assert.equal(vm.evaluate('WoWAIDB.outbox.ctx'), null);
  // Moving to another zone changes it, so the next message (from another chat,
  // the first one is still waiting) carries the new version.
  vm.run('STUB.zone = "Elwynn Forest"; STUB.subzone = ""; STUB.posX = 0.1; WoWAI.NewChat("Second"); WoWAI.Send("where am I")');
  rec = stripRecords(vm).find(r => r.text === 'where am I');
  assert.equal(rec.flags, 'c');
  assert.ok(rec.ctx.includes('Location: Elwynn Forest\n'), rec.ctx);
  assert.ok(rec.ctx.includes('Position: 10.0, 67.8 on Duskwood (map 1431)'), 'the map name shows when it differs from the zone');
  assert.equal(Buffer.from(vm.evaluate('WoWAIDB.outbox.ctx'), 'hex').toString('utf8'), rec.ctx, 'the reload path carries it too');
  // Turning it off sends an empty context at once (a hello), so the bridge drops what it had.
  vm.run('SlashCmdList.WOWAI("context off")');
  assert.equal(vm.evaluate('WoWAIDB.settings.context'), 'false');
  const off = stripRecords(vm).filter(r => r.flags === 'h;c');
  assert.equal(off.length, 1);
  assert.equal(off[0].ctx, '');
  assert.ok(vm.evaluate('WoWAIDB.chats[2].history[#WoWAIDB.chats[2].history].text').includes('Game context is OFF'));
  // Back on: another hello, with the context again.
  vm.run('SlashCmdList.WOWAI("context on")');
  const on = stripRecords(vm).filter(r => r.flags === 'h;c');
  assert.ok(on.some(r => r.ctx.includes('Character: Testchar')));
  assert.ok(vm.evaluate('WoWAIDB.chats[2].history[#WoWAIDB.chats[2].history].text').includes('Game context is ON'));
});

test('the game context lists professions through the API the Forever client actually has', () => {
  const vm = newVM();
  // The harness models the real client, so the old code path cannot pass by accident: the bare
  // skill-line globals do not exist on Forever (skills are C_SkillInfo.GetNumSkillLines /
  // C_SkillInfo.GetSkillLineInfo, returning a SkillLineAttributes table), and a stub that
  // defines them tests code that cannot run in game.
  assert.equal(vm.evaluate('GetNumSkillLines'), null, 'the client has no bare GetNumSkillLines');
  assert.equal(vm.evaluate('GetSkillLineInfo'), null, 'the client has no bare GetSkillLineInfo');
  assert.equal(vm.evaluate('type(GetProfessions)'), 'function', 'the client does have GetProfessions');
  login(vm);
  const ctx = vm.evaluate('WoWAI.GameContext()');
  assert.ok(ctx.includes('Professions: Skinning 75/75, First Aid 40/75'), ctx);
  // An empty slot among the two primaries (GetProfessions returns nil for it) is skipped, and a
  // character with nothing trained gets no line at all -- as in game.
  vm.run('STUB.professions = {}');
  assert.ok(!vm.evaluate('WoWAI.GameContext()').includes('Professions:'), 'no line without professions');
  // The whole block still fits the budget the strip reserves for it.
  vm.run('STUB.professions = { 393, nil, 129 }');
  const bytes = Buffer.byteLength(vm.evaluate('WoWAI.GameContext()'), 'utf8');
  assert.ok(bytes < 700, `context is ${bytes} bytes, under CONTEXT_MAX (700)`);
});

test('the game context lists the active specialization through the API the Forever client actually has', () => {
  const vm = newVM();
  // The harness models the real client, so the dead tab loop cannot pass by accident. The vanilla
  // talent tab globals are not callable on Forever: GetNumTalentTabs appears nowhere in the client
  // at all (zero occurrences in the whole UI tree, generated docs included), and GetTalentTabInfo /
  // GetTalentInfo are defined only by Blizzard_DeprecatedSpecialization, whose .toc carries
  // "## AllowLoadGameType: classic, standard" -- camelot is not in that list, so the addon that
  // would define those shims never loads here.
  assert.equal(vm.evaluate('GetNumTalentTabs'), null, 'the client has no bare GetNumTalentTabs');
  assert.equal(vm.evaluate('GetTalentTabInfo'), null, 'the client has no bare GetTalentTabInfo');
  assert.equal(vm.evaluate('GetTalentInfo'), null, 'the client has no bare GetTalentInfo');
  // What it does have, called unconditionally by its own camelot-only UI
  // (Blizzard_UIPanels_Game/Camelot/PaperDollFrame.lua:498,504), is C_SpecializationInfo --
  // GetSpecialization for the one active spec, GetSpecializationInfo(specIndex) to unpack it.
  assert.equal(vm.evaluate('type(C_SpecializationInfo.GetSpecialization)'), 'function', 'the client does have C_SpecializationInfo.GetSpecialization');
  assert.equal(vm.evaluate('type(C_SpecializationInfo.GetSpecializationInfo)'), 'function', 'and GetSpecializationInfo');
  // There is no tab count to walk: the namespace has no GetNumTalentTabs equivalent at all.
  assert.equal(vm.evaluate('C_SpecializationInfo.GetNumTalentTabs'), null, 'the modern namespace exposes no tab count');
  login(vm);
  // At a level where talents are possible -- Forever grants the first point at 10 -- so a spec is
  // meaningful rather than trivially absent. In-game appearance cannot judge this fix: the live
  // character is level 9, so the line's absence there is over-determined.
  const level = Number(vm.evaluate('STUB.level'));
  assert.ok(level >= 10, `level ${level} is at or past the first talent point`);
  const ctx = vm.evaluate('WoWAI.GameContext()');
  assert.ok(ctx.includes('Talents: Beast Mastery 14'), ctx);
  // A client reporting no spec (spec 0, as before the first talent point) gets no line -- absence
  // over a plausible-looking zero.
  vm.run('STUB.spec = 0');
  assert.ok(!vm.evaluate('WoWAI.GameContext()').includes('Talents:'), 'no line without an active spec');
  // So does an index the client cannot describe -- no "Talents: nil".
  vm.run('STUB.spec = 99');
  assert.ok(!vm.evaluate('WoWAI.GameContext()').includes('Talents:'), 'no line when the spec has no info');
  // And the whole block still fits the budget the strip reserves for it.
  vm.run('STUB.spec = 1');
  const bytes = Buffer.byteLength(vm.evaluate('WoWAI.GameContext()'), 'utf8');
  assert.ok(bytes < 700, `context is ${bytes} bytes, under CONTEXT_MAX (700)`);
});

test('the game context sends stat totals and a filled/empty slot count, and stays inside the byte budget', () => {
  const vm = newVM();
  // The harness models the real client rather than a convenient one, because a stub that invents
  // APIs is how the talents/professions lines shipped dead. The character sheet and the equipped
  // reader are BARE globals on Forever -- Blizzard's own camelot-only code calls them that way
  // (UnitHealthMax/UnitPowerType/UnitPowerMax at Camelot/PaperDollFrame.lua:630,648,649; UnitArmor
  // at Camelot/PaperDollFrameStats.lua:460; UnitStat at Camelot/PaperDollFrame.lua:694;
  // GetInventoryItemLink at Camelot/PaperDollFrame.lua:2140) -- while the bag/bank pair next door
  // is namespaced. The addon must not assume symmetry, and neither may this harness.
  assert.equal(vm.evaluate('type(_G.GetInventoryItemLink)'), 'function', 'the equipped reader is a bare global on this client');
  assert.equal(vm.evaluate('C_Item and C_Item.GetInventoryItemLink'), null, 'and there is no namespaced twin to fall back on');
  assert.equal(vm.evaluate('type(UnitStat)'), 'function', 'UnitStat is a bare global');
  assert.equal(vm.evaluate('type(UnitArmor)'), 'function', 'so is UnitArmor');
  // Eleven Forever unit functions are SecretWhenUnitStatsRestricted
  // (UnitDocumentation.lua:337,647,666,684,1049,1071,2946,2964,3134,3200,3427); UnitStat is one.
  // UnitHealthMax and UnitPowerMax carry their own predicates (SecretWhenUnitHealthMaxRestricted,
  // SecretWhenUnitPowerMaxRestricted) rather than that one -- so the gate cannot be written against
  // a single named predicate, and this harness secret-values every read the line makes. A secret is
  // a number as far as type() is concerned, so `type(v) == "number"` is not a sufficient guard.
  assert.equal(vm.evaluate('type(STUB.secret)'), 'number', 'a secret value is still a number to type()');
  assert.equal(vm.evaluate('issecretvalue(STUB.secret)'), 'true', 'issecretvalue is what identifies it');
  assert.equal(vm.evaluate('issecretvalue(1)'), 'false', 'and it does not fire on a plain number');

  login(vm);
  const ctx = vm.evaluate('WoWAI.GameContext()');
  assert.ok(ctx.includes('Stats: HP 1450, Mana 820, Armor 512, Str 68, Agi 95, Sta 74, Int 61, Spi 52'), ctx);
  assert.ok(ctx.includes('Gear: 7 of 19 slots filled (12 empty)'), ctx);
  // Empty slots outnumber the 19-slot total only if the reader is wrong; a link is an item, a nil
  // is an empty slot, and nothing else may be counted as either.
  assert.ok(!ctx.includes('nil'), `no field may be built from a nil return: ${ctx}`);

  // An empty slot is an empty slot, not a failure to read one: 19 slots, 0 links.
  vm.run('STUB.equipped = {}');
  assert.ok(vm.evaluate('WoWAI.GameContext()').includes('Gear: 0 of 19 slots filled (19 empty)'), 'a bare character reads as 0 of 19');
  // No equipped reader at all is UNKNOWN, not naked -- the line goes, it does not become "0 of 19".
  vm.run('GetInventoryItemLink = nil');
  assert.ok(!vm.evaluate('WoWAI.GameContext()').includes('Gear:'), 'no reader, no line');
  vm.run('STUB.equipped = STUB_EQUIPPED');
  vm.run('GetInventoryItemLink = STUB_GetInventoryItemLink');

  // The slot count comes from the client, and 19 is only the last resort. NUM_INVSLOTS is a
  // client global (Blizzard's camelot character frame walks it unguarded,
  // Camelot/CharacterFrame.lua:38) that nothing in the camelot-only Lua defines, so an addon
  // cannot assume it is there -- nor that it is 19. A client reporting 12 slots is read as 12
  // slots, so the item in slot 16 is outside the range and is not counted: the client defines the
  // range, and reading past it would be reading containers this client does not have.
  vm.run('NUM_INVSLOTS = 12');
  assert.ok(vm.evaluate('WoWAI.GameContext()').includes('Gear: 6 of 12 slots filled (6 empty)'), 'the client owns the slot count');
  vm.run('NUM_INVSLOTS = nil');
  assert.ok(vm.evaluate('WoWAI.GameContext()').includes('Gear: 7 of 19 slots filled (12 empty)'), '19 is the documented fallback (INVSLOT_HEAD=1..INVSLOT_TABARD=19)');
  // A client that reports the count but refuses to let us read it (a secret) must not produce a
  // Gear line built from it -- 19 is a fallback for an ABSENT count, not for an unreadable one.
  vm.run('NUM_INVSLOTS = STUB.secret');
  const secretCount = vm.evaluate('WoWAI.GameContext()');
  assert.ok(secretCount.includes('Gear: 7 of 19 slots filled (12 empty)'), `an unreadable slot count falls back rather than being printed: ${secretCount}`);
  vm.run('NUM_INVSLOTS = 19');

  // A stat the client refuses to show us (a secret on a restricted map) is left OUT, and the
  // other stats still land. A fabricated 0 would be worse than the omission: the agent reasons on
  // a number it is given, and cannot reason on one it is not.
  vm.run('STUB.stats = { STUB.secret, 95, 74, 61, 52 }');
  const partial = vm.evaluate('WoWAI.GameContext()');
  assert.ok(partial.includes('Stats: HP 1450, Mana 820, Armor 512, Agi 95, Sta 74, Int 61, Spi 52'), partial);
  assert.ok(!/Str\s+\S/.test(partial), `a secret strength must not be printed at all: ${partial}`);
  assert.ok(!partial.includes('Str 0'), 'and must not be printed as a plausible-looking 0');
  // Armor is a secret too, on the same restricted map.
  vm.run('STUB.armor = STUB.secret');
  assert.ok(!vm.evaluate('WoWAI.GameContext()').includes('Armor'), 'a secret armor is left out');
  // Every read secret: no Stats line at all, never a line of zeros.
  vm.run('STUB.stats = { STUB.secret, STUB.secret, STUB.secret, STUB.secret, STUB.secret }');
  vm.run('STUB.healthMax, STUB.powerMax = STUB.secret, STUB.secret');
  const none = vm.evaluate('WoWAI.GameContext()');
  assert.ok(!none.includes('Stats:'), `no Stats line when nothing is readable: ${none}`);

  // The budget is measured, not asserted: the block the addon actually produces, in bytes, must
  // stay under the cap the strip reserves for it (CONTEXT_MAX = 700).
  vm.run('STUB.stats = { 68, 95, 74, 61, 52 }; STUB.healthMax, STUB.armor, STUB.powerMax = 1450, 512, 820');
  const full = vm.evaluate('WoWAI.GameContext()');
  const bytes = Buffer.byteLength(full, 'utf8');
  const lines = full.split('\n');
  const detail = lines.map((l, i) => `${i + 1}: [${Buffer.byteLength(l, 'utf8')}] ${l}`).join('\n');
  assert.ok(bytes < 700, `context is ${bytes} bytes, under CONTEXT_MAX (700)\n${detail}`);
  // A guard on the guard: the two new lines are what this card added, so they must actually be in
  // the measured block rather than the measurement passing on an unchanged one.
  const statsBytes = Buffer.byteLength(lines.find(l => l.startsWith('Stats: ')) || '', 'utf8');
  const gearBytes = Buffer.byteLength(lines.find(l => l.startsWith('Gear: ')) || '', 'utf8');
  assert.ok(statsBytes > 0 && gearBytes > 0, `both new lines present in the measured block\n${detail}`);
  console.log(`      context block: ${bytes} bytes of 700 (slack ${700 - bytes}); +${statsBytes + gearBytes + 2} of it the two new lines`);
});

test('the game context sends what is worn and what is in the bags, with the API the Forever client actually has', () => {
  const vm = newVM();
  // This harness models the REAL Forever surface rather than a convenient one, because a stub that
  // invents APIs is how the talents and professions lines shipped dead. The asymmetry below is the
  // point: the equipped readers are BARE globals, the container readers are NAMESPACED, and there
  // is no cross-over in either direction.
  assert.equal(vm.evaluate('type(_G.GetInventoryItemLink)'), 'function', 'the equipped reader is a bare global');
  assert.equal(vm.evaluate('type(_G.GetInventoryItemQuality)'), 'function', 'so is the equipped quality reader (Camelot/PaperDollFrame.lua:2184)');
  assert.equal(vm.evaluate('_G.GetItemInfoInstant'), null, 'but there is no bare GetItemInfoInstant -- it is C_Item.* only');
  assert.equal(vm.evaluate('type(C_Item.GetItemInfoInstant)'), 'function', 'and that is where the client really keeps it');
  // The container readers are namespaced, and the bare globals the old code would reach for do NOT
  // exist. The only unnamespaced container calls left in the whole forever tree are inside
  // Blizzard_APIDocumentationGenerated (a union registry) and Blizzard_BoostTutorial, which is
  // `## LoadOnDemand: 1` and never loads outside the level-boost flow.
  assert.equal(vm.evaluate('type(C_Container.GetContainerNumSlots)'), 'function', 'the bag readers are namespaced');
  assert.equal(vm.evaluate('type(C_Container.GetContainerItemInfo)'), 'function', 'and return one table, not positional values');
  assert.equal(vm.evaluate('GetContainerNumSlots'), null, 'there is no bare GetContainerNumSlots on this client');
  assert.equal(vm.evaluate('GetContainerItemInfo'), null, 'nor a bare GetContainerItemInfo');
  assert.equal(vm.evaluate('GetContainerItemLink'), null, 'nor a bare GetContainerItemLink');
  assert.equal(vm.evaluate('Enum.BagIndex.Backpack'), '0', 'Enum.BagIndex is callable, as camelot-only code uses it');

  login(vm);
  const ctx = vm.evaluate('WoWAI.GameContext()');
  // What is worn: one entry per EQUIPPED slot that holds something, named, with a one-letter
  // quality. Empty slots are absent rather than listed -- the Gear line above counts them.
  assert.ok(ctx.includes('Worn: Head Worn Helm(P), Neck Thick Necklace(C), Chest Sturdy Tunic(U), Waist Loose Belt(C)'), ctx);
  // Truncation is admitted, not hidden: a list cut short without a marker reads as the whole list.
  assert.ok(/Worn: .*, \+\d+ more/.test(ctx), `a truncated Worn list must say how many it is not showing: ${ctx}`);
  // The bags: the wearable items only, each labelled with the slot it competes for, and the counts
  // of what was looked at and what was even a candidate.
  assert.ok(ctx.includes('Bags: 4 of 7 items wearable'), ctx);
  assert.ok(ctx.includes('Weapon Fine Longsword(U)'), ctx);
  assert.ok(ctx.includes("Feet Footpad's Shoes(U)"), 'the slot comes from the item, via GetItemInfoInstant');
  assert.ok(ctx.includes('Off Hand Dented Buckler(C)'), 'a shield is an off-hand item');
  assert.ok(!ctx.includes('Linen Cloth'), 'a non-wearable item is looked at but never listed as a candidate');
  assert.ok(!ctx.includes('nil'), `no field may be built from a nil return: ${ctx}`);

  // The bag half is what makes the question answerable: the agent must see WHICH items are
  // candidates, not merely how many slots are filled. Removing the API must cost the line, not
  // fabricate an empty bag -- "your bags are empty" and "we could not look" are different facts.
  vm.run('C_Container = nil');
  const noApi = vm.evaluate('WoWAI.GameContext()');
  assert.ok(!noApi.includes('Bags:'), `no reader, no Bags line: ${noApi}`);
  assert.ok(noApi.includes('Worn:'), 'and the other half is unaffected -- one absent API costs one line');
  vm.run('C_Container = STUB_C_CONTAINER');

  // A bag holding only non-wearable items is a real answer worth stating as a zero: the agent
  // should learn "nothing in your bags is gear" rather than receive no line at all.
  vm.run('STUB.bags = { [0] = { { id = 1009, name = "Linen Cloth", quality = 1 } } }; STUB.bagSlots = { [0] = 1 }');
  const allCloth = vm.evaluate('WoWAI.GameContext()');
  assert.ok(allCloth.includes('Bags: 0 of 1 items wearable'), allCloth);
  assert.ok(!/Bags: 0 of 1 items wearable --/.test(allCloth), 'with nothing to list there is no list, and no dangling separator');
  // An actual empty bag set is also a stated zero, not a missing line.
  vm.run('STUB.bags = {}; STUB.bagSlots = {}');
  assert.ok(vm.evaluate('WoWAI.GameContext()').includes('Bags: 0 of 0 items wearable'), 'an empty bag reads as 0 of 0');
  vm.run('STUB.bags = STUB_BAGS; STUB.bagSlots = STUB_BAG_SLOTS');

  // No equipped reader at all is UNKNOWN, not naked: the Worn line goes rather than becoming empty.
  vm.run('GetInventoryItemLink = nil');
  const noWorn = vm.evaluate('WoWAI.GameContext()');
  assert.ok(!noWorn.includes('Worn:'), `no reader, no Worn line: ${noWorn}`);
  assert.ok(noWorn.includes('Bags:'), 'and the bag half still arrives');
  vm.run('GetInventoryItemLink = STUB_GetInventoryItemLink');

  // The client owns the bag range: an Enum.BagIndex reporting a different set is followed, so a
  // client that numbers its bags differently is read correctly instead of being read as empty.
  vm.run('Enum = { BagIndex = { Backpack = 0, Bag_1 = 1, Bag_2 = 2, Bag_3 = 3, Bag_4 = 4 } }');
  assert.ok(vm.evaluate('WoWAI.GameContext()').includes('Bags: 4 of 7 items wearable'), 'the enum-defined range is walked');
  vm.run('Enum = STUB_ENUM');
  // ...and with no readable enum the documented 0..4 range is the fallback, which is the same set.
  vm.run('Enum = nil');
  assert.ok(vm.evaluate('WoWAI.GameContext()').includes('Bags: 4 of 7 items wearable'), '0..4 is the fallback, matching PLAYER_BAGS');
  vm.run('Enum = STUB_ENUM');

  // A slot the client will not describe contributes nothing rather than a guess: an item whose
  // equip location is unreadable is counted as seen but never listed as a candidate. The fixture
  // holds two copies of item 2140 (backpack and bag 1), so a readable 2140 alone is exactly two
  // candidates out of the seven slots holding something.
  vm.run('STUB.equipLoc = { [2140] = "INVTYPE_WEAPON" }');
  const partialUnknown = vm.evaluate('WoWAI.GameContext()');
  assert.ok(partialUnknown.includes('Bags: 2 of 7 items wearable'), `only the readable items are candidates: ${partialUnknown}`);
  assert.ok(!partialUnknown.includes('Footpad'), 'an item the client will not classify is not guessed at');
  assert.ok(!partialUnknown.includes('Dented Buckler'), 'nor is a shield assumed off-hand without the client saying so');
  vm.run('STUB.equipLoc = STUB_EQUIP_LOC');

  // A quality the client refuses to give (a secret) costs the letter, never the item.
  vm.run('STUB.quality = { [1] = STUB.secret }');
  const secretQuality = vm.evaluate('WoWAI.GameContext()');
  assert.ok(secretQuality.includes('Head Worn Helm,') || secretQuality.includes('Head Worn Helm,'), `the item survives an unreadable quality: ${secretQuality}`);
  assert.ok(!secretQuality.includes('secret'), 'and a secret is never printed');
  vm.run('STUB.quality = STUB_QUALITY');

  // A candidate the client will COUNT but not NAME is the case that made the count and the list
  // disagree, and a count/list disagreement is read as a complete list. Both halves of the fix are
  // asserted: the unnamed candidate is inside the "+N more", and the counts line survives even
  // when nothing at all can be listed. Found by fuzzing the line, not by reading it.
  vm.run('STUB.bags = { [0] = { { id = 2140, name = "Fine Longsword", quality = 2 }, { id = 1121, name = "", quality = 2 } } }; STUB.bagSlots = { [0] = 2 }');
  const oneUnnamed = vm.evaluate('WoWAI.GameContext()').split('\n').find(l => l.startsWith('Bags: '));
  assert.ok(/^Bags: 2 of 2 items wearable -- Weapon Fine Longsword\(U\), \+1 more$/.test(oneUnnamed), `the unnameable candidate is admitted in the +N, not silently dropped: ${oneUnnamed}`);
  vm.run('STUB.bags = { [0] = { { id = 1121, name = "", quality = 2 } } }; STUB.bagSlots = { [0] = 1 }');
  const allUnnamed = vm.evaluate('WoWAI.GameContext()').split('\n').find(l => l.startsWith('Bags: '));
  assert.equal(allUnnamed, 'Bags: 1 of 1 items wearable, +1 more', 'with nothing nameable the counts line still stands and still accounts for the shortfall');
  // The invariant, as one assertion over both: whatever the line lists plus whatever its own "+N
  // more" admits equals the count it states. A line that fails this reads as a complete list.
  for (const [count, line] of [['2 of 2', oneUnnamed], ['1 of 1', allUnnamed]]) {
    const found = Number(line.match(/^Bags: (\d+) of/)[1]);
    const listed = line.includes(' -- ') ? line.split(' -- ')[1].replace(/, \+\d+ more$/, '').split(', ').filter(Boolean).length : 0;
    const more = Number((line.match(/, \+(\d+) more$/) || [])[1] || 0);
    assert.equal(listed + more, found, `${count} must add up on the line itself: ${line}`);
  }
  vm.run('STUB.bags = STUB_BAGS; STUB.bagSlots = STUB_BAG_SLOTS');

  // THE ACCEPTANCE CRITERION, as an assertion rather than a description: from the block alone, an
  // agent can name a bag candidate AND the item it would replace, which is the whole of "is
  // anything in my bags an upgrade". Both halves come from one string with no other input.
  vm.run('STUB.bags = { [0] = { { id = 1121, name = "Footpad\'s Shoes", quality = 2 } } }; STUB.bagSlots = { [0] = 1 }');
  const upgrade = vm.evaluate('WoWAI.GameContext()');
  const bagHalf = upgrade.split('\n').find(l => l.startsWith('Bags: '));
  const wornHalf = upgrade.split('\n').find(l => l.startsWith('Worn: '));
  assert.ok(/Feet Footpad's Shoes\(U\)/.test(bagHalf), `the candidate is named: ${bagHalf}`);
  assert.ok(/Feet Worn Boots\(C\)/.test(wornHalf), `and what it would replace is named: ${wornHalf}`);
  console.log(`      upgrade answer: "${bagHalf}"  vs  "${wornHalf}"`);
  vm.run('STUB.bags = STUB_BAGS; STUB.bagSlots = STUB_BAG_SLOTS');

  // The budget is measured, not asserted, and the two lists are packed against the real remaining
  // room rather than cut by the cap -- so every line survives on a full block.
  const full = vm.evaluate('WoWAI.GameContext()');
  const bytes = Buffer.byteLength(full, 'utf8');
  const detail = full.split('\n').map((l, i) => `${i + 1}: [${Buffer.byteLength(l, 'utf8')}] ${l}`).join('\n');
  assert.ok(bytes < 700, `context is ${bytes} bytes, under CONTEXT_MAX (700)\n${detail}`);
  assert.ok(full.split('\n').every(l => /^[A-Z][a-z]+: /.test(l)), `every line is a complete Key: value line -- no fragment from the cap\n${detail}`);
  const wornBytes = Buffer.byteLength(full.split('\n').find(l => l.startsWith('Worn: ')) || '', 'utf8');
  const bagBytes = Buffer.byteLength(full.split('\n').find(l => l.startsWith('Bags: ')) || '', 'utf8');
  console.log(`      context block: ${bytes} bytes of 700 (slack ${700 - bytes}); the two inventory lines cost ${wornBytes + bagBytes + 2}`);
});

test('a profession tool is not a bag upgrade, and the line says so without leaving anything out', () => {
  const vm = newVM();

  // THE TOKEN QUESTION, answered from evidence rather than from the name it looks like it should
  // have. The client does enumerate a dedicated InventoryType for profession gear --
  // IndexProfessionToolType = 29, IndexProfessionGearType = 30
  // (Blizzard_APIDocumentationGenerated/ItemConstantsDocumentation.lua:218-219) -- and both tokens
  // exist in the client's own string table (INVTYPE_PROFESSION_TOOL, INVTYPE_PROFESSION_GEAR, at
  // wowb-strings.txt offsets 988443/988446). But that is NOT the token the live client returned for
  // the two items this card is about, and the fixture below reproduces what it actually returned.
  //
  // The measured line (bridge/state.json) was:
  //   Bags: 2 of 29 items wearable -- Main Hand Blacksmith Hammer(C), Main Hand Mining Pick(C)
  // "Main Hand" is rendered by exactly one key in EQUIP_LOC -- INVTYPE_WEAPONMAINHAND -- so the
  // equip location the client reported for both tools was the ORDINARY weapon one. Matching a
  // profession token would therefore never have excluded them, and a fix written that way would
  // have been green in a stub while doing nothing in game. Blizzard's own profession probe agrees
  // about which field it inspects: `invType == "INVTYPE_PROFESSION_TOOL"` against the equip
  // location (Blizzard_Tutorials/Blizzard_Tutorials_Professions.lua:112) -- the same unusable
  // field. The discriminator used here is the item's class pair instead.
  //
  // The fixture carries the real location AND the real class pair for each tool, so the test
  // cannot pass via a missing location.
  assert.equal(vm.evaluate('STUB.equipLoc[2901]'), 'INVTYPE_WEAPONMAINHAND', 'a Mining Pick reports the ordinary weapon location, not a profession one');
  assert.equal(vm.evaluate('STUB.equipLoc[5956]'), 'INVTYPE_WEAPONMAINHAND', 'so does a Blacksmith Hammer');
  // ...and that location alone maps to a slot, which is exactly why the old line listed them.
  assert.equal(vm.evaluate('STUB.itemClass[2901][1] .. "/" .. STUB.itemClass[2901][2]'), '2/14', 'the tool is weapon/Miscellaneous (Enum.ItemClass.Weapon=2, Enum.ItemWeaponSubclass.Generic=14)');

  login(vm);

  // CRITERION 1: a profession tool in a bag is NOT listed, and the count is reported without it.
  // One tool plus one real item in a two-slot bag: the honest answer is 1 of 2, not 2 of 2.
  vm.run('STUB.bags = { [0] = { { id = 2901, name = "Mining Pick", quality = 1 }, { id = 1121, name = "Footpad\'s Shoes", quality = 2 } } }; STUB.bagSlots = { [0] = 2 }');
  const toolAndGear = vm.evaluate('WoWAI.GameContext()').split('\n').find(l => l.startsWith('Bags: '));
  assert.equal(toolAndGear, "Bags: 1 of 2 items wearable -- Feet Footpad's Shoes(U)",
    `the tool is left out and the count excludes it: ${toolAndGear}`);
  assert.ok(!toolAndGear.includes('Mining Pick'), 'the profession tool is not offered as an upgrade');

  // CRITERION 2: real gear is still listed normally -- the whole point of the line, so this
  // asserts the pre-existing detection rather than tolerating its loss. The shoes and the buckler
  // and both swords survive with their slots; only the tools are gone.
  vm.run('STUB.bags = STUB_BAGS; STUB.bagSlots = STUB_BAG_SLOTS');
  const gearOnly = vm.evaluate('WoWAI.GameContext()').split('\n').find(l => l.startsWith('Bags: '));
  assert.equal(gearOnly, "Bags: 4 of 7 items wearable -- Weapon Fine Longsword(U), Feet Footpad's Shoes(U), Off Hand Dented Buckler(C), Weapon Fine Longsword(U)",
    'upgrade detection is unchanged for real gear');
  assert.ok(gearOnly.includes("Feet Footpad's Shoes(U)"), 'a real armor upgrade is still listed');
  assert.ok(gearOnly.includes('Off Hand Dented Buckler(C)'), 'so is a shield');
  assert.ok(gearOnly.includes('Weapon Fine Longsword(U)'), 'so is a weapon');

  // CRITERION 3: bags holding ONLY profession tools read as the honest empty answer, and the line
  // is PRESENT rather than dropped. This is the live character's case verbatim -- two tools, no
  // gear -- and "nothing in your bags is gear" is a real answer, not a missing one.
  vm.run('STUB.bags = { [0] = { { id = 2901, name = "Mining Pick", quality = 1 }, { id = 5956, name = "Blacksmith Hammer", quality = 1 } } }; STUB.bagSlots = { [0] = 2 }');
  const toolsOnly = vm.evaluate('WoWAI.GameContext()').split('\n').find(l => l.startsWith('Bags: '));
  assert.equal(toolsOnly, 'Bags: 0 of 2 items wearable',
    `the honest empty answer, stated rather than omitted: ${toolsOnly}`);
  assert.ok(toolsOnly !== undefined, 'the line survives -- an empty answer is not an absent one');
  assert.ok(!/Bags: 0 of 2 items wearable --/.test(toolsOnly), 'and carries no dangling separator');
  assert.ok(!toolsOnly.includes('Mining Pick') && !toolsOnly.includes('Blacksmith'), 'neither tool is offered');

  // The discriminator is the CLASS PAIR, isolated: the same item id, the same equip location, with
  // only the pair changed. If the exclusion were keyed on the location -- or on anything else --
  // these three would not differ, so this is what proves which field does the work.
  vm.run('STUB.equipLoc[9999] = "INVTYPE_WEAPONMAINHAND"');
  vm.run('STUB.bags = { [0] = { { id = 9999, name = "Mystery Blade", quality = 2 } } }; STUB.bagSlots = { [0] = 1 }');
  const unclassified = vm.evaluate('WoWAI.GameContext()').split('\n').find(l => l.startsWith('Bags: '));
  assert.equal(unclassified, 'Bags: 1 of 1 items wearable -- Main Hand Mystery Blade(U)',
    `a location with no class pair stays listed -- an unreadable classification is not a filter: ${unclassified}`);
  vm.run('STUB.itemClass[9999] = { 2, 14 }');
  assert.equal(vm.evaluate('WoWAI.GameContext()').split('\n').find(l => l.startsWith('Bags: ')), 'Bags: 0 of 1 items wearable',
    'the same item, same location, classed weapon/Miscellaneous, is excluded');
  vm.run('STUB.itemClass[9999] = { 2, 7 }');
  assert.equal(vm.evaluate('WoWAI.GameContext()').split('\n').find(l => l.startsWith('Bags: ')), 'Bags: 1 of 1 items wearable -- Main Hand Mystery Blade(U)',
    'the same item, same location, classed weapon/sword, is listed again');

  // A pair the client refuses to give (a secret) is the same as no pair: the item stays listed,
  // because dropping gear on an unreadable read would be the fabricated-absence failure this file
  // refuses everywhere else.
  vm.run('STUB.itemClass[9999] = { STUB.secret, STUB.secret }');
  assert.equal(vm.evaluate('WoWAI.GameContext()').split('\n').find(l => l.startsWith('Bags: ')), 'Bags: 1 of 1 items wearable -- Main Hand Mystery Blade(U)',
    'a secret class pair is unreadable, not a positive profession match');

  // The other half of the inventory answer is untouched: what is WORN is not filtered, because the
  // Worn line names equipment slots the player actually filled, not candidates.
  vm.run('STUB.itemClass[9999] = nil; STUB.equipLoc[9999] = nil');
  const wornLine = vm.evaluate('WoWAI.GameContext()').split('\n').find(l => l.startsWith('Worn: '));
  assert.ok(/^Worn: Head Worn Helm\(P\)/.test(wornLine), `the Worn line is unaffected: ${wornLine}`);

  // The block still fits, with the filter in place.
  vm.run('STUB.bags = STUB_BAGS; STUB.bagSlots = STUB_BAG_SLOTS');
  const full = vm.evaluate('WoWAI.GameContext()');
  assert.ok(Buffer.byteLength(full, 'utf8') < 700, `context is ${Buffer.byteLength(full, 'utf8')} bytes, under CONTEXT_MAX (700)`);
  console.log(`      profession-tool answer: "${toolsOnly}"  (was "2 of 29 ... Main Hand Mining Pick(C)")`);
});

test('a shift-clicked link lands in the focused input and is sent as its name plus tooltip', () => {
  const vm = newVM();
  login(vm);
  connect(vm);
  const link = '|cff1eff00|Hitem:2140:0:0:0:0:0:0:0:60:0:0|h[Fine Longsword]|h|r';
  vm.run(`STUB.tooltips["item:2140:0:0:0:0:0:0:0:60:0:0"] = { "Fine Longsword", { "Main Hand", "Sword" }, { "17 - 33 Damage", "Speed 2.70" }, "Requires Level 14" }`);
  // Without focus the link is left alone (shift-click keeps its normal meaning).
  vm.run(`WoWAIInput:SetText("is this good for me? "); WoWAIInput:ClearFocus(); ChatFrameUtil.InsertLink("${link}")`);
  assert.equal(vm.evaluate('WoWAIInput:GetText()'), 'is this good for me? ');
  // The client's own path (bags, spellbook, quest log all end here): ChatFrameUtil.InsertLink.
  vm.run(`WoWAIInput:SetFocus(); ChatFrameUtil.InsertLink("${link}")`);
  assert.equal(vm.evaluate('WoWAIInput:GetText()'), 'is this good for me? ' + link);
  // The old global name is not hooked as well, so nothing is inserted twice.
  vm.run(`ChatEdit_InsertLink("${link}")`);
  assert.equal(vm.evaluate('WoWAIInput:GetText()'), 'is this good for me? ' + link + link, 'the alias reaches the one hook exactly once');
  vm.run(`WoWAIInput:SetText("is this good for me? ${link}")`);
  vm.run('WoWAI.SendFromInput()');
  const expected = [
    'is this good for me? [Fine Longsword]',
    '',
    '--- Linked from the game ---',
    '[Fine Longsword] item 2140 (Uncommon)',
    '  Fine Longsword',
    '  Main Hand  Sword',
    '  17 - 33 Damage  Speed 2.70',
    '  Requires Level 14',
  ].join('\n');
  const rec = stripRecords(vm).find(r => r.text.startsWith('is this good'));
  assert.equal(rec.text, expected);
  assert.equal(vm.evaluate('WoWAIDB.chats[1].history[#WoWAIDB.chats[1].history].text'), expected, 'the transcript shows what was sent');
  assert.equal(vm.evaluate('WoWAIDB.chats[1].name'), 'Is this good for me');
  // Bare links (no colour) and repeated links: one block each, tooltip or not.
  vm.run('RESULT = (WoWAI.ExpandLinks("x |Hspell:1978|h[Serpent Sting]|h y |Hspell:1978|h[Serpent Sting]|h"))');
  assert.equal(vm.evaluate('RESULT'), 'x [Serpent Sting] y [Serpent Sting]\n\n--- Linked from the game ---\n[Serpent Sting] spell 1978');
  vm.run('RESULT, COUNT = WoWAI.ExpandLinks("plain text | with a pipe")');
  assert.equal(vm.evaluate('RESULT'), 'plain text | with a pipe');
  assert.equal(vm.evaluate('COUNT'), '0');
});

test('deleting a chat tells the bridge to forget it, and a restore never brings it back', () => {
  const vm = newVM();
  login(vm);
  connect(vm);
  vm.run('WoWAI.NewChat("Second")');
  assert.equal(vm.num('#WoWAIDB.chats'), 2);
  const gone = vm.evaluate('WoWAIDB.chats[2].id');
  vm.run(`WoWAI.DeleteChat("${gone}")`);
  assert.equal(vm.num('#WoWAIDB.chats'), 1);
  // A forget record for that chat is on the strip and remembered until acked.
  const rec = stripRecords(vm).find(r => r.flags === 'd');
  assert.ok(rec, 'forget record on the strip');
  assert.equal(rec.chat, gone);
  assert.equal(rec.text, '');
  assert.equal(vm.evaluate(`WoWAIDB.forget["${gone}"] ~= nil`), 'true');
  // A restore that still lists the chat is ignored for it.
  const token = vm.evaluate('WoWAIDB.session');
  nextSlot(vm, `{ now = time(), cwd = "", replies = {}, restore = { token = "${token}", chats = { { id = "${gone}", name = "Second", cwd = "", messages = { { role = "user", text = "old", id = 1, t = 1 } } } } } }`);
  vm.run('WoWAI.Connect(); STUB.now = STUB.now + 6; STUB.Tick()');
  assert.equal(vm.num('#WoWAIDB.chats'), 1, 'deleted chat not restored');
  // The bridge acks the forget record: it leaves the strip and the memory.
  const slot = String(rec.id).padStart(3, '0');
  vm.run(`STUB.sounds["Interface\\\\AddOns\\\\WoWAI\\\\ack\\\\${slot}.wav"] = true; STUB.Tick()`);
  assert.equal(vm.evaluate(`WoWAIDB.forget["${gone}"]`), null, 'forgotten once acked');
  assert.ok(!stripRecords(vm).find(r => r.flags === 'd'), 'forget record left the strip');
});

test('until the bridge answers, Connect replaces Send and a message stays in the box', () => {
  const vm = newVM();
  login(vm);
  vm.run('WoWAI.Toggle(true)');
  assert.equal(vm.evaluate('WoWAI.IsConnected()'), 'false');
  const texts = () => vm.evaluate('table.concat(STUB.texts, "|")');
  assert.ok(texts().includes('Not connected - start the bridge, then click Connect'));
  // Sending while disconnected puts the text back in the box and starts a connect attempt.
  vm.run('WoWAIInput:SetText("fix the bug"); WoWAI.SendFromInput()');
  assert.equal(vm.evaluate('WoWAIDB.chats[1].pendingId'), null, 'nothing sent');
  assert.equal(vm.evaluate('WoWAIInput:GetText()'), 'fix the bug', 'message kept in the box');
  const hello = stripRecords(vm);
  assert.equal(hello.length, 1);
  assert.equal(hello[0].flags, 'h;c', 'a hello went out instead');
  assert.ok(texts().includes('Connecting...'));
  assert.ok(texts().includes('your message goes out as soon as it answers'));
  // No answer within CONNECT_WAIT: the attempt is reported as failed, Connect is back.
  vm.run('STUB.now = STUB.now + 20; STUB.Tick()');
  assert.equal(vm.evaluate('WoWAI.IsConnected()'), 'false');
  assert.ok(texts().includes('No answer from the bridge'));
  assert.equal(vm.evaluate('WoWAIInput:GetText()'), 'fix the bug', 'message still in the box after a failed attempt');
  // Click Connect again; this time the bridge answers the hello poll. Nothing was
  // queued by that click, so the message waits for the user.
  vm.run('WoWAI.Connect()');
  nextSlot(vm, '{ now = time(), cwd = "C:\\\\proj", replies = {} }');
  vm.run('STUB.now = STUB.now + 6; STUB.Tick()');
  assert.equal(vm.evaluate('WoWAI.IsConnected()'), 'true');
  assert.equal(vm.evaluate('WoWAIDB.chats[1].pendingId'), null, 'a plain Connect sends nothing by itself');
  vm.run('WoWAI.SendFromInput()');
  assert.ok(vm.num('WoWAIDB.chats[1].pendingId') >= 1, 'the kept message goes out once connected');
  assert.ok(stripRecords(vm).find(r => r.text === 'fix the bug'));
});

test('a message sent while disconnected goes out by itself once the bridge answers', () => {
  const vm = newVM();
  login(vm);
  vm.run('WoWAI.Toggle(true)');
  vm.run('WoWAIInput:SetText("fix the bug"); WoWAI.SendFromInput()');
  assert.equal(vm.evaluate('WoWAIDB.chats[1].pendingId'), null, 'nothing sent yet');
  // The bridge answers the hello poll: the queued message follows without a second click.
  nextSlot(vm, '{ now = time(), cwd = "C:\\\\proj", replies = {} }');
  vm.run('STUB.now = STUB.now + 6; STUB.Tick()');
  assert.equal(vm.evaluate('WoWAI.IsConnected()'), 'true');
  assert.ok(vm.num('WoWAIDB.chats[1].pendingId') >= 1, 'queued message went out on connect');
  assert.ok(stripRecords(vm).find(r => r.text === 'fix the bug'));
  assert.equal(vm.evaluate('WoWAIInput:GetText()'), '', 'box cleared after the auto-send');
  // Only once: a later reconnect sends nothing.
  vm.run('WoWAI.Connect()');
  nextSlot(vm, '{ now = time(), cwd = "C:\\\\proj", replies = {} }');
  vm.run('STUB.now = STUB.now + 6; STUB.Tick()');
  assert.equal(stripRecords(vm).filter(r => r.text === 'fix the bug').length, 1);
});

test('without the sound channel, the light stays green between idle slot polls', () => {
  // The stub has no ctl/valid.wav, so the login self-test disables the sound
  // channel: the addon is in "slot checks only" mode, like a client whose
  // PlaySoundFile reports every file as playable.
  const vm = newVM();
  login(vm);
  connect(vm);
  assert.equal(vm.evaluate('WoWAI.BridgeState()'), 'ok');
  // 90 s of silence used to mean "stale"; with no beats to hear that is normal.
  vm.run('STUB.now = STUB.now + 200; STUB.Tick()');
  assert.equal(vm.evaluate('WoWAI.BridgeState()'), 'ok', 'still green after 200 s');
  assert.equal(vm.evaluate('WoWAI.IsConnected()'), 'true');
  // 10 minutes in, the idle poll spends a slot; the bridge's clock in it keeps the light green.
  vm.run('STUB.loadCount = 0; STUB.onLoadAddOn = function(name) STUB.loadCount = STUB.loadCount + 1; WoWAI_SlotData = { now = time(), cwd = "", replies = {} } end');
  vm.run('STUB.now = STUB.now + 410; STUB.Tick()');
  assert.equal(vm.num('STUB.loadCount'), 1, 'one idle poll');
  assert.equal(vm.evaluate('WoWAI.BridgeState()'), 'ok', 'green again after the idle poll');
  // A bridge that really is gone still shows: no slot answers, and the light drops.
  vm.run('STUB.onLoadAddOn = function(name) WoWAI_SlotData = nil end');
  vm.run('STUB.now = STUB.now + 800; STUB.Tick()');
  assert.equal(vm.evaluate('WoWAI.BridgeState()'), 'stale');
  vm.run('STUB.now = STUB.now + 700; STUB.Tick()');
  assert.equal(vm.evaluate('WoWAI.BridgeState()'), 'down');
});

test('the Folder... menu item (right-click a chat) opens a prompt that sets the chat folder like /wow-ai cd', () => {
  const vm = newVM();
  login(vm);
  vm.run('WoWAI.FolderPrompt()');
  assert.equal(vm.evaluate('STUB.popup.which'), 'WOWAI_FOLDER');
  assert.equal(vm.evaluate('STUB.popup.data.cwd'), '');
  // Accept the dialog the way the game would: an edit box holding the new path.
  vm.run(`
    local dialog = { editBox = { GetText = function() return "  ..\\\\realms " end } }
    StaticPopupDialogs.WOWAI_FOLDER.OnAccept(dialog, STUB.popup.data)`);
  assert.equal(vm.evaluate('WoWAIDB.chats[1].cwd'), '..\\realms');
  assert.ok(vm.evaluate('WoWAIDB.chats[1].history[#WoWAIDB.chats[1].history].text').includes('relative to'));
  vm.run('WoWAI.FolderPrompt()');
  assert.equal(vm.evaluate('STUB.popup.data.cwd'), '..\\realms', 'prompt is prefilled with the current folder');
  // A full path gets no "relative to" note; empty goes back to the default.
  vm.run('WoWAI.SetFolder("C:\\\\other")');
  assert.ok(!vm.evaluate('WoWAIDB.chats[1].history[#WoWAIDB.chats[1].history].text').includes('relative to'));
  vm.run('WoWAI.SetFolder("")');
  assert.equal(vm.evaluate('WoWAIDB.chats[1].cwd'), '');
});

test('a sent message is encoded on the strip with the chat folder, then a slot reply finishes it', () => {
  const vm = newVM();
  login(vm);
  connect(vm);
  vm.run('SlashCmdList.WOWAI("cd realms")');
  assert.equal(vm.evaluate('WoWAIDB.chats[1].cwd'), 'realms');
  vm.run('WoWAI.Send("hello world")');
  const chatId = vm.evaluate('WoWAIDB.chats[1].id');
  const id = vm.num('WoWAIDB.chats[1].pendingId');
  assert.ok(id >= 1);
  const rec = stripRecords(vm).find(r => r.text === 'hello world');
  assert.ok(rec, 'message record on the strip');
  assert.equal(rec.chat, chatId);
  assert.equal(rec.id, id);
  assert.equal(rec.cwd, 'realms');
  assert.equal(rec.flags, '');
  // The chat took its title from the first message.
  assert.equal(vm.evaluate('WoWAIDB.chats[1].name'), 'Hello world');

  nextSlot(vm, `{ now = time(), cwd = "C:\\\\proj", replies = { { chat = "${chatId}", id = ${id}, status = "done", text = "hi back", cwd = "x", session = "s" } } }`);
  vm.run('STUB.now = STUB.now + 6; STUB.Tick()'); // first scheduled poll is 5 s after sending
  assert.equal(vm.evaluate('WoWAIDB.chats[1].pendingId'), null);
  assert.equal(vm.evaluate('WoWAIDB.chats[1].history[#WoWAIDB.chats[1].history].role'), 'assistant');
  assert.equal(vm.evaluate('WoWAIDB.chats[1].history[#WoWAIDB.chats[1].history].text'), 'hi back');
  assert.ok(vm.evaluate('table.concat(STUB.prints, "\\n")').includes('hi back'), 'reply echoed to the game chat');
  assert.equal(vm.evaluate('WoWAIStrip.shown'), 'false', 'strip cleared once nothing is pending');

  // The bridge's default folder arrived with the slot and is what "/wow-ai cd" reports.
  vm.run('SlashCmdList.WOWAI("cd")');
  assert.equal(vm.evaluate('WoWAIDB.chats[1].cwd'), '');
  assert.ok(vm.evaluate('WoWAIDB.chats[1].history[#WoWAIDB.chats[1].history].text').includes('C:\\proj'));
});

test('a denied reply shows Allow, and Allow resends with the rules as flags', () => {
  const vm = newVM();
  login(vm);
  connect(vm);
  vm.run('WoWAI.Send("search for it")');
  const chatId = vm.evaluate('WoWAIDB.chats[1].id');
  const id = vm.num('WoWAIDB.chats[1].pendingId');
  nextSlot(vm, `{ now = time(), cwd = "", replies = { { chat = "${chatId}", id = ${id}, status = "done", text = "need permission", denied = { "WebSearch", "Bash(cargo:*)" } } } }`);
  vm.run('STUB.now = STUB.now + 6; STUB.Tick()');
  assert.equal(vm.evaluate('WoWAIDB.chats[1].history[#WoWAIDB.chats[1].history].denied[2]'), 'Bash(cargo:*)');
  vm.run(`WoWAI.Allow("${chatId}", { "WebSearch", "Bash(cargo:*)" })`);
  const rec = stripRecords(vm).find(r => r.flags.includes('allow='));
  assert.ok(rec, 'allow record on the strip');
  assert.equal(rec.flags, 'allow=WebSearch,Bash(cargo:*)');
  assert.equal(rec.id, id + 1);
});

test('a chat can pick its agent: the strip says so, replies are labelled by their writer, unknown names are refused', () => {
  const vm = newVM();
  login(vm);
  // The hello slot carries the bridge's default agent and the ones it knows.
  vm.run('STUB.RunTimers()');
  const slot = replies => `{ now = time(), cwd = "", agent = "claude", agents = { "claude", "codex", "grok" }, replies = { ${replies || ''} } }`;
  nextSlot(vm, slot());
  vm.run('STUB.now = STUB.now + 6; STUB.Tick()');
  assert.equal(vm.evaluate('WoWAI.IsConnected()'), 'true');
  const texts = () => vm.evaluate('table.concat(STUB.texts, "|")');
  assert.ok(texts().includes('agent: Claude (bridge default)'), 'the cwd line names the bridge default');
  // Without an agent of its own the chat sends no agent flag, and the reply is labelled Claude.
  vm.run('WoWAI.Send("hello")');
  const chatId = vm.evaluate('WoWAIDB.chats[1].id');
  let rec = stripRecords(vm).find(r => r.text === 'hello');
  assert.equal(rec.flags, '');
  assert.equal(vm.evaluate('WoWAIDB.outbox.agent'), null);
  const id = vm.num('WoWAIDB.chats[1].pendingId');
  nextSlot(vm, slot(`{ chat = "${chatId}", id = ${id}, status = "done", text = "hi", agent = "claude" }`));
  vm.run('STUB.now = STUB.now + 6; STUB.Tick()');
  assert.equal(vm.evaluate('WoWAIDB.chats[1].history[#WoWAIDB.chats[1].history].role'), 'assistant');
  assert.equal(vm.evaluate('WoWAIDB.chats[1].history[#WoWAIDB.chats[1].history].agent'), 'claude');
  assert.ok(vm.evaluate('table.concat(STUB.prints, "\\n")').includes('[Claude · '), 'the game chat echo names the agent');
  // Switch this chat to Codex: the next message carries agent=codex, on both transports.
  vm.run('SlashCmdList.WOWAI("agent Codex")');
  assert.equal(vm.evaluate('WoWAIDB.chats[1].agent'), 'codex');
  assert.ok(vm.evaluate('WoWAIDB.chats[1].history[#WoWAIDB.chats[1].history].text').includes('agent set to Codex'));
  vm.run('WoWAI.Send("now with codex")');
  rec = stripRecords(vm).find(r => r.text === 'now with codex');
  assert.equal(rec.flags, 'agent=codex');
  assert.equal(vm.evaluate('WoWAIDB.outbox.agent'), 'codex');
  assert.ok(texts().includes('agent: Codex   mode: pixel'));
  const id2 = vm.num('WoWAIDB.chats[1].pendingId');
  nextSlot(vm, slot(`{ chat = "${chatId}", id = ${id2}, status = "done", text = "codex here", agent = "codex" }`));
  vm.run('STUB.now = STUB.now + 6; STUB.Tick()');
  assert.equal(vm.evaluate('WoWAIDB.chats[1].history[#WoWAIDB.chats[1].history].agent'), 'codex');
  assert.ok(vm.evaluate('table.concat(STUB.prints, "\\n")').includes('[Codex · '));
  // Resend keeps the agent flag.
  vm.run('WoWAI.Send("again")');
  vm.run('WoWAI.Resend()');
  assert.equal(stripRecords(vm).find(r => r.text === 'again').flags, 'agent=codex');
  vm.run('SlashCmdList.WOWAI("cancel")');
  // A name the bridge did not list is refused; "default" goes back to the bridge's.
  vm.run('SlashCmdList.WOWAI("agent gemini")');
  assert.equal(vm.evaluate('WoWAIDB.chats[1].agent'), 'codex');
  assert.ok(vm.evaluate('WoWAIDB.chats[1].history[#WoWAIDB.chats[1].history].text').includes('Unknown agent "gemini"'));
  vm.run('SlashCmdList.WOWAI("agent default")');
  assert.equal(vm.evaluate('WoWAIDB.chats[1].agent'), '');
  assert.ok(vm.evaluate('WoWAIDB.chats[1].history[#WoWAIDB.chats[1].history].text').includes('agent reset to the bridge\'s default: Claude'));
  // The Agent... menu item opens a prompt prefilled with the chat's agent.
  vm.run('WoWAI.SetAgent("grok"); WoWAI.AgentPrompt()');
  assert.equal(vm.evaluate('STUB.popup.which'), 'WOWAI_AGENT');
  assert.equal(vm.evaluate('STUB.popup.data.agent'), 'grok');
  vm.run(`
    local dialog = { editBox = { GetText = function() return " codex " end } }
    StaticPopupDialogs.WOWAI_AGENT.OnAccept(dialog, STUB.popup.data)`);
  assert.equal(vm.evaluate('WoWAIDB.chats[1].agent'), 'codex');
  // A new chat inherits the agent, like the folder.
  vm.run('WoWAI.NewChat("Second")');
  assert.equal(vm.evaluate('WoWAIDB.chats[2].agent'), 'codex');
});

test('replies saved under the old "claude" role are read as assistant replies from Claude', () => {
  const vm = newVM();
  vm.run('WoWAIDB = { chats = { { id = "c1", name = "Old", cwd = "", history = { { role = "user", text = "q", id = 1, t = 1 }, { role = "claude", text = "a", id = 1, t = 2 } }, unread = 0, created = 1 } }, activeChat = "c1", settings = {} }');
  login(vm);
  assert.equal(vm.evaluate('WoWAIDB.chats[1].history[2].role'), 'assistant');
  assert.equal(vm.evaluate('WoWAIDB.chats[1].history[2].agent'), 'claude');
  assert.equal(vm.evaluate('WoWAIDB.chats[1].agent'), '');
  // Before the bridge has said which agent it runs, the label falls back to "AI".
  vm.run('WoWAI.Toggle(true)');
  assert.ok(vm.evaluate('table.concat(STUB.texts, "|")').includes('|Claude|'), 'the old reply is labelled Claude');
});

test('free text that starts with a command word is sent as a message; exact commands still run', () => {
  const vm = newVM();
  login(vm);
  connect(vm);
  const sent = text => !!stripRecords(vm).find(r => r.text === text);
  const last = () => vm.evaluate('WoWAIDB.chats[1].history[#WoWAIDB.chats[1].history].text');
  // "delete the unused imports" is a message, not /wow-ai delete; "cancel" alone is the command.
  vm.run('SlashCmdList.WOWAI("delete the unused imports")');
  assert.equal(vm.num('#WoWAIDB.chats'), 1, 'no chat deleted');
  assert.ok(sent('delete the unused imports'));
  vm.run('SlashCmdList.WOWAI("cancel")');
  assert.equal(vm.evaluate('WoWAIDB.chats[1].pendingId'), null, 'cancel ran as a command');
  // "help me with this macro" is a message; "help" alone prints the help.
  vm.run('SlashCmdList.WOWAI("help me with this macro")');
  assert.ok(sent('help me with this macro'));
  vm.run('SlashCmdList.WOWAI("cancel")');
  vm.run('SlashCmdList.WOWAI("help")');
  assert.ok(last().includes('/wow-ai cd'));
  // One-word arguments keep their command; more words make it a message.
  vm.run('SlashCmdList.WOWAI("agent codex")');
  assert.equal(vm.evaluate('WoWAIDB.chats[1].agent'), 'codex');
  vm.run('SlashCmdList.WOWAI("agent smith says hi")');
  assert.equal(vm.evaluate('WoWAIDB.chats[1].agent'), 'codex');
  assert.ok(sent('agent smith says hi'));
  vm.run('SlashCmdList.WOWAI("cancel")');
  // Enumerated arguments: "context off" is the command, "context matters here" a message.
  vm.run('SlashCmdList.WOWAI("context off")');
  assert.equal(vm.evaluate('WoWAIDB.settings.context'), 'false');
  vm.run('SlashCmdList.WOWAI("context matters here")');
  assert.ok(sent('context matters here'));
  vm.run('SlashCmdList.WOWAI("cancel")');
  // "reset the counter" and "clear the cache" are messages; the transcript survives.
  vm.run('SlashCmdList.WOWAI("clear the cache")');
  assert.ok(sent('clear the cache'));
  assert.ok(vm.num('#WoWAIDB.chats[1].history') > 1, 'clear did not run');
  vm.run('SlashCmdList.WOWAI("cancel")');
  vm.run('SlashCmdList.WOWAI("reset the counter")');
  assert.equal(vm.evaluate('WoWAIDB.chats[1].resetNext'), null);
  assert.ok(sent('reset the counter'));
  vm.run('SlashCmdList.WOWAI("cancel")');
  // A chat can still be picked by number or name; "chat with me about it" is a message.
  vm.run('SlashCmdList.WOWAI("new Realms")');
  vm.run('SlashCmdList.WOWAI("chat 1")');
  assert.equal(vm.evaluate('WoWAIDB.activeChat'), vm.evaluate('WoWAIDB.chats[1].id'));
  vm.run('SlashCmdList.WOWAI("chat realms")');
  assert.equal(vm.evaluate('WoWAIDB.activeChat'), vm.evaluate('WoWAIDB.chats[2].id'));
  vm.run('SlashCmdList.WOWAI("chat with me about it")');
  assert.ok(sent('chat with me about it'));
  // /ai alone toggles the window.
  vm.run('WoWAI.Toggle(false); SlashCmdList.WOWAI("")');
  assert.equal(vm.evaluate('WoWAIFrame.shown'), 'true');
});

test('/wow-ai reset marks the next message as a new session', () => {
  const vm = newVM();
  login(vm);
  connect(vm);
  vm.run('SlashCmdList.WOWAI("reset")');
  vm.run('WoWAI.Send("start over")');
  const rec = stripRecords(vm).find(r => r.text === 'start over');
  assert.equal(rec.flags, 'n');
  assert.equal(vm.evaluate('WoWAIDB.chats[1].resetNext'), null);
});

test('a restore bundle addressed to this session adds the missing chats once', () => {
  const vm = newVM();
  login(vm);
  connect(vm);
  vm.run('WoWAI.Send("hi")');
  const chatId = vm.evaluate('WoWAIDB.chats[1].id');
  const id = vm.num('WoWAIDB.chats[1].pendingId');
  const token = vm.evaluate('WoWAIDB.session');
  const bundle = `restore = { token = "${token}", chats = { { id = "old1", name = "Old work", cwd = "C:\\\\old", messages = { { role = "user", id = 1, t = 1, text = "q" }, { role = "claude", id = 1, t = 2, text = "a" } } } } }`;
  nextSlot(vm, `{ now = time(), cwd = "", replies = { { chat = "${chatId}", id = ${id}, status = "done", text = "ok" } }, ${bundle} }`);
  vm.run('STUB.now = STUB.now + 6; STUB.Tick()');
  assert.equal(vm.num('#WoWAIDB.chats'), 2);
  assert.equal(vm.evaluate('WoWAIDB.chats[1].id'), 'old1');
  assert.equal(vm.num('#WoWAIDB.chats[1].history'), 2);
  // An older bridge's transcript says "claude"; it is read as an assistant reply from Claude.
  assert.equal(vm.evaluate('WoWAIDB.chats[1].history[2].role'), 'assistant');
  assert.equal(vm.evaluate('WoWAIDB.chats[1].history[2].agent'), 'claude');
  assert.equal(vm.evaluate('WoWAIDB.restored'), 'true');
  // A second bundle with the same token is ignored.
  vm.run('WoWAI.Send("again")');
  const id2 = vm.num('WoWAIDB.chats[2].pendingId');
  nextSlot(vm, `{ now = time(), cwd = "", replies = { { chat = "${chatId}", id = ${id2}, status = "done", text = "ok" } }, ${bundle.replace('old1', 'old2')} }`);
  vm.run('STUB.now = STUB.now + 6; STUB.Tick()');
  assert.equal(vm.num('#WoWAIDB.chats'), 2);
});

test('chat management commands: new, chat, rename, delete, clear, copy', () => {
  const vm = newVM();
  login(vm);
  vm.run('SlashCmdList.WOWAI("new Realms")');
  assert.equal(vm.num('#WoWAIDB.chats'), 2);
  assert.equal(vm.evaluate('WoWAIDB.chats[2].name'), 'Realms');
  assert.equal(vm.evaluate('WoWAIDB.activeChat'), vm.evaluate('WoWAIDB.chats[2].id'));
  vm.run('SlashCmdList.WOWAI("chat 1")');
  assert.equal(vm.evaluate('WoWAIDB.activeChat'), vm.evaluate('WoWAIDB.chats[1].id'));
  vm.run('SlashCmdList.WOWAI("rename Stuff")');
  assert.equal(vm.evaluate('WoWAIDB.chats[1].name'), 'Stuff');
  vm.run('SlashCmdList.WOWAI("help")');
  assert.ok(vm.evaluate('WoWAIDB.chats[1].history[1].text').includes('/wow-ai cd'));
  vm.run('SlashCmdList.WOWAI("clear")');
  assert.equal(vm.num('#WoWAIDB.chats[1].history'), 0);
  vm.run('SlashCmdList.WOWAI("delete")');
  assert.equal(vm.num('#WoWAIDB.chats'), 1);
  assert.equal(vm.evaluate('WoWAIDB.chats[1].name'), 'Realms');
  // The copy box builds with a proper backdrop (the stub fails on SetBackdrop(nil)).
  vm.run('WoWAI.ShowCopy("some reply")');
  assert.equal(vm.evaluate('WoWAICopy.shown'), 'true');
  assert.equal(vm.evaluate('WoWAICopyBox.text'), 'some reply');
});

test('chat rows: right-click opens a menu that renames or sets the folder of that chat, the trash can asks before deleting', () => {
  const vm = newVM();
  login(vm);
  vm.run('SlashCmdList.WOWAI("new Realms")');
  const first = vm.evaluate('WoWAIDB.chats[1].id');
  const second = vm.evaluate('WoWAIDB.chats[2].id');
  assert.equal(vm.evaluate('WoWAIDB.activeChat'), second);
  // The menu opens for the row's chat, not the active one, and toggles closed on a second open.
  vm.run(`WoWAI.ShowChatMenu("${first}", WoWAIFrame)`);
  assert.equal(vm.evaluate('WoWAIChatMenu.shown'), 'true');
  assert.equal(vm.evaluate('WoWAIChatMenu.chatId'), first);
  assert.equal(vm.evaluate('WoWAIChatMenu.title.text'), 'Chat 1');
  vm.run(`WoWAI.ShowChatMenu("${first}", WoWAIFrame)`);
  assert.equal(vm.evaluate('WoWAIChatMenu.shown'), 'false');
  // Rename and Folder prompts target the chat they were opened for.
  vm.run(`WoWAI.RenamePrompt("${first}")`);
  assert.equal(vm.evaluate('STUB.popup.which'), 'WOWAI_RENAME');
  assert.equal(vm.evaluate('STUB.popup.data.id'), first);
  vm.run(`
    local dialog = { editBox = { GetText = function() return "Old stuff" end } }
    StaticPopupDialogs.WOWAI_RENAME.OnAccept(dialog, STUB.popup.data)`);
  assert.equal(vm.evaluate('WoWAIDB.chats[1].name'), 'Old stuff');
  assert.equal(vm.evaluate('WoWAIDB.chats[2].name'), 'Realms');
  vm.run(`WoWAI.FolderPrompt("${first}")`);
  assert.equal(vm.evaluate('STUB.popup.which'), 'WOWAI_FOLDER');
  assert.equal(vm.evaluate('STUB.popup.data.id'), first);
  // The X asks first: nothing happens until OK, then only that chat goes and the active one stays.
  vm.run(`WoWAI.ConfirmDelete("${first}")`);
  assert.equal(vm.evaluate('STUB.popup.which'), 'WOWAI_DELETE');
  assert.equal(vm.num('#WoWAIDB.chats'), 2);
  vm.run('StaticPopupDialogs.WOWAI_DELETE.OnAccept({}, STUB.popup.data)');
  assert.equal(vm.num('#WoWAIDB.chats'), 1);
  assert.equal(vm.evaluate('WoWAIDB.chats[1].id'), second);
  assert.equal(vm.evaluate('WoWAIDB.activeChat'), second);
  // Deleting the last chat clears it instead of removing it.
  vm.run(`WoWAI.ConfirmDelete("${second}")`);
  vm.run('StaticPopupDialogs.WOWAI_DELETE.OnAccept({}, STUB.popup.data)');
  assert.equal(vm.num('#WoWAIDB.chats'), 1);
  assert.equal(vm.evaluate('WoWAIDB.chats[1].name'), 'Chat 1');
});

test('minimize collapses to the mini bar and back; the mini bar X hides everything', () => {
  const vm = newVM();
  login(vm);
  vm.run('WoWAI.Toggle(true)');
  assert.equal(vm.evaluate('WoWAIFrame.shown'), 'true');
  vm.run('WoWAI.Minimize(true)');
  assert.equal(vm.evaluate('WoWAIFrame.shown'), 'false');
  assert.equal(vm.evaluate('WoWAIMini.shown'), 'true');
  assert.equal(vm.evaluate('WoWAIDB.settings.minimized'), 'true');
  vm.run('WoWAI.Minimize(false)');
  assert.equal(vm.evaluate('WoWAIFrame.shown'), 'true');
  assert.equal(vm.evaluate('WoWAIMini.shown'), 'false');
  vm.run('WoWAI.Toggle(false)');
  assert.equal(vm.evaluate('WoWAIFrame.shown'), 'false');
  assert.equal(vm.evaluate('WoWAIMini.shown'), 'false');
  assert.equal(vm.evaluate('WoWAIDB.settings.shown'), 'false');
});

test('reload mode writes the outbox for the bridge instead of drawing the strip', () => {
  const vm = newVM();
  login(vm);
  vm.run('SlashCmdList.WOWAI("mode reload")');
  vm.run('SlashCmdList.WOWAI("reset")');
  vm.run('WoWAI.Send("via reload")');
  assert.equal(vm.evaluate('STUB.reloaded'), 'true');
  assert.equal(vm.evaluate('WoWAIDB.outbox.newSession'), 'true');
  assert.equal(vm.evaluate('WoWAIDB.outbox.text'), Buffer.from('via reload').toString('hex'));
  assert.equal(decodeStrip(vm), null);
});

test('the minimap button exists on the minimap, click toggles the window with no slash command', () => {
  const vm = newVM();
  login(vm);
  // It is a real frame, a child of Blizzard's Minimap (so it shows and hides with it).
  assert.equal(vm.evaluate('WoWAIMapButton ~= nil'), 'true');
  assert.equal(vm.evaluate('WoWAIMapButton:GetParent() == Minimap'), 'true');
  assert.equal(vm.evaluate('WoWAIMapButton.shown'), 'true', 'visible whenever the minimap is');
  // Clicking is the no-argument /wow-ai: the window toggles both ways.
  assert.equal(vm.evaluate('WoWAIFrame.shown'), 'false');
  vm.run('WoWAIMapButton.scripts.OnClick(WoWAIMapButton)');
  assert.equal(vm.evaluate('WoWAIFrame.shown'), 'true', 'click opens it');
  assert.equal(vm.evaluate('WoWAIDB.settings.shown'), 'true');
  vm.run('WoWAIMapButton.scripts.OnClick(WoWAIMapButton)');
  assert.equal(vm.evaluate('WoWAIFrame.shown'), 'false', 'click again closes it');
  // Identical to the slash command with no argument, from the same state.
  vm.run('SlashCmdList.WOWAI("")');
  const afterSlash = vm.evaluate('WoWAIFrame.shown');
  vm.run('WoWAIMapButton.scripts.OnClick(WoWAIMapButton)');
  vm.run('WoWAIMapButton.scripts.OnClick(WoWAIMapButton)');
  assert.equal(vm.evaluate('WoWAIFrame.shown'), afterSlash, 'button and /wow-ai land in the same state');
});

test('the minimap button sits on the minimap edge at its saved angle and shows the addon in a tooltip', () => {
  const vm = newVM();
  login(vm);
  // Default 225 degrees: bottom-left, on the 140x140 map's radius plus the 5px inset.
  const R = 70 + 5;
  assert.equal(vm.evaluate('WoWAIDB.settings.mapAngle'), '225');
  let x = Number(vm.evaluate('WoWAIMapButton.x'));
  let y = Number(vm.evaluate('WoWAIMapButton.y'));
  assert.ok(Math.abs(x - (-R * Math.SQRT1_2)) < 0.01, `x=${x}`);
  assert.ok(Math.abs(y - (-R * Math.SQRT1_2)) < 0.01, `y=${y}`);
  assert.equal(vm.evaluate('WoWAIMapButton.point'), 'CENTER');
  assert.equal(vm.evaluate('WoWAIMapButton.rel == Minimap'), 'true', 'anchored to the minimap, its own centre');
  assert.equal(vm.evaluate('WoWAIMapButton.relPoint'), 'CENTER');
  // 90 degrees is the top of the map, straight up from its centre.
  vm.run('WoWAIDB.settings.mapAngle = 90; WoWAI.PlaceMapButton()');
  x = Number(vm.evaluate('WoWAIMapButton.x'));
  y = Number(vm.evaluate('WoWAIMapButton.y'));
  assert.ok(Math.abs(x) < 0.01 && Math.abs(y - R) < 0.01, `x=${x} y=${y}`);
  // Hovering names the addon.
  vm.run('STUB.texts = {}; WoWAIMapButton.scripts.OnEnter(WoWAIMapButton)');
  assert.ok(vm.evaluate('table.concat(STUB.texts, "|")').includes('WoW AI'), 'tooltip identifies the addon');
});

test('dragging the button around the minimap saves the angle, and a reload puts it back there', () => {
  const vm = newVM();
  login(vm);
  // Grab the button, then move the cursor to the right of the minimap (0 degrees).
  vm.run('WoWAIMapButton.scripts.OnDragStart(WoWAIMapButton)');
  assert.equal(vm.evaluate('WoWAIMapButton.scripts.OnUpdate ~= nil'), 'true', 'the drag installs its OnUpdate');
  vm.run('STUB.cursorX, STUB.cursorY = 600, 500; WoWAIMapButton.scripts.OnUpdate(WoWAIMapButton)');
  assert.equal(Number(vm.evaluate('WoWAIDB.settings.mapAngle')).toFixed(0), '0');
  // Straight above the centre is 90; straight below is 270.
  vm.run('STUB.cursorX, STUB.cursorY = 500, 600; WoWAIMapButton.scripts.OnUpdate(WoWAIMapButton)');
  assert.equal(Number(vm.evaluate('WoWAIDB.settings.mapAngle')).toFixed(0), '90');
  vm.run('STUB.cursorX, STUB.cursorY = 400, 500; WoWAIMapButton.scripts.OnUpdate(WoWAIMapButton)');
  assert.equal(Number(vm.evaluate('WoWAIDB.settings.mapAngle')).toFixed(0), '180');
  vm.run('STUB.cursorX, STUB.cursorY = 560, 520; WoWAIMapButton.scripts.OnUpdate(WoWAIMapButton)');
  const dragged = Number(vm.evaluate('WoWAIDB.settings.mapAngle'));
  assert.ok(dragged > 0 && dragged < 90, `angle in the upper right quadrant, got ${dragged}`);
  vm.run('WoWAIMapButton.scripts.OnDragStop(WoWAIMapButton)');
  assert.equal(vm.evaluate('WoWAIMapButton.scripts.OnUpdate'), null, 'the drag removes its OnUpdate');
  // The button lands where the drag left it.
  assert.ok(Math.abs(Number(vm.evaluate('WoWAIMapButton.x')) - Math.cos(dragged * Math.PI / 180) * 75) < 0.01);
  assert.ok(Math.abs(Number(vm.evaluate('WoWAIMapButton.y')) - Math.sin(dragged * Math.PI / 180) * 75) < 0.01);
  // A /reload: the same saved data, fresh UI. The button is built again at the saved angle.
  const saved = vm.evaluate('WoWAIDB.settings.mapAngle');
  const vm2 = newVM();
  vm2.run(`WoWAIDB = { chats = { { id = "c1", name = "Chat 1", cwd = "", history = {}, unread = 0, created = 1 } }, activeChat = "c1", settings = { mapAngle = ${saved} } }`);
  login(vm2);
  assert.equal(vm2.evaluate('WoWAIDB.settings.mapAngle'), saved, 'the angle came back with the saved data');
  assert.ok(Math.abs(Number(vm2.evaluate('WoWAIMapButton.x')) - Math.cos(dragged * Math.PI / 180) * 75) < 0.01);
  assert.ok(Math.abs(Number(vm2.evaluate('WoWAIMapButton.y')) - Math.sin(dragged * Math.PI / 180) * 75) < 0.01);
});

test('the minimap button survives a square minimap, an unsized minimap and no GetMinimapShape', () => {
  // A square minimap cannot hold a button on the circle: the button is pulled in
  // toward the diagonal (the same clamp LibDBIcon uses) so it hangs off no corner.
  const vm = newVM();
  vm.run('STUB.minimapShape = "SQUARE"; STUB.texts = {}');
  login(vm);
  // The clamp: diagonal radius for a half-size of `half`, minus 10, bounded by half.
  const squareSpot = half => Math.max(-half, Math.min(-Math.SQRT1_2 * (Math.SQRT2 * half - 10), half));
  let x = Number(vm.evaluate('WoWAIMapButton.x'));
  let y = Number(vm.evaluate('WoWAIMapButton.y'));
  assert.ok(Math.abs(x - squareSpot(75)) < 0.01, `x=${x} expected ${squareSpot(75)}`);
  assert.ok(Math.abs(y - squareSpot(75)) < 0.01, `y=${y} expected ${squareSpot(75)}`);
  assert.ok(Math.abs(x) <= 70 && Math.abs(y) <= 70, `inside the 140x140 map, got ${x},${y}`);
  // A minimap that has no size yet (a frame with no size reports 0 in the client)
  // falls back to a stock size instead of collapsing the button onto the middle.
  vm.run('Minimap:SetSize(0, 0); WoWAI.PlaceMapButton()');
  const nx = Number(vm.evaluate('WoWAIMapButton.x'));
  const ny = Number(vm.evaluate('WoWAIMapButton.y'));
  assert.ok(Math.abs(nx - x) < 0.01 && Math.abs(ny - y) < 0.01, 'the fallback size gives the same spot as a real 140x140 map');
  assert.ok(Math.abs(nx) > 1, 'not collapsed onto the centre');
  // Another addon removing GetMinimapShape, or resizing the minimap, must not throw.
  // With the shape function gone it falls back to a round map, on the full radius.
  vm.run('GetMinimapShape = nil; Minimap:SetSize(200, 200); WoWAIDB.settings.mapAngle = 225; WoWAI.PlaceMapButton()');
  assert.equal(vm.evaluate('WoWAIMapButton.shown'), 'true');
  x = Number(vm.evaluate('WoWAIMapButton.x'));
  assert.ok(Math.abs(x - (-Math.SQRT1_2 * 105)) < 0.01, `follows the new size on the round fallback, x=${x} expected ${-Math.SQRT1_2 * 105}`);
});

test('the minimap button reads every shape GetMinimapShape can return, TRICORNER included', () => {
  // GetMinimapShape's documented set is ROUND, SQUARE, CORNER-*, SIDE-* and
  // TRICORNER-*. A shape the placement table does not know is silently treated
  // as round, which is how a button ends up poking off a squared-off corner.
  // Drive the real code at one angle per quadrant, for every documented shape,
  // and compare against LibDBIcon's own quadrant table and maths.
  const libdbicon = {
    ROUND: [true, true, true, true],
    SQUARE: [false, false, false, false],
    'CORNER-TOPLEFT': [false, false, false, true],
    'CORNER-TOPRIGHT': [false, false, true, false],
    'CORNER-BOTTOMLEFT': [false, true, false, false],
    'CORNER-BOTTOMRIGHT': [true, false, false, false],
    'SIDE-LEFT': [false, true, false, true],
    'SIDE-RIGHT': [true, false, true, false],
    'SIDE-TOP': [false, false, true, true],
    'SIDE-BOTTOM': [true, true, false, false],
    'TRICORNER-TOPLEFT': [false, true, true, true],
    'TRICORNER-TOPRIGHT': [true, false, true, true],
    'TRICORNER-BOTTOMLEFT': [true, true, false, true],
    'TRICORNER-BOTTOMRIGHT': [true, true, true, false],
  };
  const half = 70, radius = 5; // 140x140 stub minimap, MAP_RADIUS
  const w = half + radius;
  const diagW = Math.sqrt(2 * w * w) - 10;
  // LibDBIcon's updatePosition, verbatim, for the expected coordinates.
  // Its quadrant table is Lua (1-indexed), so shift the JS mirror by one.
  const expected = (shape, angle) => {
    const rad = (angle * Math.PI) / 180;
    let x = Math.cos(rad), y = Math.sin(rad);
    let q = 1;
    if (x < 0) q = q + 1;
    if (y > 0) q = q + 2;
    const quad = libdbicon[shape];
    if (quad[q - 1]) return [x * w, y * w];
    return [
      Math.max(-w, Math.min(x * diagW, w)),
      Math.max(-w, Math.min(y * diagW, w)),
    ];
  };
  const quadOf = (shape, angle) => {
    const rad = (angle * Math.PI) / 180;
    let q = 1;
    if (Math.cos(rad) < 0) q = q + 1;
    if (Math.sin(rad) > 0) q = q + 2;
    return libdbicon[shape][q - 1];
  };
  let checked = 0, clamped = 0;
  for (const shape of Object.keys(libdbicon)) {
    const vm = newVM();
    vm.run(`STUB.minimapShape = ${JSON.stringify(shape)}`);
    login(vm);
    for (const angle of [45, 135, 225, 315]) {
      vm.run(`WoWAIDB.settings.mapAngle = ${angle}; WoWAI.PlaceMapButton()`);
      const x = Number(vm.evaluate('WoWAIMapButton.x'));
      const y = Number(vm.evaluate('WoWAIMapButton.y'));
      const [ex, ey] = expected(shape, angle);
      assert.ok(
        Math.abs(x - ex) < 0.01 && Math.abs(y - ey) < 0.01,
        `${shape} @${angle}: got ${x},${y} expected ${ex},${ey}`
      );
      checked++;
      if (!quadOf(shape, angle)) clamped++;
    }
  }
  assert.equal(checked, 56, 'every documented shape was placed at four angles');
  assert.ok(clamped > 0, 'some quadrant really did clamp, so the TRICORNER rows are not vacuous');
});
