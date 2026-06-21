import type { JsonObject } from "./json.ts";

export type WorkspaceEntryKind = "file" | "directory";

export type WorkspacePath = string;

export interface FileStat {
	readonly path: string;
	readonly kind: WorkspaceEntryKind;
	readonly size: number;
	readonly mtime: number;
	readonly version?: string;
	readonly contentHash?: string;
	readonly mimeType?: string;
	readonly metadata?: JsonObject;
}

export interface DirEntry {
	readonly path: string;
	readonly name: string;
	readonly kind: WorkspaceEntryKind;
	readonly stat?: FileStat;
}

export type FsEventKind = "created" | "updated" | "deleted" | "renamed";

export interface FsEvent {
	readonly type: FsEventKind;
	readonly path: string;
	readonly previousPath?: string;
	readonly stat?: FileStat;
}

export interface WriteOptions {
	/**
	 * Allow creating a new file. Defaults to true.
	 */
	readonly create?: boolean;
	/**
	 * Allow replacing an existing file. Defaults to true.
	 */
	readonly overwrite?: boolean;
	/**
	 * Require the existing file to match this version before writing.
	 */
	readonly expectedVersion?: string;
	readonly mimeType?: string;
	readonly metadata?: JsonObject;
}

export interface WorkspaceFs {
	readFile(path: string): Promise<Uint8Array>;
	readTextFile(path: string): Promise<string>;
	writeFile(
		path: string,
		data: Uint8Array,
		options?: WriteOptions,
	): Promise<void>;
	writeTextFile(
		path: string,
		text: string,
		options?: WriteOptions,
	): Promise<void>;
	delete(path: string): Promise<void>;
	rename(from: string, to: string): Promise<void>;
	mkdir(path: string): Promise<void>;
	readdir(path: string): Promise<readonly DirEntry[]>;
	stat(path: string): Promise<FileStat>;
	watch(path: string, listener: (event: FsEvent) => void): () => void;
}

export type WorkspaceFsErrorCode =
	| "invalid_path"
	| "not_found"
	| "already_exists"
	| "not_a_directory"
	| "is_a_directory"
	| "conflict"
	| "permission_denied";

export interface WorkspaceFsErrorOptions {
	readonly code: WorkspaceFsErrorCode;
	readonly path: string;
	readonly message: string;
	readonly cause?: unknown;
}

export class WorkspaceFsError extends Error {
	readonly code: WorkspaceFsErrorCode;
	readonly path: string;
	override readonly cause?: unknown;

	constructor(options: WorkspaceFsErrorOptions) {
		super(options.message);
		this.name = "WorkspaceFsError";
		this.code = options.code;
		this.path = options.path;
		this.cause = options.cause;
	}
}

export class WorkspaceInvalidPathError extends WorkspaceFsError {
	constructor(path: string, message = `Invalid workspace path: ${path}`) {
		super({ code: "invalid_path", path, message });
		this.name = "WorkspaceInvalidPathError";
	}
}

export class WorkspaceNotFoundError extends WorkspaceFsError {
	constructor(path: string) {
		super({
			code: "not_found",
			path,
			message: `Workspace path not found: ${path}`,
		});
		this.name = "WorkspaceNotFoundError";
	}
}

export class WorkspaceAlreadyExistsError extends WorkspaceFsError {
	constructor(path: string) {
		super({
			code: "already_exists",
			path,
			message: `Workspace path already exists: ${path}`,
		});
		this.name = "WorkspaceAlreadyExistsError";
	}
}

export class WorkspaceNotDirectoryError extends WorkspaceFsError {
	constructor(path: string) {
		super({
			code: "not_a_directory",
			path,
			message: `Workspace path is not a directory: ${path}`,
		});
		this.name = "WorkspaceNotDirectoryError";
	}
}

export class WorkspaceIsDirectoryError extends WorkspaceFsError {
	constructor(path: string) {
		super({
			code: "is_a_directory",
			path,
			message: `Workspace path is a directory: ${path}`,
		});
		this.name = "WorkspaceIsDirectoryError";
	}
}

export class WorkspaceConflictError extends WorkspaceFsError {
	constructor(path: string, message = `Workspace write conflict: ${path}`) {
		super({ code: "conflict", path, message });
		this.name = "WorkspaceConflictError";
	}
}

export class WorkspacePermissionError extends WorkspaceFsError {
	constructor(path: string, message = `Workspace permission denied: ${path}`) {
		super({ code: "permission_denied", path, message });
		this.name = "WorkspacePermissionError";
	}
}

export function normalizeWorkspacePath(path: string): WorkspacePath {
	if (path.length === 0 || path === ".") {
		return "/";
	}
	if (path.includes("\0")) {
		throw new WorkspaceInvalidPathError(
			path,
			"Workspace paths cannot contain NUL bytes.",
		);
	}
	if (path.includes("\\")) {
		throw new WorkspaceInvalidPathError(
			path,
			"Workspace paths must use forward slashes.",
		);
	}

	const parts: string[] = [];
	for (const rawPart of path.split("/")) {
		if (rawPart === "" || rawPart === ".") {
			continue;
		}
		if (rawPart === "..") {
			throw new WorkspaceInvalidPathError(
				path,
				"Workspace paths cannot contain '..'.",
			);
		}
		parts.push(rawPart);
	}
	return parts.length === 0 ? "/" : `/${parts.join("/")}`;
}

export function dirnameWorkspacePath(path: string): WorkspacePath {
	const normalized = normalizeWorkspacePath(path);
	if (normalized === "/") {
		return "/";
	}
	const index = normalized.lastIndexOf("/");
	return index <= 0 ? "/" : normalized.slice(0, index);
}

export function basenameWorkspacePath(path: string): string {
	const normalized = normalizeWorkspacePath(path);
	if (normalized === "/") {
		return "";
	}
	return normalized.slice(normalized.lastIndexOf("/") + 1);
}

export function encodeWorkspaceText(text: string): Uint8Array {
	return new TextEncoder().encode(text);
}

export function decodeWorkspaceText(data: Uint8Array): string {
	return new TextDecoder("utf-8", { fatal: true }).decode(data);
}
