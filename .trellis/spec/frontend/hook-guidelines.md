# React Hook Guidelines

## Current Pattern

Use built-in React hooks. The foundation uses `useEffect` + `AbortController` for one health request in `src/web/App.tsx`; no custom hook or server-state library exists yet.

## Rules

- Abort fetches during cleanup.
- Treat non-2xx responses as failures before decoding.
- Narrow `unknown` errors; never assume every error is an `Error`.
- Use a custom hook only when stateful behavior has a second consumer or a page would otherwise mix multiple concerns.
- Do not add React Query/SWR until caching, retries or invalidation are needed by multiple real pages.

## Data Fetching Boundary

Backend responses are decoded/projected once. Components consume typed Page Models; they do not cast repeated raw fields. Date formatting belongs in one presentation helper after the second call site exists.

## Current Example

`src/web/App.tsx` aborts `/api/v1/healthz` on unmount and ignores only the AbortError path.
