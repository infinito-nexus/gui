# Documentation 📝

## Comments 💬

- You SHOULD write code so it is logical and self-explanatory and usually does not need comments.
- You MUST add code comments only when an exception, edge case, or surprising decision would otherwise confuse readers.
- You MUST use comments to explain why something is unusual, not to restate what obvious code already does.
- When keeping an intentionally retained outdated version pin, you MUST document the exception at the pin site with a local `TODO` comment and explain why it remains pinned.

## Requirement Keywords (RFC 2119) 📋

You MUST use [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) keywords in all documentation to express requirement levels unambiguously:

| Keyword | Meaning |
|---|---|
| `MUST` / `REQUIRED` / `SHALL` | Absolute requirement — no deviation allowed. |
| `MUST NOT` / `SHALL NOT` | Absolute prohibition — never do this. |
| `SHOULD` / `RECOMMENDED` | Strongly recommended — deviation requires justification. |
| `SHOULD NOT` / `NOT RECOMMENDED` | Strongly discouraged — allowed only with justification. |
| `MAY` / `OPTIONAL` | Permitted but not required. |

## Links 🔗

- You MUST NOT use the full URL as link text. Use the domain name, `here`, or the filename instead — never the full path.
- After `See`, you MUST use the domain name as link text, not `here`. `here` is only acceptable when the surrounding sentence reads naturally with it.
- For communication links such as Matrix, email, or phone, you MUST show only the value itself as link text.

| Type | MUST NOT | MUST |
|---|---|---|
| Web link | `https://example.com/page` | `example.com`, `here`, a descriptive label, or `page.md` |
| File link | `docs/contributing/flow/workflow.md` | `workflow.md` or `Contribution Flow` |
| Email | `mailto:hello@example.com` | `hello@example.com` |

## Semantics and Writing ✍️

- You MUST keep code and comments in English.
- You MUST fix nearby wording and semantic issues when you touch a file.
- You SHOULD use emojis when they make the text more visually appealing and improve readability.

## Headlines 🏷️

- You SHOULD place emojis after the headline text to visually highlight headings and improve scannability.
- You MUST NOT place emojis before the headline text.

## Documentation Structure 🗂️

- You SHOULD prefer `README.md` for directory-level documentation when a human-facing entry point already exists.
- You MUST keep core information inside the repository, either in code or in `.md` files.
- You MUST use `.md` files for commands, workflows, setup, and contributor guidance.
- When more than one document can describe the same workflow, command family, or policy, one file MUST be declared the SPOT and the other documents MUST summarize only the minimum context and link back to that SPOT.
- Supporting documents MUST NOT redefine requirement levels that belong to another page's SPOT unless they repeat the same wording and link back to that SPOT.
- A document MUST NOT self-declare as `SPOT` (or `Single Point of Truth`). The canonical-reference role MUST emerge implicitly from how other documents link to it, not from a label the document gives itself. Other documents MAY explicitly point out that the SPOT lies elsewhere (e.g. `X.md is the SPOT for …`); cross-pointing is the allowed form.
- You MUST NOT use `.md` files to describe implementation logic that is already visible in the code.
- You MUST keep cross-links between `.md` files up to date so readers can navigate between related pages.
