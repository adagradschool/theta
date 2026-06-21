import { basenameShellPath, dirnameShellPath } from "../path.ts";
import { OK, ok } from "../result.ts";
import type { ShellCommandRegistry, WorkspaceShellEntry } from "../types.ts";
import { parseShortFlags, requireArgs } from "./helpers.ts";

export const fileCommands: ShellCommandRegistry = {
	async basename(context, args) {
		const missing = requireArgs("basename", args, 1, "basename PATH");
		if (missing) {
			return missing;
		}
		return ok(`${basenameShellPath(context.resolvePath(args[0] ?? ""))}\n`);
	},

	async cat(context, args, stdin) {
		if (args.length === 0) {
			return ok(stdin);
		}
		let stdout = "";
		let stderr = "";
		let exitCode = 0;
		for (const arg of args) {
			try {
				stdout += await context.fs.readText(context.resolvePath(arg));
			} catch (error) {
				stderr += `cat: ${arg}: ${errorMessage(error)}\n`;
				exitCode = 1;
			}
		}
		return { stdout, stderr, exitCode };
	},

	async cp(context, args) {
		const parsed = parseShortFlags(args, "rR");
		const missing = requireArgs("cp", parsed.args, 2, "cp [-r] SOURCE TARGET");
		if (missing) {
			return missing;
		}
		const recursive = parsed.flags.has("r") || parsed.flags.has("R");
		const target = parsed.args[parsed.args.length - 1] ?? "";
		for (const source of parsed.args.slice(0, -1)) {
			await context.fs.copy(
				context.resolvePath(source),
				context.resolvePath(target),
				{
					recursive,
				},
			);
		}
		return OK;
	},

	async dirname(context, args) {
		const missing = requireArgs("dirname", args, 1, "dirname PATH");
		if (missing) {
			return missing;
		}
		return ok(`${dirnameShellPath(context.resolvePath(args[0] ?? ""))}\n`);
	},

	async ls(context, args) {
		const parsed = parseShortFlags(args, "alR");
		const paths = parsed.args.length > 0 ? parsed.args : ["."];
		let stdout = "";
		let stderr = "";
		let exitCode = 0;
		for (const rawPath of paths) {
			try {
				const path = context.resolvePath(rawPath);
				const entry = await context.fs.stat(path);
				if (entry.kind === "file") {
					stdout += `${formatLsEntry(entry)}\n`;
					continue;
				}
				const entries = parsed.flags.has("R")
					? await context.fs.walk(path)
					: await context.fs.list(path);
				stdout += `${entries.map(formatLsEntry).join("\n")}${
					entries.length > 0 ? "\n" : ""
				}`;
			} catch (error) {
				stderr += `ls: ${rawPath}: ${errorMessage(error)}\n`;
				exitCode = 1;
			}
		}
		return { stdout, stderr, exitCode };
	},

	async mkdir(context, args) {
		const parsed = parseShortFlags(args, "p");
		const missing = requireArgs(
			"mkdir",
			parsed.args,
			1,
			"mkdir [-p] DIRECTORY...",
		);
		if (missing) {
			return missing;
		}
		for (const arg of parsed.args) {
			await context.fs.mkdir(context.resolvePath(arg), {
				recursive: parsed.flags.has("p"),
			});
		}
		return OK;
	},

	async mv(context, args) {
		const missing = requireArgs("mv", args, 2, "mv SOURCE TARGET");
		if (missing) {
			return missing;
		}
		const target = args[args.length - 1] ?? "";
		for (const source of args.slice(0, -1)) {
			await context.fs.move(
				context.resolvePath(source),
				context.resolvePath(target),
			);
		}
		return OK;
	},

	async rm(context, args) {
		const parsed = parseShortFlags(args, "rfR");
		const missing = requireArgs("rm", parsed.args, 1, "rm [-rf] PATH...");
		if (missing) {
			return missing;
		}
		for (const arg of parsed.args) {
			await context.fs.delete(context.resolvePath(arg), {
				recursive: parsed.flags.has("r") || parsed.flags.has("R"),
				force: parsed.flags.has("f"),
			});
		}
		return OK;
	},

	async touch(context, args) {
		const missing = requireArgs("touch", args, 1, "touch FILE...");
		if (missing) {
			return missing;
		}
		for (const arg of args) {
			await context.fs.touch(context.resolvePath(arg));
		}
		return OK;
	},
};

function formatLsEntry(entry: WorkspaceShellEntry): string {
	return entry.kind === "directory" ? `${entry.path}/` : entry.path;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
