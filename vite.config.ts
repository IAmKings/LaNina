import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import type { ApiEnvelope, ApiMeta } from "./src/domain/contracts";
import {
  demoAtomFeed,
  demoCategoryPages,
  demoThesisCards,
  demoThesisPages,
} from "./src/domain/local-demo-fixtures";
import { PAGE_MODEL_FIXTURES } from "./src/domain/page-models.fixtures";
import { renderAtomFeed } from "./src/worker/modules/atom-feed";
import { defineConfig, type Plugin } from "vite";

const LOCAL_DEMO_API_META: ApiMeta = Object.freeze({
  generatedAt: "2026-09-10T00:00:00.000Z",
  dataCutoff: "2026-09-09T22:30:00.000Z",
  methodologyVersion: "synthetic-local-demo-v1",
});

// The published changes list reuses the review-safe change projection the overview already carries,
// so the demo exercises the real list layout instead of only its empty state.
const LOCAL_DEMO_CHANGES = Object.freeze({
  ...PAGE_MODEL_FIXTURES.emptyChanges,
  changes: PAGE_MODEL_FIXTURES.overview.topChanges,
});

/**
 * Every public read path the SPA can call, so no page falls through to the empty local D1 during a
 * demo: overview, all three market categories, the thesis list (used by the change filters), every
 * thesis detail route, changes, data health and methodology.
 */
const LOCAL_DEMO_READ_MODELS = new Map<string, unknown>([
  ["/api/v1/overview", PAGE_MODEL_FIXTURES.overview],
  ["/api/v1/theses", demoThesisCards()],
  ["/api/v1/changes", LOCAL_DEMO_CHANGES],
  ["/api/v1/data-health", PAGE_MODEL_FIXTURES.dataHealth],
  ["/api/v1/methodology", PAGE_MODEL_FIXTURES.methodology],
  ...demoCategoryPages().map((page): [string, unknown] => [`/api/v1/categories/${page.category}`, page]),
  ...demoThesisPages().map((page): [string, unknown] => [`/api/v1/theses/${page.thesis.slug}`, page]),
]);

/** Rendered by the real Atom renderer so the demo feed keeps production escaping and ordering. */
function localDemoFeedXml(origin: string): string {
  return renderAtomFeed(demoAtomFeed(), origin, LOCAL_DEMO_API_META.generatedAt);
}

// This middleware is deliberately limited to `vite --mode demo` while serving. It projects the
// existing synthetic page fixtures through the same-origin public API shape without writing D1/R2
// or changing the Worker, SPA, seed data, or any build output.
function localPublishedReadModelDemoPlugin(): Plugin {
  return {
    name: "enso-local-published-read-model-demo",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!("method" in request) || request.method !== "GET") {
          next();
          return;
        }

        const requestUrl = "url" in request && typeof request.url === "string" ? request.url : "/";
        const url = new URL(requestUrl, "http://local-demo.invalid");

        if (url.pathname === "/feed.xml") {
          response.statusCode = 200;
          response.setHeader("content-type", "application/atom+xml; charset=utf-8");
          response.setHeader("cache-control", "no-store");
          response.setHeader("x-enso-local-demo", "synthetic-published-read-model");
          response.end(localDemoFeedXml(url.origin));
          return;
        }

        const data = LOCAL_DEMO_READ_MODELS.get(url.pathname);
        if (data === undefined) {
          next();
          return;
        }

        const body: ApiEnvelope<unknown> = { data, meta: LOCAL_DEMO_API_META };
        response.statusCode = 200;
        response.setHeader("content-type", "application/json; charset=utf-8");
        response.setHeader("cache-control", "no-store");
        response.setHeader("x-enso-local-demo", "synthetic-published-read-model");
        response.end(JSON.stringify(body));
      });
    },
  };
}

export default defineConfig(({ command, mode }) => ({
  build: {
    // The post-build budget gate reads this stable client manifest. The Worker manifest remains
    // owned by the Cloudflare plugin in its separate output directory.
    manifest: "client-manifest.json",
  },
  plugins: [
    react(),
    // A demo build must stay a normal build. The fixture middleware exists only in the local Vite
    // development server, even if someone invokes `vite build --mode demo`.
    ...(command === "serve" && mode === "demo" ? [localPublishedReadModelDemoPlugin()] : []),
    // Browser E2E validates the intentionally unseeded public read model. Keep that Worker
    // ephemeral so a developer's normal local D1 state cannot change the expected responses.
    cloudflare({ persistState: process.env.PLAYWRIGHT_E2E !== "1" }),
  ],
}));
