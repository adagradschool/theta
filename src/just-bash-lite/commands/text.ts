import { matchesShellGlob } from "../glob.ts";
import { ok } from "../result.ts";
import type {
	CommandResult,
	ShellCommandContext,
	ShellCommandRegistry,
	WorkspaceShellEntry,
} from "../types.ts";
import {
	commandError,
	formatPathForOutput,
	matchesName,
	parseShortFlags,
	readableTextFiles,
	requireArgs,
	splitInputLines,
} from "./helpers.ts";

export const textCommands: ShellCommandRegistry = {
	async find(context, args) {
		const root = args[0]?.startsWith("-") ? "." : (args[0] ?? ".");
		let type: "file" | "directory" | undefined;
		let namePattern: string | undefined;
		for (
			let index = root === args[0] ? 1 : 0;
			index < args.length;
			index += 1
		) {
			const arg = args[index];
			if (arg === "-type") {
				const value = args[index + 1];
				if (value !== "f" && value !== "d") {
					return commandError("find", `${value ?? ""}: unsupported type`, 1);
				}
				type = value === "f" ? "file" : "directory";
				index += 1;
				continue;
			}
			if (arg === "-name") {
				namePattern = args[index + 1];
				index += 1;
			}
		}
		const rootPath = context.resolvePath(root);
		const rootEntry = await context.fs.stat(rootPath);
		const entries = [rootEntry, ...(await context.fs.walk(rootPath))]
			.filter((entry) => !type || entry.kind === type)
			.filter((entry) => !namePattern || matchesName(entry, namePattern))
			.map((entry) => entry.path)
			.sort();
		return ok(entries.length > 0 ? `${entries.join("\n")}\n` : "");
	},

	async grep(context, args, stdin) {
		return grepLike(context, args, stdin, { recursiveDefault: false });
	},

	async head(_context, args, stdin) {
		const { count, rest } = parseLineCount(args, 10);
		if (rest.length > 0) {
			return commandError("head", "file operands are not supported yet", 1);
		}
		const lines = splitInputLines(stdin).slice(0, count);
		return ok(lines.length > 0 ? `${lines.join("\n")}\n` : "");
	},

	async rg(context, args, stdin) {
		return grepLike(context, args, stdin, { recursiveDefault: true });
	},

	sort(_context, _args, stdin) {
		const lines = splitInputLines(stdin).slice().sort();
		return ok(lines.length > 0 ? `${lines.join("\n")}\n` : "");
	},

	async tail(_context, args, stdin) {
		const { count, rest } = parseLineCount(args, 10);
		if (rest.length > 0) {
			return commandError("tail", "file operands are not supported yet", 1);
		}
		const lines = splitInputLines(stdin).slice(-count);
		return ok(lines.length > 0 ? `${lines.join("\n")}\n` : "");
	},

	async wc(context, args, stdin) {
		const parsed = parseShortFlags(args, "lcw");
		const mode =
			parsed.flags.has("l") || parsed.flags.has("c") || parsed.flags.has("w")
				? parsed.flags
				: new Set(["l", "w", "c"]);
		if (parsed.args.length === 0) {
			return ok(`${formatWc(stdin, mode)}\n`);
		}
		let stdout = "";
		for (const arg of parsed.args) {
			const text = await context.fs.readText(context.resolvePath(arg));
			stdout += `${formatWc(text, mode)} ${arg}\n`;
		}
		return ok(stdout);
	},
};

async function grepLike(
	context: ShellCommandContext,
	args: readonly string[],
	stdin: string,
	options: { readonly recursiveDefault: boolean },
): Promise<CommandResult> {
	const parsed = parseShortFlags(args, "inrRl");
	const missing = requireArgs(
		context.commandName,
		parsed.args,
		1,
		"grep PATTERN [PATH...]",
	);
	if (missing) {
		return missing;
	}
	const pattern = parsed.args[0] ?? "";
	const paths = parsed.args.slice(1);
	const ignoreCase = parsed.flags.has("i");
	const recursive =
		options.recursiveDefault || parsed.flags.has("r") || parsed.flags.has("R");
	const listOnly = parsed.flags.has("l");
	const showLine = parsed.flags.has("n") || context.commandName === "rg";
	let matcher: RegExp;
	try {
		matcher = new RegExp(pattern, ignoreCase ? "i" : "");
	} catch (error) {
		return commandError(
			context.commandName,
			`invalid regular expression: ${error instanceof Error ? error.message : String(error)}`,
			2,
		);
	}

	if (paths.length === 0) {
		return grepInput(stdin, matcher, { showLine, listOnly: false });
	}

	let stdout = "";
	let stderr = "";
	let matches = 0;
	try {
		const files = await readableTextFiles(context, paths, { recursive });
		const prefixPath = files.length > 1 || recursive;
		for (const file of files) {
			const text = await context.fs.readText(file.path);
			const fileMatches = grepLines(text, matcher);
			if (fileMatches.length === 0) {
				continue;
			}
			matches += fileMatches.length;
			if (listOnly) {
				stdout += `${formatPathForOutput(context, file.path)}\n`;
				continue;
			}
			for (const match of fileMatches) {
				const prefix = prefixPath
					? `${formatPathForOutput(context, file.path)}:`
					: "";
				const linePrefix = showLine ? `${match.line}:` : "";
				stdout += `${prefix}${linePrefix}${match.text}\n`;
			}
		}
	} catch (error) {
		stderr += `${context.commandName}: ${error instanceof Error ? error.message : String(error)}\n`;
		return { stdout, stderr, exitCode: 2 };
	}
	return { stdout, stderr, exitCode: matches > 0 ? 0 : 1 };
}

function grepInput(
	input: string,
	matcher: RegExp,
	options: { readonly showLine: boolean; readonly listOnly: boolean },
): CommandResult {
	if (options.listOnly) {
		return ok("");
	}
	const matches = grepLines(input, matcher);
	const stdout = matches
		.map((match) => `${options.showLine ? `${match.line}:` : ""}${match.text}`)
		.join("\n");
	return {
		stdout: stdout.length > 0 ? `${stdout}\n` : "",
		stderr: "",
		exitCode: matches.length > 0 ? 0 : 1,
	};
}

function grepLines(
	input: string,
	matcher: RegExp,
): readonly { readonly line: number; readonly text: string }[] {
	return splitInputLines(input)
		.map((text, index) => ({ line: index + 1, text }))
		.filter((line) => matcher.test(line.text));
}

function parseLineCount(
	args: readonly string[],
	defaultCount: number,
): { readonly count: number; readonly rest: readonly string[] } {
	if (args[0] === "-n") {
		return {
			count: Math.max(0, Number.parseInt(args[1] ?? `${defaultCount}`, 10)),
			rest: args.slice(2),
		};
	}
	const first = args[0];
	if (first?.startsWith("-") && /^-\d+$/.test(first)) {
		return {
			count: Math.max(0, Number.parseInt(first.slice(1), 10)),
			rest: args.slice(1),
		};
	}
	return { count: defaultCount, rest: args };
}

function formatWc(input: string, flags: ReadonlySet<string>): string {
	const values: string[] = [];
	if (flags.has("l")) {
		values.push(String(splitInputLines(input).length));
	}
	if (flags.has("w")) {
		values.push(
			String(input.trim().length === 0 ? 0 : input.trim().split(/\s+/).length),
		);
	}
	if (flags.has("c")) {
		values.push(String(new TextEncoder().encode(input).byteLength));
	}
	return values.join(" ");
}

export function filterByGlob(
	entries: readonly WorkspaceShellEntry[],
	pattern: string,
): readonly WorkspaceShellEntry[] {
	return entries.filter((entry) =>
		matchesShellGlob(entry.path.slice(1), pattern),
	);
}
