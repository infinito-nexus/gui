<< START: project/items/Devices_Provider_Mode_And_Order_Flow.md >>

# Devices – Provider Integration, Mode Switch (Customer / Expert / Developer) & Order Flow

## Goal

Extend the **Devices** section to support:

* **Customer mode** → guided server ordering (minimal inputs, sensible defaults)
* **Expert mode** → comparison portal with filters across providers
* **Developer mode** → existing manual device configuration logic (unchanged)

Support integration with:

* IONOS
* Hetzner
* OVHcloud
* Optional later: AWS, Azure

Additionally:

* Allow ordering of servers
* Optionally allow domain ordering and DNS setup
* Allow assigning an optional **Primary Domain per server**
* Persist all resulting configuration into the workspace inventory

The system MUST be deterministic, cache-backed, and not depend on live provider calls for UI filtering.

---

# 1. UI: Mode Switch in Devices

## 1.1 Mode Selector

Add a mode selector in **Devices**, similar to Software mode:

* Customer
* Expert
* Developer

Default behavior:

* Customer mode for non-technical users
* Developer mode preserves current behavior
* Mode selection persisted per workspace

**Acceptance Criteria**

* Switching mode does not delete or alter existing devices.
* Developer mode behaves exactly like today.

---

# 2. Customer Mode – Guided Server Ordering

## 2.1 Minimal Inputs

Expose only:

* Server Type (default: VPS)
* Storage (default: 200 GB)
* Location (default: Germany)
* Optional Provider:

  * Default: Auto (best match across providers)

Optional:

* Budget cap

**Acceptance Criteria**

* Server ordering possible with ≤ 3 inputs.
* Defaults are visible and editable.

---

## 2.2 Best Match Results

Display 3–5 best matches:

Each card shows:

* Provider
* Region
* CPU / RAM / Storage
* Monthly price + currency
* “Order” button

**Acceptance Criteria**

* Results are based on cached normalized offers.
* No live provider API calls during filtering.

---

# 3. Expert Mode – Comparison Portal

## 3.1 Filters

* Provider multi-select
* Product type (VPS/Dedicated/Managed)
* Region
* CPU min
* RAM min
* Storage min
* Storage type (SSD/NVMe/HDD)
* Traffic (optional)
* Price range + currency
* Feature toggles:

  * IPv4 included
  * backups
  * snapshots

## 3.2 Results Table

Table columns:

* Provider
* Plan name
* Region
* Specs
* Monthly price
* “Order” button

Sortable by:

* Price
* RAM
* CPU

**Acceptance Criteria**

* Filtering is client-side on cached data.
* Sorting does not trigger provider API calls.

---

# 4. Developer Mode – Existing Manual Logic

Preserve current behavior:

Manual device entry:

* identity
* host
* port
* user
* status
* actions

No provider dependency.

**Acceptance Criteria**

* Existing inventories remain fully compatible.
* No regressions in current functionality.

---

# 5. Provider Integration Architecture

## 5.1 Separation of Concerns

Two layers:

### Catalog Layer

* Sync offers periodically
* Normalize into common model
* Cache locally

### Provisioning Layer

* Create server on explicit user action
* Requires provider credentials
* Returns device metadata

**Acceptance Criteria**

* UI filtering never triggers provisioning.
* Provisioning only on explicit confirmation.

---

# 6. Normalized Offer Model

All provider offers normalized to:

```yaml
provider: hetzner|ionos|ovh|aws|azure
product_type: vps|dedicated|managed
offer_id: "<provider-id>"
name: "<display>"
region: "fsn1"
location_label: "Germany"
cpu_cores: 4
ram_gb: 8
storage:
  gb: 200
  type: nvme
network:
  ipv4_included: true
  traffic_included_gb: 20000
pricing:
  interval: month
  currency: EUR
  monthly_total: 12.99
metadata:
  updated_at: "<timestamp>"
```

**Acceptance Criteria**

* Missing fields never break UI.
* All providers comparable using same filters.

---

# 7. Catalog Sync & Caching

* Periodic sync every 12–24h
* Cached under `${STATE_DIR}/cache/provider_offers.json` or DB

If stale:

* Show “Catalog may be outdated” banner.

**Acceptance Criteria**

* Expert filtering works even if provider APIs are down.
* Sync failures do not break UI.

---

# 8. Server Ordering Flow

## 8.1 Confirmation

Before provisioning:

Show summary:

* Provider
* Region
* Specs
* Monthly estimate
* Device identity

Require explicit confirmation.

## 8.2 Provision

Backend:

* Calls provider API
* Creates server
* Returns:

  * server_id
  * public IP / hostname

## 8.3 Post-Provision

Create device entry automatically in Devices table.

**Acceptance Criteria**

* Ordered server appears as device automatically.
* Errors return actionable messages.
* No secrets exposed in logs.

---

# 9. Domain Support (Optional)

Domains are optional and provider-dependent.

## 9.1 Customer Mode

* Optional “Add Domain” checkbox
* Register new OR attach existing domain

## 9.2 Expert Mode

* Compare domain pricing (if available)
* Create DNS zone
* Add A/AAAA records

Domain ordering NEVER auto-assigns without confirmation.

---

# 10. Per-Server Primary Domain (All Modes)

## 10.1 Goal

Each server/device can optionally define **one Primary Domain**.

Available in:

* Customer mode
* Expert mode
* Developer mode

## 10.2 UI

Each device row includes:

* Optional field: **Primary Domain**

Empty → no domain assigned.

## 10.3 Inventory Persistence

If set:

Write to:

```text
host_vars/<host>.yml
```

Example:

```yaml
DOMAIN_PRIMARY: "example.org"
```

If removed:

* `DOMAIN_PRIMARY` removed or set to null.

**Acceptance Criteria**

* DOMAIN_PRIMARY optional.
* Does not block deployment.
* Works in all modes.
* ZIP export contains DOMAIN_PRIMARY.
* No provider secrets written to inventory.

---

# 11. Inventory Integration

When server ordered:

Update:

```yaml
ansible_host: 203.0.113.10
ansible_user: root
ansible_port: 22

infinito:
  device:
    provider: hetzner
    server_id: "123456"
    region: "fsn1"
```

Secrets never written into host_vars.

---

# 12. Backend APIs

## Catalog

* GET /api/providers
* GET /api/providers/offers

## Provisioning

* POST /api/providers/order/server
* POST /api/providers/order/domain (optional)
* POST /api/providers/dns/zone (optional)

All provisioning requires explicit confirmation.

---

# 13. UI Tests (Playwright Required)

Customer:

* Defaults visible
* Ordering flow mocked

Expert:

* Filters deterministic
* Sorting works

Developer:

* Manual device logic unchanged

Primary Domain:

* Setting writes DOMAIN_PRIMARY
* Clearing removes it

Tests run headless, no real provider credentials.

---

# Status

🟩 Done
