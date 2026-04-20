# Requirements 📋

When asked to work on one or more requirements, you MUST execute the following phases in order. You MUST NOT skip a phase.

## 1. Analysis 🔍

- You MUST enumerate every requirement file under `docs/requirements/` whose status in [Milestones.md](../../requirements/Milestones.md) is not `✅`, together with every acceptance criterion still marked `- [ ]` or `[~]`.
- You MUST read each open requirement file in full before producing any plan.
- You MUST list the open items back to the user as a concrete shortlist (file + criterion).
- You MUST ask clarifying questions for any criterion that is ambiguous, under-specified, or contradicts another requirement.
- You MUST listen actively: ask, wait for the answer, re-state your understanding, and only move on when the user confirms the criterion is clearly captured. You MUST NOT proceed on assumptions.

## 2. Refinement ✂️

- Where a criterion is too coarse to verify, you MUST add `- [ ]` checkbox sub-items in the requirement file so progress is harkable.
- Where a criterion is ambiguous, you MUST sharpen its wording in the requirement file until it is testable.
- Refinements MUST land in their own commit before implementation begins, so the scope of the implementation commit stays unambiguous. The commit itself MUST follow [commit.md](commit.md), including the user-confirmation rule.
- Every scope change MUST be reflected in the requirement file; you MUST NOT change scope silently.

## 3. Implementation 🛠️

- You MUST treat each unchecked criterion (`- [ ]`) as a discrete unit of work.
- You MUST follow [iteration.md](iteration.md) for the edit-deploy-validate loop.
- You MUST check off each criterion as soon as its behavior is verified end to end. You MUST NOT batch them. You MUST NOT skip unverified criteria.
- "Looks implemented" is NOT RECOMMENDED as a basis for ticking a criterion.

## 4. Verification ✅

- Every iteration MUST end with a green `make e2e-dashboard-local` run (see [iteration.md](iteration.md)).
- A criterion MUST NOT be flipped to `- [x]` until that run is green on the final state.
- On failure, you MUST return to Implementation. You MUST NOT mark unrelated criteria done if they share the failing code path.

## Definition of Done 🏁

A requirement is done when ALL of the following hold:

- All criteria are checked (`- [x]`).
- `make e2e-dashboard-local` passes on the final state.
- Changes are committed and the PR references the requirement file.
