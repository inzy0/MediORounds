// Runs every case through a scripted ward round and the teaching layer; fails on any exception.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { CaseSession, route } from "../site/js/engine.js";
import { objectives, buildQuiz, judgeAnswer, reflect, speakerFor, figuresFor, resources } from "../site/js/teach.js";

const root = new URL("../site/data/", import.meta.url);
const wards = JSON.parse(readFileSync(new URL("wards.json", root), "utf8")).wards;
const drugs = existsSync(new URL("drugs.json", root)) ? JSON.parse(readFileSync(new URL("drugs.json", root), "utf8")) : null;
const script = ["What brought you here and since when?", "Any past medical history or previous illness?", "What medications are you taking?",
  "Any family history, smoking or alcohol?", "Check vitals", "General examination", "Examine chest, heart, abdomen and CNS", "Local examination",
  "Order CBC and biochemistry", "Order X-ray, CT, MRI and ultrasound", "Send biopsy and histopathology"];
let n = 0, err = 0, histHit = 0, examHit = 0, invHit = 0, rounds = 0, quizN = 0, quizOk = 0, withFigs = 0, figMatched = 0;
const speakers = {};
for (const w of wards) {
  const dir = new URL(`cases/${w.id}/`, root);
  const index = JSON.parse(readFileSync(new URL("index.json", dir), "utf8"));
  if (index.length !== w.count) { err++; console.error("index count mismatch", w.id); }
  for (const f of readdirSync(dir).filter(f => /^\d+\.json$/.test(f))) {
    const shard = JSON.parse(readFileSync(new URL(f, dir), "utf8"));
    const titles = shard.map(c => c.src.title);
    for (const c of shard) {
      n++;
      try {
        const s = new CaseSession(c);
        objectives(s);
        for (const q of script) {
          const r = route(q, s.phase);
          if (r === "history") { if (s.askHistory(q).kind === "hist") histHit++; }
          else if (r === "exam") { if (s.examine(q).items.length) examHit++; }
          else if (r === "order") { const o = s.order(q); if (o.results && o.results.some(x => x.items.length)) invHit++; }
        }
        s.commitDx(c.src.title); s.commitPlan("treat");
        let g = 0;
        while (s.phase !== "debrief" && g++ < 300) {
          const r = s.nextRound();
          if (r.kind === "round") { rounds++; for (const e of r.items) { const sp = speakerFor(e, "round"); speakers[sp] = (speakers[sp] || 0) + 1; } }
        }
        if (s.phase !== "debrief") throw new Error("round loop did not finish");
        const quiz = buildQuiz(s, drugs, titles);
        for (const q of quiz) {
          quizN++;
          if (!q.options.includes(q.answer) || new Set(q.options.map(o => o.toLowerCase())).size !== q.options.length) throw new Error("bad quiz options");
          const letter = "ABCD"[q.options.indexOf(q.answer)];
          if (!judgeAnswer(q, letter).correct || !judgeAnswer(q, "option " + letter.toLowerCase()).correct) throw new Error("judge failed");
          if (q.kind !== "dx" && !q.stem.includes("_____")) throw new Error("cloze without gap");
          quizOk++;
        }
        reflect("I learned to consider this diagnosis early and check the imaging", s);
        resources(c);
        if (c.figs) { withFigs++; if (figuresFor(c, ["CT", "MRI", "X-ray", "ultrasound", "biopsy & histopathology"]).length) figMatched++; }
        s.scores();
      } catch (e) { err++; if (err < 6) console.error(w.id, c.id, e.message); }
    }
  }
}
console.log({ cases: n, errors: err, histPerCase: (histHit / n).toFixed(2), examPerCase: (examHit / n).toFixed(2), invPerCase: (invHit / n).toFixed(2),
  roundsPerCase: (rounds / n).toFixed(1), quizQuestions: quizN, quizValid: quizOk, withFigures: withFigs, figuresMatchedToTests: figMatched, speakers });
const checks = [["my diagnosis is tuberculosis", "workup", "dx"], ["my differentials are TB, sarcoid", "workup", "ddx"], ["order a chest x-ray", "workup", "order"],
  ["examine the abdomen", "workup", "exam"], ["do you smoke?", "workup", "history"], ["next", "round", "next"], ["I would start IV fluids", "round", "decision"],
  ["hint", "workup", "hint"], ["my patient UHID 12345", "workup", "phi"], ["my plan is antibiotics", "plan", "plan"],
  ["Any past medical history?", "workup", "history"], ["send histopathology", "workup", "order"], ["check vitals", "workup", "exam"]];
let bad = 0;
for (const [t, ph, want] of checks) { const got = route(t, ph); if (got !== want) { bad++; console.error("route", t, ph, "->", got, "want", want); } }
console.log("route checks", checks.length - bad + "/" + checks.length);
process.exit(err || bad ? 1 : 0);
