# Frontend Type Safety

## Type Ownership

- Cross-layer response envelopes and business enums live in `src/domain/contracts.ts`.
- Page-specific view types live with their Read Model contract.
- Component-only props live next to the component.
- Database rows and source payload types never enter `src/web`.

## Validation

TypeScript types do not validate network JSON. Until a reusable runtime decoder exists, only consume same-origin Worker responses whose route has contract tests; external data is validated in backend source adapters.

When a public response becomes independently consumed or version-skewed, add one runtime decoder at the fetch boundary rather than assertions in components.

## Required Patterns

- Strict TypeScript.
- `unknown` at untrusted error/data boundaries.
- Discriminated unions for async/view states.
- Explicit `null` for known absent API fields; do not overload missing properties.
- Shared literal arrays derive union types, as in `THESIS_STAGES`.

## Forbidden Patterns

- `any` or double assertions.
- Duplicating stage/direction string unions.
- Casting the same raw API field in multiple components.
- Parsing UTC strings into local dates and serializing them back as if unchanged.
