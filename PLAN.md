# MediORounds: plan and status (updated 2026-11-26)

## Owner's requirements

- Everything free and in the cloud, with nothing running on the owner's PC.
- The same quality every time.
- Live, voice-first, chat-style practice, like a voice-assistant conversation.
- Hindi, English, Marathi and the South Indian languages.
- All MBBS wards, a virtual ward round, follow-up, medication, assessment, senior and HOD teaching.
- Repo: https://github.com/inzy0/MediORounds

## Design decisions (and why)

| Decision | Why |
|---|---|
| Static site on GitHub Pages; no backend, no API keys | Free with no usage cap. Free cloud LLM APIs all have rate limits and changing terms, so "unlimited" and "same quality every time" were not possible with them. |
| Deterministic engine: replies are verbatim case sentences | Same input gives the same output. No invented findings (generative models fabricate clinical facts with confidence). |
| Cases = CC BY / CC0 PMC OA case reports, licence checked per article | Real, citable, legally reusable; 193,930 such full-text case reports exist in the source library. |
| Voice and translation run in the student's browser (Web Speech + on-device Translator) | Free, no server, no quota. A number-mismatch check guards translated doses and lab values. |
| Progress in localStorage, with CSV export | No account or server needed. A shared faculty dashboard would need a backend (see next steps). |

## Built (v0.1)

- **3,000 cases, 300 per ward:** Medicine, Surgery, OBG, Paediatrics, Ortho, Emergency & ICU, Psychiatry, ENT,
  Ophthalmology, Dermatology. Cases with a rare or atypical title, or 2 or more complication events, are
  flagged "tricky".
- **Case flow:** work-up (history by voice/text, examination by system, investigations by category, lab tables)
  → differentials → diagnosis (plus the authors' own differential section, where present) → plan → day-by-day
  ward rounds, stopping at each complication event to ask "what now?" → HOD teaching round (the article's
  learning points or discussion lessons) → score card → next patient.
- **Medicines** named in the case are linked to DailyMed labels.
- **7 languages**, live hands-free mode, tap to interrupt.
- **Progress page:** skills, wards, streak, weakest skill, CSV export.
- **Tests:**
  - `tests/engine.test.mjs`: all 3,000 cases complete, 0 errors, 10/10 routing checks. CI runs it before every deploy.
  - `tests/e2e.mjs`: a full case in headless Chromium with 0 console errors.

## Known limits (honest list)

- Patient replies are third-person case-record sentences, not first-person speech, because rewriting them would
  be generation.
- Stage sorting uses keyword rules except where the article has section headings (222 of 3,000). Some sentences
  land in a neighbouring stage. 874 cases have no examination findings before the treatment split.
- The diagnosis auto-match is a rough term overlap (for example, "abdominal TB" vs "Pott disease" scores as
  different), so the student's own rating is the one counted when given.
- Translation needs a recent desktop Chrome or Edge. Indian-language voices depend on the device.
- Doses are what one team gave one patient. There is no label-based dose check in the browser yet.

## Next steps

| Step | What | Gate before calling it done |
|---|---|---|
| N1 | Scale the case bank (e.g. 1,000 per ward); split files so pages stay fast | Engine test 0 errors |
| N2 | Stage-sorting audit on a sample of 100 cases, rated by a human | Pre-registered accuracy bar |
| N3 | Label-based dose check (DailyMed SPL data pre-built into static JSON) | Shown dose = label text 100% |
| N4 | Faculty dashboard via a free backend (e.g. Supabase free tier), opt-in | Owner decision: accounts and data storage |
| N5 | NMC CBME competency mapping per ward | Codes checked against the NMC primary document |
| N6 | Scoring validation with real faculty raters | kappa ≥ 0.6 |
| N7 | GitHub Action that refreshes cases from PMC OA cloud (s3://pmc-oa-opendata) on a schedule, so even rebuilds need no PC | Same filters and tests in CI |
