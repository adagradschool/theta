import type { FileStat } from "../filesystem.ts";
import type { JsonObject } from "../json.ts";

export type ThetaBrowserToolName =
	| "bash"
	| "read"
	| "write"
	| "edit"
	| "ls"
	| "grep"
	| "find";

export interface ThetaBrowserToolsOptions {
	readonly include?: readonly ThetaBrowserToolName[];
	readonly bash?: import("../bash-tool/index.ts").ThetaBashToolOptions;
	readonly read?: ThetaReadToolOptions;
	readonly write?: ThetaWriteToolOptions;
	readonly edit?: ThetaEditToolOptions;
	readonly ls?: ThetaLsToolOptions;
	readonly grep?: ThetaGrepToolOptions;
	readonly find?: ThetaFindToolOptions;
}

export interface ThetaReadToolOptions {
	readonly maxLines?: number;
}

export interface ThetaWriteToolOptions {
	readonly createParents?: boolean;
}

export interface ThetaEditToolOptions {
	readonly createParents?: boolean;
}

export interface ThetaLsToolOptions {
	readonly defaultLimit?: number;
}

export interface ThetaGrepToolOptions {
	readonly defaultLimit?: number;
	readonly maxLineLength?: number;
}

export interface ThetaFindToolOptions {
	readonly defaultLimit?: number;
}

export interface ThetaReadToolInput extends JsonObject {
	readonly path: string;
	readonly offset?: number;
	readonly limit?: number;
}

export interface ThetaWriteToolInput extends JsonObject {
	readonly path: string;
	readonly content: string;
	readonly overwrite?: boolean;
	readonly createParents?: boolean;
	readonly expectedVersion?: string;
}

export interface ThetaEditReplacement extends JsonObject {
	readonly oldText: string;
	readonly newText: string;
}

export interface ThetaEditToolInput extends JsonObject {
	readonly path: string;
	readonly oldText?: string;
	readonly newText?: string;
	readonly edits?: readonly ThetaEditReplacement[];
	readonly createParents?: boolean;
	readonly expectedVersion?: string;
}

export interface ThetaLsToolInput extends JsonObject {
	readonly path?: string;
	readonly recursive?: boolean;
	readonly limit?: number;
}

export interface ThetaGrepToolInput extends JsonObject {
	readonly pattern: string;
	readonly path?: string;
	readonly glob?: string;
	readonly ignoreCase?: boolean;
	readonly literal?: boolean;
	readonly context?: number;
	readonly limit?: number;
}

export interface ThetaFindToolInput extends JsonObject {
	readonly pattern: string;
	readonly path?: string;
	readonly kind?: "file" | "directory";
	readonly limit?: number;
}

export interface ThetaReadToolDetails {
	readonly path: string;
	readonly stat: FileStat;
	readonly startLine: number;
	readonly endLine: number;
	readonly totalLines: number;
	readonly truncated: boolean;
}

export interface ThetaWriteToolDetails {
	readonly path: string;
	readonly bytes: number;
	readonly created: boolean;
	readonly stat: FileStat;
}

export interface ThetaEditToolDetails {
	readonly path: string;
	readonly replacements: number;
	readonly stat: FileStat;
	readonly diff: string;
}

export interface ThetaLsEntry {
	readonly path: string;
	readonly name: string;
	readonly kind: "file" | "directory";
	readonly size: number;
}

export interface ThetaLsToolDetails {
	readonly path: string;
	readonly entries: readonly ThetaLsEntry[];
	readonly totalEntries: number;
	readonly returnedEntries: number;
	readonly truncated: boolean;
}

export interface ThetaGrepMatch {
	readonly path: string;
	readonly line: number;
	readonly text: string;
	readonly matched: boolean;
}

export interface ThetaGrepToolDetails {
	readonly path: string;
	readonly matches: readonly ThetaGrepMatch[];
	readonly totalMatches: number;
	readonly returnedMatches: number;
	readonly truncated: boolean;
}

export interface ThetaFindMatch {
	readonly path: string;
	readonly kind: "file" | "directory";
}

export interface ThetaFindToolDetails {
	readonly path: string;
	readonly matches: readonly ThetaFindMatch[];
	readonly totalMatches: number;
	readonly returnedMatches: number;
	readonly truncated: boolean;
}
