# MediORounds

Free, live, voice-first ward rounds for MBBS students, built on real published case reports.

A student takes a bed and talks to the patient (voice or text). They examine, order tests (and see the
published images), and commit a diagnosis and a plan. Then they round on the admission day by day with the
whole team: senior resident, nurse, radiologist, pathologist, surgeon, neurologist, physiotherapist,
intensivist, obstetrician, paediatrician, psychiatrist, dietitian and clinical pharmacist. Each specialist
then asks the student one question. The case ends with an HOD teaching round, a quiz that corrects mistakes,
a "what did you learn?" reflection and a score card.

- **About 15,000 cases in 15 wards:** General Medicine, ICU & Critical Care, Emergency & Casualty, General
  Surgery, Neurology & Neurosurgery, Obstetrics & Gynaecology, Paediatrics & Neonatology, Orthopaedics,
  Physiotherapy & Rehab Centre, Clinical Pharmacology & Toxicology, Psychiatry, ENT, Ophthalmology,
  Dermatology, and Unique & Rare Cases.
- **Multidisciplinary Ward:** 1,000 cases where 3 or more specialties (surgeon, neuro, physio, ICU and others)
  each have part of the story, for holistic, team-based reasoning.
- **Published figures:** the article's own images (X-ray, CT, MRI, histology and others), shown when the
  matching test is ordered.
- **Pharmacist cards:** for every medicine named, the official label's class, mechanism, indications, boxed
  warning, contraindications, adverse reactions, interactions and pregnancy information, quoted.
- **7 languages:** English, Hindi, Marathi, Tamil, Telugu, Kannada, Malayalam.
- **Fully free, fully cloud:** a static site on GitHub Pages. No server, no API keys, no usage limits.

## Learning features

| Feature | What it does |
|---|---|
| Learning objectives | Shown at the start of each case, built from what the case contains |
| Live voice | Hands-free listen → reply → listen loop. Interrupt by tapping, or by speaking (barge-in, headphones advised) |
| Team voices | Each role speaks in its own voice where the device has several |
| Look-away rule | Away for 5 seconds (tab hidden, window unfocused, or no face seen in the optional on-device camera mode): pause the audio, or keep it going |
| Hints and ideas | Three-level hints from the senior. The classmate offers an idea when you go quiet in live mode. |
| Team review | Each specialist asks one question, then shows what the case says from their side |
| Quiz with correction | Multiple choice: the published diagnosis against real titles of other cases, plus fill-the-gap questions on medicines and tests using the case's own sentences. Wrong answers show the source sentence. |
| Reflection | "What did you learn?" is matched against the article's teaching points; you see what you caught and one point to take away |
| Memory | XP and levels (Intern to Professor), 13 badges, a streak, per-skill and per-ward progress, a reflection journal, and a spaced-repetition review deck of missed questions (1, 3, 7, 14, 30 days). All stored in the browser, with CSV export. |
| Resources | Full article, PDF, PubMed similar cases, MedlinePlus, NCBI Bookshelf, Open-i images, Wikimedia Commons images and videos, ClinicalTrials.gov |

## How it stays accurate, and the same every time

Nothing about a patient is generated. Each case is the published article's own case text, split into ward-round
stages. The article's own section headings are used where it has them; otherwise fixed keyword rules decide.
A question gets the sentence from the case record that answers it, word for word, in the voice of the team
member it belongs to. If the record doesn't cover the question, the student is told so. The same question on
the same case always gets the same answer.

| Piece | Source |
|---|---|
| History, examination, results, course, outcome | The case report's own text (verbatim) |
| Images | The article's own figures (PMC Open Access cloud bucket) |
| Differential diagnosis after the student commits | The report's own "Differential diagnosis" section, where it has one |
| HOD teaching points | The report's "Learning points" section, or the sentences in its Discussion that state a lesson |
| Medicines | Official US drug labels (openFDA, public domain), first sentences of each section, linked to DailyMed |
| Senior / team / classmate prompts | Fixed teaching prompts, with no clinical facts in them |
| Quiz | Stems are the case's own sentences. Distractors are real names from the label set or real titles of other cases. |

Scores are coverage counts, quiz results and the student's own ratings. They are a practice guide, not a
validated assessment.

## Voice and languages: what each browser does

| Feature | Uses | Works best in |
|---|---|---|
| Speech input (all 7 languages) | Web Speech API `SpeechRecognition` | Chrome, Edge (desktop + Android) |
| Spoken replies | Web Speech API `speechSynthesis` with the device's voices | Any modern browser. Indian-language voices depend on the device. |
| Translation of case text and student speech | Built-in on-device `Translator` API | Recent desktop Chrome / Edge |
| Camera look-away detection (optional) | MediaPipe face detector, on-device | Chrome, Edge, Firefox |

The original English is always one tap away. A translation whose numbers differ from the English is flagged.

## Layout

```
site/                       the website (deployed as-is)
  js/engine.js              case engine (retrieval, stages, routing)
  js/teach.js               objectives, team speakers, quiz, reflection, figures, resources
  js/voice.js               speech in/out, live mode, barge-in, look-away rule, camera presence
  js/app.js                 UI, phases, XP/badges, review deck
  data/wards.json           ward list
  data/cases/<ward>/        index.json + shards of 100 cases
  data/drugs.json           pharmacist label cards
build/build_casebank.py     case bank from the PMC OA library
build/add_figures.py        figure lists from the PMC OA cloud bucket
build/build_drugs.py        label cards from the openFDA bulk download
tests/engine.test.mjs       every case through a scripted round + teaching layer (CI)
tests/e2e.mjs               a full case in headless Chromium
```

## Deploy

Pushing to `main` runs the engine test on every case. The site is served by GitHub Pages at
`https://<user>.github.io/MediORounds/`. To make deploys wait for the tests, set **Settings → Pages → Source** to
**GitHub Actions**. Local preview: `python -m http.server 8000 --directory site`.

## Not for patient care

This is a learning simulator. Never enter real patient details. The site refuses obvious identifiers.

See [ATTRIBUTION.md](ATTRIBUTION.md) for sources and licences, and [PLAN.md](PLAN.md) for the roadmap.
