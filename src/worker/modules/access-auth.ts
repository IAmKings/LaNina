import { ADMIN_ROLES, type AdminRole } from "../../domain/page-models";

const ACCESS_JWT_HEADER = "cf-access-jwt-assertion";
// Cloudflare Access publishes and documents RS256-signed assertions. Keeping this
// allowlist to that algorithm prevents accepting an unexpected key family.
const SUPPORTED_ALGORITHMS = ["RS256"] as const;

type SupportedAlgorithm = (typeof SUPPORTED_ALGORITHMS)[number];

export interface AccessActor {
  readonly email: string | null;
  readonly roles: readonly AdminRole[];
}

export interface AccessJwtConfiguration {
  readonly issuer: string;
  readonly audience: string;
  readonly jwksUrl: string;
  readonly emailRoles: Readonly<Record<string, readonly AdminRole[]>>;
  readonly groupRoles: Readonly<Record<string, readonly AdminRole[]>>;
}

export interface AccessJwtEnvironment {
  readonly ACCESS_JWT_ISSUER?: string;
  readonly ACCESS_JWT_AUDIENCE?: string;
  readonly ACCESS_JWKS_URL?: string;
  readonly ACCESS_EMAIL_ROLE_MAP?: string;
  readonly ACCESS_GROUP_ROLE_MAP?: string;
}

export interface AccessJwtDependencies {
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => Date;
}

export type AccessJwtErrorCode =
  | "AUTH_UNAUTHORIZED"
  | "AUTH_FORBIDDEN"
  | "AUTH_CONFIGURATION"
  | "AUTH_IDENTITY_PROVIDER";

/** A safe-to-classify authentication failure. Its cause is intentionally never retained. */
export class AccessJwtError extends Error {
  readonly status: 401 | 403 | 503;

  constructor(readonly code: AccessJwtErrorCode) {
    super(accessJwtMessage(code));
    this.name = "AccessJwtError";
    this.status = code === "AUTH_UNAUTHORIZED" ? 401 : code === "AUTH_FORBIDDEN" ? 403 : 503;
  }
}

interface JwtHeader {
  readonly alg: SupportedAlgorithm;
  readonly kid: string;
}

interface JwtClaims {
  readonly iss: string;
  readonly aud: string | readonly string[];
  readonly exp: number;
  readonly nbf?: number;
  readonly email?: string;
  readonly groups?: readonly string[];
}

interface JsonWebKeySet {
  readonly keys: readonly AccessJwk[];
}

interface AccessJwk extends JsonWebKey {
  readonly kid?: string;
  readonly alg?: string;
}

/**
 * Decodes deployment configuration without inventing a team domain, audience, or role policy.
 * Missing or malformed values produce a fail-closed configuration error when an admin route opts in.
 */
export function accessJwtConfigurationFromEnvironment(
  env: AccessJwtEnvironment,
): AccessJwtConfiguration {
  const issuer = requiredHttpsUrl(env.ACCESS_JWT_ISSUER);
  const audience = requiredString(env.ACCESS_JWT_AUDIENCE);
  const jwksUrl = requiredHttpsUrl(env.ACCESS_JWKS_URL);
  return {
    issuer,
    audience,
    jwksUrl,
    emailRoles: parseRoleMap(env.ACCESS_EMAIL_ROLE_MAP),
    groupRoles: parseRoleMap(env.ACCESS_GROUP_ROLE_MAP),
  };
}

/**
 * Validates Cloudflare Access' signed assertion and returns the smallest application identity.
 * The raw JWT and unneeded claims never leave this trust-boundary module.
 */
export async function authenticateAccessRequest(
  request: Request,
  configuration: AccessJwtConfiguration,
  dependencies: AccessJwtDependencies = {},
): Promise<AccessActor> {
  const token = request.headers.get(ACCESS_JWT_HEADER);
  if (token === null || token.length === 0) throw new AccessJwtError("AUTH_UNAUTHORIZED");

  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    throw new AccessJwtError("AUTH_UNAUTHORIZED");
  }

  const header = decodeJwtHeader(parts[0]);
  const claims = decodeJwtClaims(parts[1]);
  await verifySignature(parts, header, configuration, dependencies.fetch ?? globalThis.fetch);
  validateClaims(claims, configuration, dependencies.now ?? (() => new Date()));

  return {
    email: claims.email ?? null,
    roles: mappedRoles(claims, configuration),
  };
}

export function hasAdminRole(actor: AccessActor, role: AdminRole): boolean {
  return actor.roles.includes(role);
}

/**
 * Applies the role hierarchy after signature/claim verification. This remains a
 * server-side boundary; browser state may only render its resulting projection.
 */
export async function authorizeAccessRequest(
  request: Request,
  environment: AccessJwtEnvironment,
  minimumRole: AdminRole,
  dependencies: AccessJwtDependencies = {},
): Promise<AccessActor> {
  const actor = await authenticateAccessRequest(
    request,
    accessJwtConfigurationFromEnvironment(environment),
    dependencies,
  );
  if (!hasAtLeastAdminRole(actor, minimumRole)) throw new AccessJwtError("AUTH_FORBIDDEN");
  return actor;
}

export function hasAtLeastAdminRole(actor: AccessActor, minimumRole: AdminRole): boolean {
  const minimumIndex = ADMIN_ROLES.indexOf(minimumRole);
  return actor.roles.some((role) => ADMIN_ROLES.indexOf(role) >= minimumIndex);
}

function accessJwtMessage(code: AccessJwtErrorCode): string {
  if (code === "AUTH_CONFIGURATION") return "后台身份验证配置不可用";
  if (code === "AUTH_IDENTITY_PROVIDER") return "身份验证服务暂不可用";
  if (code === "AUTH_FORBIDDEN") return "后台访问权限不足";
  return "后台访问未获授权";
}

function requiredString(value: string | undefined): string {
  if (value === undefined || value.trim().length === 0) throw new AccessJwtError("AUTH_CONFIGURATION");
  return value.trim();
}

function requiredHttpsUrl(value: string | undefined): string {
  const supplied = requiredString(value);
  const parsed = parseHttpsUrl(supplied);
  if (parsed === null) throw new AccessJwtError("AUTH_CONFIGURATION");
  // `iss` is an exact JWT string comparison. Do not normalize a configured issuer
  // (for example by adding a trailing slash) after only using URL parsing for validation.
  return supplied;
}

function parseHttpsUrl(value: string): URL | null {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed : null;
  } catch {
    return null;
  }
}

function parseRoleMap(value: string | undefined): Readonly<Record<string, readonly AdminRole[]>> {
  if (value === undefined || value.trim().length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new AccessJwtError("AUTH_CONFIGURATION");
    }
    const entries = Object.entries(parsed).map(([identity, roles]) => {
      if (identity.trim().length === 0 || !Array.isArray(roles)) {
        throw new AccessJwtError("AUTH_CONFIGURATION");
      }
      const mapped = roles.map((role) => {
        if (typeof role !== "string" || !ADMIN_ROLES.includes(role as AdminRole)) {
          throw new AccessJwtError("AUTH_CONFIGURATION");
        }
        return role as AdminRole;
      });
      return [identity, canonicalRoles(mapped)] as const;
    });
    return Object.fromEntries(entries);
  } catch (error) {
    if (error instanceof AccessJwtError) throw error;
    throw new AccessJwtError("AUTH_CONFIGURATION");
  }
}

function decodeJwtHeader(encoded: string): JwtHeader {
  const parsed = decodeJson(encoded);
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    typeof parsed.alg !== "string" ||
    !SUPPORTED_ALGORITHMS.includes(parsed.alg as SupportedAlgorithm) ||
    typeof parsed.kid !== "string" ||
    parsed.kid.length === 0
  ) {
    throw new AccessJwtError("AUTH_UNAUTHORIZED");
  }
  return { alg: parsed.alg as SupportedAlgorithm, kid: parsed.kid };
}

function decodeJwtClaims(encoded: string): JwtClaims {
  const parsed = decodeJson(encoded);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AccessJwtError("AUTH_UNAUTHORIZED");
  }
  const audience = parseAudience(parsed.aud);
  const groups = parseGroups(parsed.groups);
  if (
    typeof parsed.iss !== "string" ||
    typeof parsed.exp !== "number" ||
    !Number.isFinite(parsed.exp) ||
    (parsed.nbf !== undefined && (typeof parsed.nbf !== "number" || !Number.isFinite(parsed.nbf))) ||
    (parsed.email !== undefined && (typeof parsed.email !== "string" || parsed.email.length === 0))
  ) {
    throw new AccessJwtError("AUTH_UNAUTHORIZED");
  }
  return {
    iss: parsed.iss,
    aud: audience,
    exp: parsed.exp,
    ...(parsed.nbf === undefined ? {} : { nbf: parsed.nbf }),
    ...(parsed.email === undefined ? {} : { email: parsed.email }),
    ...(groups.length === 0 ? {} : { groups }),
  };
}

function decodeJson(encoded: string): Record<string, unknown> | null {
  try {
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(normalized + padding), (character) => character.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseAudience(value: unknown): string | readonly string[] {
  if (typeof value === "string" && value.length > 0) return value;
  if (Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === "string" && entry.length > 0)) {
    return value as readonly string[];
  }
  throw new AccessJwtError("AUTH_UNAUTHORIZED");
}

function parseGroups(value: unknown): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((group) => typeof group === "string" && group.length > 0)) {
    throw new AccessJwtError("AUTH_UNAUTHORIZED");
  }
  return value as readonly string[];
}

async function verifySignature(
  parts: readonly string[],
  header: JwtHeader,
  configuration: AccessJwtConfiguration,
  fetcher: typeof globalThis.fetch,
): Promise<void> {
  const jwks = await loadJwks(configuration.jwksUrl, fetcher);
  const jwk = jwks.keys.find((key) => key.kid === header.kid && (key.alg === undefined || key.alg === header.alg));
  if (jwk === undefined) throw new AccessJwtError("AUTH_UNAUTHORIZED");

  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const signature = base64UrlBytes(parts[2]);
    const signingInput = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const verified = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      byteArrayBuffer(signature),
      signingInput,
    );
    if (!verified) throw new AccessJwtError("AUTH_UNAUTHORIZED");
  } catch (error) {
    if (error instanceof AccessJwtError) throw error;
    throw new AccessJwtError("AUTH_UNAUTHORIZED");
  }
}

async function loadJwks(jwksUrl: string, fetcher: typeof globalThis.fetch): Promise<JsonWebKeySet> {
  try {
    const response = await fetcher(jwksUrl, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error("JWKS request failed");
    const parsed: unknown = await response.json();
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      !Array.isArray((parsed as { keys?: unknown }).keys) ||
      !(parsed as { keys: unknown[] }).keys.every(isJsonWebKey)
    ) {
      throw new Error("JWKS payload invalid");
    }
    return parsed as JsonWebKeySet;
  } catch {
    throw new AccessJwtError("AUTH_IDENTITY_PROVIDER");
  }
}

function isJsonWebKey(value: unknown): value is AccessJwk {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function base64UrlBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  return Uint8Array.from(atob(normalized + padding), (character) => character.charCodeAt(0));
}

function byteArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function validateClaims(
  claims: JwtClaims,
  configuration: AccessJwtConfiguration,
  now: () => Date,
): void {
  const nowSeconds = now().getTime() / 1000;
  if (
    claims.iss !== configuration.issuer ||
    !hasAudience(claims.aud, configuration.audience) ||
    claims.exp <= nowSeconds ||
    (claims.nbf !== undefined && claims.nbf > nowSeconds)
  ) {
    throw new AccessJwtError("AUTH_UNAUTHORIZED");
  }
}

function hasAudience(audience: string | readonly string[], expected: string): boolean {
  return typeof audience === "string" ? audience === expected : audience.includes(expected);
}

function mappedRoles(claims: JwtClaims, configuration: AccessJwtConfiguration): readonly AdminRole[] {
  const emailRoles = claims.email === undefined ? [] : configuration.emailRoles[claims.email] ?? [];
  const groupRoles = (claims.groups ?? []).flatMap((group) => configuration.groupRoles[group] ?? []);
  return canonicalRoles([...emailRoles, ...groupRoles]);
}

function canonicalRoles(roles: readonly AdminRole[]): readonly AdminRole[] {
  return ADMIN_ROLES.filter((role) => roles.includes(role));
}
