// Languages, on-device translation and the number-safety check.
// Translation uses the browser's built-in Translator API (on-device, free, no key, no server).
// Case text is always kept in its original English too; a translation whose numbers differ from the
// English is flagged so a dose or lab value is never silently changed.

export const LANGS = [
  { code: "en", speech: "en-IN", name: "English", native: "English" },
  { code: "hi", speech: "hi-IN", name: "Hindi", native: "हिन्दी" },
  { code: "mr", speech: "mr-IN", name: "Marathi", native: "मराठी" },
  { code: "ta", speech: "ta-IN", name: "Tamil", native: "தமிழ்" },
  { code: "te", speech: "te-IN", name: "Telugu", native: "తెలుగు" },
  { code: "kn", speech: "kn-IN", name: "Kannada", native: "ಕನ್ನಡ" },
  { code: "ml", speech: "ml-IN", name: "Malayalam", native: "മലയാളം" },
];
export const langOf = code => LANGS.find(l => l.code === code) || LANGS[0];

const cache = new Map();
const translators = new Map();
let status = {};

export function translatorSupported() { return typeof self !== "undefined" && "Translator" in self; }

async function getTranslator(from, to, onProgress) {
  const key = from + ">" + to;
  if (translators.has(key)) return translators.get(key);
  const p = (async () => {
    const avail = await self.Translator.availability({ sourceLanguage: from, targetLanguage: to });
    status[key] = avail;
    if (avail === "unavailable") return null;
    return await self.Translator.create({
      sourceLanguage: from, targetLanguage: to,
      monitor(m) { m.addEventListener("downloadprogress", e => onProgress && onProgress(e.loaded)); },
    });
  })().catch(() => null);
  translators.set(key, p);
  return p;
}

// Prepare a language pair (must be called from a user gesture the first time, for the model download).
export async function prepare(code, onProgress) {
  if (code === "en" || !translatorSupported()) return code === "en";
  const a = await getTranslator("en", code, onProgress);
  const b = await getTranslator(code, "en", onProgress);
  return !!(a && b);
}

export async function translate(text, from, to) {
  if (!text || from === to || !translatorSupported()) return null;
  const key = from + ">" + to + "|" + text;
  if (cache.has(key)) return cache.get(key);
  const tr = await getTranslator(from, to);
  if (!tr) return null;
  try {
    const out = await tr.translate(text);
    cache.set(key, out);
    return out;
  } catch { return null; }
}

// digits in any Indian script -> ASCII, then compare the multiset of numbers
const DIGIT_BASES = [0x0966, 0x09E6, 0x0A66, 0x0AE6, 0x0B66, 0x0BE6, 0x0C66, 0x0CE6, 0x0D66];
function asciiDigits(s) {
  return s.replace(/[०-९০-৯੦-੯૦-૯୦-୯௦-௯౦-౯೦-೯൦-൯]/g,
    ch => { const c = ch.charCodeAt(0); const b = DIGIT_BASES.find(x => c >= x && c <= x + 9); return String(c - b); });
}
const nums = s => (asciiDigits(s).replace(/(\d),(\d{3})/g, "$1$2").match(/\d+(?:\.\d+)?/g) || []).sort().join("|");
export function numbersMatch(src, out) { return nums(src) === nums(out); }

// UI strings (English source; translated on the fly when a translator is available)
export const UI = {
  tagline: "Live voice ward rounds on real published cases",
  chooseWard: "Choose a ward",
  speakOrType: "Speak or type to the patient and team…",
  tapToTalk: "Tap to talk",
  listening: "Listening…",
  speaking: "Speaking… tap to interrupt",
  thinking: "…",
  liveOn: "Live conversation on",
  liveOff: "Live conversation off",
};
