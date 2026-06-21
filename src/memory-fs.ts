import {
	basenameWorkspacePath,
	decodeWorkspaceText,
	dirnameWorkspacePath,
	encodeWorkspaceText,
	type DirEntry,
	type FileStat,
	type FsEvent,
	type WorkspaceFs,
	WorkspaceAlreadyExistsError,
	WorkspaceConflictError,
	WorkspaceIsDirectoryError,
	WorkspaceNotDirectoryError,
	WorkspaceNotFoundError,
	normalizeWorkspacePath,
	type WriteOptions,
} from "./filesystem.ts";
import type { JsonObject } from "./json.ts";

interface MemoryDirectoryEntry {
	readonly kind: "directory";
	readonly path: string;
	readonly createdAt: number;
	mtime: number;
	version: number;
	metadata?: JsonObject;
}

interface MemoryFileEntry {
	readonly kind: "file";
	readonly path: string;
	readonly createdAt: number;
	mtime: number;
	version: number;
	data: Uint8Array;
	mimeType?: string;
	metadata?: JsonObject;
}

type MemoryEntry = MemoryDirectoryEntry | MemoryFileEntry;

export interface CreateMemoryWorkspaceFsOptions {
	readonly files?: Readonly<Record<string, string | Uint8Array>>;
	readonly now?: () => number;
}

export function createMemoryWorkspaceFs(
	options: CreateMemoryWorkspaceFsOptions = {},
): WorkspaceFs {
	return new MemoryWorkspaceFs(options);
}

class MemoryWorkspaceFs implements WorkspaceFs {
	private readonly entries = new Map<string, MemoryEntry>();
	private readonly watchers = new Map<string, Set<(event: FsEvent) => void>>();
	private readonly now: () => number;

	constructor(options: CreateMemoryWorkspaceFsOptions) {
		this.now = options.now ?? Date.now;
		const timestamp = this.now();
		this.entries.set("/", {
			kind: "directory",
			path: "/",
			createdAt: timestamp,
			mtime: timestamp,
			version: 1,
		});

		for (const [path, data] of Object.entries(options.files ?? {})) {
			const bytes =
				typeof data === "string" ? encodeWorkspaceText(data) : copyBytes(data);
			this.writeFileSync(path, bytes, {});
		}
	}

	async readFile(path: string): Promise<Uint8Array> {
		const entry = this.requireEntry(path);
		if (entry.kind === "directory") {
			throw new WorkspaceIsDirectoryError(normalizeWorkspacePath(path));
		}
		return copyBytes(entry.data);
	}

	async readTextFile(path: string): Promise<string> {
		return decodeWorkspaceText(await this.readFile(path));
	}

	async writeFile(
		path: string,
		data: Uint8Array,
		options: WriteOptions = {},
	): Promise<void> {
		this.writeFileSync(path, data, options);
	}

	async writeTextFile(
		path: string,
		text: string,
		options: WriteOptions = {},
	): Promise<void> {
		await this.writeFile(path, encodeWorkspaceText(text), options);
	}

	async delete(path: string): Promise<void> {
		const normalized = normalizeWorkspacePath(path);
		if (normalized === "/") {
			throw new WorkspaceConflictError(
				"/",
				"Cannot delete the workspace root.",
			);
		}
		const entry = this.requireEntry(normalized);
		if (entry.kind === "directory") {
			for (const existingPath of this.entries.keys()) {
				if (isDescendantPath(normalized, existingPath)) {
					throw new WorkspaceConflictError(
						normalized,
						`Cannot delete non-empty directory: ${normalized}`,
					);
				}
			}
		}

		this.entries.delete(normalized);
		this.touchParent(normalized);
		this.emit({
			type: "deleted",
			path: normalized,
		});
	}

	async rename(from: string, to: string): Promise<void> {
		const sourcePath = normalizeWorkspacePath(from);
		const targetPath = normalizeWorkspacePath(to);
		if (sourcePath === "/") {
			throw new WorkspaceConflictError(
				"/",
				"Cannot rename the workspace root.",
			);
		}
		if (targetPath === "/") {
			throw new WorkspaceAlreadyExistsError("/");
		}
		if (sourcePath === targetPath) {
			return;
		}
		if (isDescendantPath(sourcePath, targetPath)) {
			throw new WorkspaceConflictError(
				sourcePath,
				"Cannot move a directory into itself.",
			);
		}
		const source = this.requireEntry(sourcePath);
		if (this.entries.has(targetPath)) {
			throw new WorkspaceAlreadyExistsError(targetPath);
		}
		this.requireDirectory(dirnameWorkspacePath(targetPath));

		const movedEntries = Array.from(this.entries.entries()).filter(
			([path]) => path === sourcePath || isDescendantPath(sourcePath, path),
		);
		for (const [path] of movedEntries) {
			this.entries.delete(path);
		}

		const timestamp = this.now();
		for (const [path, entry] of movedEntries) {
			const nextPath =
				path === sourcePath
					? targetPath
					: targetPath + path.slice(sourcePath.length);
			this.entries.set(nextPath, cloneEntryForPath(entry, nextPath, timestamp));
		}

		this.touchParent(sourcePath);
		this.touchParent(targetPath);
		this.emit({
			type: "renamed",
			path: targetPath,
			previousPath: sourcePath,
			stat: this.toStat(this.requireEntry(targetPath)),
		});

		if (source.kind === "directory") {
			for (const [path] of movedEntries) {
				if (path === sourcePath) {
					continue;
				}
				const nextPath = targetPath + path.slice(sourcePath.length);
				this.emit({
					type: "renamed",
					path: nextPath,
					previousPath: path,
					stat: this.toStat(this.requireEntry(nextPath)),
				});
			}
		}
	}

	async mkdir(path: string): Promise<void> {
		const normalized = normalizeWorkspacePath(path);
		if (this.entries.has(normalized)) {
			const existing = this.requireEntry(normalized);
			if (existing.kind === "directory") {
				return;
			}
			throw new WorkspaceAlreadyExistsError(normalized);
		}
		const parentPath = dirnameWorkspacePath(normalized);
		this.requireDirectory(parentPath);
		const timestamp = this.now();
		const entry: MemoryDirectoryEntry = {
			kind: "directory",
			path: normalized,
			createdAt: timestamp,
			mtime: timestamp,
			version: 1,
		};
		this.entries.set(normalized, entry);
		this.touchParent(normalized);
		this.emit({
			type: "created",
			path: normalized,
			stat: this.toStat(entry),
		});
	}

	async readdir(path: string): Promise<readonly DirEntry[]> {
		const directoryPath = normalizeWorkspacePath(path);
		this.requireDirectory(directoryPath);
		const entries: DirEntry[] = [];
		for (const [candidatePath, entry] of this.entries) {
			if (candidatePath === directoryPath) {
				continue;
			}
			if (dirnameWorkspacePath(candidatePath) !== directoryPath) {
				continue;
			}
			entries.push({
				path: candidatePath,
				name: basenameWorkspacePath(candidatePath),
				kind: entry.kind,
				stat: this.toStat(entry),
			});
		}
		return entries.sort((a, b) => a.path.localeCompare(b.path));
	}

	async stat(path: string): Promise<FileStat> {
		return this.toStat(this.requireEntry(path));
	}

	watch(path: string, listener: (event: FsEvent) => void): () => void {
		const normalized = normalizeWorkspacePath(path);
		let listeners = this.watchers.get(normalized);
		if (!listeners) {
			listeners = new Set();
			this.watchers.set(normalized, listeners);
		}
		listeners.add(listener);
		return () => {
			listeners?.delete(listener);
			if (listeners?.size === 0) {
				this.watchers.delete(normalized);
			}
		};
	}

	private writeFileSync(
		path: string,
		data: Uint8Array,
		options: WriteOptions,
	): void {
		const normalized = normalizeWorkspacePath(path);
		if (normalized === "/") {
			throw new WorkspaceIsDirectoryError("/");
		}
		this.requireDirectory(dirnameWorkspacePath(normalized));
		const existing = this.entries.get(normalized);
		const create = options.create ?? true;
		const overwrite = options.overwrite ?? true;

		if (existing?.kind === "directory") {
			throw new WorkspaceIsDirectoryError(normalized);
		}
		if (!existing && !create) {
			throw new WorkspaceNotFoundError(normalized);
		}
		if (existing && !overwrite) {
			throw new WorkspaceAlreadyExistsError(normalized);
		}
		if (
			existing &&
			options.expectedVersion !== undefined &&
			options.expectedVersion !== versionString(existing.version)
		) {
			throw new WorkspaceConflictError(
				normalized,
				`Expected version ${options.expectedVersion} for ${normalized}, found ${versionString(existing.version)}.`,
			);
		}

		const timestamp = this.now();
		const version = existing ? existing.version + 1 : 1;
		const entry: MemoryFileEntry = {
			kind: "file",
			path: normalized,
			createdAt: existing?.createdAt ?? timestamp,
			mtime: timestamp,
			version,
			data: copyBytes(data),
		};
		const mimeType = options.mimeType ?? existing?.mimeType;
		if (mimeType !== undefined) {
			entry.mimeType = mimeType;
		}
		const metadata = options.metadata ?? existing?.metadata;
		if (metadata !== undefined) {
			entry.metadata = metadata;
		}
		this.entries.set(normalized, entry);
		this.touchParent(normalized);
		this.emit({
			type: existing ? "updated" : "created",
			path: normalized,
			stat: this.toStat(entry),
		});
	}

	private requireEntry(path: string): MemoryEntry {
		const normalized = normalizeWorkspacePath(path);
		const entry = this.entries.get(normalized);
		if (!entry) {
			throw new WorkspaceNotFoundError(normalized);
		}
		return entry;
	}

	private requireDirectory(path: string): MemoryDirectoryEntry {
		const entry = this.requireEntry(path);
		if (entry.kind !== "directory") {
			throw new WorkspaceNotDirectoryError(normalizeWorkspacePath(path));
		}
		return entry;
	}

	private touchParent(path: string): void {
		const parentPath = dirnameWorkspacePath(path);
		const parent = this.entries.get(parentPath);
		if (parent?.kind === "directory") {
			parent.mtime = this.now();
			parent.version += 1;
		}
	}

	private toStat(entry: MemoryEntry): FileStat {
		const base = {
			path: entry.path,
			kind: entry.kind,
			size: entry.kind === "file" ? entry.data.byteLength : 0,
			mtime: entry.mtime,
			version: versionString(entry.version),
		};
		return {
			...base,
			...(entry.kind === "file" ? { contentHash: hashBytes(entry.data) } : {}),
			...(entry.kind === "file" && entry.mimeType !== undefined
				? { mimeType: entry.mimeType }
				: {}),
			...(entry.metadata !== undefined ? { metadata: entry.metadata } : {}),
		};
	}

	private emit(event: FsEvent): void {
		for (const [watchPath, listeners] of this.watchers) {
			if (!isWatchedPath(watchPath, event.path, event.previousPath)) {
				continue;
			}
			for (const listener of listeners) {
				listener(event);
			}
		}
	}
}

function copyBytes(data: Uint8Array): Uint8Array {
	return new Uint8Array(data);
}

function versionString(version: number): string {
	return String(version);
}

function isDescendantPath(parent: string, child: string): boolean {
	return child.startsWith(`${parent}/`);
}

function isWatchedPath(
	watchPath: string,
	path: string,
	previousPath: string | undefined,
): boolean {
	return (
		watchPath === "/" ||
		path === watchPath ||
		isDescendantPath(watchPath, path) ||
		previousPath === watchPath ||
		(previousPath !== undefined && isDescendantPath(watchPath, previousPath))
	);
}

function cloneEntryForPath(
	entry: MemoryEntry,
	path: string,
	timestamp: number,
): MemoryEntry {
	if (entry.kind === "directory") {
		return {
			...entry,
			path,
			mtime: timestamp,
			version: entry.version + 1,
		};
	}
	return {
		...entry,
		path,
		mtime: timestamp,
		version: entry.version + 1,
		data: copyBytes(entry.data),
	};
}

function hashBytes(data: Uint8Array): string {
	let hash = 0x811c9dc5;
	for (const byte of data) {
		hash ^= byte;
		hash = Math.imul(hash, 0x01000193);
	}
	return hash.toString(16).padStart(8, "0");
}
