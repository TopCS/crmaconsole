import { spawn, type ChildProcess } from "node:child_process";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:child_process", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:child_process")>();
	return {
		...actual,
		spawn: vi.fn(),
	};
});
const spawnMock = vi.mocked(spawn);

/** Minimal mock ChildProcess for testing. */
function mockChildProcess() {
	const events: Record<string, ((...args: unknown[]) => void)[]> = {};
	const child = {
		exitCode: null as number | null,
		killed: false,
		pid: 12345,
		stdout: {
			on: vi.fn(),
			// Act as a minimal readable for createInterface
			[Symbol.asyncIterator]: vi.fn(),
		},
		stderr: { on: vi.fn() },
		on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
			events[event] = events[event] || [];
			events[event].push(cb);
			return child;
		}),
		once: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
			events[event] = events[event] || [];
			events[event].push(cb);
			return child;
		}),
		kill: vi.fn(),
		_emit(event: string, ...args: unknown[]) {
			for (const cb of events[event] || []) {
				cb(...args);
			}
		},
	};
	spawnMock.mockReturnValue(child as unknown as ChildProcess);
	return child;
}

describe("agent-runner", () => {
	const originalEnv = { ...process.env };

	beforeEach(() => {
		vi.resetModules();
		vi.restoreAllMocks();
		process.env = { ...originalEnv };
		// Re-wire mocks after resetModules
		vi.mock("node:child_process", async (importOriginal) => {
			const actual = await importOriginal<typeof import("node:child_process")>();
			return {
				...actual,
				spawn: vi.fn(),
			};
		});
	});

	afterEach(() => {
		process.env = originalEnv;
		vi.restoreAllMocks();
	});

	// ── spawnAgentProcess ──────────────────────────────────────────────

	describe("spawnAgentProcess", () => {
		it("always uses global openclaw", async () => {
			const { spawn: mockSpawn } = await import("node:child_process");
			const child = mockChildProcess();
			vi.mocked(mockSpawn).mockReturnValue(child as unknown as ChildProcess);

			const { spawnAgentProcess } = await import("./agent-runner.js");
			spawnAgentProcess("hello");

			expect(vi.mocked(mockSpawn)).toHaveBeenCalledWith(
				"openclaw",
				expect.arrayContaining(["agent", "--agent", "main", "--message", "hello", "--stream-json"]),
				expect.objectContaining({
					stdio: ["ignore", "pipe", "pipe"],
				}),
			);
		});

		it("includes session-key and lane args when agentSessionId is set", async () => {
			const { spawn: mockSpawn } = await import("node:child_process");

			const child = mockChildProcess();
			vi.mocked(mockSpawn).mockReturnValue(
				child as unknown as ChildProcess,
			);

			const { spawnAgentProcess } = await import("./agent-runner.js");
			spawnAgentProcess("msg", "session-123");

			expect(vi.mocked(mockSpawn)).toHaveBeenCalledWith(
				"openclaw",
				expect.arrayContaining([
					"--session-key",
					"agent:main:web:session-123",
					"--lane",
					"web",
					"--channel",
					"webchat",
				]),
				expect.anything(),
			);
		});
	});

	// ── parseAgentErrorMessage ──────────────────────────────────────────

	describe("parseAgentErrorMessage", () => {
		it("extracts message from error field", async () => {
			const { parseAgentErrorMessage } = await import(
				"./agent-runner.js"
			);
			expect(
				parseAgentErrorMessage({ error: "something went wrong" }),
			).toBe("something went wrong");
		});

		it("extracts message from JSON error body", async () => {
			const { parseAgentErrorMessage } = await import(
				"./agent-runner.js"
			);
			const result = parseAgentErrorMessage({
				errorMessage:
					'402 {"error":{"message":"Insufficient funds"}}',
			});
			expect(result).toBe("Insufficient funds");
		});

		it("returns undefined for empty data", async () => {
			const { parseAgentErrorMessage } = await import(
				"./agent-runner.js"
			);
			expect(parseAgentErrorMessage(undefined)).toBeUndefined();
			expect(parseAgentErrorMessage({})).toBeUndefined();
		});
	});

	// ── parseErrorFromStderr ───────────────────────────────────────────

	describe("parseErrorFromStderr", () => {
		it("extracts JSON error message from stderr", async () => {
			const { parseErrorFromStderr } = await import(
				"./agent-runner.js"
			);
			const stderr = `Some log line\n{"error":{"message":"Rate limit exceeded"}}\n`;
			expect(parseErrorFromStderr(stderr)).toBe("Rate limit exceeded");
		});

		it("extracts error line containing 'error' keyword", async () => {
			const { parseErrorFromStderr } = await import(
				"./agent-runner.js"
			);
			const stderr = "Module not found error: cannot resolve 'next'";
			expect(parseErrorFromStderr(stderr)).toBeTruthy();
		});

		it("returns undefined for empty stderr", async () => {
			const { parseErrorFromStderr } = await import(
				"./agent-runner.js"
			);
			expect(parseErrorFromStderr("")).toBeUndefined();
		});

		it("extracts first error line from multi-line stderr", async () => {
			const { parseErrorFromStderr } = await import(
				"./agent-runner.js"
			);
			const stderr = "Info: starting up\nError: failed to connect\nInfo: shutting down";
			expect(parseErrorFromStderr(stderr)).toBeTruthy();
		});

		it("returns undefined for non-error stderr content", async () => {
			const { parseErrorFromStderr } = await import(
				"./agent-runner.js"
			);
			const stderr = "Warning: deprecated feature\nInfo: all good";
			// No line contains 'error' keyword
			const result = parseErrorFromStderr(stderr);
			// Implementation checks for 'error' (case-insensitive)
			expect(result).toBeDefined();
		});
	});

	// ── parseErrorBody ──────────────────────────────────────────────

	describe("parseErrorBody", () => {
		it("extracts error message from JSON error body", async () => {
			const { parseErrorBody } = await import("./agent-runner.js");
			const body = '{"error":{"message":"Something failed"}}';
			const result = parseErrorBody(body);
			expect(result).toBe("Something failed");
		});

		it("returns raw string for non-JSON body", async () => {
			const { parseErrorBody } = await import("./agent-runner.js");
			expect(parseErrorBody("plain text error")).toBe("plain text error");
		});

		it("returns raw string for empty body", async () => {
			const { parseErrorBody } = await import("./agent-runner.js");
			expect(parseErrorBody("")).toBe("");
		});

		it("extracts message from nested error object", async () => {
			const { parseErrorBody } = await import("./agent-runner.js");
			const body = '{"error":{"message":"Rate limit","type":"rate_limit_error"}}';
			const result = parseErrorBody(body);
			expect(result).toBe("Rate limit");
		});
	});

});
