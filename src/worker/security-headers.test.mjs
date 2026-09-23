import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { SECURITY_RESPONSE_HEADERS, withSecurityHeaders } from "./security-headers";

const ROOT = new globalThis.URL("../../", import.meta.url);

describe("response security headers", () => {
  it("keeps executable and network sources same-origin without claiming HSTS preload", () => {
    const policy = SECURITY_RESPONSE_HEADERS["content-security-policy"];

    expect(policy).toContain("connect-src 'self'");
    expect(policy).toContain("script-src 'self'");
    expect(policy).not.toMatch(/(?:connect-src|script-src)[^;]*(?:https?:|\*|data:)/);
    expect(SECURITY_RESPONSE_HEADERS["strict-transport-security"]).not.toMatch(/(?:^|;)\s*preload(?:;|$)/);
  });

  it("hardens a response without changing its status, body or route-owned headers", async () => {
    const response = withSecurityHeaders(new globalThis.Response("preserved body", {
      status: 202,
      statusText: "Accepted",
      headers: {
        "cache-control": "public, max-age=60",
        "content-type": "text/plain; charset=utf-8",
        "x-route-header": "preserved",
      },
    }));

    expect(response.status).toBe(202);
    expect(response.statusText).toBe("Accepted");
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("x-route-header")).toBe("preserved");
    expect(await response.text()).toBe("preserved body");

    for (const [name, value] of Object.entries(SECURITY_RESPONSE_HEADERS)) {
      expect(response.headers.get(name)).toBe(value);
    }
  });

  it("covers the SPA document and fingerprinted assets with equivalent static headers", () => {
    const staticHeaders = readFileSync(new globalThis.URL("public/_headers", ROOT), "utf8");

    expect(staticHeaders).toContain("/*");
    expect(staticHeaders).toContain("/assets/*");
    expect(staticHeaders).toContain("Cache-Control: public, max-age=31536000, immutable");
    for (const [name, value] of Object.entries(SECURITY_RESPONSE_HEADERS)) {
      const staticName = name.split("-").map((part) => part[0]?.toUpperCase() + part.slice(1)).join("-");
      expect(staticHeaders).toContain(`${staticName}: ${value}`);
    }
  });
});
