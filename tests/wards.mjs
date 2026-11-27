// Click every ward's "Take a bed" and "Tricky" buttons on the home page and check a case opens.
// Usage: node wards.mjs <chrome.exe> <site url>
import { spawn } from "node:child_process";
const [chrome, base] = process.argv.slice(2);
const proc = spawn(chrome, ["--headless", "--disable-gpu", "--remote-debugging-port=9335", "--window-size=1280,900", "about:blank"], { stdio: "ignore" });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws; for (let i = 0; i < 40 && !ws; i++) { try { const t = await (await fetch("http://127.0.0.1:9335/json")).json(); const p = t.find(x => x.type === "page"); if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); break; } } catch {} await sleep(250); }
if (ws.readyState !== 1) await new Promise(r => ws.addEventListener("open", r));
let id = 0; const pend = new Map(); const errors = [];
ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); }
  if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
  if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") errors.push(d.params.args.map(a => a.value || a.description).join(" ")); };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async e => (await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send("Runtime.enable"); await send("Page.enable");
const results = [];
await send("Page.navigate", { url: base + "#/" });
for (let i = 0; i < 60 && !(await ev("document.querySelectorAll('[data-go]').length")); i++) await sleep(250);
const buttons = await ev("[...document.querySelectorAll('[data-go]')].map(b=>b.dataset.go+'|'+b.dataset.mode)");
for (const b of buttons) {
  const [ward, mode] = b.split("|");
  await send("Page.navigate", { url: base + "#/" });
  for (let i = 0; i < 60 && !(await ev(`!!document.querySelector('[data-go="${ward}"][data-mode="${mode}"]')`)); i++) await sleep(200);
  const before = errors.length;
  await ev(`document.querySelector('[data-go="${ward}"][data-mode="${mode}"]').click()`);
  let ok = false;
  for (let i = 0; i < 60; i++) { await sleep(250); if (await ev("location.hash.startsWith('#/case/') && document.querySelectorAll('.msg').length >= 2")) { ok = true; break; } }
  results.push({ ward, mode, ok, hash: await ev("location.hash"), errs: errors.slice(before) });
}
for (const r of results) console.log(r.ok ? "OK  " : "FAIL", r.ward.padEnd(14), r.mode.padEnd(7), r.hash, r.errs.join(" | ").slice(0, 200));
console.log("failed:", results.filter(r => !r.ok).length, "of", results.length);
proc.kill(); process.exit(results.some(r => !r.ok) ? 1 : 0);
