import { normalizeWorkspacePath } from "../fs/filesystem.ts";
import type { WorkspaceFs } from "../fs/filesystem.ts";
import type { ThetaToolDefinition, ThetaToolFactory } from "../core/tools.ts";
import {
	assertNotAborted,
	createUnifiedDiff,
	inferLanguage,
	textResult,
	writeTextWithParents,
} from "./helpers.ts";
import { thetaEditToolSchema } from "./schemas.ts";
import type {
	ThetaEditReplacement,
	ThetaEditToolDetails,
	ThetaEditToolInput,
	ThetaEditToolOptions,
} from "./types.ts";

export function createThetaEditTool(
	options: ThetaEditToolOptions = {},
): ThetaToolFactory {
	return ({ fs }) => createThetaEditToolDefinition(fs, options);
}

export function createThetaEditToolDefinition(
	fs: WorkspaceFs,
	options: ThetaEditToolOptions = {},
): ThetaToolDefinition<ThetaEditToolInput, ThetaEditToolDetails> {
	return {
		name: "edit",
		label: "Edit",
		description:
			"Edit a UTF-8 text file using exact text replacements. Each oldText must match exactly once in the original file.",
		parameters: thetaEditToolSchema,
		executionMode: "sequential",
		async execute(context) {
			assertNotAborted(context.signal);
			const path = normalizeWorkspacePath(context.input.path);
			const replacements = normalizeReplacements(context.input);
			const before = await fs.readTextFile(path);
			const after = applyReplacements(before, replacements, path);
			const diff = createUnifiedDiff(path, before, after);
			await writeTextWithParents(fs, path, after, {
				createParents:
					context.input.createParents ?? options.createParents ?? true,
				...(context.input.expectedVersion !== undefined
					? { expectedVersion: context.input.expectedVersion }
					: {}),
			});
			assertNotAborted(context.signal);
			const stat = await fs.stat(path);
			const language = inferLanguage(path);
			return textResult(
				`Edited ${path}: replaced ${replacements.length} block(s).`,
				{ path, replacements: replacements.length, stat, diff },
				{
					title: `Edited ${path}`,
					path,
					...(language !== undefined ? { language } : {}),
					summary: `${replacements.length} replacement${replacements.length === 1 ? "" : "s"}`,
					data: { diff },
				},
			);
		},
	};
}

function normalizeReplacements(
	input: ThetaEditToolInput,
): readonly ThetaEditReplacement[] {
	if (input.edits !== undefined) {
		if (input.edits.length === 0) {
			throw new Error("edit requires at least one replacement.");
		}
		return input.edits;
	}
	if (input.oldText === undefined || input.newText === undefined) {
		throw new Error("edit requires either edits[] or oldText and newText.");
	}
	return [{ oldText: input.oldText, newText: input.newText }];
}

function applyReplacements(
	content: string,
	replacements: readonly ThetaEditReplacement[],
	path: string,
): string {
	const ranges = replacements.map((replacement) => {
		if (replacement.oldText.length === 0) {
			throw new Error(`Cannot edit ${path}: oldText cannot be empty.`);
		}
		const firstIndex = content.indexOf(replacement.oldText);
		if (firstIndex === -1) {
			throw new Error(`Cannot edit ${path}: oldText was not found.`);
		}
		const secondIndex = content.indexOf(
			replacement.oldText,
			firstIndex + replacement.oldText.length,
		);
		if (secondIndex !== -1) {
			throw new Error(`Cannot edit ${path}: oldText matched more than once.`);
		}
		return {
			start: firstIndex,
			end: firstIndex + replacement.oldText.length,
			replacement,
		};
	});
	const sorted = ranges.slice().sort((a, b) => a.start - b.start);
	for (let index = 1; index < sorted.length; index += 1) {
		const previous = sorted[index - 1];
		const current = sorted[index];
		if (previous && current && current.start < previous.end) {
			throw new Error(`Cannot edit ${path}: replacements overlap.`);
		}
	}
	let next = "";
	let cursor = 0;
	for (const range of sorted) {
		next += content.slice(cursor, range.start);
		next += range.replacement.newText;
		cursor = range.end;
	}
	next += content.slice(cursor);
	return next;
}
