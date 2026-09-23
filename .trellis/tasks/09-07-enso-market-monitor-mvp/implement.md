# Implementation Plan — ENSO 市场影响监测平台 MVP

## Planning State

This parent task coordinates five child tasks and is not an implementation target. After the user approves this plan, start `09-07-platform-foundation`, not the parent.

## Ordered Child Plan

- [ ] 1. Finish or validate `00-bootstrap-guidelines`; ensure backend/frontend indexes contain usable project conventions.
- [ ] 2. Start and complete `09-07-platform-foundation`.
- [ ] 3. Freeze normalized observation, source result, thesis evaluation and Read Model contracts.
- [ ] 4. Start `09-07-source-ingestion`; complete core climate/region/Panama path before secondary market adapters.
- [ ] 5. Start `09-07-thesis-evaluation-publishing` after normalized fixtures exist.
- [ ] 6. Start `09-07-web-and-admin` once Read Model examples and publication semantics are frozen; static visual work may begin earlier only if it does not create product code conflicts.
- [ ] 7. Start `09-07-release-quality` after the prior four children pass their local quality gates.
- [ ] 8. Run parent cross-child acceptance AC-01 through AC-15.
- [ ] 9. Update project specs with conventions learned from the first production implementation.
- [ ] 10. Commit/archive children, then archive the parent.

## Review Gates

### Gate 0 — Before any product code

- Git repository decision completed and repository initialized if approved by the implementation task.
- Trellis bootstrap guidelines no longer contain unresolved placeholders relevant to TypeScript/Workers/React.
- Package manager and Node runtime pinned.
- User has approved this planning summary.

### Gate 1 — Contract freeze

- D1 migration shape reviewed against product PRD §9.
- SourceAdapter fixtures prove normal, unchanged and invalid payloads.
- Read Model examples include null, stale, revision and unpublished cases.
- China/UTC date round-trip tests specified.

### Gate 2 — Vertical slice

Before adding all sources, one vertical slice must work:

```text
NOAA fixture → ingest → D1/R2 → ENSO evaluation draft
→ publish → /api/v1/overview → homepage card
```

Do not multiply adapters until this path passes locally and in staging.

### Gate 3 — Domain coverage

- Natural rubber, palm/maize, US East and Europe each have one complete factual path.
- Missing commercial data visibly caps confidence instead of being silently omitted.
- Panama contradictory-announcement scenario passes.

### Gate 4 — Release candidate

- All child checks pass.
- Source licensing register reviewed.
- Production spend choice made explicitly.
- Staging daily flow succeeds for three consecutive days.

## Expected Validation Commands

The platform child may adjust script names, but it must preserve equivalent commands:

```bash
npm run lint
npm run typecheck
npm test
npm run test:contract
npm run test:e2e
npm run build
npx wrangler d1 migrations apply enso-monitor-local --local
npx wrangler dev
```

Before production:

```bash
npx wrangler versions list
npx wrangler deploy --env staging
npx wrangler d1 migrations list enso-monitor-prod --remote
```

Production mutation/deploy commands require the release gate and explicit account authorization.

## Rollback Points

- After platform scaffold: revert product files without touching research/PRD/Trellis artifacts.
- After each migration: prefer forward-fix in staging；do not deploy destructive migrations.
- After each source adapter: disable the source row before changing shared ingestion.
- After evaluation changes: keep previous methodology version and published thesis version.
- After frontend/API deployment: use Cloudflare Worker version rollback.

## Scope Control

The following requests create follow-up tasks rather than expanding a child: paid subscriptions, AIS, user accounts, AI-generated publication, new commodities, native mobile, or infrastructure outside Cloudflare.
