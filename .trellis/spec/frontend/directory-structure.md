# Frontend Directory Structure

## Layout

```text
src/web/
├── main.tsx             # Browser bootstrap only
├── App.tsx              # Current foundation shell
├── styles.css           # Current global tokens/base styles
├── pages/               # Route-level page modules when routing begins
├── features/            # Thesis, changes, health and admin feature UI
└── components/          # Reused presentational UI after a second use exists
```

Create future folders lazily. The current real examples are `src/web/main.tsx`, `src/web/App.tsx` and `src/web/styles.css`.

## Boundaries

- `main.tsx` only mounts React.
- Pages consume PageModel types, not D1 rows or external-source shapes.
- Research calculations stay in the Worker Evaluation module.
- A feature owns its page-specific components; move to `components` only after actual reuse.

## Naming

- React components: PascalCase files and exports.
- Hooks: `useX` in camelCase files once a real hook exists.
- CSS classes: descriptive kebab-case; state class names reflect semantics, not raw colors.
