import type { JsonObject } from "../json.ts";
import type { JustBashLiteCustomCommand } from "../just-bash-lite/index.ts";

export interface ThetaBashToolOptions {
	readonly cwd?: string;
	readonly env?: Readonly<Record<string, string>>;
	readonly timeoutMs?: number;
	readonly maxOutputBytes?: number;
	readonly commands?: readonly string[];
	readonly customCommands?: readonly JustBashLiteCustomCommand[];
	readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export interface ThetaBashToolInput extends JsonObject {
	readonly command: string;
	readonly cwd?: string;
	readonly timeout?: number;
	readonly env?: Readonly<Record<string, string>>;
}

export interface ThetaBashOutputTruncation extends JsonObject {
	readonly originalBytes: number;
	readonly outputBytes: number;
	readonly omittedBytes: number;
	readonly maxBytes: number;
}

export interface ThetaBashToolDetails extends JsonObject {
	readonly command: string;
	readonly cwd: string;
	readonly stdout: string;
	readonly stderr: string;
	readonly exitCode: number;
	readonly cancelled: boolean;
	readonly timedOut: boolean;
	readonly durationMs: number;
	readonly truncated: boolean;
	readonly stdoutTruncation?: ThetaBashOutputTruncation;
	readonly stderrTruncation?: ThetaBashOutputTruncation;
}
