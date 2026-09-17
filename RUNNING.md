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

Then open **http://localhost:3000** and click **Overview → "load demo corpus"**
(or **Job matches → "+ demo corpus"**).

> The store does **not** seed itself. On a brand-new `data/` you get a profile
> form and zero jobs until you press that button or run
> `curl -X POST localhost:3000/api/jobs/seed`. The 16 demo postings are
> hand-written (`server/data/demoJobs.mjs`) and work offline, so the app is
> never quietly empty because a network fetch failed.

Data lives in `./data/*.json` — plain files, git-ignored, safe to delete.

### What each command does

| command | what happens |
|---|---|
| `npm install` | 7 runtime deps (express, react, react-dom, esbuild, pdfjs-dist, adm-zip, multer) + 2 dev (jsdom, pngjs) |
| `npm run build` | esbuild-bundles `client/main.jsx` → `public/app.js`, copies `index.html` + `styles.css`, then copies `server/lib/{fieldmap,fill}.mjs` into `extension/lib/` so the extension and server can never disagree about form mapping |
| `npm start` | `node server/index.mjs` — API + static UI on one port, binds `0.0.0.0` |
| `npm run dev` | same server **plus** esbuild in watch mode; restarts the API when `server/**` changes. Use this if you edit anything |

`public/` is git-ignored on purpose, so a fresh `git clone` must run `npm run build`
before `npm start`, or the browser gets a blank page.

---

## 2. Load your own resume (CLI, no browser needed)

```bash
node scripts/load-resume.mjs --resume=~/Downloads/resume.pdf --notice=15
node scripts/load-resume.mjs --resume=resume.txt --floor=1800000
node scripts/load-resume.mjs --resume=resume.txt --base=http://127.0.0.1:3100   # app on another port
```

Flags (all optional except `--resume`):

| flag | meaning |
|---|---|
| `--resume=<path>` | `.pdf`, `.docx`, `.txt`, `.md` — parsed by the same code path as the web UI. `~` is expanded here, so `--resume=~/Downloads/r.pdf` is fine |
| `--base=<url>` | app URL, default `http://127.0.0.1:3000`. Also reads `APPLYFLOW_URL` |
| `--notice=<weeks>` | your notice period, feeds "when can you start" answers |
| `--floor=<INR>` | salary floor. **Left unset on purpose** if you don't pass it — a guessed expectation answers a real form with a real lie, and the score follows it |
| `--field=<id>` | override the target field (e.g. `data_science`) |
| `--remote` | set `openToRemote: true` |
| `--seed` | force a re-seed of the 16 demo postings. An **empty** store gets them anyway; a populated one is left alone unless you pass this |

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
npm test               # 5 suites, ~5 seconds, no network
npm run test:e2e       # 111 checks; boots its own server on a random port :3210-3299
npm run test:all       # both
```

| suite | checks | what it actually proves |
|---|---:|---|
| `test:unit` — `scripts/fieldmap.test.mjs` | 53 | field mapper finds the right inputs (jsdom), filler respects checkboxes/ selects / React-controlled inputs |
| `test:match` — `scripts/match.test.mjs` | 30 | scoring invariants: `core` weight is real but modest, no inflation, no fabricated FX conversion, blockers dominate, vector path ≡ direct path |
| `test:render` — `scripts/render.test.mjs` | 14 | every tab in every state renders without throwing |
| `test:features` — `scripts/features.test.mjs` | 89 | tailoring, letters, resume-parsing hygiene, posting intelligence, cross-role misattribution guard |
| `test:ats` — `scripts/ats.test.mjs` | 76 | dry-run → confirm → send against a **local mock Greenhouse/Lever** (started in-process, no ATS account needed); caps, idempotency, audit log |
| `test:e2e` — `scripts/e2e.mjs` | 111 | ingest → PDF/DOCX/TXT → scoring → letters → caps → pipeline → tailoring → intelligence → submit → exports |

**248 checks, plus 14 render probes = 262.** Current tree: all green.

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
expect it to re-draft and re-score demo apps in that instance: it writes.

---

## 4. The browser extension

```bash
npm run build        # also runs sync:extension — do this after any server/lib change
```

1. `chrome://extensions` → toggle **Developer mode**
2. **Load unpacked** → select the `extension/` folder
3. In ApplyFlow: **Applications → review a pack → "copy extension payload"**
4. Open the job's apply URL → click the extension icon → **Fill**

The payload travels via `chrome.storage.local`, not a URL, so the extension
needs no host permission for your ApplyFlow server and works when the API is
bound to localhost only. It types into the form; **you** press Submit. Safety
rules and the per-board behaviour are in [`extension/README.md`](extension/README.md).

Firefox: `about:debugging#/runtime/this-firefox` → Load Temporary Add-on →
pick `extension/manifest.json`.

---

## 5. Real job sources (this sandbox cannot reach them)

Outbound HTTP here is limited to the npm registry and `api.github.com`. On your
own machine or a VPS:

```bash
export ADZUNA_APP_ID=… ADZUNA_APP_KEY=… ADZUNA_COUNTRY=in   # free key, best for India
export JOOBLE_API_KEY=…
export LLM_API_KEY=…        # optional, enables letter polish only
```

or put them in **Settings → Sources** (stored in `data/settings.json`).
Greenhouse/Lever board slugs need no key at all: `greenhouseBoards: ["zerodha","cred"]`,
`leverCompanies: ["postman"]`. Auto-refresh from Settings → **run auto-apply**;
cron the same way with `POST /api/run` if you'd rather not keep the UI open.

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

Backup = copy `data/`. Reset = `rm -rf data/*.json` (the server recreates a
default profile on next start). There are no secrets in the repo; `data/` is
git-ignored precisely because it holds your résumé, contact details and salary
floor.

To run it somewhere reachable, put a TLS reverse proxy in front and don't bind
`0.0.0.0` to a public interface without one — there is no authentication layer,
because it assumes your laptop or a private box.

Handy endpoints once it's up (`curl` works, there's no auth to script around):

```bash
curl localhost:3000/healthz                       # ok + uptime + which dataDir
curl localhost:3000/api/meta                      # fields, sources, pipeline, which keys are set
curl "localhost:3000/api/jobs?sort=score"         # ranked, with match + flags
curl localhost:3000/api/profile                   # + completeness %
curl localhost:3000/api/export/pack.md            # letters + answers + tailored resumes
curl localhost:3000/api/export/prefill.json       # the extension batch payload
curl -X POST localhost:3000/api/apps/draft \
  -H 'content-type: application/json' -d '{"jobIds":["demo_3"],"force":true}'
```

Per-app: `/api/apps/:id/tailored.txt`, `/api/apps/:id/prefill`,
`/api/apps/:id/submit-support`, `POST /api/apps/:id/submit` (dry run unless you
send `{"confirm":true}`). Submissions log to `/api/submissions`.

---

## 7. If it doesn't come up

| symptom | cause / fix |
|---|---|
| blank page, console 404 on `/app.js` | you skipped `npm run build` |
| `EADDRINUSE :::3000` | something already on the port: `PORT=3100 npm start`, then `--base=http://127.0.0.1:3100` for the CLI |
| Jobs tab empty on a fresh checkout | by design — press "load demo corpus" or `POST /api/jobs/seed` |
| `Cannot find module 'adm-zip'` | ran a script from outside the repo root — `cd` into the checkout first |
| resume parses to a name and nothing else | the PDF is an image; it has no text layer. Use the `.docx`/`.txt` export |
| `The PDF reader could not load inside this Node process` | Node too old for the pinned pdfjs, or someone bumped it past 3.x on a Node 18 box (see §0) — nothing wrong with your file |
| `no such file: ~/Downloads/x.pdf` | your shell left a literal `~` inside the flag value. The script expands `~` itself now, so this means the file really isn't there — it lists what *is* in that folder |
| every live source errors `connect EHOSTUNREACH`/`000` | you're in the sandbox: only npm + `api.github.com` egress. Expected; use the demo corpus |
| extension fills nothing | it only reads a copied payload — re-run "copy extension payload", then Reload the extension after `npm run build` |

---

## 8. What is *not* here, on purpose

- No auto-submit on LinkedIn/Indeed/Workday/iCIMS/SmartRecruiters — those need a
  login or a captcha, so the last click stays yours. The seam to add your own
  Playwright worker (with your cookies, on your machine) is
  `server/lib/automation.mjs → composeApplication()`.
- No credential storage, no accounts, no telemetry. Nothing leaves your machine
  except the requests you trigger.
- No LLM requirement. Letters, answers and tailoring are deterministic templates;
  the model, if configured, only re-words and may never add a claim.
