import type { BlobCache, ContentHash } from "../blob-sync.ts";
import type { WorkspaceFs } from "../filesystem.ts";
import type { JsonObject } from "../json.ts";

export interface ThetaStorageMigration {
	readonly version: number;
	readonly description: string;
	readonly sql: readonly string[];
}

export type LocalWorkspaceEntryKind = "file" | "directory";
export type LocalBlobSyncStatus =
	| "local_only"
	| "uploading"
	| "uploaded"
	| "download_needed"
	| "downloading"
	| "ready"
	| "error";

export interface LocalWorkspaceEntryRecord {
	readonly workspaceId: string;
	readonly path: string;
	readonly parentPath: string;
	readonly name: string;
	readonly kind: LocalWorkspaceEntryKind;
	readonly version: string;
	readonly size: number;
	readonly contentHash?: ContentHash;
	readonly mimeType?: string;
	readonly metadata?: JsonObject;
	readonly blobSyncStatus?: LocalBlobSyncStatus;
	readonly createdByDeviceId?: string;
	readonly updatedByDeviceId?: string;
	readonly createdAt: number;
	readonly updatedAt: number;
	readonly deletedAt?: number;
}

export interface LocalWorkspaceFileVersionRecord {
	readonly workspaceId: string;
	readonly path: string;
	readonly version: string;
	readonly contentHash: ContentHash;
	readonly size: number;
	readonly createdByDeviceId?: string;
	readonly createdAt: number;
}

export type ThetaWorkspaceMutationKind =
	| "putEntry"
	| "recordFileVersion"
	| "deleteEntry";

export type ThetaWorkspaceMutationPayload =
	| {
			readonly kind: "putEntry";
			readonly entry: LocalWorkspaceEntryRecord;
			readonly expectedVersion?: string;
	  }
	| {
			readonly kind: "recordFileVersion";
			readonly version: LocalWorkspaceFileVersionRecord;
	  }
	| {
			readonly kind: "deleteEntry";
			readonly workspaceId: string;
			readonly path: string;
			readonly expectedVersion?: string;
	  };

export interface ThetaWorkspaceMutationRecord {
	readonly id: string;
	readonly workspaceId: string;
	readonly kind: ThetaWorkspaceMutationKind;
	readonly payload: ThetaWorkspaceMutationPayload;
	readonly attempts: number;
	readonly lastError?: string;
	readonly createdAt: number;
	readonly updatedAt: number;
}

export interface ThetaWorkspaceMutationQueue {
	enqueue(
		mutations: readonly ThetaWorkspaceMutationPayload[],
	): Promise<readonly ThetaWorkspaceMutationRecord[]>;
	listPending(
		workspaceId: string,
		limit?: number,
	): Promise<readonly ThetaWorkspaceMutationRecord[]>;
	markSynced(ids: readonly string[]): Promise<void>;
	markFailed(id: string, error: string): Promise<void>;
}

export interface PutLocalWorkspaceEntryOptions {
	readonly expectedVersion?: string;
	readonly overwrite?: boolean;
}

export interface PGliteWorkspaceMetadataStore {
	getSchemaVersion(): Promise<number>;
	migrate(targetVersion?: number): Promise<void>;
	getEntry(
		workspaceId: string,
		path: string,
	): Promise<LocalWorkspaceEntryRecord | undefined>;
	listChildren(
		workspaceId: string,
		directoryPath: string,
	): Promise<readonly LocalWorkspaceEntryRecord[]>;
	putEntry(
		entry: LocalWorkspaceEntryRecord,
		options?: PutLocalWorkspaceEntryOptions,
	): Promise<void>;
	deleteEntry(workspaceId: string, path: string): Promise<void>;
	listEntries(
		workspaceId: string,
	): Promise<readonly LocalWorkspaceEntryRecord[]>;
	updateBlobSyncStatus(
		workspaceId: string,
		path: string,
		status: LocalBlobSyncStatus,
	): Promise<void>;
	recordFileVersion(version: LocalWorkspaceFileVersionRecord): Promise<void>;
	listFileVersions(
		workspaceId: string,
		path: string,
	): Promise<readonly LocalWorkspaceFileVersionRecord[]>;
}

export interface CreateLocalWorkspaceFsOptions {
	readonly workspaceId: string;
	readonly metadata: PGliteWorkspaceMetadataStore;
	readonly blobs: BlobCache;
	readonly mutationQueue?: ThetaWorkspaceMutationQueue;
	readonly deviceId?: string;
	readonly now?: () => number;
}

export interface CreateMemoryLocalWorkspaceFsOptions {
	readonly workspaceId?: string;
	readonly now?: () => number;
}

export interface CreateMemoryPGliteWorkspaceMetadataStoreOptions {
	readonly schemaVersion?: number;
}

export interface CreateOpfsBlobCacheOptions {
	readonly rootName?: string;
	readonly now?: () => number;
}

export type LocalWorkspaceFsFactory = (
	options: CreateLocalWorkspaceFsOptions,
) => WorkspaceFs;
