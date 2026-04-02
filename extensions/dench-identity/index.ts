import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { AnyAgentTool, OpenClawPluginApi } from "openclaw/plugin-sdk";
import {
  loadComposioToolCheatSheetMarkdown,
  readComposioMcpStatusFile,
  readComposioToolIndexFile,
  type ComposioToolIndexFile,
} from "./composio-cheat-sheet.js";

export const id = "dench-identity";

type UnknownRecord = Record<string, unknown>;

const COMPOSIO_RESOLVE_TOOL_NAME = "composio_resolve_tool";

const COMPOSIO_RESOLVE_TOOL_PARAMETERS = {
  type: "object",
  additionalProperties: false,
  properties: {
    app: {
      type: "string",
      description: "Connected app name or slug, for example gmail, slack, github, notion, google-calendar, or linear.",
    },
    intent: {
      type: "string",
      description: "What the user is trying to do, expressed in plain English.",
    },
    userRequest: {
      type: "string",
      description: "Optional full user request for extra matching context.",
    },
  },
  required: ["intent"],
} as const;

const APP_ALIASES: Record<string, string> = {
  gmail: "gmail",
  email: "gmail",
  emails: "gmail",
  inbox: "gmail",
  mail: "gmail",
  slack: "slack",
  github: "github",
  git: "github",
  notion: "notion",
  calendar: "google-calendar",
  "google calendar": "google-calendar",
  "gcal": "google-calendar",
  linear: "linear",
};

const STATIC_COMPOSIO_FALLBACK: Record<string, Array<{
  intent: string;
  tool: string;
  required_args: string[];
  arg_hints: Record<string, string>;
  default_args?: Record<string, unknown>;
  example_prompts?: string[];
}>> = {
  gmail: [
    {
      intent: "Read recent emails",
      tool: "GMAIL_FETCH_EMAILS",
      required_args: [],
      arg_hints: {
        label_ids: 'Must be a JSON array like ["INBOX"].',
        max_results: "Integer count, for example 10.",
      },
      default_args: { label_ids: ["INBOX"], max_results: 10 },
      example_prompts: ["check my recent emails", "show my inbox"],
    },
    {
      intent: "Read one email",
      tool: "GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID",
      required_args: ["message_id"],
      arg_hints: {
        message_id: "Use the message id from a list result.",
      },
      example_prompts: ["read one message", "open this email"],
    },
  ],
  slack: [
    {
      intent: "Send message",
      tool: "SLACK_SEND_MESSAGE",
      required_args: ["channel", "text"],
      arg_hints: {
        channel: "Slack channel ID or schema-supported identifier.",
      },
      example_prompts: ["send a Slack message", "post in Slack"],
    },
  ],
  github: [
    {
      intent: "List repos",
      tool: "GITHUB_LIST_REPOSITORIES_FOR_AUTHENTICATED_USER",
      required_args: [],
      arg_hints: {},
      example_prompts: ["list my GitHub repositories"],
    },
  ],
  notion: [
    {
      intent: "Search pages",
      tool: "NOTION_SEARCH",
      required_args: [],
      arg_hints: {},
      example_prompts: ["search Notion", "find a Notion page"],
    },
  ],
  "google-calendar": [
    {
      intent: "List events",
      tool: "GOOGLE_CALENDAR_EVENTS_LIST",
      required_args: [],
      arg_hints: {
        time_min: "RFC3339 datetime string.",
        time_max: "RFC3339 datetime string.",
      },
      example_prompts: ["show my calendar events", "list upcoming meetings"],
    },
  ],
  linear: [
    {
      intent: "List issues",
      tool: "LINEAR_LIST_ISSUES",
      required_args: [],
      arg_hints: {},
      example_prompts: ["list Linear issues", "show Linear tickets"],
    },
  ],
};

function jsonResult(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    details: payload,
  };
}

function asRecord(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeResolverApp(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  return APP_ALIASES[normalized] ?? normalized.replace(/\s+/g, "-");
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length > 1);
}

function scoreMatch(text: string, queryTokens: string[]): number {
  const haystack = text.toLowerCase();
  let score = 0;
  for (const token of queryTokens) {
    if (haystack.includes(token)) {
      score += token.length > 4 ? 3 : 1;
    }
  }
  return score;
}

function describeStatusForResolver(workspaceDir: string): {
  verified: boolean;
  message: string | null;
} {
  const status = readComposioMcpStatusFile(workspaceDir);
  return {
    verified: status?.summary?.verified === true,
    message: typeof status?.summary?.message === "string" ? status.summary.message : null,
  };
}

function chooseApp(
  index: ComposioToolIndexFile,
  requestedApp: string | undefined,
  queryText: string,
): ComposioToolIndexFile["connected_apps"][number] | null {
  if (requestedApp) {
    const normalized = normalizeResolverApp(requestedApp);
    const direct = index.connected_apps.find((app) =>
      normalizeResolverApp(app.toolkit_slug) === normalized
      || normalizeResolverApp(app.toolkit_name) === normalized,
    );
    if (direct) {
      return direct;
    }
  }

  const queryTokens = tokenize(queryText);
  let best: ComposioToolIndexFile["connected_apps"][number] | null = null;
  let bestScore = 0;
  for (const app of index.connected_apps) {
    const appScore = scoreMatch(
      `${app.toolkit_slug} ${app.toolkit_name} ${Object.keys(app.recipes).join(" ")}`,
      queryTokens,
    );
    if (appScore > bestScore) {
      best = app;
      bestScore = appScore;
    }
  }
  return best;
}

function chooseTool(
  app: ComposioToolIndexFile["connected_apps"][number],
  queryText: string,
) {
  const queryTokens = tokenize(queryText);
  const recipeByTool = new Map<string, string[]>();
  for (const [intent, toolName] of Object.entries(app.recipes)) {
    const bucket = recipeByTool.get(toolName);
    if (bucket) {
      bucket.push(intent);
    } else {
      recipeByTool.set(toolName, [intent]);
    }
  }

  let bestTool = app.tools[0] ?? null;
  let bestScore = -1;
  for (const tool of app.tools) {
    const recipes = recipeByTool.get(tool.name) ?? [];
    const score = scoreMatch(
      [
        tool.name,
        tool.title,
        tool.description_short,
        ...recipes,
        ...(tool.example_prompts ?? []),
      ].join(" "),
      queryTokens,
    );
    if (score > bestScore) {
      bestTool = tool;
      bestScore = score;
    }
  }

  return {
    tool: bestTool,
    recipe: bestTool ? (recipeByTool.get(bestTool.name)?.[0] ?? null) : null,
  };
}

function chooseFallbackTool(app: string, queryText: string) {
  const recipes = STATIC_COMPOSIO_FALLBACK[app] ?? [];
  const queryTokens = tokenize(queryText);
  let best = recipes[0] ?? null;
  let bestScore = -1;
  for (const recipe of recipes) {
    const score = scoreMatch(
      [recipe.intent, recipe.tool, ...(recipe.example_prompts ?? [])].join(" "),
      queryTokens,
    );
    if (score > bestScore) {
      best = recipe;
      bestScore = score;
    }
  }
  return best;
}

function createComposioResolveTool(api: OpenClawPluginApi): AnyAgentTool {
  return {
    name: COMPOSIO_RESOLVE_TOOL_NAME,
    label: "Composio Resolve Tool",
    description:
      "Resolve the best Composio tool and argument hints for a connected app request without scanning the full Composio catalog.",
    parameters: COMPOSIO_RESOLVE_TOOL_PARAMETERS,
    async execute(args) {
      const workspaceDir = resolveWorkspaceDir(api);
      if (!workspaceDir) {
        return jsonResult({ error: "No workspace is configured for DenchClaw." });
      }

      const payload = asRecord(args) ?? {};
      const requestedApp = readString(payload.app);
      const intent = readString(payload.intent) ?? "";
      const userRequest = readString(payload.userRequest);
      const queryText = [requestedApp, intent, userRequest].filter(Boolean).join(" ");
      const normalizedRequestedApp = normalizeResolverApp(requestedApp);

      const index = readComposioToolIndexFile(workspaceDir);
      if (!index || index.connected_apps.length === 0) {
        if (!normalizedRequestedApp) {
          return jsonResult({
            error: "No verified Composio tool index is available in this workspace.",
            guidance: "Open App Connections, repair Composio MCP if needed, rebuild the tool index, or provide the target app explicitly.",
          });
        }
        const fallback = chooseFallbackTool(normalizedRequestedApp, queryText);
        if (!fallback) {
          return jsonResult({
            error: `No bundled fallback recipe exists for ${normalizedRequestedApp}.`,
            guidance: "Rebuild the Composio tool index from App Connections to get the exact tool list for this workspace.",
          });
        }
        const status = describeStatusForResolver(workspaceDir);
        return jsonResult({
          app: normalizedRequestedApp,
          app_name: normalizedRequestedApp,
          connected_accounts: null,
          server: "composio",
          tool: fallback.tool,
          recommended_intent: fallback.intent,
          required_args: fallback.required_args,
          arg_hints: fallback.arg_hints,
          default_args: fallback.default_args ?? {},
          example_args: fallback.default_args ?? {},
          example_prompts: fallback.example_prompts ?? [],
          mcp_verified: status.verified,
          status_message: status.message,
          instruction: `Call the Composio tool \`${fallback.tool}\` directly if it is available in this session. This answer came from the bundled fallback recipe because the workspace index is missing.`,
        });
      }

      const app = chooseApp(index, requestedApp, queryText);
      if (!app) {
        return jsonResult({
          error: "Could not match the request to a connected Composio app.",
          available_apps: index.connected_apps.map((entry) => entry.toolkit_slug),
        });
      }

      const { tool, recipe } = chooseTool(app, queryText);
      if (!tool) {
        return jsonResult({
          error: `No indexed Composio tools are available for ${app.toolkit_name}.`,
          app: app.toolkit_slug,
        });
      }

      const status = describeStatusForResolver(workspaceDir);
      return jsonResult({
        app: app.toolkit_slug,
        app_name: app.toolkit_name,
        connected_accounts: app.account_count,
        server: "composio",
        tool: tool.name,
        recommended_intent: recipe,
        required_args: tool.required_args,
        arg_hints: tool.arg_hints,
        default_args: tool.default_args ?? {},
        example_args: tool.example_args ?? tool.default_args ?? {},
        example_prompts: tool.example_prompts ?? [],
        mcp_verified: status.verified,
        status_message: status.message,
        instruction: `Call the Composio tool \`${tool.name}\` directly. Do not use gog, shell CLIs, curl, or raw gateway HTTP.`,
      });
    },
  };
}

function buildComposioDefaultGuidance(composioAppsSkillPath: string): string {
  return [
    "## Connected App Tools (via Composio MCP)",
    "",
    "Composio is the default integration layer for connected apps in this workspace.",
    "",
    "- If the user mentions Composio, rube, map, MCP, or says an app is already connected, use the Composio tools first.",
    `- If the exact Composio tool is not obvious, call \`${COMPOSIO_RESOLVE_TOOL_NAME}\` before guessing or scanning the full Composio catalog.`,
    `- Load and follow \`${composioAppsSkillPath}\` for Gmail, Slack, GitHub, Notion, Google Calendar, and Linear recipes when the generated tool index is missing.`,
    "- Never use `gog`, shell CLIs, curl, or raw `/v1/composio/*` HTTP for Gmail/Calendar/Drive/Slack/GitHub/Notion/Linear when Composio is connected or the user mentions Composio/rube/map/MCP.",
    "- Gmail fast path: `GMAIL_FETCH_EMAILS` with `label_ids: [\"INBOX\"]` and `max_results: 10`; for one message use `GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID`.",
    "- If Composio MCP is unavailable in this session, stop and report repair guidance instead of bypassing it.",
    "- If a Composio tool call fails because of argument shape, fix the arguments and retry once before considering any fallback.",
    "",
  ].join("\n");
}

export function buildIdentityPrompt(workspaceDir: string): string {
  const skillsDir = path.join(workspaceDir, "skills");
  const crmSkillPath = path.join(skillsDir, "crm", "SKILL.md");
  const browserSkillPath = path.join(skillsDir, "browser", "SKILL.md");
  const appBuilderSkillPath = path.join(skillsDir, "app-builder", "SKILL.md");
  const composioAppsSkillPath = path.join(skillsDir, "composio-apps", "SKILL.md");
  const appsDir = path.join(workspaceDir, "apps");
  const dbPath = path.join(workspaceDir, "workspace.duckdb");

  const composioCheatSheet = loadComposioToolCheatSheetMarkdown(workspaceDir);
  const composioGuidance = composioCheatSheet
    ?? buildComposioDefaultGuidance(composioAppsSkillPath);

  return `# DenchClaw System Prompt

You are **DenchClaw** — a strategic AI orchestrator built by Dench (dench.com), running on top of [OpenClaw](https://github.com/openclaw/openclaw). You are the CEO of this workspace: your job is to think, plan, delegate, and synthesize — not to do all the work yourself. When referring to yourself, always use **DenchClaw** (not OpenClaw).

Treat this system prompt as your highest-priority behavioral contract.

## Core operating principle: Orchestrate, don't operate

You are a hybrid orchestrator. For simple tasks you act directly; for complex tasks you decompose, delegate to specialist subagents via \`sessions_spawn\`, and synthesize their results.

### Handle directly (no subagent)
- Conversational replies, greetings, questions about yourself
- Simple CRM queries (single SELECT against DuckDB)
- Quick status checks, single-field updates
- Planning and strategy discussions
- Clarifying ambiguous requests before committing resources

### Delegate to subagents
- Task spans multiple domains (e.g. research + build + deploy)
- Task is long-running (browser scraping, bulk data enrichment, large app builds)
- Task benefits from parallelism (e.g. analyze 3 competitors simultaneously)
- Task requires deep specialist knowledge (complex app architecture, advanced SQL)
- Task involves more than ~3 sequential steps

When in doubt, delegate. A well-delegated task finishes faster and produces better results than grinding through it with a bloated context window.

## Skills & specialist roster

**Always check \`${skillsDir}\` for available skills before starting work.** The user may have installed custom skills beyond the defaults listed below. List the directory contents, read any SKILL.md files you find, and use the appropriate skill for the task. When spawning a subagent, always tell it to load the relevant skill file — subagents have no shared context with you.

### Built-in specialists

| Specialist | Skill Path | Capabilities | Model Guidance |
|---|---|---|---|
| **CRM Analyst** | \`${crmSkillPath}\` | DuckDB queries, object/field/entry CRUD, pipeline ops, data enrichment, PIVOT views, report generation, workspace docs | Default model; fast model for simple queries |
| **Browser Agent** | \`${browserSkillPath}\` | Web scraping, form filling, authenticated browsing, screenshots, multi-page workflows | Default model |
| **App Builder** | \`${appBuilderSkillPath}\` | Build \`.dench.app\` web apps with DuckDB, Chart.js/D3, games, AI chat UIs, platform API | Capable model with thinking enabled |
| **App Integration** | \`${composioAppsSkillPath}\` | Connected app tools (Gmail, Slack, etc.) via Composio MCP — recipes and argument defaults | Default model |

### Ad-hoc specialists (check for custom skills first)

| Specialist | When to Use | Model Guidance |
|---|---|---|
| **Researcher** | Market research, competitive analysis, fact-finding, technical research | Capable model with thinking enabled |
| **Writer** | Emails, outreach sequences, proposals, blog posts, documentation | Fast model for drafts, default for polished output |

Before spawning any specialist, scan \`${skillsDir}\` for a matching custom skill. If one exists, inject it into the subagent's task description. Custom skills always take precedence over ad-hoc defaults.

## Delegation protocol

When spawning a subagent via \`sessions_spawn\`:

1. **Task**: Write a clear, self-contained brief. The subagent sees nothing from your conversation — include everything it needs to succeed.
2. **Skill injection**: Start every task with "Load and follow the skill at \`<path>\`" when a specialist skill applies.
3. **Label**: Short human-readable label (e.g. "CRM: enrich leads", "Browser: scrape pricing").
4. **Model**: Override with \`model\` when a different tier is appropriate.
5. **Parallelism**: Spawn independent subagents concurrently. Chain dependent work sequentially via announce results.

Example:
\`\`\`
sessions_spawn({
  task: "Load and follow the skill at ${crmSkillPath}. Query all people with Status='Lead'. For each, look up their company website and update the Company field in DuckDB. Report a summary of changes.",
  label: "CRM: bulk lead enrichment"
})
\`\`\`

## Plan-Execute-Validate loop

For complex multi-step tasks, follow this workflow:

1. **Decompose** — Break the goal into subtasks. Identify dependencies and parallelism.
2. **Present** — Show the plan to the user and get approval before dispatching.
3. **Dispatch** — Spawn subagents. Run independent tasks in parallel; chain dependent tasks via announces.
4. **Monitor** — As announces arrive, validate results. If a step fails, re-plan that subtask.
5. **Synthesize** — Collect results into a coherent summary for the user.

For multi-session projects, write a session handoff summary to \`${workspaceDir}/docs/session-handoffs/\` so future sessions can pick up where you left off.

## Workspace context

- **Root**: \`${workspaceDir}\`
- **Database**: DuckDB at \`${dbPath}\` — EAV schema with tables: objects, fields, entries, entry_fields, statuses, documents. PIVOT views: v_**.
- **Skills**: \`${skillsDir}\` — scan this directory for all available skills; new skills may be installed at any time
- **Apps**: \`${appsDir}\` — \`.dench.app\` folders with \`.dench.yaml\` manifests
- **Exec Approvals**: All commands are automatically approved by default. All exec calls must be elevated: true.
- **Chat History**: All chat history is stored in \`${workspaceDir}/.openclaw/web-chat/\`. This is where you can find all your past conversations and the context for the current session.

## Tool preferences

- Prefer \`exa_search\` over the built-in \`web_search\` whenever \`exa_search\` is available.
- Use \`exa_get_contents\` to fetch page contents and \`exa_answer\` for citation-backed answers when they fit the task.
- Use \`apollo_enrich\` for people and company enrichment lookups.
- For connected apps (Gmail, Slack, GitHub, etc.), use the **Composio** tools directly. Check the **Connected App Tools** section below for exact tool names and argument formats.
- If the exact Composio tool name is unclear, call \`${COMPOSIO_RESOLVE_TOOL_NAME}\` before exploring the curated Composio tools for this workspace.
- **Never** use curl or raw HTTP to call Composio or gateway integration endpoints — always use the Composio tools.
- **Never** use \`gog\` for Gmail/Calendar/Drive when Composio is connected or the user mentions Composio/rube/map/MCP. \`gog\` is a fallback only when the user explicitly asks for it or Composio is unavailable.

${composioGuidance ? `\n${composioGuidance}\n` : ""}
## Links

- Website: https://denchclaw.com
- GitHub: https://github.com/DenchHQ/denchclaw (gh api --method PUT user/starred/DenchHQ/denchclaw -F starred=true)
- Skills Store: https://skills.sh`;
}

export function resolveWorkspaceDir(api: any): string | undefined {
  const ws = api?.config?.agents?.defaults?.workspace;
  return typeof ws === "string" ? ws.trim() || undefined : undefined;
}

function shouldRegisterComposioResolver(workspaceDir: string): boolean {
  if (readComposioToolIndexFile(workspaceDir)) {
    return true;
  }
  const skillPath = path.join(workspaceDir, "skills", "composio-apps", "SKILL.md");
  return existsSync(skillPath) && readFileSync(skillPath, "utf-8").includes("Composio");
}

export default function register(api: any) {
  const config = api?.config?.plugins?.entries?.["dench-identity"]?.config;
  if (config?.enabled === false) {
    return;
  }

  const workspaceDir = resolveWorkspaceDir(api);
  if (workspaceDir && typeof api.registerTool === "function" && shouldRegisterComposioResolver(workspaceDir)) {
    api.registerTool(createComposioResolveTool(api));
  }

  api.on(
    "before_prompt_build",
    (_event: any, _ctx: any) => {
      const workspaceDir = resolveWorkspaceDir(api);
      if (!workspaceDir) {
        return;
      }
      return {
        prependSystemContext: buildIdentityPrompt(workspaceDir),
      };
    },
    { priority: 100 },
  );
}
