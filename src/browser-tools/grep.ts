import { normalizeWorkspacePath } from "../fs/filesystem.ts";
import type { WorkspaceFs } from "../fs/filesystem.ts";
import type { ThetaToolDefinition, ThetaToolFactory } from "../core/tools.ts";
import {
	assertNotAborted,
	matchesPathOrBasename,
	splitLines,
	textResult,
	toRelativeWorkspacePath,
	truncateLine,
	walkWorkspace,
} from "./helpers.ts";
import { thetaGrepToolSchema } from "./schemas.ts";
import type {
	ThetaGrepMatch,
	ThetaGrepToolDetails,
	ThetaGrepToolInput,
	ThetaGrepToolOptions,
} from "./types.ts";

const DEFAULT_LIMIT = 100;
const DEFAULT_MAX_LINE_LENGTH = 240;

export function createThetaGrepTool(
	options: ThetaGrepToolOptions = {},
): ThetaToolFactory {
	return ({ fs }) => createThetaGrepToolDefinition(fs, options);
}

export function createThetaGrepToolDefinition(
	fs: WorkspaceFs,
	options: ThetaGrepToolOptions = {},
): ThetaToolDefinition<ThetaGrepToolInput, ThetaGrepToolDetails> {
	return {
		name: "grep",
		label: "Grep",
		description:
			"Search workspace text files for a regex or literal string. Returns file paths, line numbers, and matching lines.",
		parameters: thetaGrepToolSchema,
		async execute(context) {
			assertNotAborted(context.signal);
			const path = normalizeWorkspacePath(context.input.path ?? "/");
			const limit =
				context.input.limit ?? options.defaultLimit ?? DEFAULT_LIMIT;
			const contextLines = context.input.context ?? 0;
			if (!Number.isInteger(limit) || limit < 1) {
				throw new Error("grep limit must be a positive integer.");
			}
			if (!Number.isInteger(contextLines) || contextLines < 0) {
				throw new Error("grep context must be a non-negative integer.");
			}
			const matcher = createMatcher(context.input);
			const stat = await fs.stat(path);
			const candidates =
				stat.kind === "file"
					? [
							{
								path,
								name: path.slice(path.lastIndexOf("/") + 1),
								kind: "file" as const,
								stat,
							},
						]
					: await walkWorkspace(fs, path, { signal: context.signal });
			const collected: ThetaGrepMatch[] = [];
			const maxLineLength = options.maxLineLength ?? DEFAULT_MAX_LINE_LENGTH;
			for (const file of candidates) {
				assertNotAborted(context.signal);
				const relativePath = toRelativeWorkspacePath(file.path, path);
				if (
					context.input.glob !== undefined &&
					!matchesPathOrBasename(relativePath, context.input.glob)
				) {
					continue;
				}
				let text: string;
				try {
					text = await fs.readTextFile(file.path);
				} catch {
					continue;
				}
				const lines = splitLines(text);
				for (let index = 0; index < lines.length; index += 1) {
					const line = lines[index] ?? "";
					if (!matcher(line)) {
						continue;
					}
					const start = Math.max(0, index - contextLines);
					const end = Math.min(lines.length - 1, index + contextLines);
					for (let lineIndex = start; lineIndex <= end; lineIndex += 1) {
						const contextText = lines[lineIndex] ?? "";
						collected.push({
							path: file.path,
							line: lineIndex + 1,
							text: truncateLine(contextText, maxLineLength),
							matched: lineIndex === index,
						});
					}
					if (collected.length > limit) {
						break;
					}
				}
				if (collected.length > limit) {
					break;
				}
			}
			const matches = collected.slice(0, limit);
			const truncated = collected.length > limit;
			const output =
				matches.length === 0
					? "No matches found."
					: matches.map((match) => formatMatch(match, path)).join("\n");
			const notice = truncated
				? `\n\n[Showing first ${limit} matching lines. Increase limit to continue.]`
				: "";
			return textResult(
				`${output}${notice}`,
				{
					path,
					matches,
					totalMatches: collected.length,
					returnedMatches: matches.length,
					truncated,
				},
				{
					title: `Grep ${path}`,
					path,
					summary: `${matches.length} match${matches.length === 1 ? "" : "es"}`,
				},
			);
		},
	};
}

function createMatcher(input: ThetaGrepToolInput): (line: string) => boolean {
	if (input.literal) {
		const needle = input.ignoreCase
			? input.pattern.toLowerCase()
			: input.pattern;
		return (line) =>
			(input.ignoreCase ? line.toLowerCase() : line).includes(needle);
	}
	const flags = input.ignoreCase ? "i" : "";
	const expression = new RegExp(input.pattern, flags);
	return (line) => expression.test(line);
}

function formatMatch(match: ThetaGrepMatch, rootPath: string): string {
	const marker = match.matched ? ":" : "-";
	return `${toRelativeWorkspacePath(match.path, rootPath)}:${match.line}${marker} ${match.text}`;
}
