# MediORounds

Free, live, voice-first ward rounds for MBBS students, built on real published case reports.

A student takes a bed, talks to the patient (voice or text), examines, orders tests, commits a diagnosis and a
plan, then follows the admission day by day with a senior. When complications appear, they are asked what they
would do. The case ends with an HOD teaching round and a score card.

- **3,000 cases across 10 wards:** General Medicine, General Surgery, Obstetrics & Gynaecology, Paediatrics,
  Orthopaedics, Emergency & ICU, Psychiatry, ENT, Ophthalmology, Dermatology. The builder scales to more.
- **7 languages:** English, Hindi, Marathi, Tamil, Telugu, Kannada, Malayalam.
- **Fully free, fully cloud:** a static site on GitHub Pages. No server, no API keys, no usage limits, and nothing
  runs on the owner's PC.

## How it stays accurate, and the same every time

Nothing about a patient is generated. Each case is the published article's own case text, split into ward-round
stages. The article's own section headings are used where it has them; otherwise fixed keyword rules decide.
When a student asks a question, the engine finds the sentence in the case record that answers it and returns it
word for word. If the record doesn't cover the question, the student is told so. The same question on the same
case always gets the same answer.

| Piece | Source |
|---|---|
| History, examination, results, course, outcome | The case report's own text (verbatim) |
| Differential diagnosis shown after the student commits | The report's own "Differential diagnosis" section, where it has one |
| HOD teaching points | The report's "Learning points" section, or the sentences in its Discussion that state a lesson |
| Medicines | Names found in the case, linked to the official label on DailyMed. Doses are only what the case states. |
| Senior / HOD prompts | Fixed teaching prompts (no clinical facts) |

Scores measure how much of the case was uncovered and include the student's own ratings. They are a practice
guide, not a validated assessment.

## Voice and languages: what each browser does

| Feature | Uses | Works best in |
|---|---|---|
| Speech input (all 7 languages) | Web Speech API `SpeechRecognition` | Chrome, Edge (desktop + Android) |
| Spoken replies | Web Speech API `speechSynthesis` with the device's voices | Any modern browser. Indian-language voices depend on what the device has installed. |
| Translation of case text and student speech | Built-in on-device `Translator` API | Recent desktop Chrome / Edge |
| Live hands-free mode | Listen → reply → listen again; tap the orb to interrupt | Chrome, Edge |

If a browser has no on-device translator, the site says so. Speech input still works in the chosen language and
replies stay in English. The original English is always one tap away. A translation whose numbers differ from
the English is flagged, so a dose or lab value is never silently changed.

## Layout

```
site/                 the website (deployed as-is)
  index.html, css/, js/
  data/wards.json     ward index
  data/cases/*.json   case bank, one file per ward
build/build_casebank.py   builds site/data from the PMC Open Access library
tests/engine.test.mjs     runs every case through a scripted round (CI)
tests/e2e.mjs             drives a full case in headless Chromium
.github/workflows/pages.yml   test, then deploy to GitHub Pages
```

## Deploy

1. On GitHub, open **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
2. Push to `main`. The workflow runs the engine test on every case and then publishes `site/`.
3. The site goes live at `https://<user>.github.io/MediORounds/`.

Local preview: `python -m http.server 8000 --directory site`, then open http://127.0.0.1:8000.

## Rebuilding the case bank

`build/build_casebank.py --library <PMC OA library> --per-ward 300` reads a local copy of the PMC Open Access
case reports and keeps human cases only, under licence CC BY or CC0, not retracted, from 2015 onwards. Single cases only, each with an age
in its opening lines and both investigations and management in the text. Output is deterministic.

## Not for patient care

This is a learning simulator. Never enter real patient details. The site refuses obvious identifiers.

See [ATTRIBUTION.md](ATTRIBUTION.md) for sources and licences, and [PLAN.md](PLAN.md) for the roadmap.
