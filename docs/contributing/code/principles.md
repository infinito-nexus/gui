# Code Principles

Use these principles when you change repository code, scripts, or automation.

## Principles

Follow these principles. Keep the rule column short, imperative, and as [SMART](https://en.wikipedia.org/wiki/SMART_criteria) as practical; use the reason column for the rationale, the principle column for the linked source name, and put the expanded wording in the details column.

| Rule | Reason | Principle | Details |
|---|---|---|---|
| Consolidate duplicate logic before merging. | Duplicate behavior is easier to keep consistent. | [DRY](https://en.wikipedia.org/wiki/Don%27t_repeat_yourself) | Keep one implementation for each behavior and remove repeated logic from the touched files. |
| Leave touched code cleaner than you found it. | Small cleanup reduces future friction. | [Boy Scout Rule](https://en.wikipedia.org/wiki/Leaving_the_world_a_better_place) | Make small, safe cleanup improvements in the files you touch when they reduce friction without expanding the scope unnecessarily. |
| Store each shared value once. | Shared values drift when copied. | [SPOT](https://en.wikipedia.org/wiki/Single_source_of_truth) | Put shared fixed values in one canonical source and reference them everywhere else. |
| Choose the simplest solution. | Simple code is easier to change. | [KISS](https://en.wikipedia.org/wiki/KISS_principle) | Prefer the smallest implementation that still satisfies the requirement and remains easy to maintain. |
| Make prompts SMART. | Clear prompts reduce ambiguity. | [SMART](https://en.wikipedia.org/wiki/SMART_criteria) | Write prompts that are specific, measurable, achievable, relevant, and time-bound so the agent can act on them without ambiguity. |
| Ship the first valuable increment early. | Early value shortens feedback loops. | [Agile Manifesto](https://agilemanifesto.org/) | Deliver working software as soon as it is useful and keep delivering value continuously. |
| Write the failing test first. | Failing tests confirm requirements first. | [TDD](https://en.wikipedia.org/wiki/Test-driven_development) | Start with a failing test, implement the minimum code, and refactor with confidence. |
| Prefer beautiful code. | Readable code is easier to trust. | [Zen of Python](https://en.wikipedia.org/wiki/Zen_of_Python) | Choose code that is clean, coherent, and pleasant to read instead of code that is only clever. |
| Prefer explicit behavior. | Explicit behavior is easier to reason about. | [Zen of Python](https://en.wikipedia.org/wiki/Zen_of_Python) | Make behavior visible in the code instead of relying on hidden assumptions. |
| Mark intentional exceptions. | Exceptions need context. | [Zen of Python](https://en.wikipedia.org/wiki/Zen_of_Python) | Document intentional exceptions close to the relevant code so they stay visible until they can be removed. |
| Prefer simple code. | Simple code changes more safely. | [Zen of Python](https://en.wikipedia.org/wiki/Zen_of_Python) | Choose the simplest solution that still does the job. |
| Prefer flat structures. | Shallow structures are easier to scan. | [Zen of Python](https://en.wikipedia.org/wiki/Zen_of_Python) | Keep control flow and data structures shallow when a flatter shape works. |
| Make code readable. | Readable code speeds review and debugging. | [Zen of Python](https://en.wikipedia.org/wiki/Zen_of_Python) | Write code so the next person can understand it quickly. |
| Fail loudly on errors. | Hidden failures cause harder incidents later. | [Zen of Python](https://en.wikipedia.org/wiki/Zen_of_Python) | Do not let unexpected errors disappear unnoticed. |
| Refuse to guess in ambiguity. | Clarification is safer than guessing. | [Zen of Python](https://en.wikipedia.org/wiki/Zen_of_Python) | Stop and clarify when the inputs or intent are unclear. |
| Keep hard code easy to explain. | Hard-to-explain code often hides flaws. | [Zen of Python](https://en.wikipedia.org/wiki/Zen_of_Python) | If the code is hard to explain, rework it before merging. |

For code quality rules, see [Lint](tests/lint.md).
