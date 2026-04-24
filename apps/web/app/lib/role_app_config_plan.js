function asTrimmedPlan(value) {
  return String(value ?? "").trim();
}

export function resolvePersistedRolePlanId(selectedPlanId, defaultPlanId) {
  const selected = asTrimmedPlan(selectedPlanId);
  if (!selected) return null;
  const fallback = asTrimmedPlan(defaultPlanId) || "community";
  return selected === fallback ? null : selected;
}
