# Validation evidence

## Ten-second settling update

The user reports installed Helium capture works after unpausing. The revised source quiet period is now 10 seconds;
the independent output stability guard remains 1.8 seconds. No review scheduler interval changed.
Updated tests check no capture at 9999 ms, capture at 10000 ms, a full 10-second reset after source edits,
and a late output withheld at 1799 ms but accepted at 1800 ms of output stability.
Rerender/repeated-lookup, pause, language, length, and same-output tests retain meaningful timing coverage.
The agent did not access or reload the user's browser/profile for this update. The user must reload the unpacked
extension and refresh the existing Translate tab to activate the new content script.

## Established on 17 October 2026

MacBook: Darwin arm64. Helium `/Applications/Helium.app`, version `0.19.2.1`, was installed and running.
No existing Helium profile, tab, lookup, history, extension setting, or browser process was changed.

Daily-Helium capability check:

- `lsof -nP -a -p <Helium PID> -iTCP -sTCP:LISTEN` found no TCP listener, so no attachable TCP CDP endpoint was established;
- bundle metadata and `scripting.sdef` confirm AppleScript support;
- non-prompting `AEDeterminePermissionToAutomateTarget(..., false)` returned `-1744`, meaning automation would require user consent;
- `AXIsProcessTrusted()` returned `true` for the automation host. This does not establish Apple Events or Helium JavaScript access;
- Screen Recording and native GUI control were not exercised. No consent dialog was requested;
- the existing Google Translate tab was not read or controlled. Its lookup was left intact.

## Live Google Translate checks

The actual `capture.js` extractor and `Settler` ran against the current Google Translate DOM in headless Chromium.
The final recorded run used the explicit `~/.local/bin/agent-browser` policy wrapper with a private thread identity.
No extension was installed. Captures were collected in page memory, not sent to the vocabulary backend.
This historical trace exercised the previous 2.5-second source quiet period, not the current 10-second update.

| Case | Observation |
| --- | --- |
| rapid `seren` → `serend` → `serendipity` | one capture: `serendipity` → `sự tình cờ`; partials skipped |
| phrase `break the ice` | one capture: `phá băng` |
| sentence `I look forward to meeting you.` | one capture: `Tôi rất mong được gặp bạn.` |
| paused `perseverance` | capture count stayed at 3 |
| auto-detected English `hello` | selected tab retained `data-language-code="auto"`; capture count stayed at 3 |
| explicit English `resilience` | capture count became 4; `khả năng phục hồi` |
| normalized 479-character passage | capture count stayed at 4 under default 300-character setting |
| switch to Vietnamese → English and enter `xin chào` | capture count stayed at 4 |
| switch back and repeat `serendipity` | capture count became 5 |
| induce repeated DOM replacements and old output reappearance | capture count stayed at 5 |

The last row deliberately mutates the real page DOM; it is not a claim that Google naturally reproduced that sequence.
Additional browser-free cases cover stale output held after a source change, same-translation misses, 81-word sources,
2001-character translations, resume without backfill, and non-English directions.

[Recorded transitions and captures](fixtures/live-google-translate.json) contain 25 transitions and 5 settled captures.
The fixture contains synthetic test lookups only, not the user's existing tab or private vocabulary.
The trace confirms that initial `data-p` metadata does not update during typing; `associated: false` after a source change is expected.
The fixture is evidence, not a substitute for rerunning against Google's current DOM.

The earlier browser run accidentally used the raw `agent-browser` binary because the mise shim preceded the policy wrapper in PATH.
The raw binary ignored `AB_THREAD` and shared its default ephemeral session with another task.
That collision invalidated one later screenshot attempt; the screenshot was deleted. The final trace and screenshots were repeated
with the explicit policy wrapper and a private session. The daily Helium session was never involved.

## Checks and visual inspection

`node --test extension/*.test.cjs` passed. JavaScript syntax checks passed for every extension `.js` file.
The HTTP queue test received 2 requests with one identical event ID: first HTTP 503, then HTTP 200 after worker recreation.
No additional request occurred while paused or after replaying the accepted capture.
Clearing a subsequently rejected pending capture emptied the queue, reset the error, and enabled pause.

Settings rendered at 390px with readable labels, no horizontal overflow, and masked token input.
Paused/zero-pending, resumed/HTTP-400-pending, and cleared/automatically-paused previews were captured and visually inspected.
Settings previews used a stubbed runtime bridge. They do not prove permission prompts, persistence, or backend delivery.

## Initial agent-side validation limits

Installed Manifest V3 runtime, real service-worker suspension, browser-enforced optional host permissions,
and a complete Translate → extension → real app `/api/state` card path were not exercised.
The approved Mac browser wrapper reserves `--extension`, profile, executable, and CDP launch options.
The standing browser convention forbids bypassing that wrapper. Loading unpacked through the browser UI
requires a manual folder chooser. No exception was assumed and no daily-browser installation was attempted.

After the user loads unpacked in Helium, the remaining acceptance check is:

1. Pair a capture-only token through the extension settings.
2. Resume capture and refresh the existing Translate tab once.
3. Enter an explicit English → Vietnamese lookup and leave the source unchanged for 10 seconds plus up to 250 ms for polling, with stable output for 1.8 seconds. Late output or background-tab throttling can delay capture further.
4. Confirm the popup pending count drains and the matching card appears in the app.
5. Stop the local app, perform another lookup, and confirm one pending capture remains.
6. Restart the app and select **Retry delivery**.
7. Confirm exactly one event was accepted, using its stable event ID.
8. Pause, change the lookup, and confirm no new capture or upload occurs.

Do not claim exact intent detection: long typing pauses can capture partial text, equal translations can be missed,
and previously unseen late responses can still produce an incorrect association. See README for the complete tradeoffs.
