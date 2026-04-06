# 010 - Devices – Provider Integration, Mode Switch & Order Flow

## User Story

As a user, I want to order and configure servers through Customer (guided), Expert (comparison), or Developer (manual) modes with IONOS, Hetzner, and OVHcloud integration so that I can provision infrastructure and persist all configuration directly into the workspace inventory.

## Acceptance Criteria

- [x] A mode selector (Customer / Expert / Developer) is available in the Devices section, similar to Software mode.
- [x] Mode selection is persisted per workspace.
- [x] Switching mode does not delete or alter existing devices.
- [x] Developer mode preserves the current manual device entry behaviour exactly (identity, host, port, user, status, actions).
- [x] Existing inventories remain fully compatible; no regressions in Developer mode.
- [x] **Customer mode** exposes only: Server Type (default: VPS), Storage (default: 200 GB), Location (default: Germany), optional Provider (default: Auto), optional budget cap.
- [x] Customer mode allows server ordering with ≤ 3 required inputs; defaults are visible and editable.
- [x] Customer mode shows 3–5 best-match result cards, each displaying: Provider, Region, CPU/RAM/Storage, monthly price + currency, and an Order button.
- [x] Results in Customer mode are based on cached normalized provider offers; no live provider API calls occur during filtering.
- [x] **Expert mode** supports multi-filter comparison with: Provider multi-select, Product type (VPS/Dedicated/Managed), Region, CPU min, RAM min, Storage min, Storage type (SSD/NVMe/HDD), Traffic (optional), Price range + currency, IPv4 included, backups, snapshots toggles.
- [x] Expert mode displays results in a table with columns: Provider, Plan name, Region, Specs, Monthly price, Order button; sortable by Price, RAM, CPU.
- [x] Expert mode filtering is client-side on cached data; sorting does not trigger provider API calls.
- [x] UI filtering never triggers provisioning; provisioning only occurs on explicit user confirmation.
- [x] Before provisioning, a confirmation summary is shown: Provider, Region, Specs, Monthly estimate, Device identity.
- [x] The backend calls the provider API, creates the server, and returns server_id and public IP/hostname.
- [x] The ordered server appears automatically as a device entry in the Devices table after provisioning.
- [x] Provisioning errors return actionable messages; no secrets are exposed in logs.
- [x] All provider offers are normalized to a common model (provider, product_type, offer_id, name, region, location_label, cpu_cores, ram_gb, storage, network, pricing, metadata).
- [x] Missing fields in normalized offers never break the UI.
- [x] All providers (IONOS, Hetzner, OVHcloud) are comparable using the same filters.
- [x] Catalog sync runs periodically every 12–24 hours; cached under `${STATE_DIR}/cache/provider_offers.json` or DB.
- [x] When the catalog is stale, a "Catalog may be outdated" banner is shown.
- [x] Expert filtering works even when provider APIs are down (operates on cached data).
- [x] Sync failures do not break the UI.
- [x] The Catalog Layer (sync + normalize + cache) and Provisioning Layer (create on explicit action) are strictly separated.
- [x] Each device/server can optionally define one Primary Domain stored as `DOMAIN_PRIMARY` in `host_vars/<host>.yml`.
- [x] `DOMAIN_PRIMARY` is optional and does not block deployment.
- [x] `DOMAIN_PRIMARY` works in all three modes (Customer, Expert, Developer).
- [x] ZIP export contains `DOMAIN_PRIMARY`; clearing the field removes or nulls the key.
- [x] No provider secrets (API keys, tokens) are written into the inventory (`host_vars` or `group_vars`).
- [x] When a server is ordered, `ansible_host`, `ansible_user`, `ansible_port`, and `infinito.device` (provider, server_id, region) are written to the inventory.
- [x] Domain ordering is optional, provider-dependent, and never auto-assigns without explicit user confirmation.
- [x] Backend catalog endpoints: `GET /api/providers`, `GET /api/providers/offers`.
- [x] Backend provisioning endpoints: `POST /api/providers/order/server`, optional `POST /api/providers/order/domain`, optional `POST /api/providers/dns/zone`.
- [x] Playwright test (Customer): defaults are visible; ordering flow works with mocked provider.
- [x] Playwright test (Expert): filters are deterministic; sorting works on cached data.
- [x] Playwright test (Developer): manual device logic unchanged.
- [x] Playwright test (Primary Domain): setting writes `DOMAIN_PRIMARY`; clearing removes it.
- [x] Tests run headless with no real provider credentials.
