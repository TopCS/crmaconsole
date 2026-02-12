import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { readWorkspaceFile, safeResolvePath } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const path = url.searchParams.get("path");

  if (!path) {
    return Response.json(
      { error: "Missing 'path' query parameter" },
      { status: 400 },
    );
  }

  const file = readWorkspaceFile(path);
  if (!file) {
    return Response.json(
      { error: "File not found or access denied" },
      { status: 404 },
    );
  }

  return Response.json(file);
}

/**
 * POST /api/workspace/file
 * Body: { path: string, content: string }
 *
 * Writes a file to the dench workspace. Creates parent directories as needed.
 */
export async function POST(req: Request) {
  let body: { path?: string; content?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { path: relPath, content } = body;
  if (!relPath || typeof relPath !== "string" || typeof content !== "string") {
    return Response.json(
      { error: "Missing 'path' and 'content' fields" },
      { status: 400 },
    );
  }

  const absPath = safeResolvePath(relPath);
  if (!absPath) {
    return Response.json(
      { error: "Invalid path or path traversal rejected" },
      { status: 400 },
    );
  }

  try {
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, content, "utf-8");
    return Response.json({ ok: true, path: relPath });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Write failed" },
      { status: 500 },
    );
  }
}
