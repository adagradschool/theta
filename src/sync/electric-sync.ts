import type { PGliteInterface } from "@electric-sql/pglite";
import type {
	PGliteWithSync,
	SyncShapesToTablesResult,
} from "@electric-sql/pglite-sync";
import type { BlobCache, BlobStore, BlobTransferResult } from "./blob-sync.ts";
import type {
	PGliteWorkspaceMetadataStore,
	ThetaWorkspaceMutationPayload,
	ThetaWorkspaceMutationQueue,
	ThetaWorkspaceMutationRecord,
} from "../local-storage.ts";
import { syncThetaWorkspaceBlobsToStore } from "./workspace-sync.ts";

export interface ThetaElectricShapeConfig {
	readonly url: string | URL;
	readonly headers?: Readonly<Record<string, string>>;
}

export interface SyncThetaElectricWorkspaceMetadataOptions {
	readonly pg: PGliteInterface & Partial<PGliteWithSync>;
	readonly workspaceId: string;
	readonly shape: ThetaElectricShapeConfig;
	readonly key?: string | null;
	readonly onInitialSync?: () => void;
	readonly onError?: (error: Error) => void;
}

export interface ThetaWorkspaceMutationEndpointConfig {
	readonly url: string | URL;
	readonly headers?: Readonly<Record<string, string>>;
	readonly fetch?: typeof fetch;
}

export interface FlushThetaWorkspaceMutationQueueOptions {
	readonly workspaceId: string;
	readonly queue: ThetaWorkspaceMutationQueue;
	readonly endpoint: ThetaWorkspaceMutationEndpointConfig;
	readonly limit?: number;
}

export interface FlushThetaWorkspaceMutationQueueResult {
	readonly sent: number;
	readonly synced: number;
	readonly failed: number;
	readonly remaining: number;
}

export interface SyncThetaWorkspaceToRemoteOptions
	extends FlushThetaWorkspaceMutationQueueOptions {
	readonly metadata: PGliteWorkspaceMetadataStore;
	readonly cache: BlobCache;
	readonly blobStore: BlobStore;
}

export interface SyncThetaWorkspaceToRemoteResult {
	readonly blobs: readonly BlobTransferResult[];
	readonly mutations: FlushThetaWorkspaceMutationQueueResult;
}

export interface ThetaWorkspaceMutationRequest {
	readonly workspaceId: string;
	readonly mutations: readonly ThetaWorkspaceMutationPayload[];
}

export interface ThetaWorkspaceMutationResponse {
	readonly ok: true;
	readonly applied: number;
}

export interface ThetaWorkspaceMutationConflict {
	readonly path: string;
	readonly expectedVersion: string;
	readonly actualVersion: string | undefined;
}

export async function syncThetaElectricWorkspaceMetadata(
	options: SyncThetaElectricWorkspaceMetadataOptions,
): Promise<SyncShapesToTablesResult> {
	const sync = options.pg.sync;
	if (!sync) {
		throw new Error(
			"Theta Electric sync requires PGlite to be created with electricSync().",
		);
	}
	return sync.syncShapesToTables({
		key: options.key ?? `theta-workspace:${options.workspaceId}`,
		shapes: {
			workspaceEntries: {
				shape: {
					url: String(options.shape.url),
					params: workspaceParams(
						"theta_workspace_entries",
						options.workspaceId,
					),
					...(options.shape.headers !== undefined
						? { headers: options.shape.headers }
						: {}),
				},
				table: "theta_workspace_entries",
				primaryKey: ["workspace_id", "path"],
			},
			fileVersions: {
				shape: {
					url: String(options.shape.url),
					params: workspaceParams("theta_file_versions", options.workspaceId),
					...(options.shape.headers !== undefined
						? { headers: options.shape.headers }
						: {}),
				},
				table: "theta_file_versions",
				primaryKey: ["workspace_id", "path", "version"],
			},
		},
		...(options.onInitialSync !== undefined
			? { onInitialSync: options.onInitialSync }
			: {}),
		...(options.onError !== undefined ? { onError: options.onError } : {}),
	});
}

export async function flushThetaWorkspaceMutationQueue(
	options: FlushThetaWorkspaceMutationQueueOptions,
): Promise<FlushThetaWorkspaceMutationQueueResult> {
	const pending = await options.queue.listPending(
		options.workspaceId,
		options.limit,
	);
	if (pending.length === 0) {
		return { sent: 0, synced: 0, failed: 0, remaining: 0 };
	}
	const response = await postWorkspaceMutations(options.endpoint, {
		workspaceId: options.workspaceId,
		mutations: pending.map((record) => record.payload),
	});
	if (response.ok) {
		await options.queue.markSynced(pending.map((record) => record.id));
		return {
			sent: pending.length,
			synced: pending.length,
			failed: 0,
			remaining: (
				await options.queue.listPending(options.workspaceId, options.limit)
			).length,
		};
	}
	const error = await response.text();
	await markBatchFailed(options.queue, pending, error);
	return {
		sent: pending.length,
		synced: 0,
		failed: pending.length,
		remaining: (
			await options.queue.listPending(options.workspaceId, options.limit)
		).length,
	};
}

export async function syncThetaWorkspaceToRemote(
	options: SyncThetaWorkspaceToRemoteOptions,
): Promise<SyncThetaWorkspaceToRemoteResult> {
	const pending = await options.queue.listPending(
		options.workspaceId,
		options.limit,
	);
	const contentHashes = contentHashesFromMutations(
		pending.map((record) => record.payload),
	);
	const blobs =
		contentHashes.size > 0
			? await syncThetaWorkspaceBlobsToStore({
					workspaceId: options.workspaceId,
					metadata: options.metadata,
					cache: options.cache,
					store: options.blobStore,
					contentHashes,
				})
			: [];
	const mutations = await flushThetaWorkspaceMutationQueue(options);
	return { blobs, mutations };
}

function workspaceParams(table: string, workspaceId: string) {
	return {
		table,
		where: "workspace_id = $1",
		params: { "1": workspaceId },
		replica: "full",
	} as const;
}

function contentHashesFromMutations(
	mutations: readonly ThetaWorkspaceMutationPayload[],
): ReadonlySet<string> {
	return new Set(
		mutations.flatMap((mutation) =>
			mutation.kind === "putEntry" &&
			mutation.entry.kind === "file" &&
			mutation.entry.contentHash
				? [mutation.entry.contentHash]
				: [],
		),
	);
}

async function postWorkspaceMutations(
	endpoint: ThetaWorkspaceMutationEndpointConfig,
	request: ThetaWorkspaceMutationRequest,
): Promise<Response> {
	const fetchFn = endpoint.fetch ?? fetch;
	return fetchFn(endpoint.url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...endpoint.headers,
		},
		body: JSON.stringify(request),
	});
}

async function markBatchFailed(
	queue: ThetaWorkspaceMutationQueue,
	pending: readonly ThetaWorkspaceMutationRecord[],
	error: string,
): Promise<void> {
	await Promise.all(
		pending.map((record) =>
			queue.markFailed(record.id, error || "Mutation flush failed."),
		),
	);
}
