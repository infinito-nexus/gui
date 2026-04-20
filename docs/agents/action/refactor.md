# Refactoring and Optimization 🔧

## Trigger ❓

After every commit you MUST ask the user:

> "Do you want to refactor and optimize the affected files?"

- If the answer is **no**, you MUST continue without refactoring.
- If the answer is **yes**, you MUST follow the steps below.

## Steps 🪜

1. You MUST re-read `AGENTS.md` and follow all instructions in it.
2. You MUST apply all rules from `AGENTS.md` and `docs/contributing/` to every affected file — code, documentation, naming, structure, and any other applicable guideline.
3. For every affected documentation file, you MUST apply [documentation.md](../../contributing/documentation.md) (RFC 2119 keywords, link formatting, writing style).
4. If the change affects a major component (`apps/api/`, `apps/web/`, or shared test infrastructure), you MUST refactor the entire component, not only the modified files.
   - If more than one component is affected, you MUST ask the user first:
     > "The following components are affected: [list]. Which components should be refactored — specific ones, or all?"
   - You MUST refactor only the components confirmed by the user.
