# 011 - Role Pricing – Refined Spec (Offerings, Plans, Multi-Currency, Regional, Volume, Inventory Persistence)

## User Story

As a provider, I want to declare multi-currency, region-aware, and advanced pricing models (offerings, plan tiers, volume bands, setup fees, minimum commits) in Ansible role metadata so that users receive deterministic backend-calculated quotes and the selected plan is persisted in the inventory for reproducible deployments.

## Acceptance Criteria

- [x] Roles MAY provide pricing metadata via `roles/*/meta/pricing.yml`.
- [x] `meta/main.yml` MAY reference pricing explicitly via `galaxy_info.pricing.schema: v2` and `galaxy_info.pricing.file`.
- [x] Roles without pricing metadata default to one implicit offering, one implicit plan `community`, price 0, no UI inputs; existing behaviour is unchanged.
- [x] Pricing metadata is optional and non-breaking.
- [x] The schema hierarchy is: **Offering** (provider + deployment + optional version + optional region availability) → **Plan/Tier** (selectable tier e.g. Starter/Business/Enterprise) → **Pricing** (declarative primitives).
- [x] A provider can define multiple offerings per role.
- [x] Each offering can define multiple plans/tiers.
- [x] A single version line can have multiple tiers.
- [x] All numeric price points support a currency map with ISO 4217 keys (e.g. `prices: {EUR: 169, USD: 199}`).
- [x] At least one currency is required per price point.
- [x] The backend never auto-converts currencies.
- [x] An unsupported currency yields a clear validation error.
- [x] Regional pricing is supported via `regional_prices` keyed by region enum (`global`, `eu`, `us`, `uk`, `apac`, `latam`).
- [x] When `regional_prices` is present, quote requests must include `region`.
- [x] When `regional_prices` is absent, region defaults to `global`.
- [x] No region fallback across markets unless explicitly defined (deterministic).
- [x] Same offering/plan returns different totals for different regions.
- [x] Region and currency are selectable independently in the UI.
- [x] The schema supports all pricing primitives: `fixed`, `per_unit`, `tiered_per_unit`, `volume_per_unit` (band applied to all units), `bundle`, `addon`, `factor`, `custom`.
- [x] `volume_per_unit` determines the matching band by total units and applies that band's unit price to **all** units (not progressively).
- [x] `volume_per_unit` is clearly distinct from `tiered_per_unit` in the engine.
- [x] `bundle` overage supports `per_unit`, `tiered_per_unit`, and `volume_per_unit`; overage tiers apply to overage units only.
- [x] Plans MAY define a `setup_fee` with `interval: once` and a currency price map.
- [x] Setup fee is added to the quote only when `include_setup_fee=true` or on first purchase; it never repeats on renewals.
- [x] The quote response includes `setup_fee` separately in the breakdown.
- [x] The UI shows the setup fee clearly labeled as "one-time".
- [x] Plans MAY define a `minimum_commit` with interval and a currency/region price map.
- [x] After calculating all usage/addons/factors, the engine enforces: `total = max(total, minimum_commit)`.
- [x] The quote output indicates when a minimum commit was applied.
- [x] Minimum commit enforcement is deterministic: same input always triggers the same floor.
- [x] `schema: v2` is validated on indexing; pricing blocks (including region + currency structures) are normalized.
- [x] Invalid pricing metadata is ignored with warnings and does not break role indexing.
- [x] `/api/roles` includes `pricing_summary` with region/currency availability when present.
- [x] `/api/roles/{id}` includes full pricing metadata when present.
- [x] `POST /api/pricing/quote` accepts: `role_id`, `offering_id`, `plan_id`, `inputs`, `currency`, optional `region` (required when `regional_prices` exist), optional `include_setup_fee`.
- [x] The quote response includes: `total`, `currency`, `region`, `interval`, breakdown (base, usage, addons, factors, setup_fee, minimum_commit_applied with bool + delta), `notes`.
- [x] Unsupported currency or region in a quote request yields a validation error.
- [x] The UI renders: Offering selector, Plan selector, Inputs, Region selector (only when regional pricing applies), Currency selector, "Include setup fee" toggle (only when `setup_fee` exists), Pricing preview panel (via quote API).
- [x] The UI never calculates pricing client-side.
- [x] Region/currency switching or setup-fee toggle triggers a new quote request.
- [x] "Minimum spend applied" is shown in the UI when a minimum commit was enforced.
- [x] The selected `plan_id` is stored per role under `applications.<role_id>.plan_id` in `host_vars/<host>.yml`.
- [x] The full pricing context is stored as: `applications.<role_id>.plan_id`, optional `applications.<role_id>.pricing.currency`, `region`, `inputs`.
- [x] Changing the plan dropdown updates `host_vars/<host>.yml` deterministically and immediately.
- [x] Reloading the UI restores the dropdown state from the inventory.
- [x] When `plan_id` is missing or no `pricing.yml` exists, the dropdown defaults to **Enabled – Community** (`plan_id: community`, `per_unit: 1 EUR/user`, `inputs.users: 1`).
- [x] Setting `plan_id: null` disables the role, excludes it from deployment, and shows "Disabled" in the dropdown.
- [x] The tile button label always reflects the current state: Disabled / Community · Enabled / `<Plan Label>` · Enabled.
- [x] The plan dropdown is the only control for enable/disable and plan selection on a role tile.
- [x] Removing a role removes its plan entry from the inventory.
- [x] Plan selection is preserved through ZIP export/import.
- [x] The pricing engine reads only from inventory + metadata; no hidden frontend state.
- [x] When validation fails (invalid plan, currency, region, or inputs), deployment is blocked and a clear error is returned; no silent fallback.
- [x] Backend unit tests cover: fixed, per_unit, tiered_per_unit (progressive), volume_per_unit (band-all-units), bundle with tiered overage, bundle with volume overage, setup_fee inclusion toggle, minimum_commit floor application, regional_prices selection, invalid currency/region.
- [x] Playwright tests cover: Region selector appears only when required, currency selector changes totals, setup fee toggle changes quote + breakdown, minimum commit scenario displays applied floor, volume pricing threshold changes total correctly.
- [x] Tests pass headless in CI; no real secrets are used.
