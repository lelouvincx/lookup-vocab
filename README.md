# Lookup

An English → Vietnamese vocabulary app with public read/write access and no login. Review on your phone, capture short desktop lookups through the paired extension, or add a card manually.

## Agent infrastructure

This repository adopts [lelouvincx/template](https://github.com/lelouvincx/template). Follow [AGENTS.md](AGENTS.md) for the shared lifecycle and publishing contract.

- `.agents/setup` bootstraps shared tooling, installs npm dependencies and applies local D1 migrations.
- `.agents/resume` refreshes the shared runtime without reinstalling the application.
- `.agents/sync` reapplies shared runtime tooling only.
- `.agents/project` owns Lookup-specific lifecycle work.
- `.agents/configure-amp` explicitly configures the personal Amp project; it does not grant bot access.

The shared source defaults to a sibling `agent-skills` checkout on this Mac or the template's standard orb paths. Set `AGENT_SKILLS_DIR` to an absolute checkout path when needed. CI checks both the template lifecycle and the app/extension without deploying or accessing production D1. Local data, credentials, generated builds and review artifacts are excluded from Git.

## Run locally

Requires Node 24 or newer and npm. No Cloudflare login or cloud resource is needed for local development.

```sh
npm ci
npm run db:init
npm run dev
```

Open http://127.0.0.1:5173 on this machine. The server binds to loopback only. `npm run dev` enables local-origin mutation checks for HTTP localhost/127.0.0.1 URLs. Never expose this development server through a tunnel or reverse proxy. The app has no password.

SQLite data persists under `.wrangler/state/`. Restarting the server does not remove cards. The repository and source archive exclude this directory. Stop the server with Ctrl-C when you no longer need it.

```sh
npm run typecheck
npm test
npm run design:lint
npm run design:check
npm run build
```

`build` is a Wrangler dry run, not a deployment. Tests exercise the real Worker handler and actual migration/triggers with an in-memory SQLite adapter for D1. Browser validation is separate. Node may report that its SQLite module is experimental.

## Design contract

`DESIGN.md` is the normative palette, typography, spacing and shape contract. The UI borrows a playful language-learning visual style, not any app's logo, mascot or assets. Google's official `@google/design.md` CLI checks it with `npm run design:lint`. `npm run design:tokens` uses the public native CSS-vars exporter for colors, spacing and radii and its public parsed model for typography; `public/tokens.css` is generated, not hand-maintained. Run it after editing the contract. `npm run design:check` detects stale tokens, and build regenerates them. No external fonts or visual runtime dependencies are loaded.

## Hosted instance and public access

The authorized instance is **https://vocab.lelouvincx.com**, deployed in the `lelouvincx` Cloudflare account. On 20 October 2026, the user explicitly accepted public read/write access and requested removal of all owner login. Anyone can read vocabulary, reviews and backups, change settings, restore data, and create or revoke pairing tokens. Same-origin checks are not authentication: a non-browser client can supply the required Origin header.

Current app-scoped resources:

- Worker: `lookup-vocab`; custom domain: `vocab.lelouvincx.com`
- D1: `lookup-vocab`, ID `d9de4ef6-d7ee-4624-8d54-ed9122033557`; migration `0001.sql` applied
- `workers.dev` and preview URLs remain disabled

Deleted only these Access applications, including their app-scoped policies:

- `Lookup owner`, ID `a5bf0913-fb72-4d01-96d6-f764c9a7cc61`
- `Lookup capture token endpoint`, ID `b0e177ac-d548-4dfb-8ca9-df32c29011d2`

The shared Access team, identity providers and unrelated applications were not changed. Worker JWT/email verification, the unused JOSE dependency, and `ACCESS_TEAM`, `ACCESS_AUD`, `OWNER_EMAIL` configuration were removed. `APP_ORIGIN` remains for same-origin mutation protection. Leave `LOCAL_DEV` absent in production. `run_worker_first: true` keeps API protections and security headers on asset requests too.

Live anonymous checks returned 200 without redirects for HTML, CSS, JavaScript, state and backup. A settings save with the existing daily limit returned 200; cross-origin, null-origin and missing-origin saves returned 403. Missing/invalid capture bearers returned 401. Backup contents and the existing token-table fingerprint matched before/after; the exact settings probe receipt was removed. No user vocabulary or reviews were changed, and no migration was run for this release.

Open the hosted URL directly, with no sign-in. Pairing and real iPhone review steps otherwise remain unchanged. Store future credentials only as 1Password `op://` references in local env files and resolve them at execution time.

## Install on your iPhone

1. Open https://vocab.lelouvincx.com in Safari.
2. Tap Share, then **Add to Home Screen** (it may be under **More**).
3. If Safari shows **Open as Web App**, leave it enabled, then tap **Add**.
4. Tap the **Lookup** icon on your Home Screen to open the app without Safari's address bar.

Lookup includes a web app manifest and iPhone Home Screen icon. It remains online-only: opening the app, loading cards and saving reviews require an internet connection. No service worker, offline card cache or background review queue is installed. Actual iPhone installation and standalone behavior still need device acceptance; a desktop browser check cannot verify iOS installation.

The icon reuses the site's book mark and design-contract colors. To regenerate its PNGs after editing `public/icons/icon.svg`, use librsvg:

```sh
rsvg-convert -w 180 -h 180 public/icons/icon.svg -o public/icons/apple-touch-icon.png
rsvg-convert -w 192 -h 192 public/icons/icon.svg -o public/icons/icon-192.png
rsvg-convert -w 512 -h 512 public/icons/icon.svg -o public/icons/icon-512.png
```

## Pair the extension

In the public app, open Settings → Create pairing token. Copy the one-time visible token and app base URL into the extension's settings. Tokens are 32 random bytes from browser Web Crypto. Only their SHA-256 hashes persist server-side. Use HTTPS for a hosted app. Loopback HTTP is for local tests only.

The capture endpoint still requires a valid token. Other web routes are public regardless of bearer headers, and anyone can manage tokens through the app. Revoke a token in Settings when a desktop is lost or no longer used. Revocation prevents delivery of queued captures until a new token is paired. A failed pairing request retries with the same token/ID while the page stays open. If the page closes before you copy a token, create another token and revoke the inaccessible entry.

The extension implementation and its setup instructions live in `extension/` in this repository.

### Capture contract

```http
POST /api/captures
Authorization: Bearer <paired extension token>
Content-Type: application/json
```

```json
{
  "eventId": "unique-stable-event-id",
  "sourceText": "take it in stride",
  "translatedText": "bình thản đón nhận",
  "sourceLanguage": "en",
  "targetLanguage": "vi",
  "capturedAt": "2026-10-17T12:00:00Z"
}
```

Source: 1 to 500 characters, at most 80 whitespace-separated words. Translation: 1 to 2000 characters. Both are trimmed and must be nonempty. Event IDs: 8 to 128 ASCII letters/digits, hyphen, underscore or colon. Timestamps must be valid ISO datetimes with a timezone. The server accepts only en → vi. Long passages and other directions receive 400, never an approval inbox.

Successful captures return 200 with `{ "status": "accepted", "eventId": "..." }`. Retries must use the same ID **and the identical payload**. A reused ID with different payload returns 409. Invalid/revoked tokens return 401; validation returns 400; oversized body returns 413; wrong content type returns 415; transient storage failures return 503. Retry transient failures using the same event ID. Never create a fresh event for a transport retry.

## Card and scheduling behavior

- identity uses Unicode NFC plus trimmed/collapsed whitespace; case and punctuation remain significant, so `US` and `us` stay separate
- one card per normalized English text; translations may update on a genuine new lookup
- a distinct lookup event increments the count and makes an active card due immediately without resetting its scheduler step or review history
- retrying the same capture event does not increment the count, change its due date, or update the translation
- suspended and removed cards stay inactive on later capture; restore them explicitly from Library
- Remembered schedules 1, 3, 7, 14, then 30 days; later Remembered grades stay at 30 days
- Forgot resets the step and schedules 10 minutes
- review events persist; card versions reject stale concurrent grades
- the daily cap defaults to 10 and counts **first graded introductions**, not captures or reveals; due/relearn/repeat reviews do not consume it
- daily accounting uses Asia/Ho_Chi_Minh and resets at local midnight; settings allow 0 to 100 new cards per day
- due reviews precede new cards; reopening/focusing the Review screen refreshes captures without polling or replacing intake forms

Library's Remove from deck is a soft deletion, not privacy erasure. Text, lookups, capture receipts, and review events remain in storage and backups. There is no permanent-erasure feature in this version.

## Backup and restore

Portable JSON backups include cards, review events, capture receipts and the new-card limit. Pairing credentials are never exported. Downloaded portable backups are compact JSON and limited to **1,000,000 UTF-8 bytes**, with the same limit enforced on import. The request-body limit is 5 MB, which also permits formatted files whose compact data stays within the portable limit. Larger collections receive an explicit error instead of an unusable download. Use a full D1 SQL export for larger collections.

Restore validates identities, references, unique event IDs and field types before replacing data. All replacements run in one atomic D1 batch. Import suppresses capture/review triggers, so it does not increment counts or reschedule cards. A failed batch rolls back the replacement.

Restore replaces vocabulary/review/capture data and the daily limit. It keeps paired tokens and existing settings/card/revocation mutation receipts. This intentionally prevents an already-applied, delayed admin mutation from changing restored data a second time. To deliberately change a restored setting/card, submit a fresh action. Restore retries must reuse the same restore ID; a fresh ID means a new replacement. Captures/reviews after the backup disappear with the rollback; their receipts also disappear, so a delayed capture newer than the restored backup can be delivered again.

Backups contain private text and history. Keep them out of Git and shared screenshot folders. A full SQL export also includes token hashes and mutation receipts. Treat it as more sensitive than a portable backup.

### Larger database backups

Local export, without cloud access:

```sh
npx wrangler d1 export lookup-vocab --local --output /private/backup-location/lookup.sql
```

After hosting is authorized, use `--remote` instead of `--local` for a remote export. For restoration, first create an **empty replacement database**, import the SQL with `wrangler d1 execute <replacement> --file <backup.sql> --local` (or explicitly authorized `--remote`), then validate row counts and app behavior before switching the configured database ID. Do not import a full schema dump over the live database. Keep the old database until validation passes. This administrative path is separate from portable in-app restore and has not been exercised against cloud resources.

## Limits and outstanding hosted verification

The app is online-only; no service worker caches cards. State currently loads the full collection and is intended for a modest personal deck. No automatic translation service is called by manual intake. Browser desktop captures depend on the extension's supported translation-site adapters. Installed Helium capture was user-confirmed after unpausing. Reloading the extension to activate the latest 10-second source-quiet timing and actual iPhone Safari review remain user-side acceptance; emulated mobile Chrome is not a substitute.
