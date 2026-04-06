# Role Pricing & Variants (Meta-driven, UI-integrated) — Refined Spec (Offerings + Plans + Tiered Usage + Multi-Currency + Enterprise Edge Cases)

## Goal

Enable **provider-specific offerings**, **software editions/versions**, **plan/tier bundles**, **multi-currency pricing**, and key
enterprise edge cases (**setup fees**, **volume pricing**, **minimum commits**, **regional pricing**)
to be declared in Ansible roles, indexed by the backend, and selectable/calculable in the UI.

The system MUST be:

* **data-driven**
* **deterministic**
* **secure**
* **non-executable** (no vendor JS, no dynamic code)
* **backend-calculated** (frontend renders only)

---

## 1. Role-side Metadata (Ansible)

### 1.1 Pricing Metadata File

* [x] Roles MAY provide pricing metadata via:

  * `roles/*/meta/pricing.yml` (preferred)

* [x] `meta/main.yml` MAY reference pricing explicitly:

  ```yaml
  galaxy_info:
    pricing:
      schema: v2
      file: meta/pricing.yml
  ```

* [x] Roles without pricing metadata default to:

  * one implicit offering
  * one implicit plan: `community`
  * price: `0`
  * no UI inputs

**Acceptance Criteria**

* [x] Roles without pricing metadata behave exactly like today.
* [x] Pricing metadata is optional and non-breaking.

---

## 1.2 Schema Core: Offerings → Plans (Tiers) → Pricing

* **Offering** — provider + deployment + optional version + optional region availability
* **Plan/Tier** — selectable tier (Starter/Business/Enterprise)
* **Pricing** — declarative pricing primitives (including new edge cases)

**Acceptance Criteria**

* [x] A provider can define multiple offerings per role.
* [x] Each offering can define multiple plans/tiers.
* [x] A single version line can have multiple tiers.

---

## 1.3 Multi-Currency Pricing (No Conversion)

All numeric price points MUST support a currency map:

```yaml
prices:
  EUR: 169
  USD: 199
```

Rules:

* [x] At least one currency required per price point.
* [x] Currency keys MUST be ISO 4217.
* [x] Backend never auto-converts currencies.

**Acceptance Criteria**

* [x] Quote API can compute totals for any supported currency.
* [x] Unsupported currency yields a clear validation error.

---

## 1.4 Regional Pricing (Market Segmentation, Not Currency)

Pricing MAY vary by **region/market** independent of currency (e.g., EU vs US pricing in EUR and USD both existing).

### 1.4.1 Region Keys

Regions use a fixed enum (expandable later):

* `global`
* `eu`
* `us`
* `uk`
* `apac`
* `latam`

### 1.4.2 Region-Aware Price Points

Every place where `prices` exists MAY alternatively be `regional_prices`:

```yaml
regional_prices:
  eu:
    EUR: 169
    USD: 185
  us:
    USD: 199
```

Rules:

* [x] If `regional_prices` is present, quote requests MUST include `region`.
* [x] If `regional_prices` missing, region defaults to `global`.
* [x] No region fallback across markets unless explicitly defined (deterministic).

**Acceptance Criteria**

* [x] Same offering/plan can return different totals for different regions.
* [x] UI can select region and currency independently.

---

## 1.5 Supported Pricing Model Primitives (Expanded)

The schema MUST support at least:

* [x] `fixed`
* [x] `per_unit`
* [x] `tiered_per_unit` (progressive tiers)
* [x] `volume_per_unit` (**NEW**: single-rate bands applied to ALL units)
* [x] `bundle` (base + included units + overage)
* [x] `addon`
* [x] `factor`
* [x] `custom`

---

## 1.6 Setup Fee (Explicit)

Plans MAY define an additional one-time setup fee.

```yaml
setup_fee:
  interval: once
  prices:
    EUR: 499
    USD: 549
```

Rules:

* [x] Setup fee is added to the quote only when `include_setup_fee=true` or when the UI indicates “first purchase”.
* [x] Setup fee never repeats on renewals.

**Acceptance Criteria**

* [x] Quote response includes setup_fee separately in breakdown.
* [x] UI shows setup fee clearly as “one-time”.

---

## 1.7 Minimum Commit (Minimum Spend)

Plans MAY define a minimum monthly/yearly spend (total floor), per currency/region.

```yaml
minimum_commit:
  interval: month
  prices:
    EUR: 500
    USD: 600
```

Rules:

* [x] After calculating total usage/base/addons/factors, enforce:

  * `total = max(total, minimum_commit)`
* [x] Minimum commit applies per interval and currency/region exactly.

**Acceptance Criteria**

* [x] Quote output indicates when a minimum commit was applied.
* [x] Deterministic: same input always triggers same floor.

---

## 1.8 Volume Pricing (Explicit, Non-Progressive)

Add a new primitive for the common “band rate applied to all units” model.

### 1.8.1 `volume_per_unit`

Meaning:

* Determine the matching band by total units.
* Apply that band’s unit price to **all** units.

```yaml
pricing:
  type: volume_per_unit
  unit: user
  interval: month
  bands:
    - up_to: 50
      prices:
        EUR: 8
        USD: 9
    - up_to: 200
      prices:
        EUR: 6
        USD: 7
    - up_to: null
      prices:
        EUR: 4
        USD: 5
```

**Acceptance Criteria**

* [x] Volume pricing is distinct from tiered/progressive pricing.
* [x] Engine applies band price to all units deterministically.

---

## 1.9 Bundle Pricing (with Tiered or Volume Overage)

`bundle` remains base + included units + overage, but now overage may be:

* `per_unit`
* `tiered_per_unit`
* `volume_per_unit` (**NEW**)

```yaml
pricing:
  type: bundle
  interval: month
  base:
    prices:
      EUR: 169
      USD: 199
  included_units:
    user: 50
  overage:
    type: tiered_per_unit
    unit: user
    tiers:
      - up_to: 200
        prices:
          EUR: 3
          USD: 4
      - up_to: null
        prices:
          EUR: 2
          USD: 3
```

Tier semantics:

* [x] Overage tiers apply to **overage units only**.

**Acceptance Criteria**

* [x] Business plan can use tiered or volume overage.
* [x] Same inputs always produce same totals.

---

## 2. Backend API (Index + Calculation + Quote)

### 2.1 Indexing

* [x] Validate `schema: v2`.
* [x] Normalize pricing blocks (including region + currency structures).
* [x] Invalid pricing metadata is ignored with warnings.

**Acceptance Criteria**

* [x] `/api/roles` includes `pricing_summary` including region/currency availability.
* [x] `/api/roles/{id}` includes full pricing metadata.

---

### 2.2 Quote Endpoint

**POST** `/api/pricing/quote`

Request MUST include:

* `role_id`
* `offering_id`
* `plan_id`
* `inputs`
* `currency`
* optional: `region` (required when regional_prices exist)
* optional: `include_setup_fee` (boolean)

Response includes:

* `total`
* `currency`
* `region`
* `interval`
* `breakdown`:

  * base
  * usage
  * addons
  * factors
  * setup_fee
  * minimum_commit_applied (bool + delta)
* `notes`

**Acceptance Criteria**

* [x] Unsupported currency/region yields validation error.
* [x] Minimum commit enforcement is indicated in output.
* [x] Setup fee is included only when requested/applicable.

---

## 3. Web UI (Offering + Plan + Region + Currency)

UI controls:

* [x] Offering selector
* [x] Plan selector
* [x] Inputs
* [x] Region selector (only if offering/plan supports regional pricing)
* [x] Currency selector
* [x] “Include setup fee” toggle (optional; shown only if setup_fee exists)
* [x] Pricing preview panel (quote API)

**Acceptance Criteria**

* [x] UI never calculates pricing client-side.
* [x] Region/currency switching triggers new quote.
* [x] Setup fee is visually labeled as one-time.
* [x] Minimum commit is shown as “minimum spend applied”.

---

## 4. Testing (Required)

### Backend

* [x] Unit tests:

  * fixed, per_unit
  * tiered_per_unit (progressive)
  * volume_per_unit (band-all-units)
  * bundle with tiered overage
  * bundle with volume overage
  * setup_fee inclusion toggle
  * minimum_commit floor application
  * regional_prices selection
  * invalid currency/region

### Frontend (Playwright)

* [x] Region selector appears only when required
* [x] Currency selector changes totals
* [x] Setup fee toggle changes quote + breakdown
* [x] Minimum commit scenario displays applied floor
* [x] Volume pricing threshold changes total correctly

**Acceptance Criteria**

* [x] Tests pass headless in CI.
* [x] No real secrets used.

---

## Status

* 🟩 Done


# 7. Inventory Integration – Plan Selection Persistence

## Goal

Persist the selected pricing plan **directly inside the Ansible inventory**, so that:

* Deployment is deterministic
* No UI-only state exists
* The plan selection travels with ZIP export/import
* The CLI can operate without the Web UI

The selected plan MUST be stored per host and per application (role).

---

## 7.1 Storage Location in Inventory

The selected plan MUST be stored in:

```
host_vars/<host>.yml
```

Under the corresponding application (role) ID.

### Structure

```yaml
applications:
  web-app-nextcloud:
    plan_id: community
```

If a role has no pricing metadata, the implicit default is:

```yaml
plan_id: community
```

Where:

* `community`
* default pricing = 1 EUR per user
* default input: users = 1

Unless explicitly overridden by `pricing.yml`.

---

## 7.2 Full Example with Pricing Inputs

```yaml
applications:
  web-app-nextcloud:
    plan_id: business
    pricing:
      currency: EUR
      region: eu
      inputs:
        users: 25
```

Rules:

* `plan_id` is mandatory when the role is enabled.
* `pricing` block is optional.
* If `pricing` block is missing:

  * defaults apply from metadata.
* If `currency` is missing:

  * default currency from metadata.
* If `region` is missing:

  * defaults to `global`.

---

## 7.3 Disabled Roles

A role is considered disabled if:

* It is not present under `applications`, OR
* `plan_id` is explicitly set to `null`.

Example:

```yaml
applications:
  web-app-nextcloud:
    plan_id: null
```

UI interpretation:

* Dropdown shows "Disabled"
* No pricing calculation
* Role excluded from deployment

---

## 7.4 Backend Rules

When generating a pricing quote or preparing deployment:

1. Load role metadata (`pricing.yml`)
2. Read `plan_id` from `host_vars/<host>.yml`
3. Validate:

   * plan exists for selected offering
   * currency valid
   * region valid
   * inputs valid
4. Apply deterministic pricing engine

If validation fails:

* Deployment is blocked
* Clear validation error returned
* No silent fallback

---

## 7.5 Default Behavior (Global Rule)

For every role:

If:

* No `pricing.yml` exists
* OR no `plan_id` defined

Then:

```
plan_id = community
pricing.per_unit = 1 EUR
inputs.users = 1
```

This guarantees:

* Every role always has a valid pricing state
* No undefined plan scenario
* Fully deterministic behavior

---

## 7.6 Why Plan Is Stored in Inventory

This design ensures:

* Inventory is the single source of truth
* Plan selection survives ZIP export/import
* CLI and UI behave identically
* No hidden frontend state
* Deployment is reproducible

---

## 7.7 Acceptance Criteria

* [x] `plan_id` is stored per role under `applications.<role_id>`
* [x] UI dropdown reflects inventory state
* [x] Changing dropdown updates `host_vars/<host>.yml`
* [x] Removing a role removes its plan entry
* [x] Community default applies automatically if undefined
* [x] Pricing engine reads only from inventory + metadata

## UI Integration – Single Dropdown (Inventory-backed Plan Selection)

Each role tile contains **exactly one dropdown** that controls both **enabled/disabled** and the **selected plan**. The dropdown is **inventory-backed**: selecting an entry immediately updates `host_vars/<host>.yml` under `applications.<role_id>.plan_id`.

### Dropdown Entries

The dropdown list MUST contain:

* **Disabled**
* **Enabled – Community** *(default)*
* **Enabled – <Plan>** for every plan defined in `pricing.yml`
* *(optional, only if relevant)* **Enabled – <Plan> (REGION / CURRENCY)** if the role’s pricing metadata is region-aware and/or multi-currency and the UI exposes these as selectable presets.

### Default Behavior

If a role has no `pricing.yml` or no stored `plan_id`, the dropdown defaults to:

* **Enabled – Community**

With implicit defaults:

* `plan_id = community`
* `per_unit = 1 EUR / user`
* `users = 1`

unless overridden by `pricing.yml`.

### Inventory Write Rules

On selection, the UI MUST write:

* **Disabled**:

  * remove `applications.<role_id>` entirely **OR** set `plan_id: null`
* **Enabled – <Plan>**:

  * ensure role exists under `applications`
  * set `applications.<role_id>.plan_id: <plan_id>`

Example write:

```yaml
applications:
  web-app-nextcloud:
    plan_id: business
```

### Visual Label in Tile

The tile button label MUST always reflect the current state:

* `Disabled`
* `Community · Enabled`
* `<Plan Label> · Enabled`

### Acceptance Criteria

* [x] Dropdown is the only control for enable/disable and plan selection.
* [x] Selecting any entry updates `host_vars/<host>.yml` deterministically.
* [x] Reloading the UI restores dropdown state from inventory.
* [x] If `plan_id` missing, UI shows **Enabled – Community** by default.
