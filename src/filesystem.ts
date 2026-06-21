import type { JsonObject } from "./json.ts";

export type WorkspaceEntryKind = "file" | "directory";

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
	readonly create?: boolean;
	readonly overwrite?: boolean;
	readonly expectedVersion?: string;
	readonly mimeType?: string;
	readonly metadata?: JsonObject;
}

export interface WorkspaceFs {
	readFile(path: string): Promise<Uint8Array>;
	writeFile(
		path: string,
		data: Uint8Array,
		options?: WriteOptions,
	): Promise<void>;
	delete(path: string): Promise<void>;
	rename(from: string, to: string): Promise<void>;
	mkdir(path: string): Promise<void>;
	readdir(path: string): Promise<readonly DirEntry[]>;
	stat(path: string): Promise<FileStat>;
	watch(path: string, listener: (event: FsEvent) => void): () => void;
}
