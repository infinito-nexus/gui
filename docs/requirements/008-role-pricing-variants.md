# Role Pricing & Variants (Meta-driven, UI-integrated)

## Goal

Enable **provider-specific software variants and pricing models** (e.g. Community, Enterprise, Tier-based)
to be **declared in Ansible roles**, automatically **indexed by the backend**, and **selectable & calculable in the UI**.

The system must be **data-driven, deterministic, secure**, and **not execute arbitrary vendor JavaScript**.

---

## 1. Role-side Metadata (Ansible)

### 1.1 Pricing Metadata File

* [x] Roles MAY provide pricing metadata via a dedicated file:

  * `roles/*/meta/pricing.yml` (preferred)
  * or `pricing.json`

* [x] `meta/main.yml` MAY reference pricing explicitly:

  ```yaml
  galaxy_info:
    pricing:
      schema: v1
      file: meta/pricing.yml
````

* [x] Roles without pricing metadata default to:

  * Single implicit variant: `community`
  * Price: `0`
  * No UI inputs

**Acceptance Criteria**

* [x] Roles without pricing metadata continue to work unchanged
* [x] Pricing metadata is optional and non-breaking

---

### 1.2 Supported Pricing Model Primitives

The pricing schema MUST support at least:

* [x] `fixed` (free or flat price)
* [x] `per_unit` (e.g. per user)
* [x] `tiered_per_unit`
* [x] `bundle` (base fee + usage)
* [x] `addon`
* [x] `factor` (support level multipliers)
* [x] `custom` (contact sales / external pricing)

**Acceptance Criteria**

* [x] All primitives are declarative (no executable code)
* [x] All primitives are versioned under a schema (`schema: v1`)

---

### 1.3 Inputs & Applicability

* [x] Pricing metadata MAY define user inputs:

  * number
  * enum
  * boolean

* [x] Inputs can be scoped via `applies_to` to specific variants

* [x] Defaults are mandatory for all inputs

**Acceptance Criteria**

* [x] UI never renders an input without a default
* [x] Inputs are only shown when relevant to the selected variant

---

## 2. Backend API (Pricing Index & Calculation)

### 2.1 Pricing Metadata Indexing

* [x] Extend role indexing to detect and parse pricing metadata
* [x] Validate pricing files against a strict schema
* [x] Invalid pricing metadata:

  * is ignored
  * emits a warning
  * does NOT break role indexing

**Acceptance Criteria**

* [x] `/api/roles` includes `pricing_summary` when available
* [x] `/api/roles/{id}` includes full `pricing` block when present

---

### 2.2 Pricing Calculation Engine

* [x] Implement a deterministic **PricingEngine** (backend-side)

* [x] Engine accepts:

  * role_id
  * selected variant
  * input values

* [x] Engine returns:

  * total price
  * breakdown (base, addons, factors)
  * unit price (if applicable)
  * interval (month/year/once)

**Acceptance Criteria**

* [x] Same input always produces same output
* [x] No pricing logic exists in the frontend
* [x] Engine is fully unit-tested

---

## 3. Web UI (Variant Selection & Pricing Preview)

### 3.1 Variant Selection

* [x] Replace simple “Select” button with:

  * Variant selector (radio / dropdown)
  * Default: `community`

* [x] Variant label + description are shown inline

**Acceptance Criteria**

* [x] Roles with one variant behave exactly like today
* [x] Variant switching does not reset unrelated UI state

---

### 3.2 Dynamic Inputs

* [x] Render pricing inputs dynamically based on metadata
* [x] Inputs update pricing preview live
* [x] Inputs are validated client-side (type, min/max)

**Acceptance Criteria**

* [x] Invalid input never reaches the backend
* [x] UI always reflects the currently selected variant

---

### 3.3 Pricing Preview

* [x] Show pricing preview panel:

  * Total price
  * Interval (monthly/yearly/once)
  * Optional breakdown (toggleable)

* [x] Support “Contact sales” state for custom pricing

**Acceptance Criteria**

* [x] Pricing preview is clearly marked as *estimate*
* [x] Zero-price variants explicitly show “Free”

---

## 4. Security & Trust Model

* [x] No arbitrary JavaScript is executed from roles
* [x] Pricing metadata is treated as untrusted input
* [x] Strict schema validation is mandatory

**Acceptance Criteria**

* [x] Pricing metadata cannot inject scripts or HTML
* [x] CSP does not require relaxation for pricing features

---

## 5. Testing (Required)

### Backend

* [x] Unit tests for PricingEngine:

  * fixed
  * per_unit
  * tiered
  * addons
  * factors
  * edge cases (0, min, max)

### Frontend (Playwright)

* [x] Variant selector renders correctly
* [x] Inputs appear/disappear on variant change
* [x] Pricing preview updates on input change
* [x] “Contact sales” variant disables calculation

**Acceptance Criteria**

* [x] All pricing logic is covered by automated tests
* [x] Tests pass headless in CI

---

## 6. UX Principles

* [x] Community / Free is always the least prominent upsell
* [x] Enterprise pricing never blocks deployment
* [x] Pricing UI never forces a purchase flow

**Acceptance Criteria**

* [x] Users can deploy Community without friction
* [x] Pricing is informative, not coercive

---

## Status

* 🟩 Done
