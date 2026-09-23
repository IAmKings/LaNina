import { describe, expect, it, vi } from "vitest";

import {
  accessJwtConfigurationFromEnvironment,
  authenticateAccessRequest,
  hasAtLeastAdminRole,
  hasAdminRole,
  type AccessJwtConfiguration,
} from "./access-auth";

const NOW = new Date("2026-09-10T00:00:00.000Z");
const CONFIGURATION: AccessJwtConfiguration = {
  issuer: "https://team.cloudflareaccess.com",
  audience: "enso-admin-audience",
  jwksUrl: "https://team.cloudflareaccess.com/cdn-cgi/access/certs",
  emailRoles: { "editor@example.test": ["editor"] },
  groupRoles: { publishers: ["viewer", "publisher"] },
};

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
