import type { Command } from "commander";
import { readTelemetryConfig, writeTelemetryConfig } from "../../telemetry/config.js";
import { isTelemetryEnabled } from "../../telemetry/telemetry.js";

export function registerTelemetryCommand(program: Command) {
  const cmd = program
    .command("telemetry")
    .description("Manage anonymous telemetry for DenchClaw");

  cmd
    .command("status")
    .description("Show current telemetry status")
    .action(() => {
      const config = readTelemetryConfig();
      const envDisabled =
        process.env.DO_NOT_TRACK === "1" ||
        process.env.DENCHCLAW_TELEMETRY_DISABLED === "1" ||
        Boolean(process.env.CI);
      const effective = isTelemetryEnabled();

      console.log(`Telemetry config:  ${config.enabled ? "enabled" : "disabled"}`);
      if (envDisabled) {
        console.log("Environment override: disabled (DO_NOT_TRACK, DENCHCLAW_TELEMETRY_DISABLED, or CI)");
      }
      console.log(`Effective status:  ${effective ? "enabled" : "disabled"}`);
      console.log("\nLearn more: https://github.com/openclaw/openclaw/blob/main/TELEMETRY.md");
    });

  cmd
    .command("disable")
    .description("Disable anonymous telemetry")
    .action(() => {
      writeTelemetryConfig({ enabled: false });
      console.log("Telemetry has been disabled.");
      console.log("You can re-enable it anytime with: denchclaw telemetry enable");
    });

  cmd
    .command("enable")
    .description("Enable anonymous telemetry")
    .action(() => {
      writeTelemetryConfig({ enabled: true });
      console.log("Telemetry has been enabled. Thank you for helping improve DenchClaw!");
    });
}
