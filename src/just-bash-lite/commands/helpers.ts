import { matchesShellGlob } from "../glob.ts";
import { basenameShellPath } from "../path.ts";
import { fail } from "../result.ts";
import type {
	CommandResult,
	ShellCommandContext,
	WorkspaceShellEntry,
} from "../types.ts";

export interface ParsedFlags {
	readonly flags: ReadonlySet<string>;
	readonly args: readonly string[];
}

export function parseShortFlags(
	args: readonly string[],
	knownFlags: string,
): ParsedFlags {
	const flags = new Set<string>();
	const rest: string[] = [];
	let parsingFlags = true;
	for (const arg of args) {
		if (!parsingFlags || arg === "-" || !arg.startsWith("-")) {
			rest.push(arg);
			continue;
		}
		if (arg === "--") {
			parsingFlags = false;
			continue;
		}
		for (const flag of arg.slice(1)) {
			if (!knownFlags.includes(flag)) {
				rest.push(arg);
				continue;
			}
			flags.add(flag);
		}
	}
	return { flags, args: rest };
}

export function commandError(
	command: string,
	message: string,
	exitCode = 1,
): CommandResult {
	return fail(`${command}: ${message}\n`, exitCode);
}

export function requireArgs(
	command: string,
	args: readonly string[],
	min: number,
	usage: string,
): CommandResult | undefined {
	if (args.length >= min) {
		return undefined;
	}
	return commandError(command, `missing operand\nusage: ${usage}`, 2);
}

export async function readableTextFiles(
	context: ShellCommandContext,
	paths: readonly string[],
	options: { readonly recursive?: boolean } = {},
): Promise<readonly WorkspaceShellEntry[]> {
	const files: WorkspaceShellEntry[] = [];
	for (const rawPath of paths) {
		const path = context.resolvePath(rawPath);
		const entry = await context.fs.stat(path);
		if (entry.kind === "file") {
			files.push(entry);
			continue;
		}
		if (!options.recursive) {
			throw new Error(`${context.commandName}: ${rawPath}: Is a directory`);
		}
		for (const descendant of await context.fs.walk(path)) {
			if (descendant.kind === "file") {
				files.push(descendant);
			}
		}
	}
	return files.sort((left, right) => left.path.localeCompare(right.path));
}

export function splitInputLines(input: string): readonly string[] {
	if (input.length === 0) {
		return [];
	}
	const normalized = input.endsWith("\n") ? input.slice(0, -1) : input;
	return normalized.length === 0 ? [""] : normalized.split(/\r\n|\r|\n/);
}

export function formatPathForOutput(
	context: ShellCommandContext,
	path: string,
): string {
	const relative = path.startsWith(`${context.cwd}/`)
		? path.slice(context.cwd.length + 1)
		: path === context.cwd
			? "."
			: path;
	return relative.startsWith("/")
		? relative
		: relative || basenameShellPath(path);
}

export function matchesName(
	entry: WorkspaceShellEntry,
	pattern: string,
): boolean {
	return (
		matchesShellGlob(entry.name, pattern) ||
		matchesShellGlob(entry.path.slice(1), pattern)
	);
}
