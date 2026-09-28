import { Router, type RouteDefinition } from "../http/router";
import { atomFeedRoute, healthzRoute, robotsRoute, sitemapRoute } from "./discovery";
import {
  categoryRoute,
  changesRoute,
  dataHealthRoute,
  indicatorSeriesRoute,
  methodologyRoute,
  overviewRoute,
  publicDailyBriefRoute,
  thesisRoute,
  thesesRoute,
} from "./public";
import {
  adminDailyBriefPublishRoute,
  adminDailyBriefRoute,
  adminDraftRoute,
  adminRunsRoute,
  manualSourceRunRoute,
  administrativeDraftEditRoute,
  thesisEvaluateRoute,
  thesisPublishRoute,
  thesisReviewRoute,
  thesisWithdrawRoute,
} from "./admin";

/**
 * The Worker's complete route table — 24 entries covering every public and administrative route.
 * Public param shapes with their own charset constraints (thesis slug, market category, source id)
 * are encoded directly in the named group; admin ids keep the loose `[^/]+` shape so an invalid id
 * still reaches the route's own authentication + validation sequence and produces its historical
 * status/copy.
 */
export function createWorkerRouter(): Router {
  const routes: readonly RouteDefinition[] = [
    // discovery
    { method: "GET", pattern: "/sitemap.xml", handler: sitemapRoute },
    { method: "GET", pattern: "/robots.txt", handler: robotsRoute },
    { method: "GET", pattern: "/api/v1/healthz", handler: healthzRoute },
    { method: "GET", pattern: "/feed.xml", handler: atomFeedRoute },
    // public read models
    { method: "GET", pattern: "/api/v1/overview", handler: overviewRoute },
    { method: "GET", pattern: "/api/v1/theses", handler: thesesRoute },
    { method: "GET", pattern: "/api/v1/indicators/:indicatorId/series", handler: indicatorSeriesRoute },
    { method: "GET", pattern: "/api/v1/changes", handler: changesRoute },
    { method: "GET", pattern: "/api/v1/data-health", handler: dataHealthRoute },
    { method: "GET", pattern: "/api/v1/methodology", handler: methodologyRoute },
    { method: "GET", pattern: "/api/v1/daily/:date", handler: publicDailyBriefRoute },
    { method: "GET", pattern: "/api/v1/categories/:category<[a-z]+>", handler: categoryRoute },
    { method: "GET", pattern: "/api/v1/theses/:slug<[a-z0-9]+(?:-[a-z0-9]+)*>", handler: thesisRoute },
    // administrative
    { method: "GET", pattern: "/api/admin/runs", handler: adminRunsRoute },
    { method: "GET", pattern: "/api/admin/theses/:thesisId/draft", handler: adminDraftRoute },
    { method: "PUT", pattern: "/api/admin/thesis-versions/:versionId", handler: administrativeDraftEditRoute },
    { method: "POST", pattern: "/api/admin/thesis-versions/:versionId/publish", handler: thesisPublishRoute },
    { method: "POST", pattern: "/api/admin/thesis-versions/:versionId/withdraw", handler: thesisWithdrawRoute },
    { method: "POST", pattern: "/api/admin/theses/:thesisId/evaluate", handler: thesisEvaluateRoute },
    { method: "POST", pattern: "/api/admin/thesis-versions/:versionId/review", handler: thesisReviewRoute },
    { method: "POST", pattern: "/api/admin/daily/:date/publish", handler: adminDailyBriefPublishRoute },
    { method: "GET", pattern: "/api/admin/daily/:date", handler: adminDailyBriefRoute },
    { method: "POST", pattern: "/api/admin/sources/:sourceId<[a-z][a-z0-9_-]{0,127}>/run", handler: manualSourceRunRoute },
  ];

  const router = new Router();
  for (const route of routes) router.add(route);
  return router;
}
