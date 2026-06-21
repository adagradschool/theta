import type {
	BlobCache,
	BlobStore,
	BlobTransferResult,
	ContentHash,
} from "./blob-sync.ts";
import { ensureBlobInCache, ensureBlobInStore } from "./blob-sync.ts";
import type {
	LocalWorkspaceEntryRecord,
	LocalWorkspaceFileVersionRecord,
	PGliteWorkspaceMetadataStore,
} from "./local-storage.ts";

export interface ThetaWorkspaceManifestSnapshot {
	readonly workspaceId: string;
	readonly entries: readonly LocalWorkspaceEntryRecord[];
	readonly fileVersions: readonly LocalWorkspaceFileVersionRecord[];
}

export interface ExportThetaWorkspaceManifestOptions {
	readonly workspaceId: string;
	readonly metadata: PGliteWorkspaceMetadataStore;
}

export interface ImportThetaWorkspaceManifestOptions
	extends ExportThetaWorkspaceManifestOptions {
	readonly snapshot: ThetaWorkspaceManifestSnapshot;
}

export async function exportThetaWorkspaceManifest(
	options: ExportThetaWorkspaceManifestOptions,
): Promise<ThetaWorkspaceManifestSnapshot> {
	const entries = await options.metadata.listEntries(options.workspaceId);
	const fileVersions = (
		await Promise.all(
			entries
				.filter((entry) => entry.kind === "file")
				.map((entry) =>
					options.metadata.listFileVersions(options.workspaceId, entry.path),
				),
		)
	).flat();
	return {
		workspaceId: options.workspaceId,
		entries,
		fileVersions,
	};
}

export async function importThetaWorkspaceManifest(
	options: ImportThetaWorkspaceManifestOptions,
): Promise<void> {
	for (const entry of options.snapshot.entries) {
		await options.metadata.putEntry(
			{
				...entry,
				workspaceId: options.workspaceId,
				...(entry.kind === "file" && entry.contentHash
					? { blobSyncStatus: "download_needed" }
					: {}),
			},
			{ overwrite: true },
		);
	}
	for (const version of options.snapshot.fileVersions) {
		await options.metadata.recordFileVersion({
			...version,
			workspaceId: options.workspaceId,
		});
	}
}

export async function syncThetaWorkspaceBlobsToStore(options: {
	readonly workspaceId: string;
	readonly metadata: PGliteWorkspaceMetadataStore;
	readonly cache: BlobCache;
	readonly store: BlobStore;
}): Promise<readonly BlobTransferResult[]> {
	const results: BlobTransferResult[] = [];
	for (const entry of await options.metadata.listEntries(options.workspaceId)) {
		if (entry.kind !== "file" || !entry.contentHash) {
			continue;
		}
		const result = await ensureBlobInStore(
			options.cache,
			options.store,
			entry.contentHash,
		);
		results.push(result);
		if (result.status === "uploaded" || result.status === "already-present") {
			await options.metadata.updateBlobSyncStatus(
				options.workspaceId,
				entry.path,
				"uploaded",
			);
		}
	}
	return results;
}

export async function syncThetaWorkspaceBlobsToCache(options: {
	readonly workspaceId: string;
	readonly metadata: PGliteWorkspaceMetadataStore;
	readonly cache: BlobCache;
	readonly store: BlobStore;
}): Promise<readonly BlobTransferResult[]> {
	const results: BlobTransferResult[] = [];
	for (const entry of await options.metadata.listEntries(options.workspaceId)) {
		if (entry.kind !== "file" || !entry.contentHash) {
			continue;
		}
		const result = await ensureBlobInCache(
			options.cache,
			options.store,
			entry.contentHash,
		);
		results.push(result);
		if (result.status === "downloaded" || result.status === "already-present") {
			await options.metadata.updateBlobSyncStatus(
				options.workspaceId,
				entry.path,
				"ready",
			);
		}
	}
	return results;
}

export function contentHashesFromManifest(
	snapshot: ThetaWorkspaceManifestSnapshot,
): readonly ContentHash[] {
	return Array.from(
		new Set(
			snapshot.entries.flatMap((entry) =>
				entry.kind === "file" && entry.contentHash ? [entry.contentHash] : [],
			),
		),
	);
}
