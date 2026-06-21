import { defaultEnv, parseAssignment } from "./commands/core.ts";
import { defaultShellCommands } from "./commands/index.ts";
import {
	expandShellWord,
	type ParsedCommand,
	parseShellScript,
} from "./parse.ts";
import { normalizeShellPath, resolveShellPath } from "./path.ts";
import { OK } from "./result.ts";
import type {
	CommandResult,
	JustBashLiteExecOptions,
	JustBashLiteOptions,
	JustBashLiteResult,
	ShellCommand,
	ShellCommandContext,
	WorkspaceShellAdapter,
} from "./types.ts";
import { JustBashLiteCancelledError } from "./types.ts";
import { createWorkspaceShellAdapter } from "./workspace.ts";

interface ShellState {
	readonly fs: WorkspaceShellAdapter;
	readonly commands: ReadonlyMap<string, ShellCommand>;
	readonly signal: AbortSignal;
	readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
	cwd: string;
	env: Record<string, string>;
}

interface OutputRedirect {
	readonly operator: ">" | ">>";
	readonly path: string;
}

export class JustBashLite {
	private readonly fs: WorkspaceShellAdapter;
	private readonly commands: ReadonlyMap<string, ShellCommand>;
	private readonly cwd: string;
	private readonly env: Readonly<Record<string, string>>;
	private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;

	constructor(options: JustBashLiteOptions) {
		this.fs = createWorkspaceShellAdapter(options.fs);
		this.cwd = normalizeShellPath(options.cwd ?? "/");
		this.env = { ...defaultEnv(this.cwd), ...(options.env ?? {}) };
		this.sleep = options.sleep ?? defaultSleep;
		const include = options.commands ? new Set(options.commands) : undefined;
		this.commands = new Map([
			...Object.entries(defaultShellCommands).filter(
				([name]) => !include || include.has(name),
			),
			...(options.customCommands ?? []).map(
				(command) => [command.name, command.execute] as const,
			),
		]);
	}

	async exec(
		script: string,
		options: JustBashLiteExecOptions = {},
	): Promise<JustBashLiteResult> {
		const timeout = createTimeoutSignal(options.signal, options.timeoutMs);
		const state: ShellState = {
			fs: this.fs,
			commands: this.commands,
			signal: timeout.signal,
			sleep: this.sleep,
			cwd: normalizeShellPath(options.cwd ?? this.cwd),
			env: {
				...(options.replaceEnv ? {} : this.env),
				...(options.env ?? {}),
			},
		};
		state.env.PWD = state.cwd;

		try {
			const result = await executeSteps(script, state, options.stdin ?? "");
			return {
				...result,
				cancelled: false,
				timedOut: false,
			};
		} catch (error) {
			if (error instanceof JustBashLiteCancelledError) {
				return {
					stdout: "",
					stderr: "",
					exitCode: 130,
					cancelled: true,
					timedOut: timeout.timedOut(),
				};
			}
			throw error;
		} finally {
			timeout.dispose();
		}
	}
}

export function createJustBashLite(options: JustBashLiteOptions): JustBashLite {
	return new JustBashLite(options);
}

async function executeSteps(
	script: string,
	state: ShellState,
	stdin: string,
): Promise<CommandResult> {
	const steps = parseShellScript(script);
	let stdout = "";
	let stderr = "";
	let lastExitCode = 0;

	for (const step of steps) {
		assertNotCancelled(state.signal);
		if (step.operator === "and" && lastExitCode !== 0) {
			continue;
		}
		if (step.operator === "or" && lastExitCode === 0) {
			continue;
		}
		const result = await executePipeline(step.pipeline.commands, state, stdin);
		stdout += result.stdout;
		stderr += result.stderr;
		lastExitCode = result.exitCode;
	}

	return { stdout, stderr, exitCode: lastExitCode };
}

async function executePipeline(
	commands: readonly ParsedCommand[],
	state: ShellState,
	stdin: string,
): Promise<CommandResult> {
	let input = stdin;
	let stderr = "";
	let exitCode = 0;
	for (const command of commands) {
		assertNotCancelled(state.signal);
		const result = await executeCommand(command, state, input);
		stderr += result.stderr;
		input = result.stdout;
		exitCode = result.exitCode;
	}
	return { stdout: input, stderr, exitCode };
}

async function executeCommand(
	command: ParsedCommand,
	state: ShellState,
	stdin: string,
): Promise<CommandResult> {
	let input = stdin;
	let outputRedirect: OutputRedirect | undefined;

	for (const redirect of command.redirects) {
		const target = statePath(
			state,
			expandShellWord(redirect.target, state.env),
		);
		if (redirect.operator === "<") {
			input = await state.fs.readText(target);
		} else {
			outputRedirect = { operator: redirect.operator, path: target };
		}
	}

	const expandedWords = command.words.map((word) =>
		expandShellWord(word, state.env),
	);
	const assignments: Record<string, string> = {};
	let commandIndex = 0;
	while (commandIndex < expandedWords.length) {
		const assignment = parseAssignment(expandedWords[commandIndex] ?? "");
		if (!assignment) {
			break;
		}
		assignments[assignment.name] = assignment.value;
		commandIndex += 1;
	}

	if (commandIndex >= expandedWords.length) {
		Object.assign(state.env, assignments);
		return OK;
	}

	const name = expandedWords[commandIndex] ?? "";
	const args = expandedWords.slice(commandIndex + 1);
	const registered = state.commands.get(name);
	if (!registered) {
		return {
			stdout: "",
			stderr: `${name}: command not found\n`,
			exitCode: 127,
		};
	}

	const commandEnv =
		Object.keys(assignments).length > 0
			? { ...state.env, ...assignments }
			: state.env;
	const context = createCommandContext(state, name, commandEnv);
	let result = await registered(context, args, input);

	if (outputRedirect) {
		if (outputRedirect.operator === ">>") {
			await state.fs.appendText(outputRedirect.path, result.stdout);
		} else {
			await state.fs.writeText(outputRedirect.path, result.stdout);
		}
		result = { ...result, stdout: "" };
	}

	return result;
}

function createCommandContext(
	state: ShellState,
	commandName: string,
	env: Readonly<Record<string, string>>,
): ShellCommandContext {
	return {
		fs: state.fs,
		get cwd() {
			return state.cwd;
		},
		env,
		signal: state.signal,
		commandName,
		resolvePath(path) {
			return statePath(state, path);
		},
		setCwd(path) {
			state.cwd = normalizeShellPath(path);
			state.env.PWD = state.cwd;
		},
		setEnv(name, value) {
			state.env[name] = value;
		},
		sleep(ms) {
			return state.sleep(ms, state.signal);
		},
	};
}

function statePath(state: ShellState, path: string): string {
	if (path === "~") {
		return "/";
	}
	if (path.startsWith("~/")) {
		return resolveShellPath("/", path.slice(2));
	}
	return resolveShellPath(state.cwd, path);
}

function createTimeoutSignal(
	signal: AbortSignal | undefined,
	timeoutMs: number | undefined,
): {
	readonly signal: AbortSignal;
	readonly timedOut: () => boolean;
	dispose(): void;
} {
	const controller = new AbortController();
	let timedOut = false;
	let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
	const abort = () => controller.abort();
	if (signal?.aborted) {
		controller.abort();
	}
	signal?.addEventListener("abort", abort, { once: true });
	if (timeoutMs !== undefined && timeoutMs > 0) {
		timeoutHandle = setTimeout(() => {
			timedOut = true;
			controller.abort();
		}, timeoutMs);
	}
	return {
		signal: controller.signal,
		timedOut: () => timedOut,
		dispose() {
			if (timeoutHandle) {
				clearTimeout(timeoutHandle);
			}
			signal?.removeEventListener("abort", abort);
		},
	};
}

function assertNotCancelled(signal: AbortSignal): void {
	if (signal.aborted) {
		throw new JustBashLiteCancelledError();
	}
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
	assertNotCancelled(signal);
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(resolve, ms);
		const abort = () => {
			clearTimeout(timeout);
			reject(new JustBashLiteCancelledError());
		};
		signal.addEventListener("abort", abort, { once: true });
	});
}
