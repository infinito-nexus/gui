import test from "node:test";
import assert from "node:assert/strict";

import { resolvePersistedRolePlanId } from "../../../apps/web/app/lib/role_app_config_plan.js";

test("omits persisted plan id when selected plan matches the role default", () => {
  assert.equal(resolvePersistedRolePlanId("community", "community"), null);
  assert.equal(resolvePersistedRolePlanId("starter", "starter"), null);
});

test("persists a non-default plan id", () => {
  assert.equal(resolvePersistedRolePlanId("pro", "community"), "pro");
  assert.equal(resolvePersistedRolePlanId("community", "starter"), "community");
});

test("returns null when no plan id is selected", () => {
  assert.equal(resolvePersistedRolePlanId("", "community"), null);
  assert.equal(resolvePersistedRolePlanId(null, "community"), null);
});
