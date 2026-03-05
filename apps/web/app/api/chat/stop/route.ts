/**
 * POST /api/chat/stop
 *
 * Abort an active agent run. Called by the Stop button.
 * Works for both parent sessions (by sessionId) and subagent sessions (by sessionKey).
 */
import { abortRun, getActiveRun } from "@/lib/active-runs";
import { trackServer } from "@/lib/telemetry";

export const runtime = "nodejs";

export async function POST(req: Request) {
	const body: { sessionId?: string; sessionKey?: string } = await req
		.json()
		.catch(() => ({}));

	const isSubagentSession = typeof body.sessionKey === "string" && body.sessionKey.includes(":subagent:");
	const runKey = isSubagentSession && body.sessionKey ? body.sessionKey : body.sessionId;

	if (!runKey) {
		return new Response("sessionId or subagent sessionKey required", { status: 400 });
	}

	const run = getActiveRun(runKey);
	const canAbort =
		run?.status === "running" || run?.status === "waiting-for-subagents";
	const aborted = canAbort ? abortRun(runKey) : false;
	if (aborted) {
		trackServer("chat_stopped");
	}
	return Response.json({ aborted });
}
