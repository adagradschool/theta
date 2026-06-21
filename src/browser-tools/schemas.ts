import { Type } from "@earendil-works/pi-ai/base";
import type { ThetaToolSchema } from "../tools.ts";

export const thetaReadToolSchema = Type.Object({
	path: Type.String({ description: "Workspace file path to read." }),
	offset: Type.Optional(
		Type.Number({ description: "1-indexed first line to read." }),
	),
	limit: Type.Optional(Type.Number({ description: "Maximum lines to read." })),
}) as unknown as ThetaToolSchema;

export const thetaWriteToolSchema = Type.Object({
	path: Type.String({ description: "Workspace file path to write." }),
	content: Type.String({ description: "Complete file content." }),
	overwrite: Type.Optional(
		Type.Boolean({ description: "Whether to replace an existing file." }),
	),
	createParents: Type.Optional(
		Type.Boolean({ description: "Whether to create missing parent folders." }),
	),
	expectedVersion: Type.Optional(
		Type.String({ description: "Required existing file version." }),
	),
}) as unknown as ThetaToolSchema;

export const thetaEditToolSchema = Type.Object({
	path: Type.String({ description: "Workspace file path to edit." }),
	oldText: Type.Optional(
		Type.String({ description: "Exact text to replace for a single edit." }),
	),
	newText: Type.Optional(Type.String({ description: "Replacement text." })),
	edits: Type.Optional(
		Type.Array(
			Type.Object({
				oldText: Type.String({ description: "Exact text to replace." }),
				newText: Type.String({ description: "Replacement text." }),
			}),
			{ description: "Multiple exact, non-overlapping replacements." },
		),
	),
	createParents: Type.Optional(
		Type.Boolean({ description: "Whether to create missing parent folders." }),
	),
	expectedVersion: Type.Optional(
		Type.String({ description: "Required existing file version." }),
	),
}) as unknown as ThetaToolSchema;

export const thetaLsToolSchema = Type.Object({
	path: Type.Optional(
		Type.String({ description: "Workspace directory path to list." }),
	),
	recursive: Type.Optional(
		Type.Boolean({ description: "Whether to list descendants recursively." }),
	),
	limit: Type.Optional(
		Type.Number({ description: "Maximum entries to return." }),
	),
}) as unknown as ThetaToolSchema;

export const thetaGrepToolSchema = Type.Object({
	pattern: Type.String({ description: "Regex or literal text to search for." }),
	path: Type.Optional(
		Type.String({ description: "Workspace file or directory path to search." }),
	),
	glob: Type.Optional(
		Type.String({ description: "Optional file glob, for example **/*.ts." }),
	),
	ignoreCase: Type.Optional(Type.Boolean()),
	literal: Type.Optional(Type.Boolean()),
	context: Type.Optional(
		Type.Number({ description: "Context lines before and after each match." }),
	),
	limit: Type.Optional(Type.Number({ description: "Maximum matches." })),
}) as unknown as ThetaToolSchema;

export const thetaFindToolSchema = Type.Object({
	pattern: Type.String({ description: "Glob pattern to match file paths." }),
	path: Type.Optional(
		Type.String({ description: "Workspace directory path to search." }),
	),
	kind: Type.Optional(
		Type.Union([Type.Literal("file"), Type.Literal("directory")]),
	),
	limit: Type.Optional(Type.Number({ description: "Maximum matches." })),
}) as unknown as ThetaToolSchema;
