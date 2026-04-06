# 008 - Role Pricing & Variants (Meta-driven, UI-integrated)

## User Story

As a provider, I want to declare software variants and pricing models in Ansible role metadata so that the backend indexes them, calculates prices deterministically, and users can select a variant and see a pricing preview in the UI.

## Acceptance Criteria

- [x] Roles MAY provide pricing metadata via `roles/*/meta/pricing.yml` or `pricing.json`.
- [x] `meta/main.yml` MAY reference pricing explicitly via `galaxy_info.pricing.schema` and `galaxy_info.pricing.file`.
- [x] Roles without pricing metadata default to a single implicit `community` variant at price 0 with no UI inputs.
- [x] Roles without pricing metadata continue to work unchanged.
- [x] Pricing metadata is optional and non-breaking.
- [x] The pricing schema supports at least these primitives: `fixed`, `per_unit`, `tiered_per_unit`, `bundle`, `addon`, `factor`, `custom`.
- [x] All pricing primitives are declarative (no executable code).
- [x] All primitives are versioned under `schema: v1`.
- [x] Pricing metadata MAY define user inputs of type: number, enum, boolean.
- [x] Inputs can be scoped via `applies_to` to specific variants.
- [x] All inputs have mandatory defaults.
- [x] The UI never renders a pricing input without a default value.
- [x] Inputs are only shown when relevant to the currently selected variant.
- [x] Role indexing is extended to detect and parse pricing metadata.
- [x] Pricing files are validated against a strict schema on indexing.
- [x] Invalid pricing metadata is ignored, emits a warning, and does not break role indexing.
- [x] `/api/roles` includes a `pricing_summary` field when pricing metadata is available.
- [x] `/api/roles/{id}` includes the full `pricing` block when present.
- [x] A deterministic backend PricingEngine is implemented.
- [x] The PricingEngine accepts: role_id, selected variant, input values.
- [x] The PricingEngine returns: total price, breakdown (base, addons, factors), unit price (if applicable), interval (month/year/once).
- [x] Same input always produces the same output from the PricingEngine.
- [x] No pricing logic exists in the frontend.
- [x] The PricingEngine is fully unit-tested.
- [x] The variant selector replaces the simple "Select" button (radio or dropdown); default is `community`.
- [x] Variant label and description are shown inline.
- [x] Roles with a single variant behave exactly like today.
- [x] Variant switching does not reset unrelated UI state.
- [x] Pricing inputs are rendered dynamically based on metadata and update the pricing preview live.
- [x] Inputs are validated client-side (type, min/max); invalid input never reaches the backend.
- [x] The UI always reflects the currently selected variant.
- [x] A pricing preview panel shows: total price, interval (monthly/yearly/once), optional toggleable breakdown.
- [x] "Contact sales" state is supported for `custom` pricing variants.
- [x] The pricing preview is clearly marked as an estimate.
- [x] Zero-price variants explicitly show "Free".
- [x] No arbitrary JavaScript from roles is executed.
- [x] Pricing metadata is treated as untrusted input; strict schema validation is mandatory.
- [x] Pricing metadata cannot inject scripts or HTML.
- [x] CSP does not require relaxation for pricing features.
- [x] Backend unit tests cover: fixed, per_unit, tiered, addons, factors, edge cases (0, min, max).
- [x] Playwright tests cover: variant selector renders correctly, inputs appear/disappear on variant change, pricing preview updates on input change, "Contact sales" variant disables calculation.
- [x] All pricing logic is covered by automated tests that pass headless in CI.
- [x] Community / Free is always the least prominent upsell; enterprise pricing never blocks deployment.
- [x] Pricing UI never forces a purchase flow; users can deploy Community without friction.
