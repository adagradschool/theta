import { PGlite } from "@electric-sql/pglite";
import { electricSync } from "@electric-sql/pglite-sync";
import {
	createLocalWorkspaceFs,
	createHttpBlobStore,
	createMemoryBlobStorage,
	createPGliteWorkspaceMetadataStore,
	createPGliteWorkspaceMutationQueue,
	syncThetaElectricWorkspaceMetadata,
	syncThetaWorkspaceBlobsToCache,
	syncThetaWorkspaceToRemote,
	THETA_LOCAL_STORAGE_SCHEMA_VERSION,
} from "../dist/index.js";

const {
	THETA_PROXY_TOKEN,
	THETA_BLOB_BASE_URL = "https://theta-proxy.adagradschool.workers.dev/v1/blobs/",
	THETA_ELECTRIC_SHAPE_URL = "https://theta-proxy.adagradschool.workers.dev/v1/electric/shape",
	THETA_WORKSPACE_MUTATION_URL = "https://theta-proxy.adagradschool.workers.dev/v1/mutations/workspace",
} = process.env;

if (!THETA_PROXY_TOKEN) {
	console.error("Set THETA_PROXY_TOKEN.");
	process.exit(1);
}

const workspaceId = `electric-smoke-${Date.now()}`;
const filePath = "/src/electric-sync.md";
const text = `# Electric mutation smoke\n\nworkspace=${workspaceId}\n`;
const remoteBlobs = createHttpBlobStore({
	baseUrl: THETA_BLOB_BASE_URL,
	headers: { Authorization: `Bearer ${THETA_PROXY_TOKEN}` },
});

const source = await createLocalClient("source");
try {
	const fs = createLocalWorkspaceFs({
		workspaceId,
		metadata: source.metadata,
		blobs: source.blobs,
		mutationQueue: source.queue,
		deviceId: "queued-smoke",
	});
	await fs.mkdir("/src");
	await fs.writeTextFile(filePath, text);

	const pendingBeforeFlush = await source.queue.listPending(workspaceId);
	const syncUp = await syncThetaWorkspaceToRemote({
		workspaceId,
		queue: source.queue,
		metadata: source.metadata,
		cache: source.blobs,
		blobStore: remoteBlobs,
		endpoint: {
			url: THETA_WORKSPACE_MUTATION_URL,
			headers: { Authorization: `Bearer ${THETA_PROXY_TOKEN}` },
		},
	});

	const first = await createSyncedClient("first");
	const second = await createSyncedClient("second");
	try {
		await Promise.all([
			waitForEntry(first.metadata, workspaceId, filePath),
			waitForEntry(second.metadata, workspaceId, filePath),
		]);
		const firstDownload = await syncThetaWorkspaceBlobsToCache({
			workspaceId,
			metadata: first.metadata,
			cache: first.blobs,
			store: remoteBlobs,
		});
		const secondDownload = await syncThetaWorkspaceBlobsToCache({
			workspaceId,
			metadata: second.metadata,
			cache: second.blobs,
			store: remoteBlobs,
		});
		const firstEntry = await first.metadata.getEntry(workspaceId, filePath);
		const secondEntry = await second.metadata.getEntry(workspaceId, filePath);
		const firstText = await createLocalWorkspaceFs({
			workspaceId,
			metadata: first.metadata,
			blobs: first.blobs,
		}).readTextFile(filePath);
		const secondText = await createLocalWorkspaceFs({
			workspaceId,
			metadata: second.metadata,
			blobs: second.blobs,
		}).readTextFile(filePath);
		const firstVersions = await first.metadata.listFileVersions(
			workspaceId,
			filePath,
		);
		const secondVersions = await second.metadata.listFileVersions(
			workspaceId,
			filePath,
		);
		console.log(
			JSON.stringify(
				{
					workspaceId,
					filePath,
					pendingBeforeFlush: pendingBeforeFlush.map((record) => record.kind),
					syncUp: {
						blobs: syncUp.blobs.map((blob) => blob.status),
						mutations: syncUp.mutations,
					},
					firstDownload: firstDownload.map((blob) => blob.status),
					secondDownload: secondDownload.map((blob) => blob.status),
					firstEntry,
					secondEntry,
					firstText,
					secondText,
					firstVersionCount: firstVersions.length,
					secondVersionCount: secondVersions.length,
					firstSynced: first.sync.isUpToDate,
					secondSynced: second.sync.isUpToDate,
				},
				null,
				2,
			),
		);
	} finally {
		first.sync.unsubscribe();
		second.sync.unsubscribe();
		await first.pg.close();
		await second.pg.close();
	}
} finally {
	await source.pg.close();
}

async function createLocalClient(label) {
	const pg = new PGlite();
	await pg.waitReady;
	const metadata = createPGliteWorkspaceMetadataStore(pg);
	await metadata.migrate(THETA_LOCAL_STORAGE_SCHEMA_VERSION);
	const blobs = createMemoryBlobStorage();
	const queue = createPGliteWorkspaceMutationQueue({
		pg,
		metadata,
		createId: createIdFactory(label),
	});
	return { pg, metadata, blobs, queue };
}

async function createSyncedClient(label) {
	const pg = new PGlite({
		extensions: { sync: electricSync() },
	});
	await pg.waitReady;
	const metadata = createPGliteWorkspaceMetadataStore(pg);
	await metadata.migrate(THETA_LOCAL_STORAGE_SCHEMA_VERSION);
	const blobs = createMemoryBlobStorage();
	const sync = await syncThetaElectricWorkspaceMetadata({
		pg,
		workspaceId,
		key: `theta-electric-smoke:${label}:${workspaceId}`,
		shape: {
			url: THETA_ELECTRIC_SHAPE_URL,
			headers: { Authorization: `Bearer ${THETA_PROXY_TOKEN}` },
		},
		onError(error) {
			console.error(`Electric sync error (${label}):`, error);
		},
	});
	return { pg, metadata, blobs, sync };
}

async function waitForEntry(metadata, workspaceId, path) {
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		const entry = await metadata.getEntry(workspaceId, path);
		if (entry?.path === path) {
			return entry;
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error(`Timed out waiting for ${path} to sync.`);
}

function createIdFactory(label) {
	let next = 1;
	return () => `theta-${label}-mutation-${next++}`;
}
