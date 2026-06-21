import type { CommandResult } from "./types.ts";

export const OK: CommandResult = {
	stdout: "",
	stderr: "",
	exitCode: 0,
};

export function ok(stdout = ""): CommandResult {
	return {
		stdout,
		stderr: "",
		exitCode: 0,
	};
}

export function fail(stderr: string, exitCode = 1): CommandResult {
	return {
		stdout: "",
		stderr,
		exitCode,
	};
}

export function combineResults(
	results: readonly CommandResult[],
	exitCode: number,
): CommandResult {
	return {
		stdout: results.map((result) => result.stdout).join(""),
		stderr: results.map((result) => result.stderr).join(""),
		exitCode,
	};
}
