# ApplyFlow prefiller (Chrome/Edge extension)

Loads a pack exported from ApplyFlow and types it into job-application forms
**in your own browser, in your own session**. It fills. It does not submit.

## Install (2 minutes, no store listing)

1. Build once so `extension/lib/*.mjs` exists (it is copied from `server/lib`
   by the build): `npm run build`
2. Open `chrome://extensions` (or `edge://extensions`) → toggle **Developer mode**
3. **Load unpacked** → select this `extension/` folder
4. Pin the icon. Done.

Firefox: `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → pick
`manifest.json` (MV3 works; the `browser.*` shim is enough for this extension —
if a call errors, `s/this.chrome/browser./` in `content.js`/`popup.js`).

## One click: open the site *and* fill it

Applications → open a pack → **open the site & autofill**. That single button:

1. finds the extension on the current page (the content script announces its id to the
   app over `postMessage`; there is no hardcoded id to guess),
2. hands the pack to the extension's service worker over `chrome.runtime.sendMessage`
   (`externally_connectable` is limited to `localhost`/`127.0.0.1`),
3. has the worker open the posting in a new tab and, once that tab's content script
   reports ready, release the pack exactly once into it.

So it fills **empty** fields with the pack, leaves anything you already typed alone, and
leaves anything you never answered untouched — `work.authorized`, `requires.sponsorship`,
`background.agree`, `consent.data`, `reason.for.leaving` arrive as `null` and the filler
skips nulls rather than writing `false` or clearing a checkbox. It never submits, never
clicks Submit, never uploads without you picking the file.

If nothing answers the handshake, the extension isn't installed on that profile: the
button copies the payload and opens the page instead, so you can paste it in the popup.
One claim per handoff means a reload of the form does **not** refill over your edits —
click the icon and press **Fill this page** to do that deliberately.

## Use it the manual way

1. ApplyFlow → **Applications** → open a pack → **export prefill pack (.json)**
   (whole batch) or **download prefill pack** for a single job.
2. Click the extension icon → **Import pack** → choose that file.
   For a batch, a job list appears — click the one you're applying to.
3. Open the application URL.
4. Click **Fill this page**. Watch the green overlay bottom-right: it lists every
   field it wrote, and outlines each one briefly.
5. Handle what's left (it tells you what couldn't be mapped), read the letter,
   pick the resume/cover-letter files in the upload inputs, then press **Submit**.

Optional: tick *auto-fill detected application forms when they load* — the
content script then pre-fills empty fields on any page whose URL/title looks
like an application (job/apply/career/role). Still nothing submitted, and only
empty fields are touched.

For a rich-text cover-letter box that the automated pass can't reach: click into
it, then press **Letter → focused** in the popup.

## Harvesting jobs from a page you're already on

ApplyFlow needs real postings to score, and neither LinkedIn nor Naukri offers a
public jobs API for it (LinkedIn's is partner OAuth; Naukri's is an internal
endpoint behind an anti-bot challenge). This is the path that doesn't require
anyone to break anything:

1. Log in to LinkedIn / open a Naukri search results page, as yourself, normally.
2. Scroll the results list so the cards are rendered (LinkedIn lazy-loads them).
3. Extension icon → **Harvest** → set the ApplyFlow address (default
   `http://127.0.0.1:3000`, saved in `chrome.storage`) → **read only (no import)**
   once, to see exactly what it found on this page.
4. Then **read cards here → import**. The response tells you how many were new,
   how many were already in the store, and the corpus total.

What it reads: job title, company, location, the posting url, the posted date,
salary/experience text where the card shows it, and skill tags where present.
What it never reads: cookies, tokens, passwords, your messages, your profile, or
anything behind an interaction. It never clicks, navigates, or submits. The card
data is posted to the address you set and to nowhere else.

Rows with no title or url are dropped by the server and reported as `skipped`
rather than imported half-empty, and unknown fields stay empty instead of being
guessed — so a page that a layout change has broken shows up as *nothing
imported*, loudly, not as a page full of wrong jobs.

## Rules it is built with

| rule | why |
| --- | --- |
| never submits, never clicks a submit-like control | that's the ToS line, and the one that protects your account |
| never touches `password`, `otp`, `captcha`, `csrf`, `ssn`, `bank`, `routing`, `signature` | hard blacklist in `lib/fieldmap.mjs → NEVER_FILL` |
| never writes to marketing/newsletter/opt-in checkboxes | flagged `human-only`, left for you |
| never overwrites a field that already has a value | re-running is safe; a filled form stays filled |
| never types an empty pack value | your "prefer not to say" fields stay blank instead of being blanked |
| every write is logged in the page overlay | you can see exactly what it touched, before you send |
| no network requests on the prefill path | it only ever reads a file you pick; no analytics, no server |
| the one exception: Harvest POSTs parsed job cards to the ApplyFlow address *you* set | nothing else is sent, no other host is contacted, and no telemetry exists to send |

## How field mapping works

`lib/fieldmap.mjs` holds an ordered list of label patterns (`first.name`,
`email`, `notice.period`, `work.authorized`, `cover.letter`, …). For each
control it concatenates `name`, `id`, `placeholder`, `aria-label`,
`data-test`, `autocomplete`, its `<label>`, the wrapping group's text, its
next sibling and the `fieldset > legend`, then takes the **first** pattern that
matches — so specific intent always beats a generic `name` or `date`.

Coverage in practice: Greenhouse, Lever, Ashby, Workable and most plain HTML
forms fill ~80-95% of fields. Workday, iCIMS and Taleo obfuscate their ids
(`input_1042`), so they rely on `aria-label` + label text; that works for the
standard fields, and the rest is reported as unmapped.

Pin anything yourself with `data-qa-field="<key>"` (works on a custom careers
page, or via a Userscript/stylus-free DOM edit while debugging).

## Test the mapper without a browser

The same two modules run under jsdom, with fixtures shaped like a Greenhouse
form and an obfuscated Workday form:

```bash
npm run test        # 53 checks: mapping, radio/select resolution, safety refusals
```

That's the code path the extension actually uses — `extension/lib/*.mjs` is
copied from `server/lib/*.mjs` by `npm run build`, so the tests can't drift
from what ships.

## Files

```
manifest.json      MV3 config: content script on <all_urls>, storage, activeTab, scripting
background.js      tiny service worker: hands the content script its pack + toggle on page load
popup.{html,js}    import a pack, choose a job from a batch, trigger fill/survey, harvest the current page, download the letter
content.{js,css}   the overlay + the fill/survey/harvest handlers (async IIFE, ES-module import of lib/)
lib/fieldmap.mjs   ← copied from server/lib at build time (single source of truth)
lib/fill.mjs       ← ditto: fillControl / fillDocument
lib/harvest.mjs    ← ditto: the card readers, so a page parsed here and a page parsed by
                     the server's Naukri source cannot drift apart
icons/             generated by scripts/icons.mjs
```

## If it fills nothing

- Click **Detect fields** in the popup. If the rows say `<i>unmapped</i>`, the
  ATS really has no label text on those inputs — that's a hand-fill case, and
  ApplyFlow's pack already lists exactly which values are waiting.
- If the popup says it can't inject, reload the tab (content scripts aren't
  injected into tabs opened before installation).
- `chrome://`, `about:`, and Web Store pages are off-limits by design.
- The file pickers stay manual: extensions cannot read arbitrary files from
  your disk, so pick `resume.pdf` / `cover-letter.txt` yourself.

## Uninstall

Remove it from `chrome://extensions`. Nothing is left behind: the only
persistent state is `chrome.storage.local` inside the extension profile
(the loaded pack + your fill toggle), which goes away with it.
