import { describe, expect, it } from "vitest";
import { buildMessagesFromParsed } from "./subagent-panel";

describe("buildMessagesFromParsed", () => {
  it("splits assistant output at user-message boundaries (prevents turn merging)", () => {
    const messages = buildMessagesFromParsed("sub-1", "Initial task", [
      { type: "text", text: "Working on it." },
      { type: "reasoning", text: "Checking files", state: "streaming" },
      { type: "user-message", id: "u-1", text: "Please include a summary" },
      { type: "text", text: "Added a summary section." },
    ]);

    expect(messages).toHaveLength(4);
    expect(messages[0]?.role).toBe("user");
    expect(messages[1]?.role).toBe("assistant");
    expect(messages[2]).toMatchObject({
      id: "u-1",
      role: "user",
      parts: [{ type: "text", text: "Please include a summary" }],
    });
    expect(messages[3]).toMatchObject({
      role: "assistant",
      parts: [{ type: "text", text: "Added a summary section." }],
    });
  });

  it("creates stable fallback user IDs when stream omits explicit user-message id", () => {
    const messages = buildMessagesFromParsed("sub-2", "Task", [
      { type: "user-message", text: "Follow-up without id" },
      { type: "text", text: "Handled follow-up." },
    ]);

    expect(messages[1]?.id).toBe("user-sub-2-0");
    expect(messages[1]?.role).toBe("user");
    expect(messages[2]?.role).toBe("assistant");
  });
});
