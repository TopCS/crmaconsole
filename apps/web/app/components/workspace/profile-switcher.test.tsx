// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProfileSwitcher } from "./profile-switcher";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("ProfileSwitcher workspace delete action", () => {
  const originalConfirm = window.confirm;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    window.confirm = originalConfirm;
  });

  it("deletes a profile workspace from the dropdown action", async () => {
    const user = userEvent.setup();
    const onWorkspaceDelete = vi.fn();
    let profileFetchCount = 0;

    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : (input as URL).href;
      const method = init?.method ?? "GET";
      if (url === "/api/profiles" && method === "GET") {
        profileFetchCount += 1;
        if (profileFetchCount === 1) {
          return jsonResponse({
            activeProfile: "work",
            profiles: [
              {
                name: "work",
                stateDir: "/home/testuser/.openclaw-work",
                workspaceDir: "/home/testuser/.openclaw-work/workspace",
                isActive: true,
                hasConfig: true,
              },
            ],
          });
        }
        return jsonResponse({
          activeProfile: "work",
          profiles: [
            {
              name: "work",
              stateDir: "/home/testuser/.openclaw-work",
              workspaceDir: null,
              isActive: true,
              hasConfig: true,
            },
          ],
        });
      }
      if (url === "/api/workspace/delete" && method === "POST") {
        return jsonResponse({ deleted: true, profile: "work" });
      }
      throw new Error(`Unexpected fetch call: ${method} ${url}`);
    }) as typeof fetch;

    window.confirm = vi.fn(() => true);

    render(<ProfileSwitcher onWorkspaceDelete={onWorkspaceDelete} />);
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/profiles");
    });

    await user.click(screen.getByTitle("Switch workspace profile"));
    await user.click(screen.getByTitle("Delete workspace for work"));

    await waitFor(() => {
      expect(onWorkspaceDelete).toHaveBeenCalledWith("work");
    });

    const deleteCall = vi
      .mocked(global.fetch)
      .mock.calls.find((call) => (typeof call[0] === "string" ? call[0] : (call[0] as URL).href) === "/api/workspace/delete");
    expect(deleteCall).toBeTruthy();
    expect(deleteCall?.[1]).toMatchObject({
      method: "POST",
    });
  });
});
