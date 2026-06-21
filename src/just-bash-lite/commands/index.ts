import type { ShellCommandRegistry } from "../types.ts";
import { coreCommands } from "./core.ts";
import { fileCommands } from "./files.ts";
import { textCommands } from "./text.ts";

export const defaultShellCommands: ShellCommandRegistry = {
	...coreCommands,
	...fileCommands,
	...textCommands,
};

export const defaultShellCommandNames =
	Object.keys(defaultShellCommands).sort();
