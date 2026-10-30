import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertOutboundAllowed, blocked, isDemoMode } from "./demo-mode";

const KEY = "CRM_A_DEMO_MODE";
const original = process.env[KEY];

beforeEach(() => {
  delete process.env[KEY];
});

afterEach(() => {
  if (original === undefined) {delete process.env[KEY];}
  else {process.env[KEY] = original;}
});

describe("demo mode outbound guard", () => {
  it("is off by default", () => {
    expect(isDemoMode()).toBe(false);
  });

  it("accepts the documented truthy spellings", () => {
    for (const value of ["1", "true", "TRUE", "yes", "on"]) {
      process.env[KEY] = value;
      expect(isDemoMode()).toBe(true);
    }
    for (const value of ["0", "false", "no", "off", ""]) {
      process.env[KEY] = value;
      expect(isDemoMode()).toBe(false);
    }
  });

  it("blocks outbound when enabled", () => {
    process.env[KEY] = "1";
    expect(() => assertOutboundAllowed("ses-email")).toThrow(/Outbound disabled in demo mode/);
  });

  it("allows outbound when disabled", () => {
    expect(() => assertOutboundAllowed("ses-email")).not.toThrow();
  });

  it("produces a simulated result payload", () => {
    const result = blocked("openclaw-channel");
    expect(result.simulated).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.provider).toBe("openclaw-channel");
  });
});
