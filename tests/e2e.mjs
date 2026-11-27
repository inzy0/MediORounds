// End-to-end: drive a full case in headless Chromium via the DevTools protocol. Usage: node e2e.mjs <chrome.exe> <url> <shotdir>
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const [chrome, url, shots] = process.argv.slice(2);
const proc = spawn(chrome, ["--headless", "--disable-gpu", "--remote-debugging-port=9333", "--window-size=1280,900", "about:blank"], { stdio: "ignore" });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, id = 0; const pending = new Map(); const errors = [];
for (let i = 0; i < 40; i++) { try { const t = await (await fetch("http://127.0.0.1:9333/json")).json(); const p = t.find(x => x.type === "page"); if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); break; } } catch {} await sleep(250); }
await new Promise(r => ws.onopen = r);
ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
  if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") errors.push(d.params.args.map(a => a.value || a.description).join(" ")); };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async expr => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const shot = async name => { const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(`${shots}/${name}.png`, Buffer.from(r.result.data, "base64")); };
await send("Runtime.enable"); await send("Page.enable");
await send("Page.navigate", { url });
for (let i = 0; i < 120 && !(await ev("!!document.querySelector('#text') && document.querySelectorAll('.msg').length >= 2")); i++) await sleep(250);
const sayIt = async t => { await ev(`(()=>{const i=document.querySelector('#text');i.value=${JSON.stringify(t)};document.querySelector('#say').requestSubmit();})()`); await sleep(700); };
for (const t of ["What brought you here and since when?", "Any past medical history?", "Check vitals", "Examine the abdomen", "Order CBC and biochemistry", "Order CT and ultrasound", "My differentials are appendicitis, TB, lymphoma", "hint"]) await sayIt(t);
await shot("e2e_workup");
await sayIt("My diagnosis is abdominal tuberculosis");
await sayIt("My plan is antitubercular therapy and supportive care");
await shot("e2e_plan");
const seen = new Set();
for (let k = 0; k < 60; k++) {
  if (await ev("!!document.querySelector('.scorecard')")) break;
  const ph = await ev("document.querySelector('.ph.on')?.textContent"); seen.add(ph);
  const last = await ev("[...document.querySelectorAll('.msg:not(.you) .body')].pop()?.textContent || ''");
  if (ph === "Team review") { if (!seen.has("shotTeam")) { seen.add("shotTeam"); await shot("e2e_team"); } await sayIt("I would check this carefully and involve the team early"); }
  else if (ph === "HOD & quiz") {
    if (/what did you learn/i.test(last)) { await shot("e2e_quiz"); await sayIt("I learned to look for the red flags early and to confirm the diagnosis with the right test"); }
    else await sayIt("A");
  }
  else await sayIt("next");
}
await sleep(800);
await ev("document.querySelectorAll('.fig img').forEach(i=>i.loading='eager')"); await sleep(4000);
await shot("e2e_debrief");
const counts = await ev(`({msgs:document.querySelectorAll('.msg').length, roles:[...new Set([...document.querySelectorAll('.msg')].map(m=>m.className.replace('msg ','')))], score:!!document.querySelector('.scorecard'), phases:${JSON.stringify([])}, saved:JSON.parse(localStorage.getItem('mediorounds.v1')||'{}').sessions?.length, xp:JSON.parse(localStorage.getItem('mediorounds.v1')||'{}').xp, badges:JSON.parse(localStorage.getItem('mediorounds.v1')||'{}').badges, deck:JSON.parse(localStorage.getItem('mediorounds.v1')||'{}').deck?.length, figs:document.querySelectorAll('.fig img').length, figsDecoded:[...document.querySelectorAll('.fig img')].filter(i=>i.complete&&i.naturalWidth>0).length, imgQuestions:document.querySelectorAll('.qimg img').length, doseChecks:document.querySelectorAll('.dosecheck li').length, finishBtn:!!document.querySelector('.btn.finish')})`);
counts.phases = [...seen].filter(x => x && !x.startsWith("shot"));
console.log(JSON.stringify(counts), "errors:", errors);
proc.kill(); process.exit(errors.length ? 1 : 0);
