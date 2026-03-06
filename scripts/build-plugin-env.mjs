import { writeFileSync } from "node:fs";

const key = process.env.POSTHOG_KEY || "";
writeFileSync(
  "extensions/posthog-analytics/lib/build-env.js",
  `export const POSTHOG_KEY = ${JSON.stringify(key)};\n`,
);
