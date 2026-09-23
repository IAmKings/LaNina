# Frontend Quality Guidelines

## Required Checks

- ESLint and strict TypeScript pass.
- Unit tests cover non-trivial state and response branches.
- Page work includes loading, empty, stale and error behavior.
- Manual viewport checks: 360×800, 768×1024, 1280×800.
- Keyboard navigation and WCAG AA contrast are verified.
- Initial JS remains under the PRD budget; charts load lazily.

## Review Checklist

- UI uses the shared domain vocabulary from `CONTEXT.md`.
- Every public fact shows source and observation/publication/fetch times where required.
- Evidence and counterevidence have equal structural access.
- Missing values are not rendered as zero.
- Draft/private fields cannot be reached from public requests.
- One page uses one Read Model request instead of card-level N+1 calls.

## Forbidden Patterns

- Misleading dual-axis charts.
- Color-only status communication.
- Direct fetches to third-party data sources from the browser.
- Adding a UI library, router or state manager before an accepted requirement needs it.

## Current Tests

- `src/domain/contracts.test.ts` locks stage/direction values.
- `src/worker/index.test.ts` locks the initial public health/error envelope consumed by the SPA.
