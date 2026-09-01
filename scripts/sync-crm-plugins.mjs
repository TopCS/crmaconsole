/**
 * Re-sync Crm-A owned bundled plugins into the state dir on EVERY container
 * start.
 *
 * Why: the full bundled-plugin sync runs inside bootstrap, which only
 * executes on the FIRST install (when openclaw.json is missing). An existing
 * state volume never re-runs it — plugins added to the image later (or on
 * older state volumes) would never reach the gateway, and the chat agent
 * silently loses its tools (crm_a_phone_campaign, shopify_admin, …).
 *
 * Idempotent: copies each plugin dir into <state>/extensions and merges
 * allow + load.paths + entries{enabled:true} into openclaw.json, preserving
 * any existing entry config. Cheap: two dir copies + one JSON merge.
 *
 * Run inside the container: node /app/scripts/sync-crm-plugins.mjs
 */

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const stateDir = process.env.OPENCLAW_STATE_DIR || path.join(process.env.HOME || "/root", ".openclaw-crm-a");
const packageRoot = "/app";
const extensionsSrc = path.join(packageRoot, "extensions");

// The Crm-A owned plugins that must ALWAYS be present and enabled. (Cloud-
// gated ones like apollo/exa stay under bootstrap's richer handling.)
const CRM_OWNED_PLUGINS = ["crm-a-nlpearl-outbound", "crm-a-shopify-admin"];

const configPath = path.join(stateDir, "openclaw.json");
if (!existsSync(configPath)) {
  console.error("[sync-crm-plugins] no openclaw.json yet — bootstrap will handle it");
  process.exit(0);
}

const cfg = JSON.parse(readFileSync(configPath, "utf-8"));
cfg.plugins = cfg.plugins || {};
cfg.plugins.allow = Array.isArray(cfg.plugins.allow) ? cfg.plugins.allow : [];
cfg.plugins.entries = cfg.plugins.entries || {};
cfg.plugins.load = cfg.plugins.load || { paths: [] };

for (const id of CRM_OWNED_PLUGINS) {
  const src = path.join(extensionsSrc, id);
  if (!existsSync(src)) {
    console.error(`[sync-crm-plugins] missing in image: ${id} — skipped`);
    continue;
  }
  const dest = path.join(stateDir, "extensions", id);
  mkdirSync(path.dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true, force: true });

  if (!cfg.plugins.allow.includes(id)) { cfg.plugins.allow.push(id); }
  cfg.plugins.entries[id] = {
    ...(cfg.plugins.entries[id] ?? {}),
    enabled: true,
    ...(cfg.plugins.entries[id]?.config ? { config: cfg.plugins.entries[id].config } : {}),
  };
  if (!Array.isArray(cfg.plugins.load.paths)) { cfg.plugins.load.paths = []; }
  if (!cfg.plugins.load.paths.includes(dest)) { cfg.plugins.load.paths.push(dest); }
}

// The shared helpers dir backs the CRM plugins — refresh it too.
const sharedSrc = path.join(extensionsSrc, "shared");
if (existsSync(sharedSrc)) {
  const sharedDest = path.join(stateDir, "extensions", "shared");
  mkdirSync(sharedDest, { recursive: true });
  cpSync(sharedSrc, sharedDest, { recursive: true, force: true });
}

writeFileSync(configPath, `${JSON.stringify(cfg, null, 2)}\n`);
console.log("[sync-crm-plugins] ok:", CRM_OWNED_PLUGINS.join(", "));
