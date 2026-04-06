# Role Tile – Quick Links Icons (Meta-driven)

## Goal

Extend each role tile with a bottom “quick links” icon row, fully driven by `roles/*/meta/main.yml` (`galaxy_info.*`).

---

## 1. Metadata Extraction (Backend)

* [x] Extend meta parser to extract these optional URLs from `galaxy_info`:

  * [x] `documentation`
  * [x] `video`
  * [x] `forum` (fallback: global Infinito.Nexus forum URL if not set per role)
  * [x] `homepage`
  * [x] `issue_tracker_url`
  * [x] `license_url`
* [x] Normalize/validate:

  * [x] Accept only `http://` / `https://` URLs
  * [x] Empty/invalid values are ignored (do not break rendering)

**Acceptance Criteria**

* [x] Role JSON contains these fields when present, otherwise omits them or sets `null`
* [x] Malformed URLs do not crash indexing; they are skipped with a warning

---

## 2. Tile UI – Icon Row (Frontend)

* [x] Render a compact icon row at the **bottom of each tile**.
* [x] Show icons only for links that exist in role metadata.
* [x] Provide tooltip/aria-label per icon:

  * [x] Documentation
  * [x] Video
  * [x] Forum
  * [x] Homepage
  * [x] Issues
  * [x] License

**Acceptance Criteria**

* [x] Tiles with no links show no icon row (no empty placeholders)
* [x] Icons are visually consistent across tiles and do not shift layout unexpectedly

---

## 3. Link Behaviors

* [x] `documentation` → open in **new tab**
* [x] `forum` → open Infinito.Nexus forum in **new tab**
* [x] `homepage` → open manufacturer/provider homepage in **new tab**
* [x] `issue_tracker_url` → open bug reporting page in **new tab**
* [x] `license_url` → open license page in **new tab**
* [x] `video` → open **smooth JS foreground overlay** (modal)

  * [x] Video is loaded as an `<iframe>` (supports common link formats, incl. youtu.be / youtube.com, etc.)
  * [x] Modal has close button + ESC to close + click-backdrop to close
  * [x] On close: stop playback by clearing/unmounting the iframe src

**Acceptance Criteria**

* [x] All non-video links open in a new tab with safe attributes (`rel="noopener noreferrer"`)
* [x] Video opens in a modal with smooth transition and works with typical video URL formats
* [x] Closing the modal reliably stops the video audio

---

## 4. UI Tests (Playwright – Required)

* [x] Tile with all links renders all corresponding icons
* [x] Tile with partial links renders only those icons
* [x] Clicking non-video icons opens a new tab (assert `target=_blank` behavior)
* [x] Clicking video icon opens modal; iframe is present; closing removes iframe

**Acceptance Criteria**

* [x] Tests cover DOM state + modal open/close transitions
* [x] Tests run headless and pass in CI
