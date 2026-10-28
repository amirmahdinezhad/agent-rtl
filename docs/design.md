# Panel design and behavior

The shared T3 and Codex panel uses Vazir and English labels. Theme and accent synchronize with Setup without changing the host app's appearance. Lavender is the default; Blue, Mint and Yellow are also available. All three toggle thumbs stay white.

- Panel width is 352 pixels with click targets of at least 44 pixels. Scrolling and narrow layouts must remain usable.
- Persist RTL, Force RTL and Shift+2 toggles, TTF/OTF fonts up to 2 MB, text size and line spacing. Preserve appropriate code direction and fonts.
- Support Tab, Enter/Space, arrows, Home/End and Escape. Keep focus visible; cancelling file selection must preserve settings.
- Opening/closing the panel, menus and transient messages must avoid layout jumps. Respect Reduce Motion.
- Setup has one primary action. Preparation and Launch are separate. Keep errors readable and report success after renderer readiness is confirmed.

## Per-response direction

Default follows the global setting; explicit RTL/LTR overrides Force RTL. Exclude code, terminals and editors. Default deletes the stored override; disabling RTL retains the selection. A storage failure must not apply a new selection.

| App | Independent selection scope |
| --- | --- |
| Codex | Main local chat with valid chat/response IDs; no controls for remote hosts, user messages, side views or detached windows. |
| T3 | Canonical assistant row with a valid response ID; keys include environment, chat and response. |

Store overrides in localStorage under `agent-rtl:message-direction:v1:` without message text. Recheck internal DOM/event contracts after each app update. Original code and private React data are not read or modified.

## Review

`npm run preview:design -- --open` builds an interactive panel and nine AppKit states in both themes under `dist/`, without installation. This preview has no actual app CSS. `test:design` with `ARTL_USE_CODEX_CSS=1` and `test:t3-design` read the target app's actual CSS separately. Configure Playwright and Chromium using the [development guide](updates.md).

Check light/dark and 320-pixel layouts, a new font, themes/four accents, toggles, Persian/English/@ typing, code copy, two independent response directions, persistence after reopening, removal cancellation, focus and long Setup errors. Check font/settings synchronization across two real windows. Record each item as pass, fail or untested. Fixtures and static images do not replace [real acceptance](codex-update-workflow.md#user-manual-test-checklist).
