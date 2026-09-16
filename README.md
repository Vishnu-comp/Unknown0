# ApplyFlow

Self-hosted "auto apply" that doesn't get you banned.

Your profile + resume live in one place. ApplyFlow pulls job postings from
sources you enable, scores every posting against your actual skills with an
explanation you can audit, re-orders your resume for each posting, reads what
the posting itself reveals, writes the cover letter and the ten screening
questions, pre-fills the application form — and stops exactly one click short
of submitting on someone else's website (unless that website happens to publish
a public apply API, in which case it will do the whole thing, with your
permission).

```
sources (Adzuna · Jooble · Greenhouse · Lever · GitHub archive · demo)
        ↓  normalize + dedupe
   job store (data/jobs.json)
        ↓  weighted match engine (9 components, explainable)
   ranked matches  ──→  auto-apply policy (min score, daily cap, per-source cap, cooldown)
        ↓
   posting intelligence (11 signals read out of the posting text) ──→ score nudged, with the reason
        ↓
   composed pack: cover letter + answers + prefill payload + checklist
              + resume tailored to this posting (re-ordered, never invented)
        ↓
   you review  →  browser extension fills the form in YOUR session  →  you press Submit
              ↘  Greenhouse / Lever posting? POST the public apply API directly, after a dry run
```

---

## Why the last click stays yours

Every board that matters (LinkedIn, Indeed, Workday, Greenhouse-hosted pages)
prohibits scripted submission in its ToS, defends it with captchas, device
fingerprinting and rate-detection, and the price of getting caught is a
restricted account — for LinkedIn, your actual professional identity. A
server-side "I'll log in as you" bot additionally requires you to hand a
machine your password and session cookie forever.

So ApplyFlow automates the 95% of the work that is safe and tedious —
sourcing, ranking, tailoring, writing, typing — and leaves the send button
alone. Net effect versus manual applying: 10–20× the volume at the same
quality, ~15 minutes of your day instead of 3 hours, and no credential risk.

The one exception is honest: **Greenhouse boards and Lever postings publish a
public, unauthenticated apply endpoint** — it's the same endpoint their own
"Apply for this job" button posts to, on public data, with no login and no
captcha. For those, ApplyFlow will submit for real, but only when you flip
`Settings → Direct ATS submit` on *and* confirm each application after seeing
the exact payload (dry run is the default). LinkedIn, Indeed, Workday and iCIMS
stay manual-on-purpose: they need your session, they fingerprint automation, and
a server holding your LinkedIn cookie is the worst trade in this whole space.

If you decide you want full auto-submit on the gated boards for *yourself*, the
seam is `server/lib/automation.mjs → composeApplication()` plus a Playwright
worker running with your own cookies on your own machine. It's deliberately not
wired up here.

---

## Quickstart

Full step-by-step (fresh checkout, extension install, tests, env vars, failure
modes): **[RUNNING.md](RUNNING.md)**.

```bash
node -v                # need v22.13+ — npm only WARNS if you are older, then PDF parsing dies later
npm install
npm run build          # bundles the UI + syncs the extension's mapper
npm start              # http://localhost:3000   (PORT=… to change)
```

`pdfjs-dist@6` (PDF text extraction) declares `>=22.13` and `jsdom@30` (the DOM
test suite) declares `>=22.22.2`. On Node 18/20 everything else works —
`.txt`/`.docx` resumes, scoring, letters, tailoring, prefill — but a PDF upload
fails from inside the library, so the server now refuses to boot below 22.13 and
tells you which brew/nvm command to run (`APPLYFLOW_ALLOW_OLD_NODE=1` to override).

Dev mode (rebuilds assets on change, restarts the API on `server/` changes):

```bash
npm run dev
```

To load your actual resume from the CLI instead of the browser (same endpoints
the UI calls — parse it, propose a profile, seed the corpus, show the ranking):

```bash
node scripts/load-resume.mjs --resume=~/Downloads/resume.pdf --notice=15   # ~ works here
node scripts/load-resume.mjs --resume=resume.txt --floor=1400000   # sets the INR salary floor too
```

It only writes what your document states. The one number it deliberately leaves
empty is the salary floor: a made-up expectation answers a real form with a
real lie, and the score would quietly follow it.

The store starts empty: click **Overview → "load demo corpus"** once (or
`curl -X POST localhost:3000/api/jobs/seed`) to pull in 16 hand-written postings
(`server/data/demoJobs.mjs`) so you can see scoring, letters and the pipeline
with zero configuration and no network. Worked path:

1. **Overview → load demo corpus** — one click, nothing else to configure
2. **Resume → drop your PDF** (or paste text). `data/samples/sample-resume.pdf`
   is a real PDF you can test with.
3. **Profile → fix the suggestions** the parser made (skills, work history, headline)
4. **Job matches → set a field, a salary floor, exclude terms** (e.g. `staffing`, `BPO`)
5. **Job matches → job intel tab**: see the posting's signals, and the resume
   re-ordered for it (preview / copy plain text / download `.txt`)
6. **Applications → review a pack → copy extension payload, or open the apply URL**
7. **Greenhouse or Lever posting?** → *preview payload (dry run)*, read what would
   be sent, then **Settings → Direct ATS submit** on and `confirm + send now`
8. **Settings → sources**: turn on Adzuna or Greenhouse for live postings
9. **Run auto-apply** (top-right) — or let cron do it (see below)

## Tests

```bash
npm test            # 53 field-mapper/filler checks (jsdom) · 26 match-engine + runtime checks
                    # · 14 render probes · 89 tailoring/intelligence/parsing checks
                    # · 76 direct-submit guard-rail checks (local mock ATS)
npm run test:e2e    # 111 checks: ingest → PDF/DOCX/TXT parsing → scoring → letters → caps →
                    # pipeline → tailoring → intelligence → direct submit → exports
                    # (boots its own server on a random port with a throwaway DATA_DIR)
npm run test:all    # both

`npm run test:ats` boots a fake Greenhouse/Lever API on localhost and proves the
safety rails hold: a dry run sends zero bytes, an unsupported board is refused,
no resume means no application, a second send is blocked, the shared daily cap
applies, and every attempt — including refusals — lands in `data/submissions.json`.
```

The e2e run boots its own server against a throwaway `DATA_DIR`, so it never
touches your real profile.

---

## Tailoring the resume per posting

One resume for 60 applications is the main reason a decent candidate gets
screened out. ApplyFlow builds a per-posting version
(`server/lib/tailor.mjs`) that:

- ranks your existing bullets by how many of *the posting's own* phrases each
  one hits, and puts the strongest at the top (ATSs and recruiters both read
  top-down);
- re-orders your skill list so the technologies named in the posting lead, in
  the posting's own spelling;
- writes a one-line headline (role · years · top stack · city) from your
  profile numbers, not the employer's wishes;
- prints an explicit **"Not claimed (and correctly absent)"** line for every
  requirement you genuinely don't have, so nobody is ever accused of hiding it;
- keeps a plain-text variant (`?format=txt`) that survives Workday's textarea
  and paste-into-PDF pipelines.

Nothing is generated. Every bullet in the output is a byte-for-byte copy of
something already in your profile or parsed resume, and the test suite asserts
exactly that for the whole demo corpus — a tailored resume that invents
experience is not a feature, it's a career-risk. The UI shows the audit
(which bullets moved, which were demoted, why), so you can see the reasoning.

## Reading the posting (job intelligence)

`server/lib/companyResearch.mjs` extracts eleven signals from text we already
ingested — no extra account, no scraping, and one optional public API call
that is allowed to fail:

| signal | what it separates |
| --- | --- |
| Stage | Series B from "we're a fast-growing startup" |
| Headcount | 40 people (you touch everything) from 4,000 (process) |
| On-call / incident ownership | the best predictor of day-to-day happiness in infra roles |
| Pay transparency | a stated range vs "competitive" vs nothing |
| Pay structure | unpaid / stipend / equity-only, flagged hard |
| Remote, honestly read | "remote" tag vs "3 days in office" in the body |
| Hiring-process tell | number of rounds, take-home, algo round, "only shortlisted candidates will be contacted" |
| Stack specificity | a real list vs a 30-technology shotgun (nobody wrote this) |
| Urgency / freshness | 2 days old (early applicants get read) vs 30 days (probably a closed shortlist) |
| Benefits | published vesting terms, learning budget, relocation, parental leave |
| Sponsorship | checked against *your* `needSponsorship`, not in the abstract |

Each finding carries the reason it matters, and a subset of them nudge the
match score (−30 for unpaid, −25 for a sponsorship blocker, ±5 for quality
signals) with the applied rules listed next to the score — so a bad posting
can't flatter itself into an A+ and a good one can't be hidden by keywords
alone. The ceiling stays 97: honesty over dopamine.

The nudged score is computed on demand (`/api/jobs/:id/research`) and frozen
onto an application when it is composed, so the ranking you sort by stays the
explainable keyword match and the judgement call stays visible where you make
it. `composeApplication({ useInsights: false })` turns the nudge off entirely.

---

## Job sources

| Source | Needs key | What it covers | Where to get it |
| --- | --- | --- | --- |
| **Adzuna** | yes (free) | Indeed, CareerBuilder, ZipRecruiter, Monster, Naukri, RookiemandRoo syndication — the widest single feed | <https://developer.adzuna.com> (instant) |
| **Jooble** | yes (free) | company career pages + niche boards | <https://jooble.org/api/about> |
| **Greenhouse boards** | no | full public JSON for thousands of tech companies | board slug from any `boards.greenhouse.io/<slug>` URL |
| **Lever postings** | no | same for Lever customers (`api.lever.co/v0/postings/<org>`) | org slug from a Lever-hosted careers page |
| **GitHub Jobs archive** | no | ~19k historical tech postings, no signup | works as-is (needs `api.github.com`) |
| **Demo corpus** | no | 16 realistic postings incl. deliberately bad ones | works as-is |

Credentials can live in `data/settings.json` (Settings → Sources) or env vars:

```bash
export ADZUNA_APP_ID=… ADZUNA_APP_KEY=… ADZUNA_COUNTRY=in
export JOOBLE_API_KEY=…
export LLM_API_KEY=…            # optional; enables letter polish
```

**Best free ratio of effort to real jobs in India:** Greenhouse/Lever board
slugs (live, exact, structured, no key) + Adzuna with `country=in`.

> Note on this preview sandbox: outbound HTTP is limited (npm + `api.github.com`
> only), so *live* fetches fail here by design and the UI says so in the error.
> On your own machine or a VPS they return real postings.

### Add a source

Drop a file that exports `async (cfg) => normalizedJob[]` in `server/lib/ingest.mjs`
(see `SOURCES`), add one entry, and the UI, the runner, the caps and the exports
all pick it up automatically. Normalized shape:

```js
{ extId, source, title, company, location, remote, url, description,
  requirements: [], salaryMin, salaryMax, salaryCurrency, postedAt, tags: [],
  category, contractType, applyEmail? }
```

---

## Marking a skill "core"

Click ☆ next to a skill on the Profile tab. Core skills add a small weight in
the skills component of every score (a few points, never a re-ranking) and lead
the cover letter. It is deliberately weak: a self-declared "core" tag should
nudge a ranking, not fake a qualification.

## How matching works

`server/lib/match.mjs`, weights (tune them there, they're honest and small):

`skills 35 · field 20 · title intent 15 · semantic overlap 10 · seniority 8 · experience gap 6 · location/remote 6 · salary 5 · recency 5`

Plus hard effects: exclude-term hit → −22 and blocked from auto-apply;
unpaid/volunteer → −30; below your salary floor → flagged; "asks 5+ yrs, you
have 3" → flagged. Every job carries a per-component breakdown, matched skills,
missing skills and flags — the "why this score" tab in the job modal. A 90 means
"they will read your resume"; a 55 means "you'd be screened out", and ApplyFlow
won't spend your reputation on it.

Skills matching uses a curated phrase list (`server/lib/text.mjs`) so `node.js`,
`ci/cd`, `react native`, `a/b testing` survive instead of tokenising into dust.

---

## The browser extension

`extension/` is a Manifest V3 unpacked extension — no store, no review, no
telemetry. It reads the pack you export from ApplyFlow and types it into
application forms *in your logged-in browser session*. Full instructions and
its safety rules: [extension/README.md](extension/README.md).

```bash
# chrome://extensions → Developer mode → Load unpacked → select extension/
```

Coverage: generic label/name/placeholder/`aria-label` heuristics handle most
Greenhouse, Lever, Ashby and Workable forms outright; `data-qa-field="…"` pins
anything obfuscated. Captcha, password, OTP, SSN, bank, "marketing emails" and
signature controls are hard-refused. Already-filled fields are never
overwritten. It never submits — by construction, not by configuration.

---

## Daily automation

```cron
# 08:17 every day: pull new postings from enabled sources, then compose up to the cap
17 8 * * *  curl -s -X POST localhost:3000/api/jobs/fetch -H 'content-type: application/json' -d '{}' >> ~/.applyflow.log 2>&1
27 8 * * *  curl -s -X POST localhost:3000/api/runner/tick >> ~/.applyflow.log 2>&1
```

`/api/runner/tick` is inert unless auto-apply is enabled in Settings, and it
respects `minScore`, `dailyCap`, `perSourcePerDay` and `cooldownHours`.
Keep the daily cap low (5–12). Recruiters talk, ATSs flag burst behaviour, and
mass-applying 300 roles at once converts a strong profile into a spam signal.

---

## Data

Everything is plain JSON in `data/` (override with `DATA_DIR`) so you can read,
back up, or `git`-it:

| file | contents |
| --- | --- |
| `profile.json` | identity, experience, education, skills, targets, standing answers, consent defaults |
| `resume.json` | extracted text, parsed structure, suggested profile patch |
| `jobs.json` | normalized postings (upserted by `extId`, ids stay stable) |
| `applications.json` | packs: letter, answers, prefill, tailored resume + audit, posting insights, status history |
| `submissions.json` | every direct-ATS attempt: dry run, sent, refused, ATS status code, external application id |
| `settings.json` | source configs, runner policy, optional model key |
| `runs.json` | per-day counters the caps enforce |

Exports: `GET /api/export/pack.md` (human-readable application pack: letter,
tailored resume, what the posting revealed, answers, manual-to-do list),
`GET /api/export/prefill.json` (extension batch), `GET /api/apps/:id/prefill`,
`GET /api/jobs/:id/tailored?format=txt` (paste-ready resume for one posting),
`GET /api/apps/:id/tailored.txt` (the version frozen onto an application).

**No accounts, no auth, no analytics, no phone-home.** Run it on a laptop or a
private VPS; if you expose it to the internet, put a password proxy in front —
`profile.json` contains your phone number and address.

---

## Layout

```
server/
  index.mjs           REST API + static UI hosting (Express)
  data/demoJobs.mjs   bundled corpus
  lib/db.mjs          JSON store, default profile, field taxonomy
  lib/ingest.mjs      source adapters + normalization + upsert
  lib/match.mjs       scoring engine (explainable)
  lib/text.mjs        tokenising, skill phrases, salary/date/seniority extraction
  lib/resume.mjs      PDF/DOCX/TXT extraction + profile suggestions
  lib/letters.mjs     cover letters, screening answers, prefill payload, mailto
  lib/automation.mjs  auto-apply runner, caps, pipeline transitions, checklist
  lib/tailor.mjs      per-posting resume re-ordering (no fabrication) + audit
  lib/companyResearch.mjs  the 11 posting signals + score adjustments
  lib/atsSubmit.mjs   Greenhouse/Lever public-API submit: dry run, gates, log
  lib/fieldmap.mjs    ATS field mapping rules (shared with the extension, tested)
  lib/fill.mjs        fill algorithm (shared with the extension, tested)
client/               React UI: Overview · Profile · Resume · Job matches · Applications · Settings
extension/            MV3 prefiller (popup.html, content.js, lib/*.mjs synced at build)
scripts/              build, dev, icons, sample generators, load-resume (CLI ingest), tests
                        fieldmap/fill · match invariants · tailoring+intelligence
                        · direct-submit · render probes · e2e
```

## Rough edges / good next steps

- Multi-user auth and Postgres — `db.mjs` is the only file to swap.
- Per-ATS selector packs for Workday/iCIMS (they obfuscate ids; today you pin
  those fields with `data-qa-field` or fill by hand — the pack lists what's unmapped).
- Tailoring re-orders and re-weights; it does not rewrite prose. Given an LLM
  key the obvious step is a `polishTailored()` pass that may re-word (never
  re-claim) a bullet, gated behind the same audit that exists today.
- Job intelligence reads the posting only. Funding rounds, layoff news and
  Glassdoor sentiment live on sites that need keys or scraping — the `RULES`
  array in `companyResearch.mjs` is the seam, and each new rule must state its
  `why` and be usable without one.
- Direct submit covers Greenhouse + Lever because those are the public APIs.
  Ashby's is authenticated-per-board; SmartRecruiters needs a partner token.
  Adding either means a new `atsFor()` branch plus a `buildBody()` shape — and
  the same six guard rails, not fewer.
- Interview-prep pack: generate likely technical questions from the posting's
  stack + your own bullets.
