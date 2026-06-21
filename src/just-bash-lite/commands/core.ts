import { resolveShellPath } from "../path.ts";
import { fail, OK, ok } from "../result.ts";
import type { ShellCommandRegistry } from "../types.ts";
import { commandError } from "./helpers.ts";

export const coreCommands: ShellCommandRegistry = {
	async cd(context, args) {
		const target = context.resolvePath(args[0] ?? "/");
		const stat = await context.fs.stat(target);
		if (stat.kind !== "directory") {
			return commandError("cd", `${args[0] ?? target}: Not a directory`);
		}
		context.setCwd(target);
		return OK;
	},

	echo(_context, args) {
		let newline = true;
		let start = 0;
		if (args[0] === "-n") {
			newline = false;
			start = 1;
		}
		return ok(`${args.slice(start).join(" ")}${newline ? "\n" : ""}`);
	},

	env(context) {
		return ok(formatEnv(context.env));
	},

	export(context, args) {
		if (args.length === 0) {
			const lines = Object.entries(context.env)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(
					([key, value]) => `declare -x ${key}="${value.replace(/"/g, '\\"')}"`,
				);
			return ok(lines.length > 0 ? `${lines.join("\n")}\n` : "");
		}
		for (const arg of args) {
			const assignment = parseAssignment(arg);
			if (!assignment) {
				return commandError("export", `${arg}: not a valid identifier`, 1);
			}
			context.setEnv(assignment.name, assignment.value);
		}
		return OK;
	},

	false() {
		return fail("", 1);
	},

	printenv(context, args) {
		if (args.length === 0) {
			return ok(formatEnv(context.env));
		}
		const values = args
			.map((arg) => context.env[arg])
			.filter((value): value is string => value !== undefined);
		return {
			stdout: values.length > 0 ? `${values.join("\n")}\n` : "",
			stderr: "",
			exitCode: values.length === args.length ? 0 : 1,
		};
	},

	printf(_context, args) {
		if (args.length === 0) {
			return ok("");
		}
		const format = args[0] ?? "";
		const values = args.slice(1);
		let valueIndex = 0;
		let stdout = "";
		for (let index = 0; index < format.length; index += 1) {
			const char = format[index] ?? "";
			if (char === "\\") {
				const next = format[index + 1];
				if (next === "n") {
					stdout += "\n";
					index += 1;
				} else if (next === "t") {
					stdout += "\t";
					index += 1;
				} else {
					stdout += next ?? "\\";
					index += next === undefined ? 0 : 1;
				}
				continue;
			}
			if (char === "%") {
				const next = format[index + 1];
				if (next === "%") {
					stdout += "%";
					index += 1;
					continue;
				}
				if (next === "s" || next === "d") {
					stdout += values[valueIndex] ?? "";
					valueIndex += 1;
					index += 1;
					continue;
				}
			}
			stdout += char;
		}
		return ok(stdout);
	},

	pwd(context) {
		return ok(`${context.cwd}\n`);
	},

	async sleep(context, args) {
		const seconds = Number(args[0] ?? "1");
		if (!Number.isFinite(seconds) || seconds < 0) {
			return commandError(
				"sleep",
				`${args[0] ?? ""}: invalid time interval`,
				1,
			);
		}
		await context.sleep(seconds * 1000);
		return OK;
	},

	true() {
		return OK;
	},

	which(_context, args) {
		if (args.length === 0) {
			return commandError("which", "missing operand", 1);
		}
		return ok(`${args.map((arg) => `/bin/${arg}`).join("\n")}\n`);
	},
};

export function parseAssignment(
	value: string,
): { readonly name: string; readonly value: string } | undefined {
	const index = value.indexOf("=");
	if (index <= 0) {
		return undefined;
	}
	const name = value.slice(0, index);
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
		return undefined;
	}
	return { name, value: value.slice(index + 1) };
}

function formatEnv(env: Readonly<Record<string, string>>): string {
	const lines = Object.entries(env)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, value]) => `${key}=${value}`);
	return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

export function defaultEnv(cwd: string): Record<string, string> {
	return {
		HOME: "/",
		PATH: "/usr/bin:/bin",
		PWD: resolveShellPath("/", cwd),
		SHELL: "/bin/bash",
		TERM: "xterm-256color",
		USER: "theta",
	};
}
