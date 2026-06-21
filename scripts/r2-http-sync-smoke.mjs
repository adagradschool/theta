import {
	BlobNotFoundError,
	createHttpBlobStore,
	createLocalWorkspaceFs,
	createMemoryBlobStorage,
	createMemoryPGliteWorkspaceMetadataStore,
	exportThetaWorkspaceManifest,
	importThetaWorkspaceManifest,
	syncThetaWorkspaceBlobsToCache,
	syncThetaWorkspaceBlobsToStore,
} from "../dist/index.js";

const baseUrl = process.env.THETA_BLOB_BASE_URL;
const token = process.env.THETA_PROXY_TOKEN;

if (!baseUrl || !token) {
	console.error("Set THETA_BLOB_BASE_URL and THETA_PROXY_TOKEN.");
	process.exit(1);
}

const workspaceId = `r2-smoke-${Date.now()}`;
const store = createHttpBlobStore({
	baseUrl,
	headers: { Authorization: `Bearer ${token}` },
});

const metadataA = createMemoryPGliteWorkspaceMetadataStore();
const blobsA = createMemoryBlobStorage();
const fsA = createLocalWorkspaceFs({
	workspaceId,
	metadata: metadataA,
	blobs: blobsA,
	deviceId: "r2-smoke-a",
});

await fsA.mkdir("/src");
await fsA.writeTextFile(
	"/src/r2-smoke.txt",
	`theta r2 sync smoke\nworkspace=${workspaceId}\n`,
);

const upload = await syncThetaWorkspaceBlobsToStore({
	workspaceId,
	metadata: metadataA,
	cache: blobsA,
	store,
});
const manifest = await exportThetaWorkspaceManifest({
	workspaceId,
	metadata: metadataA,
});

const metadataB = createMemoryPGliteWorkspaceMetadataStore();
const blobsB = createMemoryBlobStorage();
const fsB = createLocalWorkspaceFs({
	workspaceId,
	metadata: metadataB,
	blobs: blobsB,
	deviceId: "r2-smoke-b",
});
await importThetaWorkspaceManifest({
	workspaceId,
	metadata: metadataB,
	snapshot: manifest,
});

let missingBeforeDownload = false;
try {
	await fsB.readTextFile("/src/r2-smoke.txt");
} catch (error) {
	if (error instanceof BlobNotFoundError) {
		missingBeforeDownload = true;
	} else {
		throw error;
	}
}

const download = await syncThetaWorkspaceBlobsToCache({
	workspaceId,
	metadata: metadataB,
	cache: blobsB,
	store,
});
const text = await fsB.readTextFile("/src/r2-smoke.txt");
const entryA = await metadataA.getEntry(workspaceId, "/src/r2-smoke.txt");
const entryB = await metadataB.getEntry(workspaceId, "/src/r2-smoke.txt");

console.log(
	JSON.stringify(
		{
			workspaceId,
			missingBeforeDownload,
			upload: upload.map((result) => result.status),
			download: download.map((result) => result.status),
			text,
			entryA,
			entryB,
		},
		null,
		2,
	),
);
