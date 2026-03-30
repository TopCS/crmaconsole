import { describe, expect, it } from "vitest";
import { inferTabType } from "./tab-state";

describe("inferTabType", () => {
  it("recognizes integrations virtual tabs", () => {
    expect(inferTabType("~integrations")).toBe("integrations");
  });

  it("keeps cron virtual tabs recognized", () => {
    expect(inferTabType("~cron/job-1")).toBe("cron");
  });
});
