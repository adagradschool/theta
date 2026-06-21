import type { BlobCache } from "../blob-sync.ts";
import {
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
	WorkspaceStaleWriteError,
	normalizeWorkspacePath,
	type WriteOptions,
} from "../filesystem.ts";
import { THETA_LOCAL_STORAGE_SCHEMA_VERSION } from "./constants.ts";
import {
	isDescendantPath,
	isWatchedPath,
	makeEntry,
	nextVersion,
	toFileStat,
} from "./record-utils.ts";
import type {
	CreateLocalWorkspaceFsOptions,
	LocalWorkspaceEntryRecord,
	PGliteWorkspaceMetadataStore,
	ThetaWorkspaceMutationPayload,
	ThetaWorkspaceMutationQueue,
} from "./types.ts";

export function createLocalWorkspaceFs(
	options: CreateLocalWorkspaceFsOptions,
): WorkspaceFs {
	return new LocalWorkspaceFs(options);
}

class LocalWorkspaceFs implements WorkspaceFs {
	private readonly workspaceId: string;
	private readonly metadata: PGliteWorkspaceMetadataStore;
	private readonly blobs: BlobCache;
	private readonly mutationQueue: ThetaWorkspaceMutationQueue | undefined;
	private readonly deviceId: string | undefined;
	private readonly now: () => number;
	private readonly watchers = new Map<string, Set<(event: FsEvent) => void>>();
	private rootReady: Promise<void> | undefined;

	constructor(options: CreateLocalWorkspaceFsOptions) {
		this.workspaceId = options.workspaceId;
		this.metadata = options.metadata;
		this.blobs = options.blobs;
		this.mutationQueue = options.mutationQueue;
		this.deviceId = options.deviceId;
		this.now = options.now ?? Date.now;
	}

	async readFile(path: string): Promise<Uint8Array> {
		await this.ensureRoot();
		const entry = await this.requireEntry(path);
		if (entry.kind === "directory") {
			throw new WorkspaceIsDirectoryError(normalizeWorkspacePath(path));
		}
		if (!entry.contentHash) {
			throw new WorkspaceNotFoundError(normalizeWorkspacePath(path));
		}
		return this.blobs.get(entry.contentHash);
	}

	async readTextFile(path: string): Promise<string> {
		return decodeWorkspaceText(await this.readFile(path));
	}

	async writeFile(
		path: string,
		data: Uint8Array,
		options: WriteOptions = {},
	): Promise<void> {
		await this.ensureRoot();
		const normalized = normalizeWorkspacePath(path);
		if (normalized === "/") {
			throw new WorkspaceIsDirectoryError("/");
		}
		await this.requireDirectory(dirnameWorkspacePath(normalized));
		const existing = await this.metadata.getEntry(this.workspaceId, normalized);
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
			existing.version !== options.expectedVersion
		) {
			throw new WorkspaceStaleWriteError(
				normalized,
				options.expectedVersion,
				existing.version,
			);
		}

		const blob = await this.blobs.put(data);
		const timestamp = this.now();
		const version = nextVersion(existing?.version);
		const mimeType = options.mimeType ?? existing?.mimeType;
		const metadata = options.metadata ?? existing?.metadata;
		const createdByDeviceId = existing?.createdByDeviceId ?? this.deviceId;
		const entry = makeEntry({
			workspaceId: this.workspaceId,
			path: normalized,
			kind: "file",
			version,
			size: blob.size,
			contentHash: blob.hash,
			blobSyncStatus: "local_only",
			createdAt: existing?.createdAt ?? timestamp,
			updatedAt: timestamp,
			...(createdByDeviceId !== undefined ? { createdByDeviceId } : {}),
			...(this.deviceId !== undefined
				? { updatedByDeviceId: this.deviceId }
				: {}),
			...(mimeType !== undefined ? { mimeType } : {}),
			...(metadata !== undefined ? { metadata } : {}),
		});

		await this.metadata.putEntry(entry, {
			overwrite: true,
			...(existing?.version !== undefined
				? { expectedVersion: existing.version }
				: {}),
		});
		await this.metadata.recordFileVersion({
			workspaceId: this.workspaceId,
			path: normalized,
			version,
			contentHash: blob.hash,
			size: blob.size,
			...(this.deviceId !== undefined
				? { createdByDeviceId: this.deviceId }
				: {}),
			createdAt: timestamp,
		});
		await this.enqueueMutations([
			{
				kind: "putEntry",
				entry,
				...(existing?.version !== undefined
					? { expectedVersion: existing.version }
					: {}),
			},
			{
				kind: "recordFileVersion",
				version: {
					workspaceId: this.workspaceId,
					path: normalized,
					version,
					contentHash: blob.hash,
					size: blob.size,
					...(this.deviceId !== undefined
						? { createdByDeviceId: this.deviceId }
						: {}),
					createdAt: timestamp,
				},
			},
		]);
		await this.touchParent(normalized);
		this.emit({
			type: existing ? "updated" : "created",
			path: normalized,
			stat: toFileStat(entry),
		});
	}

	async writeTextFile(
		path: string,
		text: string,
		options: WriteOptions = {},
	): Promise<void> {
		await this.writeFile(path, encodeWorkspaceText(text), options);
	}

	async delete(path: string): Promise<void> {
		await this.ensureRoot();
		const normalized = normalizeWorkspacePath(path);
		if (normalized === "/") {
			throw new WorkspaceConflictError(
				"/",
				"Cannot delete the workspace root.",
			);
		}
		const entry = await this.requireEntry(normalized);
		if (entry.kind === "directory") {
			const children = await this.metadata.listChildren(
				this.workspaceId,
				normalized,
			);
			if (children.length > 0) {
				throw new WorkspaceConflictError(
					normalized,
					`Cannot delete non-empty directory: ${normalized}`,
				);
			}
		}
		await this.metadata.deleteEntry(this.workspaceId, normalized);
		await this.enqueueMutations([
			{
				kind: "deleteEntry",
				workspaceId: this.workspaceId,
				path: normalized,
				expectedVersion: entry.version,
			},
		]);
		await this.touchParent(normalized);
		this.emit({ type: "deleted", path: normalized });
	}

	async rename(from: string, to: string): Promise<void> {
		await this.ensureRoot();
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
		const source = await this.requireEntry(sourcePath);
		if (await this.metadata.getEntry(this.workspaceId, targetPath)) {
			throw new WorkspaceAlreadyExistsError(targetPath);
		}
		await this.requireDirectory(dirnameWorkspacePath(targetPath));

		const descendants =
			source.kind === "directory"
				? await this.collectDescendants(sourcePath)
				: [];
		const timestamp = this.now();
		const moved = [source, ...descendants];
		for (const entry of moved) {
			await this.metadata.deleteEntry(this.workspaceId, entry.path);
		}
		for (const entry of moved) {
			const nextPath =
				entry.path === sourcePath
					? targetPath
					: targetPath + entry.path.slice(sourcePath.length);
			const nextEntry = makeEntry({
				...entry,
				path: nextPath,
				version: nextVersion(entry.version),
				updatedAt: timestamp,
				...(this.deviceId !== undefined
					? { updatedByDeviceId: this.deviceId }
					: {}),
			});
			await this.metadata.putEntry(nextEntry, { overwrite: false });
			if (nextEntry.kind === "file" && nextEntry.contentHash) {
				await this.metadata.recordFileVersion({
					workspaceId: this.workspaceId,
					path: nextEntry.path,
					version: nextEntry.version,
					contentHash: nextEntry.contentHash,
					size: nextEntry.size,
					...(this.deviceId !== undefined
						? { createdByDeviceId: this.deviceId }
						: {}),
					createdAt: timestamp,
				});
			}
			this.emit({
				type: "renamed",
				path: nextPath,
				previousPath: entry.path,
				stat: toFileStat(nextEntry),
			});
		}
		await this.touchParent(sourcePath);
		await this.touchParent(targetPath);
	}

	async mkdir(path: string): Promise<void> {
		await this.ensureRoot();
		const normalized = normalizeWorkspacePath(path);
		const existing = await this.metadata.getEntry(this.workspaceId, normalized);
		if (existing) {
			if (existing.kind === "directory") {
				return;
			}
			throw new WorkspaceAlreadyExistsError(normalized);
		}
		await this.requireDirectory(dirnameWorkspacePath(normalized));
		const timestamp = this.now();
		const entry = makeEntry({
			workspaceId: this.workspaceId,
			path: normalized,
			kind: "directory",
			version: "1",
			size: 0,
			createdAt: timestamp,
			updatedAt: timestamp,
			...(this.deviceId !== undefined
				? {
						createdByDeviceId: this.deviceId,
						updatedByDeviceId: this.deviceId,
					}
				: {}),
		});
		await this.metadata.putEntry(entry, { overwrite: false });
		await this.enqueueMutations([{ kind: "putEntry", entry }]);
		await this.touchParent(normalized);
		this.emit({ type: "created", path: normalized, stat: toFileStat(entry) });
	}

	async readdir(path: string): Promise<readonly DirEntry[]> {
		await this.ensureRoot();
		const normalized = normalizeWorkspacePath(path);
		await this.requireDirectory(normalized);
		const children = await this.metadata.listChildren(
			this.workspaceId,
			normalized,
		);
		return children
			.map((entry) => ({
				path: entry.path,
				name: entry.name,
				kind: entry.kind,
				stat: toFileStat(entry),
			}))
			.sort((a, b) => a.path.localeCompare(b.path));
	}

	async stat(path: string): Promise<FileStat> {
		await this.ensureRoot();
		return toFileStat(await this.requireEntry(path));
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

	private ensureRoot(): Promise<void> {
		if (!this.rootReady) {
			this.rootReady = this.initializeRoot();
		}
		return this.rootReady;
	}

	private async initializeRoot(): Promise<void> {
		await this.metadata.migrate(THETA_LOCAL_STORAGE_SCHEMA_VERSION);
		const existing = await this.metadata.getEntry(this.workspaceId, "/");
		if (existing) {
			return;
		}
		const timestamp = this.now();
		await this.metadata.putEntry(
			makeEntry({
				workspaceId: this.workspaceId,
				path: "/",
				kind: "directory",
				version: "1",
				size: 0,
				createdAt: timestamp,
				updatedAt: timestamp,
				...(this.deviceId !== undefined
					? {
							createdByDeviceId: this.deviceId,
							updatedByDeviceId: this.deviceId,
						}
					: {}),
			}),
			{ overwrite: false },
		);
	}

	private async requireEntry(path: string): Promise<LocalWorkspaceEntryRecord> {
		const normalized = normalizeWorkspacePath(path);
		const entry = await this.metadata.getEntry(this.workspaceId, normalized);
		if (!entry) {
			throw new WorkspaceNotFoundError(normalized);
		}
		return entry;
	}

	private async requireDirectory(
		path: string,
	): Promise<LocalWorkspaceEntryRecord> {
		const entry = await this.requireEntry(path);
		if (entry.kind !== "directory") {
			throw new WorkspaceNotDirectoryError(normalizeWorkspacePath(path));
		}
		return entry;
	}

	private async collectDescendants(
		path: string,
	): Promise<LocalWorkspaceEntryRecord[]> {
		const children = await this.metadata.listChildren(this.workspaceId, path);
		const descendants: LocalWorkspaceEntryRecord[] = [];
		for (const child of children) {
			descendants.push(child);
			if (child.kind === "directory") {
				descendants.push(...(await this.collectDescendants(child.path)));
			}
		}
		return descendants.sort((a, b) => a.path.localeCompare(b.path));
	}

	private async touchParent(path: string): Promise<void> {
		const parentPath = dirnameWorkspacePath(path);
		const parent = await this.metadata.getEntry(this.workspaceId, parentPath);
		if (!parent || parent.kind !== "directory") {
			return;
		}
		await this.metadata.putEntry(
			makeEntry({
				...parent,
				version: nextVersion(parent.version),
				updatedAt: this.now(),
			}),
			{ expectedVersion: parent.version, overwrite: true },
		);
	}

	private async enqueueMutations(
		mutations: readonly ThetaWorkspaceMutationPayload[],
	): Promise<void> {
		await this.mutationQueue?.enqueue(mutations);
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
