import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configText: "{}\n",
}));

vi.mock("@/lib/workspace", () => ({
  resolveOpenClawStateDir: vi.fn(() => "/home/testuser/.openclaw-crm-a"),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => true),
  readFileSync: vi.fn(() => mocks.configText),
  writeFileSync: vi.fn((_path: unknown, content: unknown) => {
    mocks.configText = String(content);
  }),
  mkdirSync: vi.fn(),
}));

import {
  isValidPrimaryModel,
  readCurrentPrimaryModel,
  setPrimaryModel,
} from "./agent-model";

describe("agent-model", () => {
  beforeEach(() => {
    mocks.configText = "{}\n";
  });

  it("validates provider-prefixed model ids", () => {
    expect(isValidPrimaryModel("openrouter/deepseek/deepseek-v4-pro")).toBe(true);
    expect(isValidPrimaryModel("crm-a-cloud/claude-sonnet-4.6")).toBe(true);
    expect(isValidPrimaryModel("deepseek-v4-pro")).toBe(false);
    expect(isValidPrimaryModel("openrouter/")).toBe(false);
  });

  it("writes the flat model string when no model block exists", () => {
    const result = setPrimaryModel("openrouter/deepseek/deepseek-v4-pro");
    expect(result.changed).toBe(true);
    const written = JSON.parse(mocks.configText);
    expect(written.agents.defaults.model).toBe("openrouter/deepseek/deepseek-v4-pro");
    expect(readCurrentPrimaryModel()).toBe("openrouter/deepseek/deepseek-v4-pro");
  });

  it("preserves other model settings when a primary already exists", () => {
    mocks.configText = JSON.stringify({
      agents: {
        defaults: {
          model: { primary: "openrouter/deepseek/deepseek-v4-pro", small: "openrouter/x" },
        },
      },
    });

    const result = setPrimaryModel("openrouter/openai/gpt-5.4");
    expect(result.changed).toBe(true);
    const written = JSON.parse(mocks.configText);
    expect(written.agents.defaults.model.primary).toBe("openrouter/openai/gpt-5.4");
    expect(written.agents.defaults.model.small).toBe("openrouter/x");
    expect(written.agents.defaults.models).toEqual({ "openrouter/openai/gpt-5.4": {} });
  });

  it("is a no-op when the requested model is already primary and allowed", () => {
    mocks.configText = JSON.stringify({
      agents: {
        defaults: {
          model: { primary: "openrouter/openai/gpt-5.4" },
          models: { "openrouter/openai/gpt-5.4": {} },
        },
      },
    });
    const result = setPrimaryModel("openrouter/openai/gpt-5.4");
    expect(result.changed).toBe(false);
    expect(readCurrentPrimaryModel()).toBe("openrouter/openai/gpt-5.4");
  });

  it("extends the allowlist when switching to a model not seen before", () => {
    mocks.configText = JSON.stringify({
      agents: {
        defaults: {
          model: { primary: "openrouter/openai/gpt-5.4" },
          models: { "openrouter/openai/gpt-5.4": {} },
        },
      },
    });
    const result = setPrimaryModel("openrouter/deepseek/deepseek-v4-pro");
    expect(result.changed).toBe(true);
    const written = JSON.parse(mocks.configText);
    expect(written.agents.defaults.model.primary).toBe("openrouter/deepseek/deepseek-v4-pro");
    expect(written.agents.defaults.models).toEqual({
      "openrouter/openai/gpt-5.4": {},
      "openrouter/deepseek/deepseek-v4-pro": {},
    });
  });

  it("rejects malformed model ids without writing", () => {
    expect(() => setPrimaryModel("no-slash")).toThrow();
    expect(mocks.configText).toBe("{}\n");
  });
});
