import type { ThetaToolDefinition, ThetaToolFactory } from "../tools.ts";
import { createThetaEditTool, createThetaEditToolDefinition } from "./edit.ts";
import { createThetaFindTool, createThetaFindToolDefinition } from "./find.ts";
import { createThetaGrepTool, createThetaGrepToolDefinition } from "./grep.ts";
import { createThetaLsTool, createThetaLsToolDefinition } from "./ls.ts";
import { createThetaReadTool, createThetaReadToolDefinition } from "./read.ts";
import type { ThetaBrowserToolsOptions } from "./types.ts";
import {
	createThetaWriteTool,
	createThetaWriteToolDefinition,
} from "./write.ts";

const DEFAULT_BROWSER_TOOL_NAMES = [
	"read",
	"write",
	"edit",
	"ls",
	"grep",
	"find",
] as const;

export function createThetaBrowserTools(
	options: ThetaBrowserToolsOptions = {},
): ThetaToolFactory {
	return ({ fs }) => {
		const include = new Set(options.include ?? DEFAULT_BROWSER_TOOL_NAMES);
		const tools: ThetaToolDefinition[] = [];
		if (include.has("read")) {
			tools.push(createThetaReadToolDefinition(fs, options.read));
		}
		if (include.has("write")) {
			tools.push(createThetaWriteToolDefinition(fs, options.write));
		}
		if (include.has("edit")) {
			tools.push(createThetaEditToolDefinition(fs, options.edit));
		}
		if (include.has("ls")) {
			tools.push(createThetaLsToolDefinition(fs, options.ls));
		}
		if (include.has("grep")) {
			tools.push(createThetaGrepToolDefinition(fs, options.grep));
		}
		if (include.has("find")) {
			tools.push(createThetaFindToolDefinition(fs, options.find));
		}
		return tools;
	};
}

export {
	createThetaEditTool,
	createThetaEditToolDefinition,
	createThetaFindTool,
	createThetaFindToolDefinition,
	createThetaGrepTool,
	createThetaGrepToolDefinition,
	createThetaLsTool,
	createThetaLsToolDefinition,
	createThetaReadTool,
	createThetaReadToolDefinition,
	createThetaWriteTool,
	createThetaWriteToolDefinition,
};

export type {
	ThetaBrowserToolName,
	ThetaBrowserToolsOptions,
	ThetaEditReplacement,
	ThetaEditToolDetails,
	ThetaEditToolInput,
	ThetaEditToolOptions,
	ThetaFindMatch,
	ThetaFindToolDetails,
	ThetaFindToolInput,
	ThetaFindToolOptions,
	ThetaGrepMatch,
	ThetaGrepToolDetails,
	ThetaGrepToolInput,
	ThetaGrepToolOptions,
	ThetaLsEntry,
	ThetaLsToolDetails,
	ThetaLsToolInput,
	ThetaLsToolOptions,
	ThetaReadToolDetails,
	ThetaReadToolInput,
	ThetaReadToolOptions,
	ThetaWriteToolDetails,
	ThetaWriteToolInput,
	ThetaWriteToolOptions,
} from "./types.ts";
