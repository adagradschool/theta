import { normalizeWorkspacePath } from "../fs/filesystem.ts";
import type { WorkspaceFs } from "../fs/filesystem.ts";
import type { ThetaToolDefinition, ThetaToolFactory } from "../core/tools.ts";
import {
	assertNotAborted,
	countBytes,
	inferLanguage,
	pathExists,
	textResult,
	writeTextWithParents,
} from "./helpers.ts";
import { thetaWriteToolSchema } from "./schemas.ts";
import type {
	ThetaWriteToolDetails,
	ThetaWriteToolInput,
	ThetaWriteToolOptions,
} from "./types.ts";

export function createThetaWriteTool(
	options: ThetaWriteToolOptions = {},
): ThetaToolFactory {
	return ({ fs }) => createThetaWriteToolDefinition(fs, options);
}

export function createThetaWriteToolDefinition(
	fs: WorkspaceFs,
	options: ThetaWriteToolOptions = {},
): ThetaToolDefinition<ThetaWriteToolInput, ThetaWriteToolDetails> {
	return {
		name: "write",
		label: "Write",
		description:
			"Create or overwrite a UTF-8 text file in the workspace. Missing parent directories are created by default.",
		parameters: thetaWriteToolSchema,
		executionMode: "sequential",
		async execute(context) {
			assertNotAborted(context.signal);
			const path = normalizeWorkspacePath(context.input.path);
			const created = !(await pathExists(fs, path));
			await writeTextWithParents(fs, path, context.input.content, {
				createParents:
					context.input.createParents ?? options.createParents ?? true,
				overwrite: context.input.overwrite ?? true,
				...(context.input.expectedVersion !== undefined
					? { expectedVersion: context.input.expectedVersion }
					: {}),
			});
			assertNotAborted(context.signal);
			const stat = await fs.stat(path);
			const bytes = countBytes(context.input.content);
			const language = inferLanguage(path);
			return textResult(
				`${created ? "Created" : "Wrote"} ${path} (${bytes} bytes).`,
				{ path, bytes, created, stat },
				{
					title: `${created ? "Created" : "Wrote"} ${path}`,
					path,
					...(language !== undefined ? { language } : {}),
					summary: `${bytes} bytes`,
				},
			);
		},
	};
}
