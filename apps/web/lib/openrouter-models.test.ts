import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchOpenRouterCatalog,
  resetOpenRouterCatalogCache,
} from "./openrouter-models";

function catalogResponse(entries: unknown[]): Response {
  return new Response(JSON.stringify({ data: entries }), { status: 200 });
}

describe("openrouter-models", () => {
  beforeEach(() => {
    resetOpenRouterCatalogCache();
  });

  it("maps catalog entries to config-valued models", async () => {
    const fetchMock = vi.fn(async () =>
      catalogResponse([
        {
          id: "deepseek/deepseek-v4-pro",
          name: "DeepSeek: DeepSeek V4 Pro",
          supported_parameters: ["reasoning", "tools"],
        },
        {
          id: "openai/gpt-5.4-mini",
          name: "OpenAI: GPT-5.4 Mini",
          supported_parameters: ["tools"],
        },
      ]),
    );

    const models = await fetchOpenRouterCatalog(fetchMock as unknown as typeof fetch);

    expect(models).toHaveLength(2);
    expect(models[0]).toEqual({
      configValue: "openrouter/deepseek/deepseek-v4-pro",
      id: "deepseek/deepseek-v4-pro",
      displayName: "DeepSeek: DeepSeek V4 Pro",
      provider: "openrouter",
      reasoning: true,
    });
    expect(models[1].reasoning).toBe(false);
  });

  it("caches the catalog across calls", async () => {
    const fetchMock = vi.fn(async () => catalogResponse([{ id: "a/b", name: "A B" }]));
    await fetchOpenRouterCatalog(fetchMock as unknown as typeof fetch);
    await fetchOpenRouterCatalog(fetchMock as unknown as typeof fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns the last good list when the API fails", async () => {
    const good = vi.fn(async () => catalogResponse([{ id: "a/b", name: "A B" }]));
    await fetchOpenRouterCatalog(good as unknown as typeof fetch);

    const failing = vi.fn(async () => new Response("boom", { status: 500 }));
    const models = await fetchOpenRouterCatalog(failing as unknown as typeof fetch);
    expect(models).toEqual([
      {
        configValue: "openrouter/a/b",
        id: "a/b",
        displayName: "A B",
        provider: "openrouter",
        reasoning: false,
      },
    ]);
  });
});
