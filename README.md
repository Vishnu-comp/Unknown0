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
sources (Adzuna · Jooble · Greenhouse · Lever · GitHub archive · Naukri)
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
node -v                # Node 18+ — 18.20.8 is what this is developed against
npm install
npm run build          # bundles the UI + syncs the extension's mapper
npm start              # http://localhost:3000   (PORT=… to change)
```

**Node 18 is supported on purpose**, which constrains two dependencies:
`pdfjs-dist` is pinned exactly to **3.11.174** (the last major declaring
`node >=18`; 4.x wants 20, 5.x wants 22.13) and `jsdom` is pinned to **26**
(30 wants 22.22.2). npm only *warns* about engine mismatches, so an unpinned
bump would surface much later as a PDF upload failing inside the library — hence
`server/lib/runtime.mjs` checks the floor at boot and `scripts/match.test.mjs`
asserts the guard and the pins can't drift apart. 3.x ships only a CommonJS
entry (`legacy/build/pdf.js`), and `loadPdfJs()` tries the ESM path first and
falls back to `require()`, so upgrading pdfjs later needs no code change.

Dev mode (rebuilds assets on change, restarts the API on `server/` changes):

```bash
npm run dev
```

To load your actual resume from the CLI instead of the browser (same endpoints
the UI calls — parse it, propose a profile, fetch jobs, show the ranking):

```bash
node scripts/load-resume.mjs --resume=~/Downloads/resume.pdf --notice=15   # ~ works here
node scripts/load-resume.mjs --resume=resume.txt --floor=1400000   # sets the INR salary floor too
```

It only writes what your document states. What it cannot read from a resume stays
empty — the salary floor, your notice period, where you live, whether you need
sponsorship, whether you consent to a background check. Each of those used to be
filled in with a plausible default, which meant a stranger's assumptions ended up
typed into a real form; now they surface as "needs your answer" instead.

The store starts **empty, on purpose**. There is no bundled corpus to fill it: a
matcher that always has something to show you is a matcher whose numbers nobody
checked. On boot the server fetches from every enabled source (`github_archive` is
on by default and needs no key), remembers the outcome in `data/fetchState.json`,
and `GET /api/jobs/fetch-status` says exactly what it tried and what failed. A
failed fetch is reported as a failure — never as "no jobs today".

Two ways listings get in, both real:

1. **`POST /api/jobs/fetch`** — the "fetch live jobs" button. Needs outbound HTTPS.
2. **Settings → Import jobs JSON**, or the extension's "send this page" button, for a
   LinkedIn/Naukri tab you already have open. This is the path that works in a
   locked-down sandbox, and it is still your data, not filler written for you.

Worked path:

1. **Resume → drop your PDF** (or paste text). `data/samples/sample-resume.pdf`
   is a real PDF you can test with.
2. **Profile → fix the suggestions** the parser made (skills, work history, headline)
3. **Job matches → set a field, a salary floor, exclude terms** (e.g. `staffing`, `BPO`)
4. **Job matches → job intel tab**: see the posting's signals, and the resume
   re-ordered for it (preview / copy plain text / download `.txt`)
5. **Applications → review a pack → copy extension payload, or open the apply URL**
6. **Greenhouse or Lever posting?** → *preview payload (dry run)*, read what would
   be sent, then **Settings → Direct ATS submit** on and `confirm + send now`
7. **Settings → sources**: turn on Adzuna, Greenhouse, Lever or Naukri for live
   postings (the boot fetch can be silenced with `FETCH_ON_BOOT=0`)
8. **Run auto-apply** (top-right) — or let cron do it (see below)

## Nothing about you is inferred

A matcher that writes letters has to be paranoid about the line between *derived*
and *invented*, so three things are hard-gated rather than defaulted:

| field | unset profile means | why it is not guessed |
| --- | --- | --- |
| consent to background check / data processing | the question is flagged for you and the box is left alone | a tick is your assertion, not a preference; the direct-API payload used to send `consent_for_data_processing: true` for anyone who never opened Settings |
| authorised to work / need sponsorship | flagged for you | these are legal statements, and the old code answered them **inverted** (needing sponsorship → "No, I do not require sponsorship") |
| notice period, salary expectation | blank, and the score says "no floor set yet" | a made-up number answers a real form with a real lie, and the ranking quietly follows it |

Unset is written as `null`, not `false` or `''`: the filler skips nulls, so the
control is untouched rather than ticked *or* unticked — actively un-checking a box
the user never saw is its own assertion. And the shipped `DEFAULT_PROFILE` is now a
scaffold (structure, neutral search settings, no biography); the rich "Alex Kumar"
profile lives in `scripts/fixtures/profileFixture.mjs`, because it is a made-up
person and was the thing every "honest scoring" test was accidentally measuring.

## Tests

```bash
npm test            # 53 field-mapper/filler checks (jsdom) · 30 match-engine + runtime checks
                    # · 126 harvester + ingest-config checks (Naukri/LinkedIn parsing,
                    #   settings→adapter resolution, how a failed fetch is reported,
                    #   route order, and that the API makes no claim it did not measure)
                    # · 18 render probes (incl. a genuinely blank first-run profile) · 128 tailoring/intelligence/parsing/attestation checks
                    # · 76 direct-submit guard-rail checks (local mock ATS)
                    # = 431 (53+30+126+18+128+76), and `npm run test:all` adds 132 e2e = 563
npm run test:e2e    # 132 checks: ingest → PDF/DOCX/TXT parsing → scoring → letters → caps →
                    # pipeline → import route → tailoring → intelligence → direct submit → exports
                    # (boots its own server on a random port with a throwaway DATA_DIR)
npm run test:all    # both
npm run test:harvest # harvester alone: jsdom fixtures for both scrapers + every
                    # salary/date shape, each one a real bug this code used to have
```

`npm run test:ats` boots a fake Greenhouse/Lever API on localhost and proves the
safety rails hold: a dry run sends zero bytes, an unsupported board is refused,
no resume means no application, a second send is blocked, the shared daily cap
applies, and every attempt — including refusals — lands in `data/submissions.json`.

`npm run test:harvest` is the same idea for reading job pages: it drives the
LinkedIn and Naukri scrapers over fixtures shaped like their real markup, and
asserts what must *not* happen — no company invented from a URL slug, no salary
read at the wrong scale, no card text leaking into the title, no `about:blank`
urls, and duplicate cards collapsing to one row.

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
exactly that for the whole fixture corpus — a tailored resume that invents
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
| **Naukri** (unofficial) | no | their own search endpoint, then server-rendered HTML — undocumented and behind an anti-bot challenge, so expect it to break | works as-is; falls back to Settings → Import |
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

### Why LinkedIn and Naukri go through Import instead

**LinkedIn has no public jobs API.** Its Jobs API is partner OAuth, granted to
integrators under commercial agreements — there is no "personal token" that reads
search results. Scraping the website from a server is explicitly against their
ToS and is the fastest way to lose the account that *is* your professional
identity. So this app does not do it, and no configuration will make it do it.

What it does instead: the extension reads the job cards **on the page you already
have open, in your own logged-in session**, and posts them to ApplyFlow's import
route. That is not a workaround for weakness, it is the only honest path — it
defeats nothing because you are the visitor. The same route accepts pasted JSON,
which is how you import from anything else (an ATS board, a newsletter, a raw
Naukri response):

```bash
curl -X POST localhost:3000/api/jobs/import -H 'content-type: application/json' -d '{
  "source": "linkedin",
  "jobs": [{ "title": "Senior Backend Engineer", "companyName": "Zerodha",
             "location": "Bengaluru", "url": "https://www.linkedin.com/jobs/view/4123456789/",
             "salary": "₹30 - ₹45 Lakhs p.a.", "skills": ["Java", "Kafka"] }]
}'
# → {"imported":1,"skipped":0,"total":3,"bySource":{"linkedin":2,"naukri":1}}
#    (an empty store starts at 0 — nothing is seeded to make the number look better)
```

A row needs only a `title` and a `url`; everything else is mapped from whatever
name the source used, and unknown values stay null rather than being guessed.
Because both paths run through one normaliser
([`server/lib/harvest.mjs`](server/lib/harvest.mjs)), imported jobs get scored,
written up, tailored and pre-filled exactly like fetched ones — there is no
"imported job" code path downstream.

**Naukri** is the middle case: no public API, but the site's own search endpoint
and its server-rendered HTML are readable. The `naukri` source tries both, then
fails *loudly* with the import path named in the error, because a fetcher that
silently returns `[]` on a 403 is how a matcher ends up reporting "no jobs in
Bengaluru" for weeks.

### Add a source

Add an `async (cfg) => normalizedJob[]` function to `server/lib/ingest.mjs` and
one entry to its `SOURCES` registry — the UI, the runner, the caps, `/api/meta`
and the exports all pick it up from there, with no client change. Set
`volatile: true` if the upstream can change or block you without notice (that is
what makes Settings show an honest "may be blocked" hint). Normalized shape,
defined once in `server/lib/harvest.mjs` so the browser scrapers produce it too:

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

It is also the harvester. The **Harvest** tab holds your ApplyFlow address and one
button that reads the job cards on the current page and posts them to
`/api/jobs/import` — which is how LinkedIn jobs get in without scraping LinkedIn
from a server (see [Job sources](#job-sources)). Read-only by the same rule that
keeps it from submitting: it parses visible cards, clicks nothing, and its manifest
asks for no cookie or auth permission — only `storage`, `activeTab`, `scripting`
and `notifications`. Use **read only (no import)** first if you want to see what a
page would have produced.

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
| `profile.json` | identity, experience, education, skills, targets, standing answers. Legal attestations and consent are **absent, not defaulted** — unset means "ask me" |
| `resume.json` | extracted text, parsed structure, suggested profile patch |
| `jobs.json` | normalized postings (upserted by `extId`, ids stay stable). Any posting whose source is synthetic — the old `demo` corpus or the test fixtures — is **deleted at boot** |
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
  lib/db.mjs          JSON store, default profile, field taxonomy
  lib/ingest.mjs      source adapters + settings→adapter resolution + upsert
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
  fixtures/             jobFixtures.mjs — the only fixed jobs in the repo, test-only
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
