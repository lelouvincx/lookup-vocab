# Vocabulary capture for Helium

Manifest V3 extension for English → Vietnamese text lookups on `https://translate.google.com/`.
The extension saves directly to the vocabulary app. There is no inbox or manual approval step.

Status: the user reports installed Helium capture works after unpausing.
The updated 10-second settling interval is verified by automated tests; activation in the installed extension requires the manual reload below.
The agent has not reloaded or changed the user's daily browser.

## Install manually in Helium

These steps change your daily browser only when you perform them. No browser restart is required.
Refreshing the existing Translate tab may affect transient page state. Keep any lookup you want before refreshing.

1. Open `chrome://extensions` in Helium.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Select `/Users/lelouvincx/Developer/lookup-vocab/extension`.
5. Open the extension's toolbar popup or **Details → Extension options**.
6. Enter the app origin, such as `https://your-app.example.com` or `http://localhost:5173` for local development.
7. Create a revocable extension token in the app settings. The hosted app has no login and allows public read/write access.
8. Paste that token into **Paired extension token**. Do not paste the token into chat or a source file.
9. Select **Save settings** and approve access to that app host.
10. Uncheck **Pause capture and delivery** when you want capture to start. This toggle saves immediately.
11. Refresh your existing Google Translate tab once, then select **English** and **Vietnamese** explicitly.

Google Translate's **Detect language**, including **English - Detected**, is intentionally excluded.
Only `translate.google.com` is supported; localized Translate domains are not granted access.
No Accessibility, Screen Recording, or Apple Events permission is needed to use the extension normally.

## Activate updates in an installed unpacked extension

1. Open `chrome://extensions` in Helium.
2. Find **Vocabulary capture** and select its reload button.
3. Refresh the existing Google Translate tab once to replace its old content script.
4. Confirm **Pause capture and delivery** is unchecked and explicitly select English → Vietnamese.
5. Change the source text, then leave the source unchanged for at least 10 seconds.

The update does not require a browser restart, token replacement, or a change to review scheduling.
Capture runs on the next sample after both timing conditions are met: allow 10 seconds plus up to 250 ms for polling.
Background-tab throttling can delay polling further.
If the translation arrives late or changes, its separate 1.8-second stability requirement can delay capture further.

## Capture rules and limitations

The content script samples the visible text translator every 250 ms. A candidate needs:

- explicit visible source **English** and target **Vietnamese** tabs;
- unchanged source text for at least 10 seconds, restarting the full interval after a source/language revision;
- nonempty Vietnamese output unchanged for at least 1.8 seconds;
- output different from the previous source's output;
- at most 300 source characters by default, adjustable from 1 to 500;
- at most 80 whitespace-delimited source words and 2000 translated characters.

Words, phrases, and sentences use the same rules. Whitespace is normalized. Limits count JavaScript UTF-16 code units,
matching the server's conservative ceiling. Composition events suppress capture while an IME is active.

This is a settling heuristic, not detection of intent or a guarantee that every source/output pair is correct.
If you pause typing for 10 seconds, an unfinished word or sentence can be captured.
If different source texts have the same translation, the extension can skip the later lookup.
A translation previously accepted for another source is rejected for the current source. This also causes conservative misses.
Very late, previously unseen, out-of-order translations can still be misassociated. Google exposes no supported source/result identity API in this DOM.
Background-tab throttling can delay samples and miss brief clear/edit transitions.

Google's `c-wiz[data-p]` attributes contain initial render text but remain stale during SPA typing.
The extractor uses those attributes only to allow the first page-load candidate when the initial source matches.
Later candidates rely on output transitions and quiet periods. Undocumented `jsname`/`jsrenderer` selectors can break;
unknown or missing DOM structures are skipped instead of falling back to arbitrary page text.

A source/language revision produces at most one event. DOM rerenders, output alternatives, and delivery retries cannot create another event.
Clearing or changing the source and then returning to it can create a new event, so the app can requeue review.
Reading the same unchanged text again is not distinguishable from a rerender and does not create an event.
The service worker retains the last revision and event ID per tab, preventing same-tab reload duplication.
Closing a tab and reopening the lookup can create a new event.

## Pause and delivery

The extension starts paused. The pause toggle immediately stops new captures and new upload attempts.
Lookups observed while paused are discarded, not backfilled when you resume.
Captures already in the durable queue stay on this device. Resuming delivers those pending captures.
An in-flight request is aborted when pause reaches the worker, but the server may already have accepted that request.

Captures enter `chrome.storage.local` before delivery. Delivery sends:

```http
POST <app-origin>/api/captures
Authorization: Bearer <paired extension token>
Content-Type: application/json
```

```json
{
  "eventId": "stable UUID for this lookup revision",
  "sourceText": "break the ice",
  "translatedText": "phá băng",
  "sourceLanguage": "en",
  "targetLanguage": "vi",
  "capturedAt": "2026-10-17T14:48:15.666Z"
}
```

Failures retain the exact event ID and payload. A one-minute alarm retries with exponential backoff, capped at one hour.
**Retry delivery** clears backoff but respects pause. Queue order is preserved; a failed oldest item blocks later items.
HTTP errors, including revoked tokens, appear in the popup. Replace a revoked token through settings, then retry.
If a permanent error or incorrect endpoint blocks the queue, select **Clear pending** and confirm the deletion.
This permanently deletes pending captures and pauses capture and delivery. It cannot recall a request already accepted by the server.
After clearing, correct the app URL or token, save settings, and resume. The current unchanged lookup is not automatically recaptured.
The extension never follows API redirects or sends browser cookies. Cloudflare Access has been removed from this app;
the backend capture route still verifies the bearer itself. The extension never uses this token to read or modify other app resources.
Those web resources and token management are now public, independently of the extension bearer.

Changing the app origin is blocked while captures are pending, preventing accidental forwarding to another server.
Changing the paired token for the same origin is allowed. Uninstalling the extension or clearing its local storage loses pending captures.
The token and queue are local browser storage, not encrypted by this extension. Treat the browser profile as sensitive.
Storage is restricted to trusted extension contexts; content scripts receive only pause and length settings, never the token.

## Permissions

- required: `storage`, `alarms`, and a content script limited to `https://translate.google.com/*`;
- optional: HTTPS hosts and loopback HTTP, so the user can choose an app origin;
- actually requested: only the configured app origin. Changing origins removes the previous app grant after saving;
- no history, cookies, clipboard, arbitrary page capture, or broad installed content script.

Chromium host grants apply to a host rather than a single API path. Code restricts uploads to `/api/captures`.
The optional manifest host patterns do not grant access until the user approves the specific app host.

## Run the tests

From the project root:

```sh
node --test extension/*.test.cjs
for file in extension/*.js; do node --check "$file"; done
```

Tests need only Node.js. They do not launch a browser or modify a browser profile.
`background.test.cjs` executes the real worker source against mocked Chrome APIs and a real loopback HTTP server.
It covers 503 → persisted queue → worker recreation → retry success, stable event IDs, pause, reload deduplication,
capture-only sender boundaries, token isolation, and server length ceilings. This does not prove installed MV3 lifecycle behavior.
The queue test also covers **Clear pending** recovery and its automatic pause.

See [validation evidence](VALIDATION.md) for the live-site cases and outstanding integration checks.
