# 004 - Role Tile Quick Links Icons (Meta-driven)

## User Story

As a user, I want quick-link icons at the bottom of each role tile, driven by role metadata, so that I can open documentation, videos, forums, and other resources without leaving the store.

## Acceptance Criteria

- [x] The meta parser extracts the following optional URLs from `galaxy_info`: `documentation`, `video`, `forum`, `homepage`, `issue_tracker_url`, `license_url`.
- [x] The `forum` field falls back to the global Infinito.Nexus forum URL if not set per role.
- [x] Only `http://` and `https://` URLs are accepted; other schemes are ignored.
- [x] Empty or invalid URL values are silently ignored and do not break rendering.
- [x] Role JSON includes these fields when present; otherwise omits them or sets `null`.
- [x] Malformed URLs do not crash role indexing; they are skipped with a warning.
- [x] Each role tile renders a compact icon row at its bottom.
- [x] Icons are shown only for links that exist in the role metadata.
- [x] Tiles with no links show no icon row (no empty placeholder space).
- [x] Each icon has a tooltip and aria-label: Documentation, Video, Forum, Homepage, Issues, License.
- [x] Icons are visually consistent across tiles and do not shift the tile layout unexpectedly.
- [x] `documentation` link opens in a new tab.
- [x] `forum` link opens the Infinito.Nexus forum in a new tab.
- [x] `homepage` link opens the manufacturer/provider homepage in a new tab.
- [x] `issue_tracker_url` link opens the bug-reporting page in a new tab.
- [x] `license_url` link opens the license page in a new tab.
- [x] All non-video links open with safe attributes (`rel="noopener noreferrer"`).
- [x] `video` link opens a smooth JS foreground overlay (modal).
- [x] The video modal loads the video as an `<iframe>` and supports common URL formats including youtu.be and youtube.com.
- [x] The video modal can be closed via a close button, ESC key, or clicking the backdrop.
- [x] Closing the modal stops video playback by clearing or unmounting the iframe src.
- [x] Playwright test: tile with all links renders all corresponding icons.
- [x] Playwright test: tile with partial links renders only those icons.
- [x] Playwright test: clicking a non-video icon opens a new tab (`target=_blank`).
- [x] Playwright test: clicking a video icon opens the modal with an iframe present; closing removes the iframe.
- [x] Tests cover DOM state and modal open/close transitions.
- [x] Tests run headless and pass in CI.
