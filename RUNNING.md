# Running ApplyFlow

Every command below was run before being written down. Line references are to
this repo; if a count or a path drifts, the code is right and this file is wrong.

---

## 0. Prerequisites

| you need | why |
|---|---|
| **Node ≥ 18.0** (`node -v`) | 18.20.8 is the version this is developed against. `pdfjs-dist@3.11.174` and `jsdom@26` are pinned to majors that support it |

### Why those two versions are pinned

`pdfjs-dist` 4+ requires Node 20 and 5+ requires 22.13; `jsdom` 30 requires
22.22.2. Bumping either silently drops Node 18 support — and npm only *warns*
about engine mismatches, so the breakage surfaces later, inside a PDF upload.
That trap is now guarded three ways:

```
package.json          engines.node >=18.0.0, pdfjs-dist pinned "3.11.174" (no caret)
server/lib/runtime.mjs  MIN_NODE + an advice string, checked at boot
scripts/match.test.mjs  asserts the guard floor ≥ each dep's declared engines
                        and that the pin is exact
```

To move to a newer pdfjs on purpose: raise `MIN_NODE`, update `engines`, and the
test that ties them together will tell you which one you forgot. Node 18 also
means `legacy/build/pdf.js` is CommonJS (3.x ships no `.mjs`), which
`loadPdfJs()` in `server/lib/resume.mjs` handles by trying the ESM entry first
and falling back to `require()` — so a later bump to 4.x or 5.x needs no code
change there either.

Confirm with `node -e "console.log(process.versions.node)"` — and if it prints
18.20.8, you are on exactly the version this was last exercised against.

---

## 1. First run (about 60 seconds)

```bash
npm install
npm run build          # → public/app.js + public/index.html + extension/lib sync
npm start              # → ApplyFlow → http://localhost:3000
```

Then open **http://localhost:3000**. The job store is **empty** and stays empty
until real listings arrive — there is no bundled corpus to click, on purpose. A
filler corpus is how a matcher looks healthy while every count, salary and
employer in it is invented.

> On boot the server fetches from every enabled source (`github_archive` is on by
> default and needs no key), then remembers the outcome in `data/fetchState.json`.
> `GET /api/jobs/fetch-status` reports what it tried, what it got and what failed;
> the "fetch live jobs" button in the UI reads the same thing. **A failed fetch is
> shown as a failure, never as "no jobs today"** — those two states are not the same
> and conflating them is how a blocked network becomes an empty pipeline.
>
> In a sandbox or behind an egress allowlist, expect that fetch to fail. Use
> **Settings → Import jobs** (or the extension's "send this page") to hand the
> app listings from a tab you already have open: that path needs no server-side
> network access and it is still your data, not mine.

Data lives in `./data/*.json` — plain files, git-ignored, safe to delete.

### What each command does

| command | what happens |
|---|---|
| `npm install` | 7 runtime deps (express, react, react-dom, esbuild, pdfjs-dist, adm-zip, multer) + 2 dev (jsdom, pngjs) |
| `npm run build` | esbuild-bundles `client/main.jsx` → `public/app.js`, copies `index.html` + `styles.css`, then copies `server/lib/{fieldmap,fill}.mjs` into `extension/lib/` so the extension and server can never disagree about form mapping |
| `npm start` | `node server/index.mjs` — API + static UI on one port, binds `0.0.0.0`. Env: `PORT`, `DATA_DIR`, `FETCH_ON_BOOT=0` to skip the boot fetch, `ALLOW_FIXTURE_SEED=1` for the test suites only, `FETCH_TIMEOUT_MS` |
| `npm run dev` | same server **plus** esbuild in watch mode; restarts the API when `server/**` changes. Use this if you edit anything |

`public/` is git-ignored on purpose, so a fresh `git clone` must run `npm run build`
before `npm start`, or the browser gets a blank page.

---

## 2. Load your own resume (CLI, no browser needed)

```bash
node scripts/load-resume.mjs --resume=~/Downloads/resume.pdf --notice=15
node scripts/load-resume.mjs --resume=resume.txt --floor=1800000
node scripts/load-resume.mjs --resume=resume.txt --base=http://127.0.0.1:3100   # app on another port
node scripts/load-resume.mjs --resume=~/Downloads/x.pdf --dump=/tmp/resume.txt   # just show extracted text
```

Flags (all optional except `--resume`):

| flag | meaning |
|---|---|
| `--resume=<path>` | `.pdf`, `.docx`, `.txt`, `.md` — parsed by the same code path as the web UI. `~` is expanded here, so `--resume=~/Downloads/r.pdf` is fine |
| `--base=<url>` | app URL, default `http://127.0.0.1:3000`. Also reads `APPLYFLOW_URL` |
| `--notice=<weeks>` | your notice period, feeds "when can you start" answers. **Unset if you omit it** — it used to default to a fortnight, a commitment nobody made |
| `--floor=<INR>` | salary floor. **Left unset on purpose** if you don't pass it — a guessed expectation answers a real form with a real lie, and the score follows it |
| `--field=<id>` | override the target field (e.g. `data_science`) |
| `--remote` | set `remotePreference: 'remote'` |

Nothing else is filled in for you: work authorisation, sponsorship, background-check and
data-processing consent, current location and salary expectation stay **unset**, because a
resume cannot state them and the Profile tab flags each one until you do. They used to be
defaulted — including `consentBackgroundCheck: true`, which is an assertion about you.
| `--dump=<path>` | write the extracted text and exit (`--dump=stdout` prints only) — how to tell whether a mis-parse is the PDF's fault or the parser's |
| `--seed` | load the fixed test corpus instead of fetching. Only works if the server was started with `ALLOW_FIXTURE_SEED=1`; otherwise it refuses and points at the real paths (`/api/jobs/fetch`, `/api/jobs/import`) |

The app must already be running (it calls the HTTP API — there is no direct
DB writer, which is why nothing can half-apply a profile).

Printed output: roles/bullets/education/skills the parser read, contact line,
completeness %, then every posting ranked with the matched skills and flags,
then the top posting's signal coverage. Compare it against your actual resume:
anything wrong is a parser bug worth reporting, not something to hand-patch.

The browser path (Resume → drop the PDF) additionally lets you *approve* each
suggested field and accepts a real upload you can re-send to employers.

---

## 3. Tests

```bash
npm test               # 7 suites, 487 checks, ~6 seconds
npm run doctor           # read-only diagnosis of Node, TLS trust, proxies, sources
npm run test:harvest   # harvester + ingest-config alone (jsdom fixtures for the LinkedIn/Naukri
                       # scrapers, settings→adapter resolution, how fetch failures are reported)
npm run test:e2e       # 132 checks; boots its own server on a random port :3210-3299
npm run test:all       # both
```

| suite | checks | what it actually proves |
|---|---:|---|
| `test:unit` — `scripts/fieldmap.test.mjs` | 53 | field mapper finds the right inputs (jsdom), filler respects checkboxes/ selects / React-controlled inputs |
| `test:match` — `scripts/match.test.mjs` | 30 | scoring invariants: `core` weight is real but modest, no inflation, no fabricated FX conversion, blockers dominate, vector path ≡ direct path |
| `test:render` — `scripts/render.test.mjs` | 18 | every tab in every state renders without throwing — incl. a harvested job, whose full-ISO date and unparsed pay used to render wrong |
| `test:site` — `scripts/site.test.mjs` | 24 | which page gets typed into, and which only gets asked about: exact posting vs same-board vs same-host-with-another-employer, plus the worker's auto-fill gate executed (not grepped) and a localhost-only server rule |
| `test:features` — `scripts/features.test.mjs` | 175 | tailoring, letters, resume-parsing hygiene, posting intelligence, cross-role misattribution guard |
| `test:harvest` — `scripts/harvest.test.mjs` | 126 | the job-page readers: salary/date shapes, both Naukri paths (embedded JSON, markup), the LinkedIn card + detail scrapers in jsdom, and the invariants that matter — no company guessed from a slug, no wrong-scale salary, no card text leaking into a title, duplicate cards collapsing to one row |
| `test:ats` — `scripts/ats.test.mjs` | 76 | dry-run → confirm → send against a **local mock Greenhouse/Lever** (started in-process, no ATS account needed); caps, idempotency, audit log |
| `test:e2e` — `scripts/e2e.mjs` | 132 | ingest → PDF/DOCX/TXT → scoring → letters → caps → pipeline → **import route** → tailoring → intelligence → submit → exports |

**53 + 30 + 24 + 126 + 18 + 175 + 76 = 502 checks, plus 139 end-to-end = 641.** Current tree: all green
(run on Node 22 here because that is the only runtime in this sandbox; the dependency pins and
the version guard keep Node 18.0 supported — see §0).

Useful variants:

```bash
npm run test:match                        # one suite
node scripts/e2e.mjs                      # against a server you ALREADY run on :3000
node scripts/e2e.mjs http://127.0.0.1:4000  # …or somewhere else
node scripts/e2e.mjs --own-server         # fresh server, throwaway DATA_DIR
npm ls pdfjs-dist jsdom                    # both must stay on the pinned majors (§0)
```

`--own-server` (what `npm run test:e2e` uses) spawns its own server with a temp
`DATA_DIR` in `os.tmpdir()` and a random port, so a test run can never touch
your real profile or application history; it removes the directory at the end.
`test:ats` stands up its mock ATS in-process on a random port — no Greenhouse
account, no network. If you run e2e without `--own-server` against a live app,
expect it to re-draft and re-score real apps in that instance: it writes.

---

## 4. The browser extension

```bash
npm run build        # also runs sync:extension — do this after any server/lib change
```

1. `chrome://extensions` → toggle **Developer mode**
2. **Load unpacked** → select the `extension/` folder
3. In ApplyFlow: **Applications → open a pack → "open the site & autofill"** — the app
   finds the extension on the page, hands the pack to the extension's worker, and the
   worker opens the posting and fills it when the page reports ready (empty fields only,
   `null` answers skipped, nothing submitted). No popup click, no pasting.
The handshake is `window.postMessage` → `chrome.runtime.onMessageExternal` (origin-
checked, and the manifest only lets `localhost`/`127.0.0.1` pages reach it), so no extra
permission is needed and no other site can hand the extension anything. Both sides of it
are executed by `npm run test:features` against a stubbed `chrome` — including that a
pack is claimed **once** (a reload of the posting must not refill over your edits), that
another tab cannot pick up your pack, and that a `javascript:` apply URL is refused.
Anything that cannot be answered truthfully arrives as `null`/unchecked rather than a guess.

3b. **You navigated somewhere yourself.** Every http(s) page you open gets a small card
   asking your own server which drafted pack belongs to it (`GET /api/apps/for-site?page=…`).
   It types **only** into the posting a pack was actually drafted against — `reason: "exact URL"`,
   which the server calls `trustworthy`. A different role on the same board, or a different
   employer on the same ATS host (Greenhouse hosts thousands), is listed and explained but
   never typed into on its own: you press "fill all details" on the card first. The card also
   carries "always fill on this site" / "stop auto-filling here", stored per host, and the
   popup has the same lookup as a button. Nothing here can submit a form, and a page with no
   drafted application is told exactly that rather than staying quiet.

4. Fallback for any browser where that handshake fails: **"copy extension payload"** →
   open the apply URL → click the extension icon → **Fill**

The payload travels via `chrome.storage.local`, not a URL, so the extension
needs no host permission for your ApplyFlow server and works when the API is
bound to localhost only. It types into the form; **you** press Submit. Safety
rules and the per-board behaviour are in [`extension/README.md`](extension/README.md).

**To get real postings in** (step 3' — no pack needed): open a LinkedIn search
results page or a Naukri search page, then extension icon → **Harvest** → set the
server address → *read only (no import)* → *read cards here → import*. It posts to
the same `POST /api/jobs/import` the Settings → Import box uses. If you reload
`server/lib/harvest.mjs`, re-run `npm run build` and reload the extension, or the
page-side copy goes stale.

Firefox: `about:debugging#/runtime/this-firefox` → Load Temporary Add-on →
pick `extension/manifest.json`. The extension's fill and harvest paths both
`import()` their `lib/*.mjs` at runtime; if that ever fails on a given browser,
`content.js` falls back to its built-in field map for filling and reports a clear
error for harvest — in which case use the paste path in Settings → Import jobs.

---

## 5. Real job sources (this sandbox cannot reach them)

Outbound HTTP here is limited to the npm registry and `api.github.com`. On your
own machine or a VPS:

```bash
export ADZUNA_APP_ID=… ADZUNA_APP_KEY=… ADZUNA_COUNTRY=in   # free key, best for India
export JOOBLE_API_KEY=…
export LLM_API_KEY=…        # optional, enables letter polish only
```

or put them in **Settings → Job sources** (stored in `data/settings.json`).

### GitHub archive is off by default (and why)

The `github_archive` source reads the archived public GitHub Jobs dump from
`github.com/odmo/github-jobs`. That repo no longer exists — `api.github.com` answers 404
for the repo, its `data/` directory and the file, checked from a network that reaches
GitHub normally. It shipped enabled, so every fresh install's first fetch failed against a
source that can never answer; it is `githubArchive: false` now, and a 404 says *"the corpus
is no longer published"* instead of looking like a network fault. Repoint the URL at a live
dump if you have one, otherwise use a key-less board (Greenhouse) — see below.

### Greenhouse, in detail (no key needed)

Greenhouse and Lever are the only sources that cost nothing to enable: each customer
company exposes its whole board as open JSON. In the UI — **Settings → Job sources →
Greenhouse ATS boards** — flip the toggle on, paste board slugs one per line, **save
settings**, then press the per-source *test fetch*. In `data/settings.json` that is
`sources.greenhouse.boards`; the flat legacy key `greenhouseBoards: ["zerodha","cred"]`
still folds into it, so an old file keeps working.

A slug is the path segment of the careers URL —
`job-boards.greenhouse.io/**stripe**` → `stripe`. Only the first 12 slugs are read, and
a typo'd or shut board is skipped by name while the rest still fetch. The list call asks
for `?content=true`, which is what puts real description text (salary lines, "X+ years",
sponsorship wording) into the posting-intelligence parsers instead of a stub.

To verify without the UI, and to see exactly what the server will do:

```bash
curl -s -X PUT localhost:3000/api/settings -H 'content-type: application/json' \
     -d '{"sources":{"greenhouse":{"boards":["stripe","datadog"]}}}'
curl -s localhost:3000/api/meta | jq '.enabledSources'   # → ["github_archive","greenhouse"]
curl -s -X POST localhost:3000/api/jobs/fetch -d '{}' -H 'content-type: application/json' | jq
```

`jq` is not installed by default on macOS, and an explanatory comment on a continuation
line gets eaten by zsh's globbing, so here is the same check with no `jq` and no
comments — copy-paste safe in zsh and bash alike:

```bash
curl -s localhost:3000/api/meta | python3 -c "import json,sys;print(json.load(sys.stdin)['enabledSources'])"
curl -s -X POST localhost:3000/api/jobs/fetch -H 'content-type: application/json' -d '{}' \
  | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('message') or d.get('error') or d)"
```

Wiping state, and one caveat learned the hard way: `POST /api/reset` clears jobs,
applications and counters but **deliberately leaves `profile.json` alone**, because a
profile is the most expensive thing here to re-type. An install that predates the
scaffold `DEFAULT_PROFILE` may hold answers no resume ever stated (consent ticks, a
salary floor, a city) — `POST /api/reset?profile=1` is the explicit way to clear those
too, and `data/` stays readable enough to do it by hand: `rm data/profile.json`.

Two failure modes are deliberately loud: no slugs at all →
`greenhouse: no board slugs configured … Nothing was fabricated`; blocked egress →
`2 of 2 board(s) unreachable → stripe: boards-api.greenhouse.io → unreachable from this
machine (ECONNRESET)`, because a blocked network must never be reported as "this source
has no jobs". One UI quirk worth knowing: toggling a source **off** drops its config, so
the textarea hides with your slugs in it — re-enable and paste them again.

Auto-refresh from **Applications → run auto-apply** (the button lives there, not in Settings); cron the same way with `POST /api/run`
if you'd rather not keep the UI open.

**Naukri is different from those five, and deliberately so.** It has no public API:
what exists is the search endpoint the site itself calls, plus server-rendered HTML,
both behind an anti-bot challenge. The `naukri` source tries the endpoint, then the
HTML, and if neither yields rows it raises an error that *names* the fallback path
rather than returning an empty list. Do not expect it to work from a datacenter IP.

**LinkedIn has no server-side path at all, by decision.** Its Jobs API is partner
OAuth, and scraping the site from a server violates the ToS of the one account you
least want to lose. The only supported route is the extension reading a page you
already have open in your own session, or pasting JSON into Settings → Import jobs.
Both land in the same normaliser, so scoring, letters, tailoring and prefill behave
identically for imported rows — verified by `test:harvest` and the e2e import
section (an imported job gets a score, a stable dedupe id, and a salary parsed at
the right scale).

A source that can't connect fails with its own error text in the UI — never an
empty list dressed up as "no matches".

---

## 6. Configuration & data

| variable | default | effect |
|---|---|---|
| `PORT` | `3000` | API + UI port |
| `DATA_DIR` | `./data` | where profile/jobs/apps/settings JSON live |
| `APPLYFLOW_URL` | `http://127.0.0.1:3000` | used by `scripts/load-resume.mjs` |
| `LLM_API_KEY` | unset | letter polish; everything else works without it |
| `ATS_TIMEOUT_MS` / `FETCH_TIMEOUT_MS` | built-in | outbound request budgets |
| `ATS_API_BASE` | unset | only for pointing `test:ats`-style calls at a mock |
| `FETCH_ON_BOOT` | on | pull enabled sources at startup when the store is empty; `0` opts out, `force` pulls every boot |
| `ALLOW_FIXTURE_SEED` | unset | the **only** way the 16 test postings can reach a store; tests set it, the product never does |

Upgrading from the demo-corpus era: those 16 postings lived in `data/jobs.json`, which
is git-ignored, so removing them from the code does not remove them from your disk. Boot
now deletes any posting with a synthetic source and says so on the console; it never
touches applications you drafted, it just names the ones left pointing at a removed job.
The purge is idempotent and cannot fire on real ingest — no runtime adapter can produce
that source tag. To put the fixtures in deliberately (they are test data, not reality):
`ALLOW_FIXTURE_SEED=1` then `POST /api/jobs/seed`.

Backup = copy `data/`. Reset = `rm -rf data/*.json` (the server recreates a
default profile on next start). There are no secrets in the repo; `data/` is
git-ignored precisely because it holds your résumé, contact details and salary
floor.

To run it somewhere reachable, put a TLS reverse proxy in front and don't bind
`0.0.0.0` to a public interface without one — there is no authentication layer,
because it assumes your laptop or a private box.

Handy endpoints once it's up (`curl` works, there's no auth to script around):

```bash
curl localhost:3000/healthz                       # ok + process uptime + pid + node + which dataDir
curl localhost:3000/api/meta                      # fields, sources, pipeline, which keys are set
curl "localhost:3000/api/jobs?sort=score"         # ranked, with match + flags
curl localhost:3000/api/profile                   # + completeness %
curl localhost:3000/api/export/pack.md            # letters + answers + tailored resumes
curl localhost:3000/api/export/prefill.json       # the extension batch payload
# get listings in when the network is blocked: paste what a real page gives you
curl -sX POST localhost:3000/api/jobs/import -H 'content-type: application/json' -d '{
  "source": "naukri",
  "jobs": [{ "title": "Staff Backend Engineer", "companyName": "Razorpay",
             "location": "Bengaluru", "experience": "7-11 Years",
             "salary": "₹45 - ₹65 Lakhs p.a.", "postedAt": "3 days ago",
             "url": "https://www.naukri.com/job-listings-staff-backend-bengaluru-44120998" }]
}'   # → {"imported":1,"skipped":0,"total":1,"bySource":{"naukri":1}}

# then draft against whatever is actually in the store (ids are derived from the
# url/source, so read one rather than assuming it — `demo_…` ids only exist in fixtures)
curl -sX POST localhost:3000/api/apps/draft \
  -H 'content-type: application/json' \
  -d "{\"jobIds\":[\"$(curl -s 'localhost:3000/api/jobs?sort=score' | python3 -c 'import json,sys;print(json.load(sys.stdin)["jobs"][0]["id"])')\"],\"force\":true}" 
```

Per-app: `/api/apps/:id/tailored.txt`, `/api/apps/:id/prefill`,
`/api/apps/:id/submit-support`, `POST /api/apps/:id/submit` (dry run unless you
send `{"confirm":true}`). Submissions log to `/api/submissions`.

---

## 7. Running the loop (and the one-off dry run)

The runner's controls are **not in Settings** — they live with the applications they
produce: **Applications → Auto-apply policy** ("enable runner", min score, daily cap,
per-source cap, cooldown, mode). Settings holds sources, import, direct submit, the model
and data operations; if an error message ever tells you to open a Settings panel that
isn't there, that is a bug worth reporting (test:features greps for it now).

```bash
# what would happen today, without drafting anything and without saving the switch
curl -s -X POST localhost:3000/api/runner/run -H 'content-type: application/json' \
  -d '{"enabled": true, "dryRun": true, "persist": false}'

# commit to it: same call, persist:true is the default so the flag is remembered
curl -s -X POST localhost:3000/api/runner/run -H 'content-type: application/json' -d '{"enabled": true}'

# draft two specific jobs once, ignoring the enable switch entirely
curl -s -X POST localhost:3000/api/runner/run -H 'content-type: application/json' \
  -d '{"jobIds": ["job_abc123", "job_def456"]}'

# the cron seam: refuses quietly when the runner is off, same caps otherwise
curl -s -X POST localhost:3000/api/runner/tick
```

`POST /api/runner/run` answers 400 with this exact guidance when the switch is off,
because an empty `{queued: []}` would read like "the policy works, nothing matched" when
the truth is "the policy is off". `persist:false` writes nothing at all — verified by
`data/settings.json` not existing afterwards.

---

## 8. If it doesn't come up

| symptom | cause / fix |
|---|---|
| blank page, console 404 on `/app.js` | you skipped `npm run build` |
| `EADDRINUSE :::3000` | something already on the port: `PORT=3100 npm start`, then `--base=http://127.0.0.1:3100` for the CLI |
| Jobs tab empty on a fresh checkout | by design — press "fetch live jobs", or import listings via Settings → Import jobs. `POST /api/jobs/seed` is test-only and answers 400 unless the server has `ALLOW_FIXTURE_SEED=1` |
| `Cannot find module 'adm-zip'` | ran a script from outside the repo root — `cd` into the checkout first |
| resume parses to a name and nothing else | the PDF is an image; it has no text layer. Use the `.docx`/`.txt` export |
| `The PDF reader could not load inside this Node process` | Node too old for the pinned pdfjs, or someone bumped it past 3.x on a Node 18 box (see §0) — nothing wrong with your file |
| `no such file: ~/Downloads/x.pdf` | your shell left a literal `~` inside the flag value. The script expands `~` itself now, so this means the file really isn't there — it lists what *is* in that folder |
| every source fails a TLS check | run `npm run doctor`. It reads the certificate each host actually presents and says which of four things is true — *intercepted* (issuer is not a public CA), *not-trusted* (real cert, stale Node roots), *self-signed*, or *blocked* (handshake never happened). Do not guess from the errno: an earlier build printed "a filtering/inspecting proxy answered" off one code alone, and a user with an Amazon-issued cert and no proxy chased a middlebox that was not there | -connect boards-api.greenhouse.io:443 -servername boards-api.greenhouse.io 2>/dev/null \| openssl x509 -noout -issuer`. If the issuer is not a public CA, either add its CA to Node (`NODE_EXTRA_CA_CERTS=…`) or turn that source off — do not "fix" it by disabling certificate verification. |
| resume parses but `company` is empty and the company is in `title` | older builds; the two-line header a flattened two-column PDF produces (`Shoffr` / `— Software Development Engineer (…)`) is handled now. Check what we actually read with `--dump=/tmp/resume.txt` |
| every live source errors `no route from this machine` / `EHOSTUNREACH` / `000` | you're in a sandbox or behind an egress allowlist: only npm + `api.github.com` get out. Expected; use Settings → Import jobs. `GET /api/jobs/fetch-status` keeps the last attempt's per-source errors so you can read them after a reboot |
| extension fills nothing | it only reads a copied payload — re-run "copy extension payload", then Reload the extension after `npm run build` |

---

## 9. What is *not* here, on purpose

- No auto-submit on LinkedIn/Indeed/Workday/iCIMS/SmartRecruiters — those need a
  login or a captcha, so the last click stays yours. The seam to add your own
  Playwright worker (with your cookies, on your machine) is
  `server/lib/automation.mjs → composeApplication()`.
- No credential storage, no accounts, no telemetry. Nothing leaves your machine
  except the requests you trigger.
- No LLM requirement. Letters, answers and tailoring are deterministic templates;
  the model, if configured, only re-words and may never add a claim.
