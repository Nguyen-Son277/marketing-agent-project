# Social browser interface

Scope: repair the existing social browser screen without changing API payloads, permission rules, or remote input geometry.

- Root owns `apps/web/src/screens/TrinhDuyetXaHoi.tsx`, integration, and final browser QA.
- Styling agent owns only `apps/web/src/components/social-browser/social-browser.css`.
- Audit agent performs read-only diagnosis and writes a temporary browser QA script under `/tmp/social-browser-qa/` if useful. Do not change application source.
- Root imports the stylesheet and wraps the complete screen in `.social-browser` (inside `Trang`). The remote dialog remains a descendant of that wrapper.
- Existing class names remain available: `browser-tabs`, `browser-grid`, `browser-grid--content`, `browser-actions`, `browser-url`, `browser-pre`, `browser-excerpt`, `browser-check`, `browser-media`, `browser-asset`, `browser-remote`, `browser-remote__body`, `browser-url-input`, `browser-screen`.
- New layout classes: `browser-heading`, `browser-toolbar`, `browser-tab-panel`, `browser-section`, `browser-section-heading`, `browser-collection`, `browser-form-panel`, `browser-form-grid`, `browser-field-wide`, `browser-empty`, `browser-status`, `browser-status--human`, `browser-status--agent`, `browser-status--paused`, `browser-card-meta`, `browser-card-footer`.
- Use theme variables already defined in `styles.css`. Scope styles under `.social-browser`; do not alter other screens.
- Layout must avoid horizontal overflow at 360, 390, 768, 1024, and 1440 pixels. Inputs/selects/textareas must fill their form tracks; action rows must wrap; headings and long URLs must wrap.
- Keep all existing tabs, CRUD actions, uploads, remote control, status messages, keyboard tab navigation, and translation keys.
- Use plain readable code, one statement per line. No publishing, pushing, external messages, or real social account actions.
