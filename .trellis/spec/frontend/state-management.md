# Frontend State Management

## State Categories

- Component state: local interaction/loading status via React state.
- URL state: shareable category/filter/time-range choices.
- Server state: returned by page-level API requests and HTTP cache semantics.
- Domain state: stages, direction, confidence and freshness are computed by the Worker, never by React.

## Current Decision

No global store. The current `HealthState` discriminated union in `src/web/App.tsx` is the reference for local async state.

Add a server-state dependency only after at least two pages need shared invalidation, deduplication or retries that HTTP caching and a small hook cannot handle.

## Forbidden Patterns

- Mirroring the same server response in multiple global/local stores.
- Separate `isLoading`, `isError` and nullable data flags that permit impossible combinations.
- Calculating research direction or confidence in the browser.
- Keeping shareable filters only in component memory.
