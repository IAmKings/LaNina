# React Component Guidelines

## Components

Use named function components and explicit props. Keep data fetching/state at the nearest page/feature owner and keep leaf components presentational.

Current example:

```tsx
function HealthBadge({ health }: { health: HealthState }) {
  if (health.status === "loading") return <span className="badge pending">检查中</span>;
  if (health.status === "error") return <span className="badge error">接口异常</span>;
  return <span className="badge healthy">正常 · {health.data.environment}</span>;
}
```

Use discriminated unions for loading/ready/error rather than parallel booleans.

## Styling

- Plain CSS and design tokens first; do not add a styling framework for the MVP.
- Mobile-first layouts; verify 360, 768 and 1280px.
- Direction/health colors always include text or icons.
- ECharts is dynamically imported only on chart pages when that task begins.

## Accessibility

- Prefer semantic `main`, `header`, `section`, headings and native controls.
- Every section has a programmatic heading.
- Keyboard access and WCAG AA contrast are release requirements.
- Charts require a text summary or data table.

## Common Mistakes

- Do not turn each card into a separate fetch.
- Do not put domain calculations in render functions.
- Do not create a generic component with speculative variants before a second use exists.
