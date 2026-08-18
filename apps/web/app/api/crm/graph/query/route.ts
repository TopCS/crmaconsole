import { heuristicGraphFilter, parseGraphFilterJson, type GraphFilter } from "@/lib/crm-graph-nl";
import { KNOWN_OBJECT_TYPES } from "@/lib/crm-graph";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "openai/gpt-4o-mini";
const LLM_TIMEOUT_MS = 8_000;

function resolveApiKey(): string | null {
  return process.env.OPENROUTER_API_KEY?.trim() || null;
}

function resolveModel(): string {
  return process.env.GRAPH_NL_MODEL?.trim() || DEFAULT_MODEL;
}

function buildPrompt(query: string): string {
  const types = KNOWN_OBJECT_TYPES.join(", ");
  return [
    "You translate a natural-language CRM query into a strict JSON filter for a relationship graph.",
    `The graph node types are: ${types}.`,
    "Respond with ONLY a single JSON object (no prose, no markdown fences) of exactly this shape:",
    '{"types":["people"],"labelSearch":null,"focusLabel":"Acme Corp","depth":2}',
    "Rules:",
    '- "types": array of relevant node types from the list above (empty [] if none specified).',
    '- "labelSearch": a short substring to match against node names, or null.',
    '- "focusLabel": the name of a single entity the user wants to center on, or null.',
    '- "depth": integer 1-3 for hop distance when focusing, otherwise null.',
    "",
    `Query: ${query}`,
  ].join("\n");
}

async function translateWithLlm(query: string): Promise<GraphFilter | null> {
  const apiKey = resolveApiKey();
  if (!apiKey) {return null;}

  try {
    const res = await fetch(OPENROUTER_BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: resolveModel(),
        messages: [
          { role: "system", content: "You are a precise query-to-JSON translator. Output only valid JSON." },
          { role: "user", content: buildPrompt(query) },
        ],
        temperature: 0,
        max_tokens: 200,
      }),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });

    if (!res.ok) {return null;}

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) {return null;}

    const filter = parseGraphFilterJson(content);
    // A fully-empty parse means the model didn't give us anything usable —
    // signal failure so the caller falls back to the heuristic.
    const usable = filter.types.length > 0 || filter.labelSearch || filter.focusLabel || filter.depth;
    return usable ? filter : null;
  } catch {
    return null;
  }
}

/**
 * POST /api/crm/graph/query  { query: "persone collegate ad Acme entro 2 hop" }
 *
 * Translates a natural-language query into a structured, SQL-safe graph
 * filter using OpenRouter when an API key is configured, and a local keyword
 * heuristic otherwise. Never runs the agent and never interpolates user/LLM
 * output into SQL.
 */
export async function POST(req: Request): Promise<Response> {
  let query = "";
  try {
    const body = (await req.json()) as { query?: unknown };
    if (typeof body.query === "string") {query = body.query.trim();}
  } catch {
    // fall through to the empty-query guard
  }

  if (!query) {
    return Response.json({ error: "query is required" }, { status: 400 });
  }

  const llm = await translateWithLlm(query);
  const filter: GraphFilter = llm ?? heuristicGraphFilter(query);
  const source = llm ? "llm" : "heuristic";

  return Response.json({ filter, source }, { headers: { "Cache-Control": "no-store" } });
}
