import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configText: "{}\n",
}));

vi.mock("@/lib/workspace", () => ({
  resolveOpenClawStateDir: vi.fn(() => "/home/testuser/.openclaw-crm-a"),
}));

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(() => mocks.configText),
}));

import {
  DEFAULT_CHAT_THINKING_LEVEL,
  isChatThinkingLevel,
  readConfiguredChatThinkingLevel,
} from "./chat-thinking";

describe("chat-thinking", () => {
  beforeEach(() => {
    mocks.configText = "{}\n";
  });

  it("rejects unknown thinking levels", () => {
    expect(isChatThinkingLevel("high")).toBe(true);
    expect(isChatThinkingLevel("off")).toBe(true);
    expect(isChatThinkingLevel("turbo")).toBe(false);
    expect(isChatThinkingLevel(null)).toBe(false);
  });

  it("reads the configured thinking level from openclaw.json", () => {
    mocks.configText = JSON.stringify({
      agents: { defaults: { thinkingDefault: "low" } },
    });
    expect(readConfiguredChatThinkingLevel()).toBe("low");
  });

  it("falls back to the default when unset or invalid", () => {
    expect(readConfiguredChatThinkingLevel()).toBe(DEFAULT_CHAT_THINKING_LEVEL);
    mocks.configText = JSON.stringify({
      agents: { defaults: { thinkingDefault: "turbo" } },
    });
    expect(readConfiguredChatThinkingLevel()).toBe(DEFAULT_CHAT_THINKING_LEVEL);
  });
});
