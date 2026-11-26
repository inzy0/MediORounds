# Sources and licences

## Case reports

All patient cases come from the **PubMed Central Open Access Subset** (US National Library of Medicine,
https://pmc.ncbi.nlm.nih.gov/tools/openftlist/). The licence is read **per article** from PMC's own metadata.
Only articles licensed **CC BY** (any version) or **CC0** are included.

- NC (non-commercial) licences are excluded so the site can be used and shared without restriction.
- ND (no-derivatives) and SA (share-alike) licences are excluded, because splitting a case into stages is a
  rearrangement.

Each case is reproduced verbatim. The only changes are that citation markers and figure/table pointers are
removed, and that sentences are grouped into ward-round stages. Under CC BY this counts as an adaptation, and
the site says so on every case's debrief.

Every case shows its authors, title, journal, year, DOI, a link to the original article, and its licence.
Per-case metadata is in `site/data/cases/<ward>.json` under `src`.

## Figures

Images are each article's own published figures. They are loaded directly from the **PMC Open Access
cloud bucket** (`pmc-oa-opendata`, AWS Open Data Sponsorship Program, NIH/NLM) and fall under the same per-article
CC BY / CC0 licence as the text. Each figure is shown with its caption (where the caption and image can be paired
exactly), the authors, the journal and the licence.

## Medicines

Pharmacist cards quote **openFDA drug label** data (US FDA, public domain / CC0, open.fda.gov/terms) verbatim:
pharmacologic class, mechanism of action, indications, boxed warning, contraindications, most common adverse
reactions, drug interactions and pregnancy. Only the first sentences of each section are kept, and each card
links to the full label on **DailyMed** (US National Library of Medicine) by its set id.

## On-device camera mode (optional)

The optional "notice when I look away" camera mode uses MediaPipe Tasks Vision (Apache-2.0, Google), loaded from
jsDelivr, with the BlazeFace short-range model. It runs entirely in the browser; no image leaves the device.

## Fonts

Inter and Noto Sans (Devanagari, Tamil, Telugu, Kannada, Malayalam) via Google Fonts, under the SIL Open Font
License 1.1.

## Browser features

Speech recognition, speech synthesis and translation are features of the student's own browser (Web Speech API,
Translator API). The site sends nothing to any server of its own.
