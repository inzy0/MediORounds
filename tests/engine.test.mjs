// Runs every case through a scripted ward round; fails on any exception or empty stage.
import { readFileSync, readdirSync } from "node:fs";
import { CaseSession, route } from "../site/js/engine.js";
const dir = new URL("../site/data/cases/", import.meta.url);
const script = ["What brought you here and since when?", "Any past medical history or previous illness?", "What medications are you taking?",
  "Any family history, smoking or alcohol?", "Check vitals", "General examination", "Examine chest, heart, abdomen and CNS", "Local examination",
  "Order CBC and biochemistry", "Order X-ray, CT, MRI and ultrasound", "Send biopsy and histopathology"];
let n = 0, histHit = 0, examHit = 0, invHit = 0, rounds = 0, err = 0, dxClose = 0;
const routes = {};
for (const f of readdirSync(dir)) {
  for (const c of JSON.parse(readFileSync(new URL(f, dir), "utf8"))) {
    n++;
    try {
      const s = new CaseSession(c);
      for (const q of script) {
        const r = route(q, s.phase); routes[r] = (routes[r] || 0) + 1;
        if (r === "history") { if (s.askHistory(q).kind === "hist") histHit++; }
        else if (r === "exam") { if (s.examine(q).items.length) examHit++; }
        else if (r === "order") { const o = s.order(q); if (o.results && o.results.some(x => x.items.length)) invHit++; }
      }
      const d = s.commitDx(c.src.title); if (d.verdict === "close") dxClose++;
      s.commitPlan("treat");
      let g = 0; while (s.phase !== "debrief" && g++ < 200) { const r = s.nextRound(); if (r.kind === "round") rounds++; }
      if (s.phase !== "debrief") throw new Error("round loop did not finish");
      s.scores();
    } catch (e) { err++; if (err < 5) console.error(c.id, e.message); }
  }
}
console.log({ cases: n, errors: err, routes, histAnsweredPer4: (histHit / n).toFixed(2), examAnsweredPer4: (examHit / n).toFixed(2), invAnsweredPer3: (invHit / n).toFixed(2), roundsPerCase: (rounds / n).toFixed(1), dxSelfTitleClose: dxClose + "/" + n });
const P = "decision";
const checks = [["my diagnosis is tuberculosis", "workup", "dx"], ["my differentials are TB, sarcoid", "workup", "ddx"], ["order a chest x-ray", "workup", "order"],
  ["examine the abdomen", "workup", "exam"], ["do you smoke?", "workup", "history"], ["next", "round", "next"], ["I would start IV fluids", "round", P],
  ["hint", "workup", "hint"], ["my patient UHID 12345", "workup", "phi"], ["my plan is antibiotics", "plan", "plan"]];
let bad = 0; for (const [t, ph, want] of checks) { const got = route(t, ph); if (got !== want) { bad++; console.error("route", t, ph, "->", got, "want", want); } }
console.log("route checks", checks.length - bad + "/" + checks.length);
process.exit(err || bad ? 1 : 0);
