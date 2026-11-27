// Progress merge at sign-in: nothing lost, nothing double-counted.
import assert from "node:assert/strict";
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
const store = await import("../site/js/store.js");

const S = (id, d) => ({ id, ward: "icu", date: d, scores: {} });
// 1) guest progress joins an account that already has cloud progress
let cloud = { sessions: [S("A", "2026-11-01")], xp: 100, badges: ["first"], deck: [{ key: "k1", due: "2026-11-02" }], reflections: [] };
let local = { sessions: [S("B", "2026-11-03")], xp: 40, badges: ["icu"], deck: [{ key: "k2", due: "2026-11-04" }], reflections: [{ date: "x", case: "B" }] };
let m = store.merge(local, cloud, "u1");
assert.equal(m.sessions.length, 2); assert.equal(m.xp, 140); assert.deepEqual(m.badges.sort(), ["first", "icu"]);
assert.equal(m.deck.length, 2); assert.equal(m.owner, "u1"); assert.equal(m.xpBase, 140);

// 2) same device signs in again after earning 30 more XP offline (cloud unchanged): add only the 30
local = { ...m, xp: 170, sessions: [...m.sessions, S("C", "2026-11-05")] };
m = store.merge(local, cloud = { ...m }, "u1");
assert.equal(m.xp, 170); assert.equal(m.sessions.length, 3);

// 3) after a successful upload xpBase == xp, so a re-merge adds nothing twice
local = { ...m, xpBase: m.xp };
const cloud2 = { ...m };
m = store.merge(local, cloud2, "u1");
assert.equal(m.xp, 170);

// 4) duplicate sessions collapse; later review due date wins
cloud = { sessions: [S("A", "d1")], xp: 0, badges: [], deck: [{ key: "k", due: "2026-11-02", box: 1 }], reflections: [] };
local = { sessions: [S("A", "d1")], xp: 0, badges: [], deck: [{ key: "k", due: "2026-11-09", box: 3 }], reflections: [] };
m = store.merge(local, cloud, "u2");
assert.equal(m.sessions.length, 1); assert.equal(m.deck[0].box, 3);

// 5) a different account's local data is treated as guest progress (not "same owner")
local = { sessions: [], xp: 50, xpBase: 50, owner: "someone-else", badges: [], deck: [], reflections: [] };
m = store.merge(local, { xp: 10, sessions: [], badges: [], deck: [], reflections: [] }, "u3");
assert.equal(m.xp, 60);
console.log("merge tests: 5/5 passed");
