import { afterAll, afterEach, beforeEach, vi } from "vitest";

// Ensure Vitest environment is properly set
process.env.VITEST = "true";
// Config validation walks plugin manifests; keep an aggressive cache in tests to avoid
// repeated filesystem discovery across suites/workers.
process.env.OPENCLAW_PLUGIN_MANIFEST_CACHE_MS ??= "60000";
// Vitest vm forks can load transitive lockfile helpers many times per worker.
// Raise listener budget to avoid noisy MaxListeners warnings and warning-stack overhead.
const TEST_PROCESS_MAX_LISTENERS = 128;
if (process.getMaxListeners() > 0 && process.getMaxListeners() < TEST_PROCESS_MAX_LISTENERS) {
  process.setMaxListeners(TEST_PROCESS_MAX_LISTENERS);
}

import type { OutboundSendDeps } from "../src/infra/outbound/deliver.js";
import { withIsolatedTestHome } from "./test-env.js";

// Set HOME/state isolation before importing any runtime OpenClaw modules.
const testEnv = withIsolatedTestHome();
afterAll(() => testEnv.cleanup());

const [{ installProcessWarningFilter }, { setActivePluginRegistry }, { createTestRegistry }] =
  await Promise.all([
    import("../src/infra/warning-filter.js"),
    import("../src/plugins/runtime.js"),
    import("../src/test-utils/channel-plugins.js"),
  ]);

installProcessWarningFilter();

// Define types locally since original modules were removed
type ChannelId = string;
type DeliveryMode = "direct" | "gateway";
type ChannelOutboundAdapter = {
  deliveryMode: DeliveryMode;
  sendText: (params: {
    deps?: OutboundSendDeps;
    to: string;
    text: string;
  }) => Promise<{ channel: string; messageId?: string }>;
  sendMedia?: (params: {
    deps?: OutboundSendDeps;
    to: string;
    text: string;
    mediaUrl: string;
  }) => Promise<{ channel: string; messageId?: string }>;
};

type ChannelPluginMeta = {
  id: ChannelId;
  label: string;
  selectionLabel: string;
  docsPath: string;
  blurb: string;
  aliases?: string[];
  preferSessionLookupForAnnounceTarget?: boolean;
};

type ChannelPlugin = {
  id: ChannelId;
  meta: ChannelPluginMeta;
  capabilities: { chatTypes: string[] };
  config: {
    listAccountIds: (cfg: Record<string, unknown>) => string[];
    resolveAccount: (cfg: Record<string, unknown>, accountId?: string | null) => unknown;
    isConfigured: (_account: unknown, cfg: Record<string, unknown>) => Promise<boolean>;
  };
  outbound: ChannelOutboundAdapter;
  status?: {
    buildChannelSummary: () => Promise<Record<string, unknown>>;
  };
};

const pickSendFn = (id: ChannelId, deps?: OutboundSendDeps) => {
  switch (id) {
    case "discord":
      return deps?.sendDiscord;
    case "slack":
      return deps?.sendSlack;
    case "telegram":
      return deps?.sendTelegram;
    case "whatsapp":
      return deps?.sendWhatsApp;
    case "signal":
      return deps?.sendSignal;
    case "imessage":
      return deps?.sendIMessage;
    default:
      return undefined;
  }
};

const createStubOutbound = (
  id: ChannelId,
  deliveryMode: ChannelOutboundAdapter["deliveryMode"] = "direct",
): ChannelOutboundAdapter => ({
  deliveryMode,
  sendText: async ({ deps, to, text }) => {
    const send = pickSendFn(id, deps);
    if (send) {
      // oxlint-disable-next-line typescript/no-explicit-any
      const result = await send(to, text, { verbose: false } as any);
      return { channel: id, ...result };
    }
    return { channel: id, messageId: "test" };
  },
  sendMedia: async ({ deps, to, text, mediaUrl }) => {
    const send = pickSendFn(id, deps);
    if (send) {
      // oxlint-disable-next-line typescript/no-explicit-any
      const result = await send(to, text, { verbose: false, mediaUrl } as any);
      return { channel: id, ...result };
    }
    return { channel: id, messageId: "test" };
  },
});

const createStubPlugin = (params: {
  id: ChannelId;
  label?: string;
  aliases?: string[];
  deliveryMode?: ChannelOutboundAdapter["deliveryMode"];
  preferSessionLookupForAnnounceTarget?: boolean;
}): ChannelPlugin => ({
  id: params.id,
  meta: {
    id: params.id,
    label: params.label ?? String(params.id),
    selectionLabel: params.label ?? String(params.id),
    docsPath: `/channels/${params.id}`,
    blurb: "test stub.",
    aliases: params.aliases,
    preferSessionLookupForAnnounceTarget: params.preferSessionLookupForAnnounceTarget,
  },
  capabilities: { chatTypes: ["direct", "group"] },
  config: {
    listAccountIds: (cfg: Record<string, unknown>) => {
      const channels = cfg.channels as Record<string, unknown> | undefined;
      const entry = channels?.[params.id];
      if (!entry || typeof entry !== "object") {
        return [];
      }
      const accounts = (entry as { accounts?: Record<string, unknown> }).accounts;
      const ids = accounts ? Object.keys(accounts).filter(Boolean) : [];
      return ids.length > 0 ? ids : ["default"];
    },
    resolveAccount: (cfg: Record<string, unknown>, accountId?: string | null) => {
      const channels = cfg.channels as Record<string, unknown> | undefined;
      const entry = channels?.[params.id];
      if (!entry || typeof entry !== "object") {
        return {};
      }
      const accounts = (entry as { accounts?: Record<string, unknown> }).accounts;
      const match = accountId ? accounts?.[accountId] : undefined;
      return (match && typeof match === "object") || typeof match === "string" ? match : entry;
    },
    isConfigured: async (_account, cfg: Record<string, unknown>) => {
      const channels = cfg.channels as Record<string, unknown> | undefined;
      return Boolean(channels?.[params.id]);
    },
  },
  outbound: createStubOutbound(params.id, params.deliveryMode),
});

const createDefaultRegistry = () =>
  createTestRegistry([
    {
      pluginId: "discord",
      plugin: createStubPlugin({ id: "discord", label: "Discord" }),
      source: "test",
    },
    {
      pluginId: "slack",
      plugin: createStubPlugin({ id: "slack", label: "Slack" }),
      source: "test",
    },
    {
      pluginId: "telegram",
      plugin: {
        ...createStubPlugin({ id: "telegram", label: "Telegram" }),
        status: {
          buildChannelSummary: async () => ({
            configured: false,
            tokenSource: process.env.TELEGRAM_BOT_TOKEN ? "env" : "none",
          }),
        },
      },
      source: "test",
    },
    {
      pluginId: "whatsapp",
      plugin: createStubPlugin({
        id: "whatsapp",
        label: "WhatsApp",
        deliveryMode: "gateway",
        preferSessionLookupForAnnounceTarget: true,
      }),
      source: "test",
    },
    {
      pluginId: "signal",
      plugin: createStubPlugin({ id: "signal", label: "Signal" }),
      source: "test",
    },
    {
      pluginId: "imessage",
      plugin: createStubPlugin({ id: "imessage", label: "iMessage", aliases: ["imsg"] }),
      source: "test",
    },
  ]);

// Creating a fresh registry before every single test was measurable overhead.
// The registry is treated as immutable by production code; tests that need a
// custom registry set it explicitly.
const DEFAULT_PLUGIN_REGISTRY = createDefaultRegistry();

beforeEach(() => {
  setActivePluginRegistry(DEFAULT_PLUGIN_REGISTRY);
});

afterEach(() => {
  // Guard against leaked fake timers across test files/workers.
  if (vi.isFakeTimers()) {
    vi.useRealTimers();
  }
});
