import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { confirm, isCancel, spinner } from "@clack/prompts";
import { isTruthyEnvValue } from "../infra/env.js";
import { resolveRequiredHomeDir } from "../infra/home-dir.js";
import { defaultRuntime, type RuntimeEnv } from "../runtime.js";
import { stylePromptMessage } from "../terminal/prompt-style.js";
import { theme } from "../terminal/theme.js";
import { applyCliProfileEnv } from "./profile.js";

const DEFAULT_IRONCLAW_PROFILE = "ironclaw";
const DEFAULT_GATEWAY_PORT = 18789;
const DEFAULT_WEB_APP_PORT = 3100;
const WEB_APP_PROBE_ATTEMPTS = 20;
const WEB_APP_PROBE_DELAY_MS = 750;
const DEFAULT_BOOTSTRAP_ROLLOUT_STAGE = "default";
const DEFAULT_GATEWAY_LAUNCH_AGENT_LABEL = "ai.openclaw.gateway";

type BootstrapRolloutStage = "internal" | "beta" | "default";
type BootstrapCheckStatus = "pass" | "warn" | "fail";

export type BootstrapCheck = {
  id:
    | "openclaw-cli"
    | "profile"
    | "gateway"
    | "web-ui"
    | "state-isolation"
    | "daemon-label"
    | "rollout-stage"
    | "cutover-gates";
  status: BootstrapCheckStatus;
  detail: string;
  remediation?: string;
};

export type BootstrapDiagnostics = {
  rolloutStage: BootstrapRolloutStage;
  legacyFallbackEnabled: boolean;
  checks: BootstrapCheck[];
  hasFailures: boolean;
};

export type BootstrapOptions = {
  yes?: boolean;
  nonInteractive?: boolean;
  forceOnboard?: boolean;
  skipUpdate?: boolean;
  updateNow?: boolean;
  noOpen?: boolean;
  json?: boolean;
  gatewayPort?: string | number;
  webPort?: string | number;
};

type BootstrapSummary = {
  profile: string;
  onboarded: boolean;
  installedOpenClawCli: boolean;
  openClawCliAvailable: boolean;
  openClawVersion?: string;
  gatewayUrl: string;
  gatewayReachable: boolean;
  webUrl: string;
  webReachable: boolean;
  webOpened: boolean;
  diagnostics: BootstrapDiagnostics;
};

type SpawnResult = {
  stdout: string;
  stderr: string;
  code: number;
};

function resolveCommandForPlatform(command: string): string {
  if (process.platform !== "win32") {
    return command;
  }
  if (path.extname(command)) {
    return command;
  }
  const normalized = path.basename(command).toLowerCase();
  if (
    normalized === "npm" ||
    normalized === "pnpm" ||
    normalized === "npx" ||
    normalized === "yarn"
  ) {
    return `${command}.cmd`;
  }
  return command;
}

async function runCommandWithTimeout(
  argv: string[],
  options: { timeoutMs: number; cwd?: string; env?: NodeJS.ProcessEnv },
): Promise<SpawnResult> {
  const [command, ...args] = argv;
  if (!command) {
    return { code: 1, stdout: "", stderr: "missing command" };
  }
  return await new Promise<SpawnResult>((resolve, reject) => {
    const child = spawn(resolveCommandForPlatform(command), args, {
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      child.kill("SIGKILL");
    }, options.timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        code: typeof code === "number" ? code : 1,
        stdout,
        stderr,
      });
    });
  });
}

function parseOptionalPort(value: string | number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const raw = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(raw) || raw <= 0) {
    return undefined;
  }
  return raw;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeBootstrapRolloutStage(raw: string | undefined): BootstrapRolloutStage {
  const normalized = raw?.trim().toLowerCase();
  if (normalized === "internal" || normalized === "beta" || normalized === "default") {
    return normalized;
  }
  return DEFAULT_BOOTSTRAP_ROLLOUT_STAGE;
}

export function resolveBootstrapRolloutStage(
  env: NodeJS.ProcessEnv = process.env,
): BootstrapRolloutStage {
  return normalizeBootstrapRolloutStage(
    env.IRONCLAW_BOOTSTRAP_ROLLOUT ?? env.OPENCLAW_BOOTSTRAP_ROLLOUT,
  );
}

export function isLegacyFallbackEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    isTruthyEnvValue(env.IRONCLAW_BOOTSTRAP_LEGACY_FALLBACK) ||
    isTruthyEnvValue(env.OPENCLAW_BOOTSTRAP_LEGACY_FALLBACK)
  );
}

function normalizeVersionOutput(raw: string | undefined): string | undefined {
  const first = raw
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return first && first.length > 0 ? first : undefined;
}

function firstNonEmptyLine(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const first = value
      ?.split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (first) {
      return first;
    }
  }
  return undefined;
}

function resolveProfileStateDir(profile: string, env: NodeJS.ProcessEnv = process.env): string {
  const explicitStateDir = env.OPENCLAW_STATE_DIR?.trim();
  if (explicitStateDir) {
    return path.resolve(explicitStateDir);
  }
  const home = resolveRequiredHomeDir(env, os.homedir);
  if (!profile || profile === "default") {
    return path.join(home, ".openclaw");
  }
  return path.join(home, `.openclaw-${profile}`);
}

function resolveGatewayLaunchAgentLabel(profile: string): string {
  const normalized = profile.trim().toLowerCase();
  if (!normalized || normalized === "default") {
    return DEFAULT_GATEWAY_LAUNCH_AGENT_LABEL;
  }
  return `ai.openclaw.${normalized}`;
}

async function ensureGatewayModeLocal(profile: string): Promise<void> {
  const result = await runOpenClaw(
    ["openclaw", "--profile", profile, "config", "get", "gateway.mode"],
    10_000,
  );
  const currentMode = result.stdout.trim();
  if (currentMode === "local") {
    return;
  }
  await runOpenClawOrThrow({
    argv: ["openclaw", "--profile", profile, "config", "set", "gateway.mode", "local"],
    timeoutMs: 10_000,
    errorMessage: "Failed to set gateway.mode=local.",
  });
}

async function probeForWebApp(port: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1_500);
  try {
    const response = await fetch(`http://127.0.0.1:${port}`, {
      method: "GET",
      signal: controller.signal,
      redirect: "manual",
    });
    return response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function detectRunningWebAppPort(preferredPort: number): Promise<number> {
  if (await probeForWebApp(preferredPort)) {
    return preferredPort;
  }
  for (let offset = 1; offset <= 10; offset += 1) {
    const candidate = preferredPort + offset;
    if (candidate > 65535) {
      break;
    }
    if (await probeForWebApp(candidate)) {
      return candidate;
    }
  }
  return preferredPort;
}

async function waitForWebAppPort(preferredPort: number): Promise<number> {
  for (let attempt = 0; attempt < WEB_APP_PROBE_ATTEMPTS; attempt += 1) {
    const port = await detectRunningWebAppPort(preferredPort);
    if (await probeForWebApp(port)) {
      return port;
    }
    await sleep(WEB_APP_PROBE_DELAY_MS);
  }
  return preferredPort;
}

function resolveCliPackageRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    if (existsSync(path.join(dir, "package.json"))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return process.cwd();
}

/**
 * Spawn the pre-built standalone Next.js server as a detached background
 * process if it isn't already running on the target port.
 */
function startWebAppIfNeeded(port: number, stateDir: string): void {
  const pkgRoot = resolveCliPackageRoot();
  const standaloneServer = path.join(pkgRoot, "apps/web/.next/standalone/apps/web/server.js");
  if (!existsSync(standaloneServer)) {
    return;
  }

  const logDir = path.join(stateDir, "logs");
  mkdirSync(logDir, { recursive: true });
  const outFd = openSync(path.join(logDir, "web-app.log"), "a");
  const errFd = openSync(path.join(logDir, "web-app.err.log"), "a");

  const child = spawn(process.execPath, [standaloneServer], {
    cwd: path.dirname(standaloneServer),
    detached: true,
    stdio: ["ignore", outFd, errFd],
    env: { ...process.env, PORT: String(port), HOSTNAME: "127.0.0.1" },
  });
  child.unref();
}

async function runOpenClaw(argv: string[], timeoutMs: number): Promise<SpawnResult> {
  return await runCommandWithTimeout(argv, { timeoutMs });
}

async function runOpenClawOrThrow(params: {
  argv: string[];
  timeoutMs: number;
  errorMessage: string;
}): Promise<SpawnResult> {
  const result = await runOpenClaw(params.argv, params.timeoutMs);
  if (result.code === 0) {
    return result;
  }
  const detail = firstNonEmptyLine(result.stderr, result.stdout);
  throw new Error(detail ? `${params.errorMessage}\n${detail}` : params.errorMessage);
}

/**
 * Runs an openclaw sub-command with a visible spinner that streams progress
 * from the subprocess stdout/stderr into the spinner message.
 */
async function runOpenClawWithProgress(params: {
  argv: string[];
  timeoutMs: number;
  startMessage: string;
  successMessage: string;
  errorMessage: string;
}): Promise<SpawnResult> {
  const s = spinner();
  s.start(params.startMessage);

  const [command, ...args] = params.argv;
  if (!command) {
    s.stop(params.errorMessage, 1);
    throw new Error(params.errorMessage);
  }

  const result = await new Promise<SpawnResult>((resolve, reject) => {
    const child = spawn(resolveCommandForPlatform(command), args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        child.kill("SIGKILL");
      }
    }, params.timeoutMs);

    const updateSpinner = (chunk: string) => {
      const line = chunk
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .pop();
      if (line) {
        s.message(line.length > 72 ? `${line.slice(0, 69)}...` : line);
      }
    };

    child.stdout?.on("data", (chunk) => {
      const text = String(chunk);
      stdout += text;
      updateSpinner(text);
    });
    child.stderr?.on("data", (chunk) => {
      const text = String(chunk);
      stderr += text;
      updateSpinner(text);
    });
    child.once("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({ code: typeof code === "number" ? code : 1, stdout, stderr });
    });
  });

  if (result.code === 0) {
    s.stop(params.successMessage);
    return result;
  }

  const detail = firstNonEmptyLine(result.stderr, result.stdout);
  s.stop(detail ? `${params.errorMessage}: ${detail}` : params.errorMessage, result.code);
  throw new Error(detail ? `${params.errorMessage}\n${detail}` : params.errorMessage);
}

async function ensureOpenClawCliAvailable(): Promise<{
  available: boolean;
  installed: boolean;
  version?: string;
}> {
  const check = await runOpenClaw(["openclaw", "--version"], 4_000).catch(() => null);
  if (check?.code === 0) {
    return {
      available: true,
      installed: false,
      version: normalizeVersionOutput(check.stdout || check.stderr),
    };
  }

  const install = await runCommandWithTimeout(["npm", "install", "-g", "openclaw"], {
    timeoutMs: 10 * 60_000,
  }).catch(() => null);
  if (!install || install.code !== 0) {
    return { available: false, installed: false, version: undefined };
  }

  const versionCheck = await runOpenClaw(["openclaw", "--version"], 4_000).catch(() => null);
  return {
    available: Boolean(versionCheck && versionCheck.code === 0),
    installed: true,
    version: normalizeVersionOutput(versionCheck?.stdout || versionCheck?.stderr),
  };
}

async function probeGateway(profile: string): Promise<{ ok: boolean; detail?: string }> {
  const result = await runOpenClaw(
    ["openclaw", "--profile", profile, "health", "--json"],
    12_000,
  ).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    return {
      code: 1,
      stdout: "",
      stderr: message,
    } as SpawnResult;
  });
  if (result.code === 0) {
    return { ok: true };
  }
  return {
    ok: false,
    detail: firstNonEmptyLine(result.stderr, result.stdout),
  };
}

async function openUrl(url: string): Promise<boolean> {
  const argv =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  const result = await runCommandWithTimeout(argv, { timeoutMs: 5_000 }).catch(() => null);
  return Boolean(result && result.code === 0);
}

function remediationForGatewayFailure(detail: string | undefined, port: number): string {
  const normalized = detail?.toLowerCase() ?? "";
  if (normalized.includes("device token mismatch")) {
    return "Clear stale device auth and rerun: `openclaw --profile ironclaw onboard --install-daemon`.";
  }
  if (
    normalized.includes("unauthorized") ||
    normalized.includes("token") ||
    normalized.includes("password")
  ) {
    return "Gateway auth mismatch detected. Re-run `openclaw --profile ironclaw onboard --install-daemon`.";
  }
  if (normalized.includes("address already in use") || normalized.includes("eaddrinuse")) {
    return `Port ${port} is busy. Stop the conflicting process or rerun bootstrap with \`--gateway-port <port>\`.`;
  }
  return "Run `openclaw doctor --fix` and retry `ironclaw bootstrap --force-onboard`.";
}

function remediationForWebUiFailure(port: number): string {
  return `Web UI did not respond on ${port}. Ensure the apps/web directory exists and rerun with \`ironclaw bootstrap --web-port <port>\` if needed.`;
}

function createCheck(
  id: BootstrapCheck["id"],
  status: BootstrapCheckStatus,
  detail: string,
  remediation?: string,
): BootstrapCheck {
  return { id, status, detail, remediation };
}

export function buildBootstrapDiagnostics(params: {
  profile: string;
  openClawCliAvailable: boolean;
  openClawVersion?: string;
  gatewayPort: number;
  gatewayUrl: string;
  gatewayProbe: { ok: boolean; detail?: string };
  webPort: number;
  webReachable: boolean;
  rolloutStage: BootstrapRolloutStage;
  legacyFallbackEnabled: boolean;
  env?: NodeJS.ProcessEnv;
}): BootstrapDiagnostics {
  const env = params.env ?? process.env;
  const checks: BootstrapCheck[] = [];

  if (params.openClawCliAvailable) {
    checks.push(
      createCheck(
        "openclaw-cli",
        "pass",
        `OpenClaw CLI detected${params.openClawVersion ? ` (${params.openClawVersion})` : ""}.`,
      ),
    );
  } else {
    checks.push(
      createCheck(
        "openclaw-cli",
        "fail",
        "OpenClaw CLI is missing.",
        "Install OpenClaw globally once: `npm install -g openclaw`.",
      ),
    );
  }

  if (params.profile === DEFAULT_IRONCLAW_PROFILE) {
    checks.push(createCheck("profile", "pass", `Profile verified: ${params.profile}.`));
  } else {
    checks.push(
      createCheck(
        "profile",
        "warn",
        `Profile is set to '${params.profile}' (expected '${DEFAULT_IRONCLAW_PROFILE}' for side-by-side safety).`,
        `Rerun with \`OPENCLAW_PROFILE=${DEFAULT_IRONCLAW_PROFILE}\` or pass \`--profile ${DEFAULT_IRONCLAW_PROFILE}\`.`,
      ),
    );
  }

  if (params.gatewayProbe.ok) {
    checks.push(createCheck("gateway", "pass", `Gateway reachable at ${params.gatewayUrl}.`));
  } else {
    checks.push(
      createCheck(
        "gateway",
        "fail",
        `Gateway probe failed at ${params.gatewayUrl}${params.gatewayProbe.detail ? ` (${params.gatewayProbe.detail})` : ""}.`,
        remediationForGatewayFailure(params.gatewayProbe.detail, params.gatewayPort),
      ),
    );
  }

  if (params.webReachable) {
    checks.push(createCheck("web-ui", "pass", `Web UI reachable on port ${params.webPort}.`));
  } else {
    checks.push(
      createCheck(
        "web-ui",
        "fail",
        `Web UI is not reachable on port ${params.webPort}.`,
        remediationForWebUiFailure(params.webPort),
      ),
    );
  }

  const stateDir = resolveProfileStateDir(params.profile, env);
  const defaultStateDir = path.join(resolveRequiredHomeDir(env, os.homedir), ".openclaw");
  const usesIsolatedStateDir =
    params.profile === "default" || path.resolve(stateDir) !== path.resolve(defaultStateDir);
  if (usesIsolatedStateDir) {
    checks.push(createCheck("state-isolation", "pass", `Profile state dir: ${stateDir}.`));
  } else {
    checks.push(
      createCheck(
        "state-isolation",
        "fail",
        `Profile state dir overlaps default profile: ${stateDir}.`,
        `Set \`OPENCLAW_PROFILE=${params.profile}\` (or \`OPENCLAW_STATE_DIR=~/.openclaw-${params.profile}\`) before bootstrap.`,
      ),
    );
  }

  const launchAgentLabel = resolveGatewayLaunchAgentLabel(params.profile);
  const launchAgentIsIsolated =
    params.profile === "default" || launchAgentLabel !== DEFAULT_GATEWAY_LAUNCH_AGENT_LABEL;
  if (launchAgentIsIsolated) {
    checks.push(createCheck("daemon-label", "pass", `Gateway service label: ${launchAgentLabel}.`));
  } else {
    checks.push(
      createCheck(
        "daemon-label",
        "fail",
        `Gateway service label is shared with default profile (${launchAgentLabel}).`,
        "Use a non-default profile to avoid LaunchAgent/service collisions.",
      ),
    );
  }

  checks.push(
    createCheck(
      "rollout-stage",
      params.rolloutStage === "default" ? "pass" : "warn",
      `Bootstrap rollout stage: ${params.rolloutStage}${params.legacyFallbackEnabled ? " (legacy fallback enabled)" : ""}.`,
      params.rolloutStage === "beta"
        ? "Enable beta cutover by setting IRONCLAW_BOOTSTRAP_BETA_OPT_IN=1."
        : undefined,
    ),
  );

  const migrationSuiteOk = isTruthyEnvValue(env.IRONCLAW_BOOTSTRAP_MIGRATION_SUITE_OK);
  const onboardingE2EOk = isTruthyEnvValue(env.IRONCLAW_BOOTSTRAP_ONBOARDING_E2E_OK);
  const enforceCutoverGates = isTruthyEnvValue(env.IRONCLAW_BOOTSTRAP_ENFORCE_SAFETY_GATES);
  const cutoverGatePassed = migrationSuiteOk && onboardingE2EOk;
  checks.push(
    createCheck(
      "cutover-gates",
      cutoverGatePassed ? "pass" : enforceCutoverGates ? "fail" : "warn",
      `Cutover gate: migrationSuite=${migrationSuiteOk ? "pass" : "missing"}, onboardingE2E=${onboardingE2EOk ? "pass" : "missing"}.`,
      cutoverGatePassed
        ? undefined
        : "Run migration contracts + onboarding E2E and set IRONCLAW_BOOTSTRAP_MIGRATION_SUITE_OK=1 and IRONCLAW_BOOTSTRAP_ONBOARDING_E2E_OK=1 before full cutover.",
    ),
  );

  return {
    rolloutStage: params.rolloutStage,
    legacyFallbackEnabled: params.legacyFallbackEnabled,
    checks,
    hasFailures: checks.some((check) => check.status === "fail"),
  };
}

function formatCheckStatus(status: BootstrapCheckStatus): string {
  if (status === "pass") {
    return theme.success("[ok]");
  }
  if (status === "warn") {
    return theme.warn("[warn]");
  }
  return theme.error("[fail]");
}

function logBootstrapChecklist(diagnostics: BootstrapDiagnostics, runtime: RuntimeEnv) {
  runtime.log("");
  runtime.log(theme.heading("Bootstrap checklist"));
  for (const check of diagnostics.checks) {
    runtime.log(`${formatCheckStatus(check.status)} ${check.detail}`);
    if (check.status !== "pass" && check.remediation) {
      runtime.log(theme.muted(`       remediation: ${check.remediation}`));
    }
  }
}

async function shouldRunUpdate(params: {
  opts: BootstrapOptions;
  runtime: RuntimeEnv;
}): Promise<boolean> {
  if (params.opts.updateNow) {
    return true;
  }
  if (
    params.opts.skipUpdate ||
    params.opts.nonInteractive ||
    params.opts.json ||
    !process.stdin.isTTY
  ) {
    return false;
  }
  const decision = await confirm({
    message: stylePromptMessage("Check and install OpenClaw updates now?"),
    initialValue: false,
  });
  if (isCancel(decision)) {
    params.runtime.log(theme.muted("Update check skipped."));
    return false;
  }
  return Boolean(decision);
}

export async function bootstrapCommand(
  opts: BootstrapOptions,
  runtime: RuntimeEnv = defaultRuntime,
): Promise<BootstrapSummary> {
  const nonInteractive = Boolean(opts.nonInteractive || opts.json);
  const profile = process.env.OPENCLAW_PROFILE?.trim() || DEFAULT_IRONCLAW_PROFILE;
  const rolloutStage = resolveBootstrapRolloutStage();
  const legacyFallbackEnabled = isLegacyFallbackEnabled();
  applyCliProfileEnv({ profile });

  const installResult = await ensureOpenClawCliAvailable();
  if (!installResult.available) {
    throw new Error(
      [
        "OpenClaw CLI is required but unavailable.",
        "Install it with: npm install -g openclaw",
      ].join("\n"),
    );
  }

  const requestedGatewayPort = parseOptionalPort(opts.gatewayPort) ?? DEFAULT_GATEWAY_PORT;
  const stateDir = resolveProfileStateDir(profile);
  const configPath = path.join(stateDir, "config.json");
  const forceOnboard = Boolean(opts.forceOnboard);
  const needsOnboard = forceOnboard || !existsSync(configPath);

  if (needsOnboard) {
    const onboardArgv = [
      "openclaw",
      "--profile",
      profile,
      "onboard",
      "--install-daemon",
      "--gateway-bind",
      "loopback",
      "--gateway-port",
      String(requestedGatewayPort),
    ];
    if (nonInteractive) {
      onboardArgv.push("--non-interactive", "--accept-risk");
    }
    if (opts.noOpen) {
      onboardArgv.push("--skip-ui");
    }
    await runOpenClawOrThrow({
      argv: onboardArgv,
      timeoutMs: 12 * 60_000,
      errorMessage: "OpenClaw onboarding failed.",
    });
  }

  // Ensure gateway.mode=local so the gateway doesn't refuse to start.
  // Must run after onboard (which creates the config file on first run).
  await ensureGatewayModeLocal(profile);

  if (!needsOnboard) {
    await runOpenClawOrThrow({
      argv: ["openclaw", "--profile", profile, "gateway", "install"],
      timeoutMs: 2 * 60_000,
      errorMessage: "Failed to install/verify gateway daemon.",
    });
    await runOpenClawOrThrow({
      argv: ["openclaw", "--profile", profile, "gateway", "start"],
      timeoutMs: 2 * 60_000,
      errorMessage: "Failed to start gateway daemon.",
    });
  }

  if (await shouldRunUpdate({ opts, runtime })) {
    await runOpenClawWithProgress({
      argv: ["openclaw", "update", "--yes"],
      timeoutMs: 8 * 60_000,
      startMessage: "Checking for OpenClaw updates...",
      successMessage: "OpenClaw is up to date.",
      errorMessage: "OpenClaw update failed",
    });
  }

  const gatewayProbe = await probeGateway(profile);
  const gatewayUrl = `ws://127.0.0.1:${requestedGatewayPort}`;
  const preferredWebPort = parseOptionalPort(opts.webPort) ?? DEFAULT_WEB_APP_PORT;

  if (!(await probeForWebApp(preferredWebPort))) {
    startWebAppIfNeeded(preferredWebPort, stateDir);
  }

  const runningWebPort = await waitForWebAppPort(preferredWebPort);
  const webUrl = `http://localhost:${runningWebPort}`;
  const webReachable = await probeForWebApp(runningWebPort);
  const diagnostics = buildBootstrapDiagnostics({
    profile,
    openClawCliAvailable: installResult.available,
    openClawVersion: installResult.version,
    gatewayPort: requestedGatewayPort,
    gatewayUrl,
    gatewayProbe,
    webPort: runningWebPort,
    webReachable,
    rolloutStage,
    legacyFallbackEnabled,
  });

  const shouldOpen = !opts.noOpen && !opts.json;
  const opened = shouldOpen ? await openUrl(webUrl) : false;

  if (!opts.json) {
    logBootstrapChecklist(diagnostics, runtime);
    runtime.log("");
    runtime.log(theme.heading("IronClaw ready"));
    runtime.log(`Profile: ${profile}`);
    runtime.log(`OpenClaw CLI: ${installResult.version ?? "detected"}`);
    runtime.log(`Gateway: ${gatewayProbe.ok ? "reachable" : "check failed"}`);
    runtime.log(`Web UI: ${webUrl}`);
    runtime.log(
      `Rollout stage: ${rolloutStage}${legacyFallbackEnabled ? " (legacy fallback enabled)" : ""}`,
    );
    if (!opened && shouldOpen) {
      runtime.log(theme.muted("Browser open failed; copy/paste the URL above."));
    }
    if (diagnostics.hasFailures) {
      runtime.log(
        theme.warn(
          "Bootstrap completed with failing checks. Address remediation items above before full cutover.",
        ),
      );
    }
  }

  const summary: BootstrapSummary = {
    profile,
    onboarded: needsOnboard,
    installedOpenClawCli: installResult.installed,
    openClawCliAvailable: installResult.available,
    openClawVersion: installResult.version,
    gatewayUrl,
    gatewayReachable: gatewayProbe.ok,
    webUrl,
    webReachable,
    webOpened: opened,
    diagnostics,
  };
  if (opts.json) {
    runtime.log(JSON.stringify(summary, null, 2));
  }
  return summary;
}
