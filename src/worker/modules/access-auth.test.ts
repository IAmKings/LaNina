import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetJwksCacheForTests,
  accessJwtConfigurationFromEnvironment,
  authenticateAccessRequest,
  hasAtLeastAdminRole,
  hasAdminRole,
  type AccessJwtConfiguration,
} from "./access-auth";

const NOW = new Date("2026-09-10T00:00:00.000Z");
// 与实现里的 JWKS_CACHE_TTL_MS 对齐：缓存条目在注入时钟前进超过该值后视为过期。
const JWKS_CACHE_TTL_MS = 5 * 60 * 1000;
const CONFIGURATION: AccessJwtConfiguration = {
  issuer: "https://team.cloudflareaccess.com",
  audience: "enso-admin-audience",
  jwksUrl: "https://team.cloudflareaccess.com/cdn-cgi/access/certs",
  emailRoles: { "editor@example.test": ["editor"] },
  groupRoles: { publishers: ["viewer", "publisher"] },
};

// 模块级 JWKS 缓存跨用例持久存在；每个用例前重置，避免上一个用例的假 key 泄漏进来。
beforeEach(() => __resetJwksCacheForTests());

describe("Cloudflare Access JWT authentication", () => {
  it("validates a signed assertion and maps only configured email/group roles", async () => {
    const keyPair = await signingKeyPair();
    const publicKey = await publicJwk(keyPair.publicKey);
    const token = await signedToken(keyPair.privateKey, {
      email: "editor@example.test",
      groups: ["publishers", "unmapped-group"],
    });
    const fetch = vi.fn(async () => Response.json({ keys: [publicKey] }));

    const actor = await authenticateAccessRequest(requestWithToken(token), CONFIGURATION, { fetch, now: () => NOW });

    expect(actor).toEqual({ email: "editor@example.test", roles: ["viewer", "editor", "publisher"] });
    expect(hasAdminRole(actor, "publisher")).toBe(true);
    expect(fetch).toHaveBeenCalledWith(CONFIGURATION.jwksUrl, { headers: { accept: "application/json" } });
  });

  it.each([
    ["expired", { exp: seconds(NOW) - 1 }],
    ["not-before in the future", { nbf: seconds(NOW) + 1 }],
    ["wrong issuer", { iss: "https://other.cloudflareaccess.com" }],
    ["wrong audience", { aud: "another-application" }],
  ])("rejects a token with %s", async (_, claimOverrides) => {
    const keyPair = await signingKeyPair();
    const token = await signedToken(keyPair.privateKey, claimOverrides);
    const fetch = async () => Response.json({ keys: [await publicJwk(keyPair.publicKey)] });

    await expect(
      authenticateAccessRequest(requestWithToken(token), CONFIGURATION, { fetch, now: () => NOW }),
    ).rejects.toMatchObject({ code: "AUTH_UNAUTHORIZED", status: 401 });
  });

  it("rejects a valid-shaped token signed by an unknown key", async () => {
    const signingPair = await signingKeyPair();
    const publishedPair = await signingKeyPair();
    const token = await signedToken(signingPair.privateKey);
    const fetch = async () => Response.json({ keys: [await publicJwk(publishedPair.publicKey)] });

    await expect(
      authenticateAccessRequest(requestWithToken(token), CONFIGURATION, { fetch, now: () => NOW }),
    ).rejects.toMatchObject({ code: "AUTH_UNAUTHORIZED", status: 401 });
  });

  it("rejects a missing assertion before requesting a JWKS", async () => {
    const fetch = vi.fn();

    await expect(
      authenticateAccessRequest(new Request("https://example.test/api/admin/runs"), CONFIGURATION, { fetch, now: () => NOW }),
    ).rejects.toMatchObject({ code: "AUTH_UNAUTHORIZED", status: 401 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails closed for missing or malformed deployment configuration", () => {
    expect(accessJwtConfigurationFromEnvironment({
      ACCESS_JWT_ISSUER: CONFIGURATION.issuer,
      ACCESS_JWT_AUDIENCE: CONFIGURATION.audience,
      ACCESS_JWKS_URL: CONFIGURATION.jwksUrl,
    }).issuer).toBe(CONFIGURATION.issuer);
    expectAccessConfigurationFailure({});
    expectAccessConfigurationFailure({
      ACCESS_JWT_ISSUER: CONFIGURATION.issuer,
      ACCESS_JWT_AUDIENCE: CONFIGURATION.audience,
      ACCESS_JWKS_URL: CONFIGURATION.jwksUrl,
      ACCESS_GROUP_ROLE_MAP: '{"publishers":["admin"]}',
    });
  });

  it("classifies JWKS outages without retaining token or claims in the error", async () => {
    const keyPair = await signingKeyPair();
    const token = await signedToken(keyPair.privateKey, { email: "private@example.test" });

    await expect(
      authenticateAccessRequest(requestWithToken(token), CONFIGURATION, {
        fetch: async () => { throw new Error("private upstream detail"); },
        now: () => NOW,
      }),
    ).rejects.toMatchObject({ code: "AUTH_IDENTITY_PROVIDER", status: 503 });
  });

  it("treats editor and publisher as viewer-or-higher without granting an unmapped actor access", () => {
    expect(hasAtLeastAdminRole({ email: "viewer@example.test", roles: ["viewer"] }, "viewer")).toBe(true);
    expect(hasAtLeastAdminRole({ email: "editor@example.test", roles: ["editor"] }, "viewer")).toBe(true);
    expect(hasAtLeastAdminRole({ email: "publisher@example.test", roles: ["publisher"] }, "viewer")).toBe(true);
    expect(hasAtLeastAdminRole({ email: "none@example.test", roles: [] }, "viewer")).toBe(false);
    expect(hasAtLeastAdminRole({ email: "editor@example.test", roles: ["editor"] }, "publisher")).toBe(false);
  });
});

describe("JWKS module cache", () => {
  it("fetches the key set once for every verification inside the TTL", async () => {
    const keyPair = await signingKeyPair();
    const token = await signedToken(keyPair.privateKey, { email: "editor@example.test" });
    const fetch = vi.fn(async () => Response.json({ keys: [await publicJwk(keyPair.publicKey)] }));
    const dependencies = { fetch, now: () => NOW };

    const first = await authenticateAccessRequest(requestWithToken(token), CONFIGURATION, dependencies);
    const second = await authenticateAccessRequest(requestWithToken(token), CONFIGURATION, dependencies);

    expect(first.email).toBe("editor@example.test");
    expect(second.email).toBe("editor@example.test");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("continues verification on stale keys when a post-TTL refresh fails", async () => {
    const keyPair = await signingKeyPair();
    // 断言的是验签走 stale 缓存而非 JWKS 刷新结果，令牌寿命必须长于 TTL 推进量。
    const token = await signedToken(keyPair.privateKey, {
      email: "editor@example.test",
      exp: seconds(NOW) + 600,
    });
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ keys: [await publicJwk(keyPair.publicKey)] }))
      .mockRejectedValueOnce(new Error("identity provider outage"));
    let currentTimeMs = NOW.getTime();
    const dependencies = { fetch, now: () => new Date(currentTimeMs) };

    const fresh = await authenticateAccessRequest(requestWithToken(token), CONFIGURATION, dependencies);
    currentTimeMs += JWKS_CACHE_TTL_MS + 1;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const stale = await authenticateAccessRequest(requestWithToken(token), CONFIGURATION, dependencies);
    const warnCalls = warn.mock.calls;
    warn.mockRestore();

    expect(fresh.email).toBe("editor@example.test");
    expect(stale.email).toBe("editor@example.test");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(warnCalls).toHaveLength(1);
    expect(JSON.parse(warnCalls[0]?.[0] as string)).toMatchObject({
      handler: "access-auth",
      errorCode: "JWKS_REFRESH_FAILED",
      outcome: "stale-verification",
    });
  });

  it("fails closed with 503 when the key set has never been fetched and the refresh fails", async () => {
    const keyPair = await signingKeyPair();
    const token = await signedToken(keyPair.privateKey, { email: "editor@example.test" });

    await expect(
      authenticateAccessRequest(requestWithToken(token), CONFIGURATION, {
        fetch: async () => { throw new Error("identity provider outage"); },
        now: () => NOW,
      }),
    ).rejects.toMatchObject({ code: "AUTH_IDENTITY_PROVIDER", status: 503 });
  });

  it("coalesces concurrent verifications into a single in-flight JWKS fetch", async () => {
    const keyPair = await signingKeyPair();
    const token = await signedToken(keyPair.privateKey, { email: "editor@example.test" });
    const fetch = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return Response.json({ keys: [await publicJwk(keyPair.publicKey)] });
    });

    const actors = await Promise.all(
      Array.from({ length: 5 }, () =>
        authenticateAccessRequest(requestWithToken(token), CONFIGURATION, { fetch, now: () => NOW })),
    );

    expect(actors).toHaveLength(5);
    expect(actors.every((actor) => actor.email === "editor@example.test")).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
  });
});

async function signingKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
}

async function publicJwk(key: CryptoKey): Promise<JsonWebKey & { kid: string; alg: string }> {
  return { ...await crypto.subtle.exportKey("jwk", key), kid: "test-key", alg: "RS256" };
}

async function signedToken(
  key: CryptoKey,
  overrides: Partial<{ iss: string; aud: string; exp: number; nbf: number; email: string; groups: string[] }> = {},
): Promise<string> {
  const header = base64UrlJson({ alg: "RS256", kid: "test-key", typ: "JWT" });
  const claims = base64UrlJson({
    iss: CONFIGURATION.issuer,
    aud: CONFIGURATION.audience,
    exp: seconds(NOW) + 300,
    ...overrides,
  });
  const signingInput = `${header}.${claims}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${base64UrlBytes(new Uint8Array(signature))}`;
}

function requestWithToken(token: string): Request {
  return new Request("https://example.test/api/admin/runs", {
    headers: { "cf-access-jwt-assertion": token },
  });
}

function base64UrlJson(value: unknown): string {
  return base64UrlBytes(new TextEncoder().encode(JSON.stringify(value)));
}

function base64UrlBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function seconds(value: Date): number {
  return value.getTime() / 1000;
}

function expectAccessConfigurationFailure(environment: Parameters<typeof accessJwtConfigurationFromEnvironment>[0]): void {
  try {
    accessJwtConfigurationFromEnvironment(environment);
    throw new Error("Expected configuration parsing to fail");
  } catch (error) {
    expect(error).toMatchObject({ code: "AUTH_CONFIGURATION", status: 503 });
  }
}
