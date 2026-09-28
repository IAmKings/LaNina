import type { AppContext, RequestHandlerDependencies } from "../context";
import type { Env } from "../index";

/**
 * The Worker's single route table: `{ method, pattern, handler }` entries whose patterns carry
 * named params (`/api/v1/theses/:slug`). Patterns are compiled to anchored regular expressions
 * once at module load, replacing the previous pairs of "shape" and "extract" regexes — the
 * pattern in the table is now the only definition of a route's path shape.
 *
 * A path that matches some pattern but not with the request's method yields 405 + `Allow`
 * (the one deliberately new behavior); an unmatched path falls through to the 404 fallback.
 */

export type RouteParams = Record<string, string>;

/** Everything a route handler needs; built by the dispatcher in index.ts per request. */
export interface RouteContext {
  readonly request: Request;
  readonly url: URL;
  readonly requestId: string;
  readonly params: RouteParams;
  readonly env: Env;
  readonly app: AppContext;
  readonly dependencies: RequestHandlerDependencies;
  /** `(dependencies.now ?? (() => new Date()))().toISOString()` — one timestamp per call site. */
  nowIso(): string;
}

export type RouteHandler = (request: Request, ctx: RouteContext) => Promise<Response> | Response;

export interface RouteDefinition {
  readonly method: string;
  /** `/api/admin/theses/:thesisId/draft`; `:name<regex-source>` overrides the `[^/]+` default. */
  readonly pattern: string;
  readonly handler: RouteHandler;
}

export type RouteMatch =
  | { readonly kind: "match"; readonly handler: RouteHandler; readonly params: RouteParams }
  | { readonly kind: "method-not-allowed"; readonly allow: readonly string[] };

interface CompiledRoute {
  readonly method: string;
  readonly regex: RegExp;
  readonly handler: RouteHandler;
}

const DEFAULT_PARAM_SOURCE = "[^/]+";
const PARAM_SEGMENT = /^:([A-Za-z0-9_]+)(?:<(.+)>)?$/;

function escapeRegExp(source: string): string {
  return source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function compileRoutePattern(pattern: string): RegExp {
  const source = pattern
    .split("/")
    .map((segment) => {
      if (segment === "") return segment;
      const param = PARAM_SEGMENT.exec(segment);
      if (param === null) return escapeRegExp(segment);
      return `(?<${param[1]}>${param[2] ?? DEFAULT_PARAM_SOURCE})`;
    })
    .join("/");
  return new RegExp(`^${source}$`);
}

export class Router {
  private readonly routes: CompiledRoute[] = [];

  add(definition: RouteDefinition): this {
    this.routes.push({
      method: definition.method,
      regex: compileRoutePattern(definition.pattern),
      handler: definition.handler,
    });
    return this;
  }

  /**
   * Path hits are collected even when the method differs, so a wrong-method request can be
   * answered with the full Allow list instead of a misleading 404.
   */
  match(method: string, pathname: string): RouteMatch | null {
    let allow: string[] | null = null;
    for (const route of this.routes) {
      const matched = route.regex.exec(pathname);
      if (matched === null) continue;
      if (route.method === method) {
        return { kind: "match", handler: route.handler, params: matched.groups ?? {} };
      }
      (allow ??= []).push(route.method);
    }
    if (allow !== null) return { kind: "method-not-allowed", allow };
    return null;
  }
}
