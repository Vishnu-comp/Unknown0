# ⚡ AutoFill Pro — One-Click Form Filler

A browser extension (Chrome Manifest V3 — also works on Edge, Brave, Arc) that
auto-fills **your details** into job applications and forms:

| Site | What gets filled |
|---|---|
| **Google Forms** (`docs.google.com/forms`) | Text / paragraph answers, multiple choice, checkboxes, dropdowns, date questions, "Other" options |
| **LinkedIn** (`linkedin.com`) | Easy Apply steps, profile forms, city/state typeaheads, resume upload |
| **Naukri** (`naukri.com`, `naukrigulf.com`) | Profile & application forms, experience years/months, salary, notice period, resume upload |
| **Workday** (`*.myworkdayjobs.com` + Workday-hosted portals) | `data-automation-id` fields, custom dropdowns (country/state/gender), date-of-birth parts, resume upload |
| **Any other website** | Generic engine: matches field labels / placeholders / aria-labels / ids to your profile |

Everything is stored **locally** in `chrome.storage` — no servers, no tracking.

---

## Install (Load unpacked)

1. Download / clone this repository.
2. Open **`chrome://extensions`** (Edge: `edge://extensions`).
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the **`extension/`** folder inside this repo.
5. The options page opens automatically — **type your real details** and press **Save**.

> ⚠️ **First run:** the gray “e.g. …” text in the fields is just an example placeholder —
> it is **not** saved data. Fill in *your* name/email/phone etc. once and press **Save**;
> until then the extension has nothing to fill (the popup shows “Profile completeness 0%”).
> Also note the extension cannot run on its own settings tab or on `chrome://` pages —
> use it on a normal website with a form.

> Tip: upload your resume (PDF/DOCX ≤ 6 MB) in the "Answers & Resume" tab —
> it is stored locally and auto-attached on LinkedIn / Naukri / Workday upload fields.

## Use it

- **One click** — press the purple **⚡ Fill** button floating at the bottom-right of any page with a form.
- **Popup** — click the extension icon → **Auto-Fill This Page**.
- **Keyboard** — `Alt + Shift + F`.
- **Multi-step forms** (LinkedIn Easy Apply, Workday wizards) — after the first fill,
  new steps are filled automatically as they appear for the next 5 minutes.
- **Auto mode** — optional toggle in the popup: fill as soon as a form page opens.

Filled fields are highlighted in green for a moment so you can review before submitting.
**Nothing is ever submitted for you** — you review and press Submit yourself.

## Custom answers (for "and all" those site-specific questions)

Job portals love one-off questions ("Do you require sponsorship?", "How did you hear
about us?"). In **Answers & Resume** you can save `keywords → answer` pairs.
Whenever a question contains one of the keywords, that answer is used.
Handy defaults are pre-seeded (work authorization, relocation, sponsorship, source).

Sensitive fields are **never** filled: passwords, OTPs, captchas, CVV/card numbers,
bank / SSN / tax IDs.

## Try it locally

Open `extension/demo/sample-form.html` in Chrome after loading the extension —
it exercises the generic matcher (radios, selects, date, links, custom answer).

## Development

```
extension/
├── manifest.json          # MV3 manifest (content scripts on <all_urls>)
├── background.js          # shortcut, open-options relay
├── content.js             # platform detect, floating widget, step watcher
├── lib/
│   ├── utils.js           # React-safe value setter, labels, dates, option matching
│   ├── aliases.js         # profile schema + question→field matcher (pure logic)
│   └── engine.js          # generic fill engine (inputs, selects, radios, files)
├── adapters/
│   ├── google-forms.js    # question-card aware filler
│   ├── linkedin.js        # Easy Apply + typeaheads + resume
│   ├── naukri.js          # profile/apply forms + exp selects
│   └── workday.js         # automation-ids + Workday dropdowns
├── popup/                 # quick-fill popup + settings
├── options/               # full profile editor, resume, custom Q&A, matcher tester
└── tests/matcher.test.js  # matcher unit tests (plain Node)
```

Run the tests:

```bash
node extension/tests/matcher.test.js
```

## Roadmap

- Parse a resume PDF to pre-fill the profile automatically.
- Fillable repeatable Workday/LinkedIn experience & education sections ("Add another").
- Firefox build (mostly compatible already).
- Profiles per site / per role.

## Privacy

All data (profile, custom answers, resume) lives in `chrome.storage.local` on your
device. The extension makes **zero network requests**. Export / delete your data any
time from the "Settings & data" tab.
