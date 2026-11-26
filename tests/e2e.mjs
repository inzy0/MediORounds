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
await send("Page.navigate", { url }); await sleep(2500);
const sayIt = async t => { await ev(`(()=>{const i=document.querySelector('#text');i.value=${JSON.stringify(t)};document.querySelector('#say').requestSubmit();})()`); await sleep(700); };
for (const t of ["What brought you here and since when?", "Any past medical history?", "Check vitals", "Examine the abdomen", "Order CBC and biochemistry", "Order CT and ultrasound", "My differentials are appendicitis, TB, lymphoma", "hint"]) await sayIt(t);
await shot("e2e_workup");
await sayIt("My diagnosis is abdominal tuberculosis");
await sayIt("My plan is antitubercular therapy and supportive care");
await shot("e2e_plan");
for (let k = 0; k < 15; k++) { const ph = await ev("document.querySelector('.ph.on')?.textContent"); if (ph === "Debrief") break; await sayIt("next"); }
await sayIt("next"); await sleep(800);
await shot("e2e_debrief");
const counts = await ev(`({msgs:document.querySelectorAll('.msg').length, nodoc:[...document.querySelectorAll('.msg .body')].filter(b=>/isn't documented/.test(b.textContent)).length, score:!!document.querySelector('.scorecard'), phase:document.querySelector('.ph.on')?.textContent, saved:JSON.parse(localStorage.getItem('mediorounds.v1')||'{}').sessions?.length})`);
console.log(JSON.stringify(counts), "errors:", errors);
proc.kill(); process.exit(errors.length ? 1 : 0);
