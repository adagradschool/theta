import { describe, expect, it } from "vitest";
import {
	createMemoryWorkspaceFs,
	createThetaBashTool,
	createThetaWorkspace,
	type JsonObject,
	type ThetaBashToolDetails,
	type ThetaBashToolInput,
	type ThetaToolDefinition,
	type ThetaToolExecutionContext,
	type ThetaToolResult,
	type ThetaWorkspace,
	type WorkspaceFs,
	WorkspaceNotFoundError,
} from "../src/index.ts";
import {
	createJustBashLite,
	defaultShellCommandNames,
} from "../src/just-bash-lite/index.ts";

interface ToolHarness {
	readonly fs: WorkspaceFs;
	readonly workspace: ThetaWorkspace;
	readonly tool: ThetaToolDefinition<ThetaBashToolInput, ThetaBashToolDetails>;
}

describe("just-bash-lite runtime", () => {
	it("keeps heavyweight upstream commands out of the vendored shell", () => {
		expect(defaultShellCommandNames).not.toEqual(
			expect.arrayContaining([
				"sqlite3",
				"python",
				"python3",
				"js-exec",
				"curl",
			]),
		);
	});

	it("runs common browser shell commands against WorkspaceFs", async () => {
		const fs = createMemoryWorkspaceFs();
		await fs.mkdir("/src");
		await fs.writeTextFile("/src/a.txt", "alpha\nbeta\n");
		await fs.writeTextFile("/src/b.md", "docs\n");
		const shell = createJustBashLite({ fs, cwd: "/src" });

		const result = await shell.exec(
			"pwd; echo $FOO; cat a.txt | grep -n beta; find . -type f -name '*.txt' | sort",
			{ env: { FOO: "theta" } },
		);

		expect(result).toMatchObject({
			exitCode: 0,
			cancelled: false,
			timedOut: false,
			stderr: "",
		});
		expect(result.stdout).toBe("/src\ntheta\n2:beta\n/src/a.txt\n");
	});

	it("applies filesystem mutations through shell commands", async () => {
		const fs = createMemoryWorkspaceFs();
		const shell = createJustBashLite({ fs });

		const result = await shell.exec(
			"mkdir -p docs && echo hello > docs/a.txt && echo world >> docs/a.txt && cp docs/a.txt docs/b.txt && mv docs/b.txt docs/c.txt && rm docs/a.txt",
		);

		expect(result.exitCode).toBe(0);
		expect(await fs.readTextFile("/docs/c.txt")).toBe("hello\nworld\n");
		await expect(fs.readTextFile("/docs/a.txt")).rejects.toBeInstanceOf(
			WorkspaceNotFoundError,
		);
	});

	it("captures stderr and non-zero exit codes", async () => {
		const fs = createMemoryWorkspaceFs();
		const shell = createJustBashLite({ fs });

		const result = await shell.exec("cat missing.txt");

		expect(result.exitCode).toBe(1);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("cat: missing.txt:");
	});

	it("cancels commands when the timeout elapses", async () => {
		const fs = createMemoryWorkspaceFs();
		const shell = createJustBashLite({ fs });

		const result = await shell.exec("sleep 1", { timeoutMs: 5 });

		expect(result).toMatchObject({
			exitCode: 130,
			cancelled: true,
			timedOut: true,
		});
	});

	it("runs custom commands with shell context, stdin, args, and redirects", async () => {
		const fs = createMemoryWorkspaceFs();
		const shell = createJustBashLite({
			fs,
			customCommands: [
				{
					name: "upper",
					async execute(context, args, stdin) {
						const suffix = args.length > 0 ? ` ${args.join(" ")}` : "";
						await context.fs.writeText(
							context.resolvePath("custom-ran.txt"),
							context.env.CUSTOM_MARK ?? "missing",
						);
						return {
							stdout: `${stdin.toUpperCase().trim()}${suffix}\n`,
							stderr: "",
							exitCode: 0,
						};
					},
				},
			],
		});

		const result = await shell.exec("echo hello | upper world > out.txt", {
			env: { CUSTOM_MARK: "ok" },
		});

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe("");
		expect(await fs.readTextFile("/out.txt")).toBe("HELLO world\n");
		expect(await fs.readTextFile("/custom-ran.txt")).toBe("ok");
	});
});

describe("Theta bash tool", () => {
	it("returns stdout, stderr, exit code, cwd, env, and truncation details", async () => {
		const harness = await createHarness({
			maxOutputBytes: 48,
		});

		const result = await executeTool(harness, {
			command:
				"echo $NAME && printf '123456789012345678901234567890123456789012345678901234567890' && missing-command",
			env: { NAME: "theta" },
		});

		expect(result.isError).toBe(true);
		expect(result.details).toMatchObject({
			command:
				"echo $NAME && printf '123456789012345678901234567890123456789012345678901234567890' && missing-command",
			cwd: "/",
			exitCode: 127,
			cancelled: false,
			timedOut: false,
			truncated: true,
		});
		expect(result.details?.stdout).toContain("[truncated");
		expect(result.details?.stderr).toContain("missing-command");
		expect(result.content[0]?.type).toBe("text");
		if (result.content[0]?.type !== "text") {
			throw new Error("Expected text tool content.");
		}
		expect(result.content[0].text).toContain("Command exited with code 127.");
	});

	it("runs with tool-level timeout settings", async () => {
		const harness = await createHarness();

		const result = await executeTool(harness, {
			command: "sleep 1",
			timeout: 0.005,
		});

		expect(result.isError).toBe(true);
		expect(result.details).toMatchObject({
			exitCode: 130,
			cancelled: true,
			timedOut: true,
		});
	});

	it("exposes custom commands through the Theta bash tool", async () => {
		const harness = await createHarness({
			customCommands: [
				{
					name: "write-note",
					async execute(context, args) {
						await context.fs.writeText(
							context.resolvePath(args[0] ?? "note.txt"),
							args.slice(1).join(" "),
						);
						return { stdout: "done\n", stderr: "", exitCode: 0 };
					},
				},
			],
		});

		const result = await executeTool(harness, {
			command:
				"mkdir -p notes && write-note notes/custom.txt hello custom command",
		});

		expect(result.isError).toBeFalsy();
		expect(result.details?.stdout).toBe("done\n");
		expect(await harness.fs.readTextFile("/notes/custom.txt")).toBe(
			"hello custom command",
		);
	});
});

async function createHarness(
	options: Parameters<typeof createThetaBashTool>[0] = {},
): Promise<ToolHarness> {
	const fs = createMemoryWorkspaceFs();
	const workspace = createThetaWorkspace({
		id: "bash-workspace",
		fs,
		tools: [createThetaBashTool(options)],
	});
	const [tool] = await workspace.resolveTools();
	if (!tool || tool.name !== "bash") {
		throw new Error("Missing bash tool.");
	}
	return {
		fs,
		workspace,
		tool: tool as ThetaToolDefinition<ThetaBashToolInput, ThetaBashToolDetails>,
	};
}

async function executeTool(
	harness: ToolHarness,
	input: ThetaBashToolInput,
): Promise<ThetaToolResult<ThetaBashToolDetails>> {
	const abortController = new AbortController();
	const context: ThetaToolExecutionContext<
		ThetaBashToolInput,
		ThetaBashToolDetails
	> = {
		workspace: harness.workspace,
		fs: harness.fs,
		toolCallId: "bash-call",
		input: input as ThetaBashToolInput & JsonObject,
		signal: abortController.signal,
		update() {},
	};
	return harness.tool.execute(context);
}
