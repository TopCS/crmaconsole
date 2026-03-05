import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:fs", () => ({
	writeFileSync: vi.fn(),
	mkdirSync: vi.fn(),
}));

vi.mock("@/lib/workspace", () => ({
	safeResolveNewPath: vi.fn(),
	isSystemFile: vi.fn(() => false),
}));

describe("POST /api/workspace/write-binary", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.mock("node:fs", () => ({
			writeFileSync: vi.fn(),
			mkdirSync: vi.fn(),
		}));
		vi.mock("@/lib/workspace", () => ({
			safeResolveNewPath: vi.fn(),
			isSystemFile: vi.fn(() => false),
		}));
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns 400 when form data parsing fails (rejects malformed multipart payload)", async () => {
		const { POST } = await import("./write-binary/route.js");
		const req = {
			formData: vi.fn().mockRejectedValue(new Error("invalid")),
		} as unknown as Request;
		const res = await POST(req);
		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json.error).toContain("Invalid form data");
	});

	it("returns 400 when path is missing (prevents ambiguous write target)", async () => {
		const { POST } = await import("./write-binary/route.js");
		const form = new FormData();
		form.append("file", new Blob([new Uint8Array([1, 2, 3])]));
		const req = new Request("http://localhost/api/workspace/write-binary", {
			method: "POST",
			body: form,
		});
		const res = await POST(req);
		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json.error).toContain("Missing 'path'");
	});

	it("returns 400 when file blob is missing (rejects partial payloads)", async () => {
		const { POST } = await import("./write-binary/route.js");
		const form = new FormData();
		form.append("path", "docs/report.docx");
		const req = new Request("http://localhost/api/workspace/write-binary", {
			method: "POST",
			body: form,
		});
		const res = await POST(req);
		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json.error).toContain("Missing 'file'");
	});

	it("returns 403 when writing a system file (prevents protected-file tampering)", async () => {
		const { isSystemFile, safeResolveNewPath } = await import("@/lib/workspace");
		vi.mocked(isSystemFile).mockReturnValueOnce(true);

		const { POST } = await import("./write-binary/route.js");
		const form = new FormData();
		form.append("path", "workspace.duckdb");
		form.append("file", new Blob([new Uint8Array([1])]));
		const req = new Request("http://localhost/api/workspace/write-binary", {
			method: "POST",
			body: form,
		});
		const res = await POST(req);
		expect(res.status).toBe(403);
		expect(safeResolveNewPath).not.toHaveBeenCalled();
	});

	it("returns 400 when safe path resolution fails (blocks path traversal attacks)", async () => {
		const { safeResolveNewPath } = await import("@/lib/workspace");
		vi.mocked(safeResolveNewPath).mockReturnValueOnce(null);

		const { POST } = await import("./write-binary/route.js");
		const form = new FormData();
		form.append("path", "../../etc/passwd");
		form.append("file", new Blob([new Uint8Array([1])]));
		const req = new Request("http://localhost/api/workspace/write-binary", {
			method: "POST",
			body: form,
		});
		const res = await POST(req);
		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json.error).toContain("traversal");
	});

	it("writes binary bytes exactly to the resolved destination", async () => {
		const { safeResolveNewPath } = await import("@/lib/workspace");
		vi.mocked(safeResolveNewPath).mockReturnValueOnce("/ws/docs/report.docx");
		const { writeFileSync: mockWrite, mkdirSync: mockMkdir } = await import("node:fs");

		const { POST } = await import("./write-binary/route.js");
		const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff]);
		const form = new FormData();
		form.append("path", "docs/report.docx");
		form.append("file", new Blob([bytes]));
		const req = new Request("http://localhost/api/workspace/write-binary", {
			method: "POST",
			body: form,
		});
		const res = await POST(req);

		expect(res.status).toBe(200);
		expect(mockMkdir).toHaveBeenCalledWith("/ws/docs", { recursive: true });
		expect(mockWrite).toHaveBeenCalledWith(
			"/ws/docs/report.docx",
			expect.any(Buffer),
		);
		const written = vi.mocked(mockWrite).mock.calls[0]?.[1] as Buffer;
		expect(written[0]).toBe(0x50);
		expect(written[1]).toBe(0x4b);
		expect(written[2]).toBe(0x03);
		expect(written[3]).toBe(0x04);
		expect(written[4]).toBe(0xff);
	});

	it("returns 500 when disk write throws (surfaces actionable failure)", async () => {
		const { safeResolveNewPath } = await import("@/lib/workspace");
		vi.mocked(safeResolveNewPath).mockReturnValueOnce("/ws/docs/report.docx");
		const { writeFileSync: mockWrite } = await import("node:fs");
		vi.mocked(mockWrite).mockImplementationOnce(() => {
			throw new Error("ENOSPC: no space left on device");
		});

		const { POST } = await import("./write-binary/route.js");
		const form = new FormData();
		form.append("path", "docs/report.docx");
		form.append("file", new Blob([new Uint8Array([1, 2, 3])]));
		const req = new Request("http://localhost/api/workspace/write-binary", {
			method: "POST",
			body: form,
		});
		const res = await POST(req);

		expect(res.status).toBe(500);
		const json = await res.json();
		expect(json.error).toContain("ENOSPC");
	});
});
