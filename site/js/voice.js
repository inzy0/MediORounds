// Voice: browser Web Speech API only (free, no key).
// - Live mode: hands-free loop (listen -> reply is spoken -> listen again).
// - Barge-in: optionally keep listening while a reply plays; speaking cuts the reply (use headphones).
// - Team voices: each role gets its own installed voice where the device has several.
// - Away rule: when the student is away for 5 s (tab hidden / window unfocused / no face on camera),
//   either pause the audio until they return, or keep it going.

const SR = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);

const ROLE_TUNE = {
  patient: { pitch: 1.05, rate: 0.95 }, senior: { pitch: 0.9, rate: 1.0 }, hod: { pitch: 0.8, rate: 0.95 },
  nurse: { pitch: 1.15, rate: 1.05 }, record: { pitch: 1, rate: 1.02 }, surgeon: { pitch: 0.85, rate: 1.05 },
  neurologist: { pitch: 1.0, rate: 0.97 }, physiotherapist: { pitch: 1.1, rate: 1.05 }, intensivist: { pitch: 0.9, rate: 1.08 },
  radiologist: { pitch: 0.95, rate: 1.0 }, pathologist: { pitch: 1.05, rate: 0.98 }, psychiatrist: { pitch: 1.0, rate: 0.92 },
  obstetrician: { pitch: 1.12, rate: 1.0 }, paediatrician: { pitch: 1.18, rate: 1.02 }, dietitian: { pitch: 1.1, rate: 1.0 },
  pharmacist: { pitch: 1.05, rate: 1.05 }, peer: { pitch: 1.2, rate: 1.1 }, system: { pitch: 1, rate: 1.05 },
};
const ROLE_ORDER = Object.keys(ROLE_TUNE);

export class Voice {
  constructor({ onFinal, onInterim, onState, onAway }) {
    this.onFinal = onFinal; this.onInterim = onInterim; this.onState = onState; this.onAway = onAway;
    this.lang = "en-IN"; this.live = false; this.state = "idle"; this.rec = null; this.muted = false;
    this.rate = 1; this.bargeIn = false; this.awayMode = "pause"; this.away = false; this.pausedForAway = false;
    this.speakingToken = 0;
    this.canListen = !!SR; this.canSpeak = typeof speechSynthesis !== "undefined";
    if (this.canSpeak) {
      this.voices = speechSynthesis.getVoices();
      speechSynthesis.onvoiceschanged = () => { this.voices = speechSynthesis.getVoices(); };
    }
    this.installAway();
  }

  setState(s) { this.state = s; this.onState && this.onState(s); }
  setLang(code) { this.lang = code; if (this.rec) this.stopListening(); }

  voicesFor(lang) {
    const l2 = lang.slice(0, 2).toLowerCase();
    const vs = (this.voices || []).filter(v => v.lang && v.lang.replace("_", "-").toLowerCase().startsWith(l2));
    const exact = vs.filter(v => v.lang.replace("_", "-").toLowerCase() === lang.toLowerCase());
    const pool = exact.length ? exact : vs;
    const rank = v => (/natural|online|neural/i.test(v.name) ? 0 : /google/i.test(v.name) ? 1 : 2);
    return [...pool].sort((a, b) => rank(a) - rank(b));
  }
  hasVoice(lang) { return this.voicesFor(lang).length > 0; }
  // different roles -> different installed voices (round robin), so the ward sounds like a team
  voiceFor(lang, role) {
    const pool = this.voicesFor(lang);
    if (!pool.length) return null;
    const i = Math.max(0, ROLE_ORDER.indexOf(role));
    return pool[i % pool.length];
  }

  // ---------------- listening ----------------
  listen(opts = {}) {
    if (!this.canListen || this.rec) return;
    if (!opts.duringSpeech && this.canSpeak) speechSynthesis.cancel();
    const rec = new SR();
    rec.lang = this.lang; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
    let final = "";
    rec.onresult = e => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript; else interim += r[0].transcript;
      }
      const heard = (final + interim).trim();
      // barge-in: two or more words while a reply is playing -> stop the reply
      if (this.state === "speaking" && heard.split(/\s+/).length >= 2) this.interrupt(true);
      this.onInterim && this.onInterim(heard);
    };
    rec.onerror = e => { this.lastError = e.error; };
    rec.onend = () => {
      this.rec = null;
      const err = this.lastError; this.lastError = null;
      if (final.trim()) { this.setState("thinking"); this.onFinal(final.trim()); return; }
      if (this.state === "speaking") return;                          // barge-in listener ended quietly
      if (this.live && !this.away && err !== "not-allowed" && err !== "service-not-allowed") {
        setTimeout(() => this.live && !this.rec && this.state !== "speaking" && this.listen(), 250); return;
      }
      this.setState("idle");
    };
    this.rec = rec;
    try { rec.start(); if (this.state !== "speaking") this.setState("listening"); } catch { this.rec = null; this.setState("idle"); }
  }

  stopListening() { if (this.rec) { try { this.rec.abort(); } catch {} this.rec = null; } if (this.state === "listening") this.setState("idle"); }

  // ---------------- speaking ----------------
  // parts: [{text, lang, role}] -> resolves when finished or interrupted
  speak(parts) {
    if (!this.canSpeak || this.muted || !parts.length) { this.afterSpeak(); return Promise.resolve(); }
    speechSynthesis.cancel();
    const token = ++this.speakingToken;
    this.setState("speaking");
    if (this.bargeIn && this.canListen) setTimeout(() => token === this.speakingToken && this.listen({ duringSpeech: true }), 400);
    return new Promise(resolve => {
      const utts = [];
      for (const p of parts) {
        const chunks = p.text.match(/[^.!?।]+[.!?।]*\s*/g) || [p.text];          // Chrome cuts long utterances
        const v = this.voiceFor(p.lang, p.role) || this.voiceFor("en-IN", p.role) || this.voiceFor("en-US", p.role);
        const tune = ROLE_TUNE[p.role] || ROLE_TUNE.system;
        for (const ch of chunks) {
          if (!ch.trim()) continue;
          const u = new SpeechSynthesisUtterance(ch.trim());
          if (v) { u.voice = v; u.lang = v.lang; } else u.lang = p.lang;
          u.pitch = tune.pitch; u.rate = Math.min(2, tune.rate * this.rate);
          utts.push(u);
        }
      }
      if (!utts.length) { this.afterSpeak(); resolve(); return; }
      const last = utts[utts.length - 1];
      last.onend = last.onerror = () => { if (token === this.speakingToken) this.afterSpeak(); resolve(); };
      utts.forEach(u => speechSynthesis.speak(u));
      if (this.away && this.awayMode === "pause") { speechSynthesis.pause(); this.pausedForAway = true; }
    });
  }

  afterSpeak() {
    if (this.rec && this.state === "speaking") { this.setState("listening"); return; }     // barge-in listener keeps going
    this.setState("idle");
    if (this.live && this.canListen && !this.away) setTimeout(() => this.live && this.state === "idle" && this.listen(), 300);
  }

  interrupt(keepListening) {
    this.speakingToken++;
    if (this.canSpeak) speechSynthesis.cancel();
    if (keepListening && this.rec) this.setState("listening"); else this.setState("idle");
  }

  toggle() {
    if (this.state === "speaking") { this.interrupt(); this.listen(); return; }
    if (this.state === "listening") { this.live = false; this.stopListening(); return; }
    this.listen();
  }

  // ---------------- away rule (5 s) ----------------
  installAway() {
    if (typeof document === "undefined") return;
    let timer = null;
    const leave = () => { clearTimeout(timer); timer = setTimeout(() => this.setAway(true), 5000); };
    const back = () => { clearTimeout(timer); if (this.away) this.setAway(false); };
    document.addEventListener("visibilitychange", () => document.hidden ? leave() : back());
    window.addEventListener("blur", leave);
    window.addEventListener("focus", back);
    this._leave = leave; this._back = back;
  }
  setAway(v) {
    if (v === this.away) return;
    this.away = v;
    this.onAway && this.onAway(v);
    if (this.awayMode !== "pause") return;
    if (v) {
      if (this.canSpeak && speechSynthesis.speaking) { speechSynthesis.pause(); this.pausedForAway = true; }
      if (this.rec) this.stopListening();
    } else {
      if (this.pausedForAway && this.canSpeak) { speechSynthesis.resume(); this.pausedForAway = false; }
      else if (this.live && this.state === "idle") this.listen();
    }
  }

  // ---------------- optional camera presence (on-device face detection) ----------------
  async startPresence(videoEl, onStatus) {
    try {
      const vision = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs");
      const files = await vision.FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm");
      const det = await vision.FaceDetector.createFromOptions(files, {
        baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite" },
        runningMode: "VIDEO",
      });
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 }, audio: false });
      videoEl.srcObject = stream; await videoEl.play();
      this.presence = { det, stream, lastSeen: performance.now(), timer: null };
      this.presence.timer = setInterval(() => {
        if (videoEl.readyState < 2) return;
        const r = det.detectForVideo(videoEl, performance.now());
        const seen = r.detections && r.detections.length > 0;
        if (seen) { this.presence.lastSeen = performance.now(); if (this.away && !document.hidden) this.setAway(false); }
        else if (performance.now() - this.presence.lastSeen > 5000) this.setAway(true);
        onStatus && onStatus(seen);
      }, 500);
      return true;
    } catch (e) { onStatus && onStatus(null, e); return false; }
  }
  stopPresence() {
    if (!this.presence) return;
    clearInterval(this.presence.timer);
    this.presence.stream.getTracks().forEach(t => t.stop());
    this.presence = null;
  }
}
