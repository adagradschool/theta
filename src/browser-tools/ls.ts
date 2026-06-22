import { normalizeWorkspacePath } from "../fs/filesystem.ts";
import type { WorkspaceFs } from "../fs/filesystem.ts";
import type { ThetaToolDefinition, ThetaToolFactory } from "../core/tools.ts";
import { assertNotAborted, textResult, walkWorkspace } from "./helpers.ts";
import { thetaLsToolSchema } from "./schemas.ts";
import type {
	ThetaLsEntry,
	ThetaLsToolDetails,
	ThetaLsToolInput,
	ThetaLsToolOptions,
} from "./types.ts";

const DEFAULT_LIMIT = 200;

export function createThetaLsTool(
	options: ThetaLsToolOptions = {},
): ThetaToolFactory {
	return ({ fs }) => createThetaLsToolDefinition(fs, options);
}

export function createThetaLsToolDefinition(
	fs: WorkspaceFs,
	options: ThetaLsToolOptions = {},
): ThetaToolDefinition<ThetaLsToolInput, ThetaLsToolDetails> {
	return {
		name: "ls",
		label: "List",
		description:
			"List workspace directory contents. Directories are shown with a trailing slash.",
		parameters: thetaLsToolSchema,
		async execute(context) {
			assertNotAborted(context.signal);
			const path = normalizeWorkspacePath(context.input.path ?? "/");
			const limit =
				context.input.limit ?? options.defaultLimit ?? DEFAULT_LIMIT;
			if (!Number.isInteger(limit) || limit < 1) {
				throw new Error("ls limit must be a positive integer.");
			}
			const stat = await fs.stat(path);
			if (stat.kind !== "directory") {
				throw new Error(`Cannot list ${path}: path is not a directory.`);
			}
			const rawEntries = context.input.recursive
				? await walkWorkspace(fs, path, {
						includeDirectories: true,
						signal: context.signal,
					})
				: await Promise.all(
						(await fs.readdir(path)).map(async (entry) => ({
							path: entry.path,
							name: entry.name,
							kind: entry.kind,
							stat: entry.stat ?? (await fs.stat(entry.path)),
						})),
					);
			const entries: ThetaLsEntry[] = rawEntries.map((entry) => ({
				path: entry.path,
				name: entry.name,
				kind: entry.kind,
				size: entry.stat.size,
			}));
			const returned = entries.slice(0, limit);
			const truncated = returned.length < entries.length;
			const output =
				returned.length === 0
					? "(empty directory)"
					: returned.map(formatEntry).join("\n");
			const notice = truncated
				? `\n\n[Showing ${returned.length} of ${entries.length} entries. Increase limit to continue.]`
				: "";
			return textResult(
				`${output}${notice}`,
				{
					path,
					entries: returned,
					totalEntries: entries.length,
					returnedEntries: returned.length,
					truncated,
				},
				{
					title: `Listed ${path}`,
					path,
					summary: `${returned.length}/${entries.length} entries`,
				},
			);
		},
	};
}

function formatEntry(entry: ThetaLsEntry): string {
	return entry.kind === "directory" ? `${entry.path}/` : entry.path;
}
