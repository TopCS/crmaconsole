import { readWorkspaceFile } from "@/lib/workspace";

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
