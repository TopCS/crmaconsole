import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const plugins = [
  "extensions/crm-a-identity/index.ts",
  "extensions/crm-a-ai-gateway/index.ts",
  "extensions/crm-a-nlpearl-outbound/index.ts",
];

for (const entry of plugins) {
  await build({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: path.join(root, entry.replace(/\.ts$/, ".mjs")),
    packages: "external",
  });
}
