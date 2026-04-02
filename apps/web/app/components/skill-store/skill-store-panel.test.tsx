// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SkillStorePanel } from "./skill-store-panel";

type InstalledSkill = {
  name: string;
  slug: string;
  description: string;
  emoji?: string;
  source: string;
  filePath: string;
  protected: boolean;
};

const browseSkill = {
  slug: "nextjs",
  displayName: "Next.js",
  summary: "by vercel/next.js",
  installs: 42,
  source: "vercel/next.js",
};

const installedSkill: InstalledSkill = {
  name: "Next.js",
  slug: "nextjs",
  description: "The official Next.js skill.",
  source: "skills.sh",
  filePath: "/tmp/workspace/skills/nextjs/SKILL.md",
  protected: false,
};

function getUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

describe("SkillStorePanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("shows install progress and success feedback", async () => {
    const user = userEvent.setup();
    let installRequestCount = 0;
    let installedRequestCount = 0;
    let resolveInstall: ((value: Response) => void) | undefined;
    const installPromise = new Promise<Response>((resolve) => {
      resolveInstall = resolve;
    });

    global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = getUrl(input);
      const method = init?.method ?? "GET";

      if (url === "/api/skills" && method === "GET") {
        installedRequestCount += 1;
        return Promise.resolve(new Response(JSON.stringify({
          skills: installedRequestCount === 1 ? [] : [installedSkill],
        })));
      }

      if (url.startsWith("/api/skills/browse") && method === "GET") {
        return Promise.resolve(new Response(JSON.stringify({ skills: [browseSkill] })));
      }

      if (url === "/api/skills/install" && method === "POST") {
        installRequestCount += 1;
        return installPromise;
      }

      throw new Error(`Unexpected fetch: ${method} ${url}`);
    }) as typeof fetch;

    render(<SkillStorePanel />);

    await user.click(screen.getByRole("button", { name: "Browse" }));

    await waitFor(() => {
      expect(screen.getByText("Next.js")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Install" }));

    expect(screen.getByText("Installing...")).toBeInTheDocument();

    resolveInstall?.(new Response(JSON.stringify({
      ok: true,
      slug: "nextjs",
      skill: installedSkill,
    })));

    await waitFor(() => {
      expect(screen.getByText("Next.js is now installed.")).toBeInTheDocument();
    });

    expect(installRequestCount).toBe(1);
    expect(screen.getAllByText("Installed").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Installed" }));

    await waitFor(() => {
      expect(screen.getAllByText("Next.js").length).toBeGreaterThan(0);
    });
  });

  it("shows an error when install fails", async () => {
    const user = userEvent.setup();

    global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = getUrl(input);
      const method = init?.method ?? "GET";

      if (url === "/api/skills" && method === "GET") {
        return Promise.resolve(new Response(JSON.stringify({ skills: [] })));
      }

      if (url.startsWith("/api/skills/browse") && method === "GET") {
        return Promise.resolve(new Response(JSON.stringify({ skills: [browseSkill] })));
      }

      if (url === "/api/skills/install" && method === "POST") {
        return Promise.resolve(new Response(JSON.stringify({
          ok: false,
          error: "Install failed: GitHub rate limit exceeded",
        }), { status: 500 }));
      }

      throw new Error(`Unexpected fetch: ${method} ${url}`);
    }) as typeof fetch;

    render(<SkillStorePanel />);

    await user.click(screen.getByRole("button", { name: "Browse" }));

    await waitFor(() => {
      expect(screen.getByText("Next.js")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Install" }));

    await waitFor(() => {
      expect(screen.getAllByText("Install failed: GitHub rate limit exceeded").length).toBeGreaterThan(0);
    });

    expect(screen.getByRole("button", { name: "Install" })).toBeInTheDocument();
  });

  it("keeps a newly installed skill visible even if the follow-up refresh is empty", async () => {
    const user = userEvent.setup();
    let installedRequestCount = 0;

    global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = getUrl(input);
      const method = init?.method ?? "GET";

      if (url === "/api/skills" && method === "GET") {
        installedRequestCount += 1;
        return Promise.resolve(new Response(JSON.stringify({ skills: [] })));
      }

      if (url.startsWith("/api/skills/browse") && method === "GET") {
        return Promise.resolve(new Response(JSON.stringify({ skills: [browseSkill] })));
      }

      if (url === "/api/skills/install" && method === "POST") {
        return Promise.resolve(new Response(JSON.stringify({
          ok: true,
          slug: "nextjs",
          skill: installedSkill,
        })));
      }

      throw new Error(`Unexpected fetch: ${method} ${url}`);
    }) as typeof fetch;

    render(<SkillStorePanel />);

    await user.click(screen.getByRole("button", { name: "Browse" }));

    await waitFor(() => {
      expect(screen.getByText("Next.js")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Install" }));

    await waitFor(() => {
      expect(screen.getByText("Next.js is now installed.")).toBeInTheDocument();
    });

    expect(installedRequestCount).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Installed").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Installed" }));

    await waitFor(() => {
      expect(screen.getAllByText("Next.js").length).toBeGreaterThan(0);
    });
  });
});
