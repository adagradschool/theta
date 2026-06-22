import type { WorkspaceFs } from "../fs/filesystem.ts";

export interface JustBashLiteOptions {
	readonly fs: WorkspaceFs;
	readonly cwd?: string;
	readonly env?: Readonly<Record<string, string>>;
	readonly commands?: readonly string[];
	readonly customCommands?: readonly JustBashLiteCustomCommand[];
	readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export interface JustBashLiteExecOptions {
	readonly cwd?: string;
	readonly env?: Readonly<Record<string, string>>;
	readonly replaceEnv?: boolean;
	readonly stdin?: string;
	readonly signal?: AbortSignal;
	readonly timeoutMs?: number;
}

export interface JustBashLiteResult {
	readonly stdout: string;
	readonly stderr: string;
	readonly exitCode: number;
	readonly cancelled: boolean;
	readonly timedOut: boolean;
}

export interface CommandResult {
	readonly stdout: string;
	readonly stderr: string;
	readonly exitCode: number;
}

export interface WorkspaceShellEntry {
	readonly path: string;
	readonly name: string;
	readonly kind: "file" | "directory";
	readonly size: number;
}

export interface WorkspaceShellAdapter {
	exists(path: string): Promise<boolean>;
	stat(path: string): Promise<WorkspaceShellEntry>;
	readText(path: string): Promise<string>;
	writeText(path: string, text: string): Promise<void>;
	appendText(path: string, text: string): Promise<void>;
	mkdir(
		path: string,
		options?: { readonly recursive?: boolean },
	): Promise<void>;
	list(path: string): Promise<readonly WorkspaceShellEntry[]>;
	walk(path: string): Promise<readonly WorkspaceShellEntry[]>;
	delete(
		path: string,
		options?: { readonly recursive?: boolean; readonly force?: boolean },
	): Promise<void>;
	copy(
		from: string,
		to: string,
		options?: { readonly recursive?: boolean },
	): Promise<void>;
	move(from: string, to: string): Promise<void>;
	touch(path: string): Promise<void>;
}

export interface ShellCommandContext {
	readonly fs: WorkspaceShellAdapter;
	readonly cwd: string;
	readonly env: Readonly<Record<string, string>>;
	readonly signal: AbortSignal;
	readonly commandName: string;
	resolvePath(path: string): string;
	setCwd(path: string): void;
	setEnv(name: string, value: string): void;
	sleep(ms: number): Promise<void>;
}

export type ShellCommand = (
	context: ShellCommandContext,
	args: readonly string[],
	stdin: string,
) => Promise<CommandResult> | CommandResult;

export type ShellCommandRegistry = Readonly<Record<string, ShellCommand>>;

export interface JustBashLiteCustomCommand {
	readonly name: string;
	readonly execute: ShellCommand;
}

export class JustBashLiteCancelledError extends Error {
	constructor() {
		super("Command cancelled.");
		this.name = "JustBashLiteCancelledError";
	}
}
