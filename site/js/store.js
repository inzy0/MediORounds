// Everything the site remembers lives in this browser only (localStorage): progress, XP, badges, review deck,
// settings and reflections. Export gives a CSV a student can hand to faculty.
const KEY = "mediorounds.v1";
const blank = () => ({ sessions: [], prefs: {}, xp: 0, badges: [], deck: [], reflections: [] });

export function load() {
  try { return Object.assign(blank(), JSON.parse(localStorage.getItem(KEY) || "{}")); } catch { return blank(); }
}
let saveHook = null;
export function onSave(fn) { saveHook = fn; }
export function save(db) { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} if (saveHook) saveHook(db); }

// Merge this browser's progress with the account's cloud copy (used at sign-in).
// Sessions, badges, review cards and reflections are unions; XP adds what was earned on this device
// since it last synced (or all of it, the first time guest progress is brought into an account).
export function merge(local, cloud, uid) {
  const L = Object.assign(blank(), local || {}), C = Object.assign(blank(), cloud || {});
  const byKey = (arr, k) => { const m = new Map(); for (const x of arr) m.set(k(x), x); return m; };
  const sess = byKey(C.sessions, s => s.id + "|" + s.date);
  for (const s of L.sessions) sess.set(s.id + "|" + s.date, s);
  const deck = byKey(C.deck, c => c.key);
  for (const c of L.deck) { const o = deck.get(c.key); if (!o || (c.due || "") > (o.due || "")) deck.set(c.key, c); }
  const refl = byKey(C.reflections, r => r.date + "|" + r.case);
  for (const r of L.reflections) refl.set(r.date + "|" + r.case, r);
  const sameOwner = L.owner === uid;
  const gained = sameOwner ? Math.max(0, (L.xp || 0) - (L.xpBase || 0)) : (L.xp || 0);
  const xp = (C.xp || 0) + gained;
  return {
    sessions: [...sess.values()].sort((a, b) => a.date.localeCompare(b.date)),
    badges: [...new Set([...C.badges, ...L.badges])],
    deck: [...deck.values()],
    reflections: [...refl.values()].sort((a, b) => a.date.localeCompare(b.date)),
    prefs: Object.assign({}, C.prefs, L.prefs),
    xp, xpBase: xp, owner: uid,
  };
}
export function clearLocal(db) {
  const prefs = db.prefs;
  for (const k of Object.keys(db)) delete db[k];
  Object.assign(db, blank(), { prefs });
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {}
}
export function addSession(db, s) { db.sessions.push(s); save(db); }
export function setPref(db, k, v) { db.prefs[k] = v; save(db); }

// ---------------- XP, levels, badges ----------------
export const LEVELS = [[0, "Intern"], [300, "House Officer"], [900, "Junior Resident"], [2000, "Senior Resident"],
  [4000, "Registrar"], [7000, "Consultant"], [11000, "Professor"]];
export function level(xp) {
  let cur = LEVELS[0], next = null;
  for (let i = 0; i < LEVELS.length; i++) if (xp >= LEVELS[i][0]) { cur = LEVELS[i]; next = LEVELS[i + 1] || null; }
  return { name: cur[1], floor: cur[0], next: next ? next[0] : null, nextName: next ? next[1] : null };
}
export function addXP(db, n) { db.xp = Math.max(0, (db.xp || 0) + n); save(db); return db.xp; }

export const BADGES = {
  first: ["First patient", "Finished your first case"],
  five: ["Five on the ward", "Finished 5 cases"],
  twentyfive: ["Ward regular", "Finished 25 cases"],
  streak3: ["Three-day streak", "Practised 3 days in a row"],
  streak7: ["Week of rounds", "Practised 7 days in a row"],
  dx: ["Sharp eye", "Got the diagnosis right"],
  quiz: ["Full marks", "Answered every quiz question right"],
  mdt: ["Team player", "Finished a multidisciplinary case"],
  icu: ["Critical thinker", "Finished an ICU case"],
  rehab: ["Back on their feet", "Finished a rehab case"],
  rare: ["Zebra hunter", "Finished a unique or rare case"],
  reflect: ["Reflective learner", "Wrote what you learned"],
  allwards: ["Rotations done", "Finished a case in every ward"],
};
export function award(db, id) {
  if (!BADGES[id] || db.badges.includes(id)) return null;
  db.badges.push(id); save(db); return BADGES[id];
}

// ---------------- spaced review deck (Leitner boxes) ----------------
const GAP_DAYS = [0, 1, 3, 7, 14, 30];
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
export function addCard(db, card) {
  const key = card.case + "|" + card.stem;
  if (db.deck.some(c => c.key === key)) return;
  db.deck.push({ ...card, key, box: 0, due: addDays(today(), 1) }); save(db);
}
export function dueCards(db) { const t = today(); return db.deck.filter(c => c.due <= t); }
export function reviewCard(db, key, correct) {
  const c = db.deck.find(x => x.key === key); if (!c) return;
  c.box = correct ? Math.min(GAP_DAYS.length - 1, c.box + 1) : 0;
  c.due = addDays(today(), GAP_DAYS[c.box] || 1);
  if (correct && c.box === GAP_DAYS.length - 1) db.deck = db.deck.filter(x => x.key !== key);       // mastered
  save(db);
}

export function streak(db) {
  const days = new Set(db.sessions.map(s => s.date.slice(0, 10)));
  let n = 0; const d = new Date();
  for (;;) {
    const k = d.toISOString().slice(0, 10);
    if (days.has(k)) { n++; d.setDate(d.getDate() - 1); }
    else if (n === 0 && k === today()) { d.setDate(d.getDate() - 1); }
    else break;
  }
  return n;
}

const SKILLS = ["hist", "exam", "inv", "dx", "plan", "quiz"];
export function summary(db) {
  const byWard = {};
  const skill = Object.fromEntries(SKILLS.map(k => [k, []]));
  for (const s of db.sessions) {
    (byWard[s.ward] = byWard[s.ward] || []).push(s);
    for (const k of SKILLS) if (s.scores[k] != null) skill[k].push(s.scores[k]);
  }
  const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  return { byWard, skill: Object.fromEntries(SKILLS.map(k => [k, { avg: avg(skill[k]), n: skill[k].length }])) };
}

export function toCSV(db) {
  const head = "date,ward,case_pmcid,case_title,history,exam,investigations,extra_tests,diagnosis,plan,quiz,hints,seconds,xp,student_diagnosis,reflection";
  const q = v => '"' + String(v ?? "").replace(/"/g, '""') + '"';
  const f = v => v == null ? "" : (Math.round(v * 1000) / 1000);
  return [head, ...db.sessions.map(s => [s.date, s.ward, s.id, q(s.title), f(s.scores.hist), f(s.scores.exam), f(s.scores.inv),
    s.scores.invExtra, f(s.scores.dx), f(s.scores.plan), f(s.scores.quiz), s.scores.hints, s.scores.secs, s.xp ?? "", q(s.dx), q(s.reflection)].join(","))].join("\n");
}
