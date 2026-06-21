import {
	WorkspaceAlreadyExistsError,
	WorkspaceConflictError,
	normalizeWorkspacePath,
} from "../filesystem.ts";
import { THETA_LOCAL_STORAGE_SCHEMA_VERSION } from "./constants.ts";
import {
	cloneEntry,
	cloneFileVersion,
	entryKey,
	versionKey,
} from "./record-utils.ts";
import type {
	CreateMemoryPGliteWorkspaceMetadataStoreOptions,
	LocalWorkspaceEntryRecord,
	LocalWorkspaceFileVersionRecord,
	PGliteWorkspaceMetadataStore,
	PutLocalWorkspaceEntryOptions,
} from "./types.ts";

export function createMemoryPGliteWorkspaceMetadataStore(
	options: CreateMemoryPGliteWorkspaceMetadataStoreOptions = {},
): PGliteWorkspaceMetadataStore {
	return new MemoryPGliteWorkspaceMetadataStore(options);
}

class MemoryPGliteWorkspaceMetadataStore
	implements PGliteWorkspaceMetadataStore
{
	private schemaVersion: number;
	private readonly entries = new Map<string, LocalWorkspaceEntryRecord>();
	private readonly versions = new Map<
		string,
		readonly LocalWorkspaceFileVersionRecord[]
	>();

	constructor(options: CreateMemoryPGliteWorkspaceMetadataStoreOptions) {
		this.schemaVersion = options.schemaVersion ?? 0;
	}

	async getSchemaVersion(): Promise<number> {
		return this.schemaVersion;
	}

	async migrate(
		targetVersion = THETA_LOCAL_STORAGE_SCHEMA_VERSION,
	): Promise<void> {
		if (targetVersion < this.schemaVersion) {
			throw new Error(
				`Cannot migrate local workspace schema from ${this.schemaVersion} down to ${targetVersion}.`,
			);
		}
		this.schemaVersion = targetVersion;
	}

	async getEntry(
		workspaceId: string,
		path: string,
	): Promise<LocalWorkspaceEntryRecord | undefined> {
		const entry = this.entries.get(
			entryKey(workspaceId, normalizeWorkspacePath(path)),
		);
		return entry ? cloneEntry(entry) : undefined;
	}

	async listChildren(
		workspaceId: string,
		directoryPath: string,
	): Promise<readonly LocalWorkspaceEntryRecord[]> {
		const normalized = normalizeWorkspacePath(directoryPath);
		return Array.from(this.entries.values())
			.filter(
				(entry) =>
					entry.workspaceId === workspaceId &&
					entry.path !== normalized &&
					entry.parentPath === normalized,
			)
			.map(cloneEntry)
			.sort((a, b) => a.path.localeCompare(b.path));
	}

	async putEntry(
		entry: LocalWorkspaceEntryRecord,
		options: PutLocalWorkspaceEntryOptions = {},
	): Promise<void> {
		const key = entryKey(entry.workspaceId, entry.path);
		const existing = this.entries.get(key);
		if (existing && options.overwrite === false) {
			throw new WorkspaceAlreadyExistsError(entry.path);
		}
		if (
			existing &&
			options.expectedVersion !== undefined &&
			existing.version !== options.expectedVersion
		) {
			throw new WorkspaceConflictError(
				entry.path,
				`Expected version ${options.expectedVersion} for ${entry.path}, found ${existing.version}.`,
			);
		}
		this.entries.set(key, cloneEntry(entry));
	}

	async deleteEntry(workspaceId: string, path: string): Promise<void> {
		this.entries.delete(entryKey(workspaceId, normalizeWorkspacePath(path)));
	}

	async recordFileVersion(
		version: LocalWorkspaceFileVersionRecord,
	): Promise<void> {
		const key = versionKey(
			version.workspaceId,
			normalizeWorkspacePath(version.path),
		);
		const versions = this.versions.get(key) ?? [];
		this.versions.set(key, [...versions, cloneFileVersion(version)]);
	}

	async listFileVersions(
		workspaceId: string,
		path: string,
	): Promise<readonly LocalWorkspaceFileVersionRecord[]> {
		return (
			this.versions.get(
				versionKey(workspaceId, normalizeWorkspacePath(path)),
			) ?? []
		).map(cloneFileVersion);
	}
}
