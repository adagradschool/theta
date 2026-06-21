import { normalizeWorkspacePath, type WorkspaceFs } from "../filesystem.ts";
import type { ThetaToolDefinition, ThetaToolFactory } from "../tools.ts";
import {
	assertNotAborted,
	inferLanguage,
	splitLines,
	textResult,
} from "./helpers.ts";
import { thetaReadToolSchema } from "./schemas.ts";
import type {
	ThetaReadToolDetails,
	ThetaReadToolInput,
	ThetaReadToolOptions,
} from "./types.ts";

const DEFAULT_MAX_LINES = 200;

export function createThetaReadTool(
	options: ThetaReadToolOptions = {},
): ThetaToolFactory {
	return ({ fs }) => createThetaReadToolDefinition(fs, options);
}

export function createThetaReadToolDefinition(
	fs: WorkspaceFs,
	options: ThetaReadToolOptions = {},
): ThetaToolDefinition<ThetaReadToolInput, ThetaReadToolDetails> {
	return {
		name: "read",
		label: "Read",
		description:
			"Read a UTF-8 text file from the workspace. Supports 1-indexed offset and limit for large files.",
		parameters: thetaReadToolSchema,
		async execute(context) {
			assertNotAborted(context.signal);
			const path = normalizeWorkspacePath(context.input.path);
			const text = await fs.readTextFile(path);
			assertNotAborted(context.signal);
			const stat = await fs.stat(path);
			const lines = splitLines(text);
			const offset = context.input.offset ?? 1;
			const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
			const limit = context.input.limit ?? maxLines;
			if (!Number.isInteger(offset) || offset < 1) {
				throw new Error("read offset must be a positive integer.");
			}
			if (!Number.isInteger(limit) || limit < 1) {
				throw new Error("read limit must be a positive integer.");
			}
			if (offset > lines.length) {
				throw new Error(
					`read offset ${offset} is beyond end of file (${lines.length} lines).`,
				);
			}
			const startIndex = offset - 1;
			const selectedLines = lines.slice(startIndex, startIndex + limit);
			const endLine = startIndex + selectedLines.length;
			const truncated = endLine < lines.length;
			const output = truncated
				? `${selectedLines.join("\n")}\n\n[Showing lines ${offset}-${endLine} of ${lines.length}. Use offset=${endLine + 1} to continue.]`
				: selectedLines.join("\n");
			const language = inferLanguage(path);
			return textResult(
				output,
				{
					path,
					stat,
					startLine: offset,
					endLine,
					totalLines: lines.length,
					truncated,
				},
				{
					title: `Read ${path}`,
					path,
					...(language !== undefined ? { language } : {}),
					summary: truncated
						? `Read lines ${offset}-${endLine} of ${lines.length}`
						: `Read ${lines.length} line${lines.length === 1 ? "" : "s"}`,
				},
			);
		},
	};
}
