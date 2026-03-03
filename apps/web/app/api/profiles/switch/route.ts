import {
  discoverProfiles,
  getEffectiveProfile,
  resolveOpenClawStateDir,
  resolveWorkspaceRoot,
  setUIActiveProfile,
} from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PROFILE_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

function normalizeSwitchProfile(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.toLowerCase() === "default") {
    return "default";
  }
  if (!PROFILE_NAME_RE.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { profile?: unknown };
  const requestedProfile = normalizeSwitchProfile(body.profile);
  if (!requestedProfile) {
    return Response.json(
      { error: "Invalid profile name. Use letters, numbers, hyphens, or underscores." },
      { status: 400 },
    );
  }

  const discovered = discoverProfiles();
  const availableNames = new Set(discovered.map((profile) => profile.name));
  if (!availableNames.has(requestedProfile)) {
    return Response.json(
      { error: `Profile '${requestedProfile}' was not found.` },
      { status: 404 },
    );
  }

  const pinnedEnvProfile = process.env.OPENCLAW_PROFILE?.trim() || null;
  if (pinnedEnvProfile && pinnedEnvProfile !== requestedProfile) {
    return Response.json(
      {
        error:
          "Profile switch was overridden by OPENCLAW_PROFILE in the server environment.",
      },
      { status: 409 },
    );
  }

  setUIActiveProfile(requestedProfile === "default" ? null : requestedProfile);
  const activeProfile = getEffectiveProfile() ?? "default";
  if (activeProfile !== requestedProfile) {
    return Response.json(
      {
        error:
          "Profile switch was overridden by OPENCLAW_PROFILE in the server environment.",
      },
      { status: 409 },
    );
  }

  const selected = discoverProfiles().find((profile) => profile.name === activeProfile) ?? null;
  return Response.json({
    activeProfile,
    stateDir: resolveOpenClawStateDir(activeProfile === "default" ? null : activeProfile),
    workspaceRoot: resolveWorkspaceRoot(),
    profile: selected,
  });
}
