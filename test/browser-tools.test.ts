import { describe, expect, it } from "vitest";
import {
	createMemoryWorkspaceFs,
	createThetaBrowserTools,
	createThetaWorkspace,
	type JsonObject,
	type ThetaEditToolDetails,
	type ThetaEditToolInput,
	type ThetaFindToolDetails,
	type ThetaFindToolInput,
	type ThetaGrepToolDetails,
	type ThetaGrepToolInput,
	type ThetaLsToolDetails,
	type ThetaLsToolInput,
	type ThetaReadToolDetails,
	type ThetaReadToolInput,
	type ThetaToolDefinition,
	type ThetaToolExecutionContext,
	type ThetaToolResult,
	type ThetaWorkspace,
	type ThetaWriteToolDetails,
	type ThetaWriteToolInput,
	type WorkspaceFs,
} from "../src/index.ts";

interface ToolHarness {
	readonly fs: WorkspaceFs;
	readonly workspace: ThetaWorkspace;
	readonly tools: ReadonlyMap<string, ThetaToolDefinition>;
}

describe("Theta browser tools", () => {
	it("creates the requested browser tool bundle", async () => {
		const harness = await createHarness();

		expect([...harness.tools.keys()]).toEqual([
			"bash",
			"read",
			"write",
			"edit",
			"ls",
			"grep",
			"find",
		]);
	});

	it("reads text files with line ranges", async () => {
		const harness = await createHarness({
			"/src/app.ts": "one\ntwo\nthree\nfour",
		});
		const result = await executeTool<ThetaReadToolInput, ThetaReadToolDetails>(
			harness,
			"read",
			{ path: "/src/app.ts", offset: 2, limit: 2 },
		);

		expect(result.content).toEqual([
			{
				type: "text",
				text: "two\nthree\n\n[Showing lines 2-3 of 4. Use offset=4 to continue.]",
			},
		]);
		expect(result.details).toMatchObject({
			path: "/src/app.ts",
			startLine: 2,
			endLine: 3,
			totalLines: 4,
			truncated: true,
		});
		expect(result.render).toMatchObject({
			path: "/src/app.ts",
			language: "typescript",
		});
	});

	it("writes files and creates parent directories", async () => {
		const harness = await createHarness();
		const result = await executeTool<
			ThetaWriteToolInput,
			ThetaWriteToolDetails
		>(harness, "write", { path: "/notes/todo.md", content: "# Todo\n" });

		expect(await harness.fs.readTextFile("/notes/todo.md")).toBe("# Todo\n");
		expect(result.details).toMatchObject({
			path: "/notes/todo.md",
			bytes: 7,
			created: true,
		});
	});

	it("edits files with exact replacements", async () => {
		const harness = await createHarness({
			"/src/app.ts": "export const value = 1;\n",
		});
		const result = await executeTool<ThetaEditToolInput, ThetaEditToolDetails>(
			harness,
			"edit",
			{
				path: "/src/app.ts",
				oldText: "value = 1",
				newText: "value = 2",
			},
		);

		expect(await harness.fs.readTextFile("/src/app.ts")).toBe(
			"export const value = 2;\n",
		);
		expect(result.details?.diff).toContain("-export const value = 1;");
		expect(result.details?.diff).toContain("+export const value = 2;");
	});

	it("lists directory contents", async () => {
		const harness = await createHarness({
			"/src/app.ts": "app",
			"/src/lib/util.ts": "util",
		});
		const result = await executeTool<ThetaLsToolInput, ThetaLsToolDetails>(
			harness,
			"ls",
			{ path: "/src", recursive: true },
		);

		expect(result.content[0]).toMatchObject({
			type: "text",
			text: expect.stringContaining("/src/lib/"),
		});
		expect(result.details?.entries.map((entry) => entry.path)).toEqual([
			"/src/app.ts",
			"/src/lib",
			"/src/lib/util.ts",
		]);
	});

	it("greps workspace text files", async () => {
		const harness = await createHarness({
			"/src/app.ts": "alpha\nbeta\nALPHA",
			"/README.md": "alpha docs",
		});
		const result = await executeTool<ThetaGrepToolInput, ThetaGrepToolDetails>(
			harness,
			"grep",
			{
				path: "/",
				pattern: "alpha",
				ignoreCase: true,
				glob: "**/*.ts",
			},
		);

		expect(result.content[0]).toMatchObject({
			type: "text",
			text: "src/app.ts:1: alpha\nsrc/app.ts:3: ALPHA",
		});
		expect(result.details?.matches).toHaveLength(2);
	});

	it("finds files by glob", async () => {
		const harness = await createHarness({
			"/src/app.ts": "app",
			"/src/app.test.ts": "test",
			"/README.md": "docs",
		});
		const result = await executeTool<ThetaFindToolInput, ThetaFindToolDetails>(
			harness,
			"find",
			{ path: "/", pattern: "**/*.ts", kind: "file" },
		);

		expect(result.content[0]).toMatchObject({
			type: "text",
			text: "src/app.test.ts\nsrc/app.ts",
		});
		expect(result.details?.matches.map((match) => match.path)).toEqual([
			"/src/app.test.ts",
			"/src/app.ts",
		]);
	});

	it("surfaces tool errors for invalid operations", async () => {
		const harness = await createHarness({
			"/duplicate.txt": "same same",
			"/exists.txt": "exists",
		});

		await expect(
			executeTool<ThetaReadToolInput, ThetaReadToolDetails>(harness, "read", {
				path: "/missing.txt",
			}),
		).rejects.toThrow("Workspace path not found");
		await expect(
			executeTool<ThetaWriteToolInput, ThetaWriteToolDetails>(
				harness,
				"write",
				{ path: "/exists.txt", content: "new", overwrite: false },
			),
		).rejects.toThrow("already exists");
		await expect(
			executeTool<ThetaEditToolInput, ThetaEditToolDetails>(harness, "edit", {
				path: "/duplicate.txt",
				oldText: "same",
				newText: "changed",
			}),
		).rejects.toThrow("matched more than once");
		await expect(
			executeTool<ThetaGrepToolInput, ThetaGrepToolDetails>(harness, "grep", {
				path: "/",
				pattern: "[",
			}),
		).rejects.toThrow("Invalid regular expression");
	});
});

async function createHarness(
	files: Readonly<Record<string, string>> = {},
): Promise<ToolHarness> {
	const fs = createMemoryWorkspaceFs();
	for (const [path, content] of Object.entries(files)) {
		await mkdirp(fs, parentPath(path));
		await fs.writeTextFile(path, content);
	}
	const workspace = createThetaWorkspace({
		id: "tools-workspace",
		fs,
		tools: [createThetaBrowserTools()],
	});
	const resolved = await workspace.resolveTools();
	return {
		fs,
		workspace,
		tools: new Map(resolved.map((tool) => [tool.name, tool])),
	};
}

async function executeTool<TInput extends JsonObject, TDetails>(
	harness: ToolHarness,
	name: string,
	input: TInput,
): Promise<ThetaToolResult<TDetails>> {
	const tool = harness.tools.get(name) as
		| ThetaToolDefinition<TInput, TDetails>
		| undefined;
	if (!tool) {
		throw new Error(`Missing tool: ${name}`);
	}
	const abortController = new AbortController();
	const context: ThetaToolExecutionContext<TInput, TDetails> = {
		workspace: harness.workspace,
		fs: harness.fs,
		toolCallId: `${name}-call`,
		input,
		signal: abortController.signal,
		update() {},
	};
	return tool.execute(context);
}

async function mkdirp(fs: WorkspaceFs, path: string): Promise<void> {
	if (path === "/") {
		return;
	}
	const segments = path.split("/").filter(Boolean);
	let current = "";
	for (const segment of segments) {
		current = `${current}/${segment}`;
		await fs.mkdir(current);
	}
}

function parentPath(path: string): string {
	const index = path.lastIndexOf("/");
	return index <= 0 ? "/" : path.slice(0, index);
}
