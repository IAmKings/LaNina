# Frontend Development Guidelines

The frontend is a React SPA built by Vite and deployed in the same Cloudflare Worker unit as the backend. It renders typed Read Models and never derives research judgments from raw data.

## Guidelines Index

| Guide | Owns | Status |
|---|---|---|
| [Directory Structure](./directory-structure.md) | Page, feature and shared UI placement | Active |
| [Component Guidelines](./component-guidelines.md) | Composition, props, CSS and accessibility | Active |
| [Hook Guidelines](./hook-guidelines.md) | Effects and future server-data hooks | Active |
| [State Management](./state-management.md) | Local, URL and server state | Active |
| [Type Safety](./type-safety.md) | Read Models, unknown input and nulls | Active |
| [Quality Guidelines](./quality-guidelines.md) | Tests, performance and review | Active |

## Pre-Development Checklist

1. Read `type-safety.md` before adding/changing a backend response.
2. Read `state-management.md` before adding a store or caching dependency.
3. Read `component-guidelines.md` for every reusable UI or chart.
4. Read `quality-guidelines.md` before implementing a page acceptance criterion.
5. Read the shared cross-layer guide when data crosses source → D1 → API → UI.
