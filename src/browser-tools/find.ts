import { normalizeWorkspacePath } from "../filesystem.ts";
import type { WorkspaceFs } from "../filesystem.ts";
import type { ThetaToolDefinition, ThetaToolFactory } from "../tools.ts";
import {
	assertNotAborted,
	matchesPathOrBasename,
	textResult,
	toRelativeWorkspacePath,
	walkWorkspace,
} from "./helpers.ts";
import { thetaFindToolSchema } from "./schemas.ts";
import type {
	ThetaFindMatch,
	ThetaFindToolDetails,
	ThetaFindToolInput,
	ThetaFindToolOptions,
} from "./types.ts";

const DEFAULT_LIMIT = 1000;

export function createThetaFindTool(
	options: ThetaFindToolOptions = {},
): ThetaToolFactory {
	return ({ fs }) => createThetaFindToolDefinition(fs, options);
}

export function createThetaFindToolDefinition(
	fs: WorkspaceFs,
	options: ThetaFindToolOptions = {},
): ThetaToolDefinition<ThetaFindToolInput, ThetaFindToolDetails> {
	return {
		name: "find",
		label: "Find",
		description:
			"Find workspace files or directories by glob pattern. Matches path segments and basenames.",
		parameters: thetaFindToolSchema,
		async execute(context) {
			assertNotAborted(context.signal);
			const path = normalizeWorkspacePath(context.input.path ?? "/");
			const limit =
				context.input.limit ?? options.defaultLimit ?? DEFAULT_LIMIT;
			if (!Number.isInteger(limit) || limit < 1) {
				throw new Error("find limit must be a positive integer.");
			}
			const entries = await walkWorkspace(fs, path, {
				includeDirectories: true,
				signal: context.signal,
			});
			const collected: ThetaFindMatch[] = [];
			for (const entry of entries) {
				if (
					context.input.kind !== undefined &&
					entry.kind !== context.input.kind
				) {
					continue;
				}
				const relativePath = toRelativeWorkspacePath(entry.path, path);
				if (!matchesPathOrBasename(relativePath, context.input.pattern)) {
					continue;
				}
				collected.push({ path: entry.path, kind: entry.kind });
				if (collected.length > limit) {
					break;
				}
			}
			const matches = collected.slice(0, limit);
			const truncated = collected.length > limit;
			const output =
				matches.length === 0
					? "No files found matching pattern."
					: matches
							.map((match) =>
								match.kind === "directory"
									? `${toRelativeWorkspacePath(match.path, path)}/`
									: toRelativeWorkspacePath(match.path, path),
							)
							.join("\n");
			const notice = truncated
				? `\n\n[Showing first ${limit} results. Increase limit to continue.]`
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
					title: `Find ${context.input.pattern}`,
					path,
					summary: `${matches.length} result${matches.length === 1 ? "" : "s"}`,
				},
			);
		},
	};
}
