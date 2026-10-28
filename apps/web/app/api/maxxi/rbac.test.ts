import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SESSION_COOKIE, signSessionToken } from "@/lib/security/session";
import { upsertOperator } from "@/lib/security/operators";
import type { OperatorRole } from "@/lib/security/rbac";

const dir = mkdtempSync(path.join(tmpdir(), "maxxi-rbac-"));
process.env.CRM_A_MAXXI_DB_DIR = dir;
process.env.CRM_A_MAXXI_FIXTURE = path.resolve(
  process.cwd(),
  "../../docs/fixtures/maxxi_demo_seed.json",
);
process.env.CRM_A_SESSION_SECRET = "test-session-secret-value-1234";

const { seedMaxxiDemo } = await import("@/lib/maxxi/seed");
const seedRoute = await import("./seed/route");
const peopleRoute = await import("./people/route");
const segmentRoute = await import("./segment/route");
const campaignsRoute = await import("./campaigns/route");
const operatorsRoute = await import("./operators/route");
const overviewRoute = await import("./overview/route");

beforeAll(async () => {
  for (const [username, roles] of [
    ["admin.demo", ["admin"]],
    ["comm.demo", ["communication"]],
    ["info.demo", ["infopoint"]],
    ["rel.demo", ["relations"]],
  ] as const) {
    upsertOperator({
      username,
      password: "password-1234",
      roles: [...roles],
      active: true,
      createdBy: "test",
    });
  }
  await seedMaxxiDemo();
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function req(username: string | null, init?: RequestInit, path = "/api/maxxi/x"): Request {
  const headers = new Headers(init?.headers);
  if (username) {
    const token = signSessionToken(username, rolesFor(username)) as string;
    headers.set("cookie", `${SESSION_COOKIE}=${encodeURIComponent(token)}`);
  }
  return new Request(`http://localhost${path}`, { ...init, headers });
}

function rolesFor(username: string): OperatorRole[] {
  switch (username) {
    case "admin.demo": return ["admin"];
    case "comm.demo": return ["communication"];
    case "info.demo": return ["infopoint"];
    case "rel.demo": return ["relations"];
    default: return [];
  }
}

describe("MAXXI RBAC", () => {
  it("denies anonymous callers", async () => {
    const res = await overviewRoute.GET(req(null));
    expect(res.status).toBe(401);
  });

  it("lets any role read the overview", async () => {
    const res = await overviewRoute.GET(req("rel.demo"));
    expect(res.status).toBe(200);
  });

  it("forbids relations from reading the eligible audience", async () => {
    const res = await segmentRoute.GET(req("rel.demo"));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain("maxxi.people.eligible");
  });

  it("lets communication read the eligible audience", async () => {
    const res = await segmentRoute.GET(req("comm.demo"));
    expect(res.status).toBe(200);
  });

  it("masks infopoint notes for roles without feedback.viewNotes", async () => {
    const path = "/api/maxxi/people?id=P-GIULIA";
    const comm = await peopleRoute.GET(req("comm.demo", undefined, path));
    const commBody = (await comm.json()) as { person: { feedback: Array<{ summary: string }> } };
    expect(commBody.person.feedback.length).toBeGreaterThan(0);
    expect(commBody.person.feedback.every((case_) => case_.summary === "")).toBe(true);

    const info = await peopleRoute.GET(req("info.demo", undefined, path));
    const infoBody = (await info.json()) as { person: { feedback: Array<{ summary: string }> } };
    expect(infoBody.person.feedback.some((case_) => case_.summary.length > 0)).toBe(true);
  });

  it("only lets communication/admin create campaign drafts", async () => {
    const forbidden = await campaignsRoute.POST(
      req("info.demo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subject: "x", body: "y" }),
      }),
    );
    expect(forbidden.status).toBe(403);

    const allowed = await campaignsRoute.POST(
      req("comm.demo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subject: "Rinnovo myMAXXI", body: "Bozza demo." }),
      }),
    );
    expect(allowed.status).toBe(200);
  });

  it("rejects seeding for non-admins", async () => {
    const res = await seedRoute.POST(req("comm.demo", { method: "POST" }));
    expect(res.status).toBe(403);
  });

  it("lets only admin manage operators", async () => {
    const forbidden = await operatorsRoute.GET(req("comm.demo"));
    expect(forbidden.status).toBe(403);
    const allowed = await operatorsRoute.GET(req("admin.demo"));
    expect(allowed.status).toBe(200);
    const body = (await allowed.json()) as { operators: Array<{ username: string }> };
    expect(body.operators.map((row) => row.username)).toContain("comm.demo");
  });

  it("never returns password hashes", async () => {
    const res = await operatorsRoute.GET(req("admin.demo"));
    const text = await res.text();
    expect(text).not.toContain("hash");
    expect(text).not.toContain("salt");
  });
});
