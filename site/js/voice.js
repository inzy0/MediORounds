// Voice: browser Web Speech API only (free, no key). Live mode = hands-free loop:
// listen -> reply is spoken -> listen again. Tapping the orb while it speaks interrupts it.

const SR = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);

const ROLE_VOICE = {
  patient: { pitch: 1.05, rate: 0.95 },
  senior: { pitch: 0.85, rate: 1.0 },
  hod: { pitch: 0.75, rate: 0.95 },
  nurse: { pitch: 1.15, rate: 1.05 },
  system: { pitch: 1, rate: 1.05 },
};

export class Voice {
  constructor({ onFinal, onInterim, onState }) {
    this.onFinal = onFinal; this.onInterim = onInterim; this.onState = onState;
    this.lang = "en-IN"; this.live = false; this.state = "idle"; this.rec = null;
    this.queue = []; this.speakingToken = 0; this.muted = false;
    this.canListen = !!SR; this.canSpeak = typeof speechSynthesis !== "undefined";
    if (this.canSpeak) {
      this.voices = speechSynthesis.getVoices();
      speechSynthesis.onvoiceschanged = () => { this.voices = speechSynthesis.getVoices(); };
    }
  }

  setState(s) { this.state = s; this.onState && this.onState(s); }
  setLang(speechCode) { this.lang = speechCode; if (this.rec) this.stopListening(); }

  voiceFor(lang) {
    const vs = (this.voices || []).filter(v => v.lang && v.lang.replace("_", "-").toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()));
    const exact = vs.filter(v => v.lang.replace("_", "-").toLowerCase() === lang.toLowerCase());
    const pool = exact.length ? exact : vs;
    return pool.find(v => /natural|online|neural/i.test(v.name)) || pool.find(v => /google/i.test(v.name)) || pool[0] || null;
  }
  hasVoice(lang) { return !!this.voiceFor(lang); }

  listen() {
    if (!this.canListen || this.state === "listening") return;
    if (this.canSpeak) speechSynthesis.cancel();
    const rec = new SR();
    rec.lang = this.lang; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
    let final = "";
    rec.onresult = e => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript; else interim += r[0].transcript;
      }
      this.onInterim && this.onInterim(final + interim);
    };
    rec.onerror = e => { this.lastError = e.error; };
    rec.onend = () => {
      this.rec = null;
      if (final.trim()) { this.setState("thinking"); this.onFinal(final.trim()); }
      else if (this.live && this.lastError !== "not-allowed" && this.state === "listening") { setTimeout(() => this.live && this.listen(), 250); return; }
      else this.setState("idle");
      this.lastError = null;
    };
    this.rec = rec;
    try { rec.start(); this.setState("listening"); } catch { this.setState("idle"); }
  }

  stopListening() { if (this.rec) { try { this.rec.abort(); } catch {} this.rec = null; } if (this.state === "listening") this.setState("idle"); }

  // speak a list of {text, lang, role}; resolves when done or interrupted
  speak(parts) {
    if (!this.canSpeak || this.muted || !parts.length) { this.afterSpeak(); return Promise.resolve(); }
    speechSynthesis.cancel();
    const token = ++this.speakingToken;
    this.setState("speaking");
    return new Promise(resolve => {
      const utts = [];
      for (const p of parts) {
        // Chrome cuts long utterances; speak sentence by sentence
        const chunks = p.text.match(/[^.!?।]+[.!?।]*\s*/g) || [p.text];
        for (const ch of chunks) {
          if (!ch.trim()) continue;
          const u = new SpeechSynthesisUtterance(ch.trim());
          const v = this.voiceFor(p.lang) || this.voiceFor("en-IN") || null;
          if (v) { u.voice = v; u.lang = v.lang; } else u.lang = p.lang;
          const rv = ROLE_VOICE[p.role] || ROLE_VOICE.system;
          u.pitch = rv.pitch; u.rate = rv.rate;
          utts.push(u);
        }
      }
      if (!utts.length) { this.afterSpeak(); resolve(); return; }
      utts[utts.length - 1].onend = () => { if (token === this.speakingToken) { this.afterSpeak(); } resolve(); };
      utts[utts.length - 1].onerror = () => { if (token === this.speakingToken) this.afterSpeak(); resolve(); };
      utts.forEach(u => speechSynthesis.speak(u));
    });
  }

  afterSpeak() {
    this.setState("idle");
    if (this.live && this.canListen) setTimeout(() => this.live && this.state === "idle" && this.listen(), 300);
  }

  interrupt() { this.speakingToken++; if (this.canSpeak) speechSynthesis.cancel(); this.setState("idle"); }

  // orb tap
  toggle() {
    if (this.state === "speaking") { this.interrupt(); this.listen(); return; }
    if (this.state === "listening") { this.live = false; this.stopListening(); return; }
    this.listen();
  }
}
