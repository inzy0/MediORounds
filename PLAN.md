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

## Built (v0.2, 2026-11-27)

- **14,977 cases** in 15 wards (up to 1,000 each), plus a **1,000-case Multidisciplinary Ward**. The new
  wards are ICU & Critical Care, Neurology & Neurosurgery, Physiotherapy & Rehab Centre, Clinical Pharmacology
  & Toxicology, and Unique & Rare. Case files are split into shards of 100, each ward with its own index.
- **Published figures** for 14,761 of the 15,977 case entries (including the multidisciplinary copies), loaded
  from the PMC OA cloud bucket. 13,418 have captions paired one to one with their images.
- **Team rounds:** each sentence is voiced by its specialist, and each specialist asks one question in a team
  review. There are **1,142 pharmacist label cards**.
- **Teaching:** learning objectives, 3-level hints, classmate nudges, an HOD round, a quiz with correction
  (48,521 questions, all valid), a reflection step, XP, levels, badges, a streak, a journal, and a
  spaced-repetition review deck.
- **Voice:** barge-in, a separate voice per role, speed control, and the 5-second look-away rule (pause or keep
  going), with an optional on-device camera mode.
- **Phone layout:** the conversation gets most of the screen.

## Built (v0.3, 2026-11-27)

- **Dose check:** every dose in a case is compared with the amounts stated in the official US label's dosing
  section (1,020 medicines). Of 24,426 dose mentions, 10,708 appear in the label, 13,063 do not, 237 are
  weight-based, and 418 have no label dosing text. The site says "appears in the label", never "correct".
- **Image questions:** "what kind of image is this?" and "which description matches this image?" (18,950
  questions, all valid). The captioned gallery now comes after the quiz.
- **Finish option** from rounds, team review, quiz or reflection, plus "Finish & back to wards".
- **Fixed** the ward-opening bug: two GitHub Pages deploys published different layouts. Loading now retries and
  shows a visible error with a Retry button.

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
| N1 | ~~Scale the case bank; split files so pages stay fast~~ Done in v0.2 (14,977 cases, shards of 100) | Engine test 0 errors: met |
| N2 | Stage-sorting audit on a sample of 100 cases, rated by a human | Pre-registered accuracy bar |
| N3 | ~~Label-based dose check~~ Done in v0.3 (case dose vs label dosing text; label excerpt shown verbatim) | Label text shown verbatim: met |
| N4 | Faculty dashboard via a free backend (e.g. Supabase free tier), opt-in | Owner decision: accounts and data storage |
| N5 | NMC CBME competency mapping per ward | Codes checked against the NMC primary document |
| N6 | Scoring validation with real faculty raters | kappa ≥ 0.6 |
| N7 | GitHub Action that refreshes cases from PMC OA cloud (s3://pmc-oa-opendata) on a schedule, so even rebuilds need no PC | Same filters and tests in CI |
