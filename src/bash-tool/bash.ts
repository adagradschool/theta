import type { WorkspaceFs } from "../filesystem.ts";
import { normalizeWorkspacePath } from "../filesystem.ts";
import { createJustBashLite } from "../just-bash-lite/index.ts";
import type { ThetaToolDefinition, ThetaToolFactory } from "../tools.ts";
import { thetaBashToolSchema } from "./schemas.ts";
import { truncateTextByBytes } from "./truncate.ts";
import type {
	ThetaBashToolDetails,
	ThetaBashToolInput,
	ThetaBashToolOptions,
} from "./types.ts";

const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;

export function createThetaBashTool(
	options: ThetaBashToolOptions = {},
): ThetaToolFactory {
	return ({ fs }) => createThetaBashToolDefinition(fs, options);
}

export function createThetaBashToolDefinition(
	fs: WorkspaceFs,
	options: ThetaBashToolOptions = {},
): ThetaToolDefinition<ThetaBashToolInput, ThetaBashToolDetails> {
	return {
		name: "bash",
		label: "Bash",
		description:
			"Execute a browser-local bash command against the workspace filesystem. Supports common file, text, search, pipe, redirect, cwd, env, timeout, and cancellation behavior.",
		parameters: thetaBashToolSchema,
		executionMode: "sequential",
		async execute(context) {
			const startedAt = Date.now();
			const cwd = normalizeWorkspacePath(
				context.input.cwd ?? options.cwd ?? "/",
			);
			const timeoutMs =
				context.input.timeout !== undefined
					? Math.max(0, context.input.timeout * 1000)
					: options.timeoutMs;
			const shell = createJustBashLite({
				fs,
				cwd,
				...(options.env !== undefined ? { env: options.env } : {}),
				...(options.commands !== undefined
					? { commands: options.commands }
					: {}),
				...(options.customCommands !== undefined
					? { customCommands: options.customCommands }
					: {}),
				...(options.sleep !== undefined ? { sleep: options.sleep } : {}),
			});
			const result = await shell.exec(context.input.command, {
				cwd,
				...(context.input.env !== undefined ? { env: context.input.env } : {}),
				signal: context.signal,
				...(timeoutMs !== undefined ? { timeoutMs } : {}),
			});
			const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
			const stdout = truncateTextByBytes(result.stdout, maxOutputBytes);
			const stderr = truncateTextByBytes(result.stderr, maxOutputBytes);
			const details: ThetaBashToolDetails = {
				command: context.input.command,
				cwd,
				stdout: stdout.text,
				stderr: stderr.text,
				exitCode: result.exitCode,
				cancelled: result.cancelled,
				timedOut: result.timedOut,
				durationMs: Date.now() - startedAt,
				truncated:
					stdout.truncation !== undefined || stderr.truncation !== undefined,
				...(stdout.truncation !== undefined
					? { stdoutTruncation: stdout.truncation }
					: {}),
				...(stderr.truncation !== undefined
					? { stderrTruncation: stderr.truncation }
					: {}),
			};
			const text = formatBashToolText(details);
			const isError =
				details.exitCode !== 0 || details.cancelled || details.timedOut;
			return {
				content: [{ type: "text", text }],
				details,
				isError,
				render: {
					title: `$ ${context.input.command}`,
					path: cwd,
					language: "bash",
					summary: statusSummary(details),
				},
			};
		},
	};
}

function formatBashToolText(details: ThetaBashToolDetails): string {
	const sections: string[] = [];
	if (details.stdout.length > 0) {
		sections.push(details.stdout.replace(/\n$/, ""));
	}
	if (details.stderr.length > 0) {
		sections.push(`[stderr]\n${details.stderr.replace(/\n$/, "")}`);
	}
	const status = statusText(details);
	if (sections.length === 0) {
		sections.push(status ?? "(no output)");
	} else if (status) {
		sections.push(status);
	}
	if (details.truncated) {
		sections.push("[Output truncated.]");
	}
	return sections.join("\n\n");
}

function statusText(details: ThetaBashToolDetails): string | undefined {
	if (details.timedOut) {
		return "Command timed out.";
	}
	if (details.cancelled) {
		return "Command cancelled.";
	}
	if (details.exitCode !== 0) {
		return `Command exited with code ${details.exitCode}.`;
	}
	return undefined;
}

function statusSummary(details: ThetaBashToolDetails): string {
	if (details.timedOut) {
		return "timed out";
	}
	if (details.cancelled) {
		return "cancelled";
	}
	return `exit ${details.exitCode}`;
}
