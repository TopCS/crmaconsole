import {
  deleteDirectComposioConfig,
  isDirectComposioConfigured,
  readDirectComposioConfig,
  writeDirectComposioConfig,
} from "@/lib/composio-direct";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET/POST/DELETE /api/settings/composio — manage the direct Composio API
 * key (stored per workspace in .crm-a-composio.json). When set, all Composio
 * traffic (tool execution, toolkit catalog, OAuth connect) goes straight to
 * Composio's Platform API instead of the Crm-A Cloud gateway.
 */

export async function GET() {
  const configured = isDirectComposioConfigured();
  const stored = readDirectComposioConfig();
  return Response.json({
    configured,
    source: process.env.COMPOSIO_API_KEY?.trim() ? "env" : stored ? "stored" : null,
    apiKeyMasked: stored ? `••••${stored.apiKey.slice(-4)}` : null,
  });
}

export async function POST(req: Request) {
  let body: { apiKey?: string };
  try {
    body = (await req.json()) as { apiKey?: string };
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const apiKey = body.apiKey?.trim();
  if (!apiKey) {
    return Response.json({ error: "apiKey is required." }, { status: 400 });
  }
  writeDirectComposioConfig({ apiKey });
  return Response.json({ configured: true });
}

export async function DELETE() {
  deleteDirectComposioConfig();
  return Response.json({ configured: false });
}
