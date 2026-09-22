import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveAppPublicOrigin } from "./public-origin";

const ORIGINAL_ENV = process.env.CRM_A_CONSOLE_PUBLIC_URL;

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.CRM_A_CONSOLE_PUBLIC_URL;
  } else {
    process.env.CRM_A_CONSOLE_PUBLIC_URL = ORIGINAL_ENV;
  }
});

beforeEach(() => {
  delete process.env.CRM_A_CONSOLE_PUBLIC_URL;
});

function makeRequest(opts: {
  url?: string;
  forwardedHost?: string;
  forwardedProto?: string;
  host?: string;
}): Request {
  const headers = new Headers();
  if (opts.forwardedHost) {
    headers.set("x-forwarded-host", opts.forwardedHost);
  }
  if (opts.forwardedProto) {
    headers.set("x-forwarded-proto", opts.forwardedProto);
  }
  if (opts.host) {
    headers.set("host", opts.host);
  }
  return new Request(opts.url ?? "http://localhost:3100/api/composio/connect", {
    method: "POST",
    headers,
  });
}

describe("resolveAppPublicOrigin", () => {
  describe("forwarded headers (cloud / behind reverse proxy)", () => {
    it("uses X-Forwarded-Host + X-Forwarded-Proto when both are present", () => {
      const origin = resolveAppPublicOrigin(
        makeRequest({
          forwardedHost: "crm-a-com.sandbox.merseoriginals.com",
          forwardedProto: "https",
        }),
      );
      expect(origin).toBe("https://crm-a-com.sandbox.merseoriginals.com");
    });

    it("defaults to http when X-Forwarded-Proto is missing or unrecognized", () => {
      expect(
        resolveAppPublicOrigin(
          makeRequest({
            forwardedHost: "example.local",
          }),
        ),
      ).toBe("http://example.local");

      expect(
        resolveAppPublicOrigin(
          makeRequest({
            forwardedHost: "example.local",
            forwardedProto: "ws",
          }),
        ),
      ).toBe("http://example.local");
    });

    it("takes the first value from a comma-separated forwarded header chain", () => {
      const origin = resolveAppPublicOrigin(
        makeRequest({
          forwardedHost: "real.example.com, intermediate.example.com",
          forwardedProto: "https",
        }),
      );
      expect(origin).toBe("https://real.example.com");
    });

    it("prefers forwarded headers over CRM_A_CONSOLE_PUBLIC_URL — needed for warm-pool slug rebinds where the env var is stale but the Host header is live", () => {
      process.env.CRM_A_CONSOLE_PUBLIC_URL =
        "https://stale-warm-pool-slug.sandbox.merseoriginals.com";
      const origin = resolveAppPublicOrigin(
        makeRequest({
          forwardedHost: "real-org-slug.sandbox.merseoriginals.com",
          forwardedProto: "https",
        }),
      );
      expect(origin).toBe("https://real-org-slug.sandbox.merseoriginals.com");
    });
  });

  describe("CRM_A_CONSOLE_PUBLIC_URL fallback", () => {
    it("uses the env var when no forwarded headers are present", () => {
      process.env.CRM_A_CONSOLE_PUBLIC_URL =
        "https://acme.sandbox.merseoriginals.com";
      const origin = resolveAppPublicOrigin(makeRequest({}));
      expect(origin).toBe("https://acme.sandbox.merseoriginals.com");
    });

    it("normalizes the env var to its origin (drops path/query)", () => {
      process.env.CRM_A_CONSOLE_PUBLIC_URL =
        "https://acme.sandbox.merseoriginals.com/some/path?query=1";
      const origin = resolveAppPublicOrigin(makeRequest({}));
      expect(origin).toBe("https://acme.sandbox.merseoriginals.com");
    });

    it("ignores a malformed env var and falls through to request.url", () => {
      process.env.CRM_A_CONSOLE_PUBLIC_URL = "this is not a url";
      const origin = resolveAppPublicOrigin(
        makeRequest({
          url: "http://localhost:3100/api/composio/connect",
        }),
      );
      expect(origin).toBe("http://localhost:3100");
    });
  });

  describe("loopback / private forwarded hosts (web runtime reverse proxy)", () => {
    it("ignores a loopback forwarded host and uses the env var instead", () => {
      process.env.CRM_A_CONSOLE_PUBLIC_URL =
        "https://top-mgm-00-2.taileb6b.ts.net";
      const origin = resolveAppPublicOrigin(
        makeRequest({
          forwardedHost: "127.0.0.1:3100",
          forwardedProto: "http",
        }),
      );
      expect(origin).toBe("https://top-mgm-00-2.taileb6b.ts.net");
    });

    it("ignores a `localhost` forwarded host and falls back to request.url when no env", () => {
      const origin = resolveAppPublicOrigin(
        makeRequest({
          forwardedHost: "localhost:3100",
          url: "http://127.0.0.1:3100/api/composio/connect",
        }),
      );
      expect(origin).toBe("http://127.0.0.1:3100");
    });

    it("ignores private-network forwarded hosts (10.x / 192.168.x / 172.16-31.x)", () => {
      process.env.CRM_A_CONSOLE_PUBLIC_URL =
        "https://acme.example.com";
      for (const host of ["10.0.0.5:3100", "192.168.1.20", "172.20.0.3:8080"]) {
        const origin = resolveAppPublicOrigin(
          makeRequest({ forwardedHost: host, forwardedProto: "https" }),
        );
        expect(origin).toBe("https://acme.example.com");
      }
    });

    it("still honors a public forwarded host even when the env var is set", () => {
      process.env.CRM_A_CONSOLE_PUBLIC_URL =
        "https://stale-warm-pool-slug.sandbox.merseoriginals.com";
      const origin = resolveAppPublicOrigin(
        makeRequest({
          forwardedHost: "real-org-slug.sandbox.merseoriginals.com",
          forwardedProto: "https",
        }),
      );
      expect(origin).toBe("https://real-org-slug.sandbox.merseoriginals.com");
    });
  });

  describe("local dev fallback", () => {
    it("returns the request.url origin when neither forwarded headers nor env var are set", () => {
      const origin = resolveAppPublicOrigin(
        makeRequest({
          url: "http://localhost:3100/api/composio/connect",
        }),
      );
      expect(origin).toBe("http://localhost:3100");
    });

    it("falls back to request.url when forwarded host is empty after trimming", () => {
      const origin = resolveAppPublicOrigin(
        makeRequest({
          forwardedHost: "   ",
          forwardedProto: "https",
          url: "http://localhost:3100/api/composio/connect",
        }),
      );
      expect(origin).toBe("http://localhost:3100");
    });
  });
});
