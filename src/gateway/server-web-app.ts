import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GatewayWebAppConfig } from "../config/types.gateway.js";
import { isTruthyEnvValue } from "../infra/env.js";

export const DEFAULT_WEB_APP_PORT = 3100;

export type WebAppHandle = {
  port: number;
  stop: () => Promise<void>;
};

/**
 * Resolve the `apps/web` directory relative to the package root.
 * Walks up from the current module until we find the workspace root
 * (identified by the presence of `apps/web/package.json`).
 */
function resolveWebAppDir(): string | null {
  const __filename = fileURLToPath(import.meta.url);
  let dir = path.dirname(__filename);
  for (let i = 0; i < 10; i++) {
    const candidate = path.join(dir, "apps", "web", "package.json");
    if (fs.existsSync(candidate)) {
      return path.join(dir, "apps", "web");
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return null;
}

/** Check whether a Next.js standalone build exists (from `output: "standalone"`). */
function hasStandaloneBuild(webAppDir: string): boolean {
  return fs.existsSync(path.join(webAppDir, ".next", "standalone", "server.js"));
}

/** Check whether a regular Next.js production build exists. */
function hasNextBuild(webAppDir: string): boolean {
  return fs.existsSync(path.join(webAppDir, ".next", "BUILD_ID"));
}

/**
 * Start the Ironclaw Next.js web app as a child process.
 *
 * Resolution order:
 * 1. Standalone build (`.next/standalone/server.js`) — shipped in the npm
 *    package; runs with plain `node`, no extra deps needed.
 * 2. Regular build (`.next/BUILD_ID`) — runs via `npx next start`.
 * 3. No build — builds from source, then starts.
 */
export async function startWebAppIfEnabled(
  cfg: GatewayWebAppConfig | undefined,
  log: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void },
): Promise<WebAppHandle | null> {
  if (isTruthyEnvValue(process.env.OPENCLAW_SKIP_WEB_APP)) {
    return null;
  }
  if (!cfg?.enabled) {
    return null;
  }

  const port = cfg.port ?? DEFAULT_WEB_APP_PORT;
  const devMode = cfg.dev === true; // default false (production)

  const webAppDir = resolveWebAppDir();
  if (!webAppDir) {
    log.warn("apps/web directory not found — skipping web app");
    return null;
  }

  let child: ChildProcess;

  if (devMode) {
    // Dev mode: ensure deps, then `next dev`.
    await ensureDepsInstalled(webAppDir, log);
    log.info(`starting web app (dev) on port ${port}…`);
    child = spawn("npx", ["next", "dev", "--port", String(port)], {
      cwd: webAppDir,
      stdio: "pipe",
      env: { ...process.env, PORT: String(port) },
    });
  } else if (hasStandaloneBuild(webAppDir)) {
    // Standalone build: run directly with node — no deps needed.
    log.info("using pre-built standalone web app");
    const serverJs = path.join(webAppDir, ".next", "standalone", "server.js");
    child = spawn(process.execPath, [serverJs], {
      cwd: path.join(webAppDir, ".next", "standalone"),
      stdio: "pipe",
      env: { ...process.env, PORT: String(port), HOSTNAME: "0.0.0.0" },
    });
  } else {
    // No standalone — fall back to regular next start.
    await ensureDepsInstalled(webAppDir, log);
    if (!hasNextBuild(webAppDir)) {
      log.info("building web app for production…");
      await runCommand("npx", ["next", "build"], webAppDir);
    } else {
      log.info("pre-built web app found — skipping build");
    }
    log.info(`starting web app (production) on port ${port}…`);
    child = spawn("npx", ["next", "start", "--port", String(port)], {
      cwd: webAppDir,
      stdio: "pipe",
      env: { ...process.env, PORT: String(port) },
    });
  }

  // Forward child stdout/stderr to the gateway log.
  child.stdout?.on("data", (data: Buffer) => {
    for (const line of data.toString().split("\n").filter(Boolean)) {
      log.info(line);
    }
  });
  child.stderr?.on("data", (data: Buffer) => {
    for (const line of data.toString().split("\n").filter(Boolean)) {
      log.warn(line);
    }
  });

  child.on("error", (err) => {
    log.error(`web app process error: ${String(err)}`);
  });

  child.on("exit", (code, signal) => {
    if (code !== null && code !== 0) {
      log.warn(`web app exited with code ${code}`);
    } else if (signal) {
      log.info(`web app terminated by signal ${signal}`);
    }
  });

  log.info(`web app available at http://localhost:${port}`);

  return {
    port,
    stop: async () => {
      if (child.exitCode === null && !child.killed) {
        child.kill("SIGTERM");
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            if (child.exitCode === null && !child.killed) {
              child.kill("SIGKILL");
            }
            resolve();
          }, 5_000);
          child.on("exit", () => {
            clearTimeout(timeout);
            resolve();
          });
        });
      }
    },
  };
}

// ── helpers ──────────────────────────────────────────────────────────────────

async function ensureDepsInstalled(
  webAppDir: string,
  log: { info: (msg: string) => void },
): Promise<void> {
  const nodeModulesDir = path.join(webAppDir, "node_modules");
  if (fs.existsSync(nodeModulesDir)) {
    return;
  }
  log.info("installing web app dependencies…");
  await runCommand("pnpm", ["install"], webAppDir);
}

function runCommand(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, stdio: "pipe", env: { ...process.env } });
    proc.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} ${args[0]} exited with code ${code}`)),
    );
    proc.on("error", reject);
  });
}
