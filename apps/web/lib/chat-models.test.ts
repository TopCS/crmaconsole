import { describe, expect, it } from "vitest";
import {
	classifyOpenAiModelSwitch,
	isLikelyOpenAiModelId,
	needsOpenAiSwitchAcknowledgement,
	normalizeDenchModelId,
	resolveActiveChatModelId,
} from "./chat-models";

describe("chat-models", () => {
	it("normalizes dench-cloud model ids for picker state", () => {
		expect(normalizeDenchModelId("dench-cloud/gpt-5.4")).toBe("gpt-5.4");
		expect(normalizeDenchModelId("gpt-5.4")).toBe("gpt-5.4");
		expect(normalizeDenchModelId("")).toBeNull();
	});

	it("prefers the actual session model over the saved default", () => {
		expect(
			resolveActiveChatModelId({
				modelOverride: null,
				sessionModel: "dench-cloud/gpt-5.4",
				selectedDenchModel: "anthropic.claude-opus-4-6-v1",
				models: [
					{
						stableId: "anthropic.claude-opus-4-6-v1",
						displayName: "Claude Opus 4.6",
						provider: "anthropic",
						reasoning: true,
					},
					{
						stableId: "gpt-5.4",
						displayName: "GPT-5.4",
						provider: "openai",
						reasoning: true,
					},
				],
			}),
		).toBe("gpt-5.4");
	});

	it("detects likely OpenAI model ids", () => {
		expect(isLikelyOpenAiModelId("gpt-5.4")).toBe(true);
		expect(isLikelyOpenAiModelId("dench-cloud/openai.gpt-5.4")).toBe(true);
		expect(isLikelyOpenAiModelId("anthropic.claude-sonnet-4-6")).toBe(false);
	});

	it("classifies cross-provider switches into OpenAI", () => {
		expect(
			classifyOpenAiModelSwitch({
				sessionModel: "dench-cloud/anthropic.claude-opus-4-6-v1",
				sessionModelProvider: "anthropic",
				targetModel: "gpt-5.4",
			}),
		).toBe("unsafe");

		expect(
			classifyOpenAiModelSwitch({
				sessionModel: "dench-cloud/gpt-5.4",
				sessionModelProvider: "openai",
				targetModel: "gpt-5.4",
			}),
		).toBe("safe");
	});

	it("classifies missing session model as unknown for OpenAI targets", () => {
		expect(
			classifyOpenAiModelSwitch({
				sessionModel: null,
				sessionModelProvider: null,
				targetModel: "gpt-5.4",
			}),
		).toBe("unknown");
	});

	it("requires acknowledgement for unsafe or unknown with assistant history", () => {
		expect(
			needsOpenAiSwitchAcknowledgement("unsafe", false),
		).toBe(true);
		expect(
			needsOpenAiSwitchAcknowledgement("unknown", true),
		).toBe(true);
		expect(
			needsOpenAiSwitchAcknowledgement("unknown", false),
		).toBe(false);
		expect(
			needsOpenAiSwitchAcknowledgement("safe", true),
		).toBe(false);
	});
});
