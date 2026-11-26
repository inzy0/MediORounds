// Progress kept in this browser only (localStorage). Export gives a CSV a student can hand to faculty.
const KEY = "mediorounds.v1";
const blank = () => ({ sessions: [], prefs: {} });

export function load() {
  try { return Object.assign(blank(), JSON.parse(localStorage.getItem(KEY) || "{}")); } catch { return blank(); }
}
export function save(db) { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} }

export function addSession(db, s) { db.sessions.push(s); save(db); }
export function setPref(db, k, v) { db.prefs[k] = v; save(db); }

export function streak(db) {
  const days = new Set(db.sessions.map(s => s.date.slice(0, 10)));
  let n = 0; const d = new Date();
  for (;;) {
    const k = d.toISOString().slice(0, 10);
    if (days.has(k)) { n++; d.setDate(d.getDate() - 1); }
    else if (n === 0 && k === new Date().toISOString().slice(0, 10)) { d.setDate(d.getDate() - 1); }
    else break;
  }
  return n;
}

const SKILLS = ["hist", "exam", "inv", "dx", "plan"];
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
  const head = "date,ward,case_pmcid,case_title,history,exam,investigations,extra_tests,diagnosis,plan,hints,seconds,student_diagnosis";
  const q = v => '"' + String(v ?? "").replace(/"/g, '""') + '"';
  const f = v => v == null ? "" : (Math.round(v * 1000) / 1000);
  return [head, ...db.sessions.map(s => [s.date, s.ward, s.id, q(s.title), f(s.scores.hist), f(s.scores.exam), f(s.scores.inv),
    s.scores.invExtra, f(s.scores.dx), f(s.scores.plan), s.scores.hints, s.scores.secs, q(s.dx)].join(","))].join("\n");
}
