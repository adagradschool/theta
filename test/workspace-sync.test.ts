import { describe, expect, it } from "vitest";
import {
	createLocalWorkspaceFs,
	createMemoryBlobStorage,
	createMemoryPGliteWorkspaceMetadataStore,
	exportThetaWorkspaceManifest,
	importThetaWorkspaceManifest,
	syncThetaWorkspaceBlobsToCache,
	syncThetaWorkspaceBlobsToStore,
	BlobNotFoundError,
} from "../src/index.ts";

describe("workspace metadata and blob sync", () => {
	it("converges a file from one device to another through manifest and blob sync", async () => {
		const workspaceId = "workspace-sync";
		const remoteBlobs = createMemoryBlobStorage();
		const metadataA = createMemoryPGliteWorkspaceMetadataStore();
		const blobsA = createMemoryBlobStorage();
		const fsA = createLocalWorkspaceFs({
			workspaceId,
			metadata: metadataA,
			blobs: blobsA,
			deviceId: "device-a",
			now: fixedClock(1000, 10),
		});
		await fsA.mkdir("/src");
		await fsA.writeTextFile("/src/app.ts", "export const value = 1;\n");

		const upload = await syncThetaWorkspaceBlobsToStore({
			workspaceId,
			metadata: metadataA,
			cache: blobsA,
			store: remoteBlobs,
		});
		const exported = await exportThetaWorkspaceManifest({
			workspaceId,
			metadata: metadataA,
		});

		const metadataB = createMemoryPGliteWorkspaceMetadataStore();
		const blobsB = createMemoryBlobStorage();
		const fsB = createLocalWorkspaceFs({
			workspaceId,
			metadata: metadataB,
			blobs: blobsB,
			deviceId: "device-b",
		});
		await importThetaWorkspaceManifest({
			workspaceId,
			metadata: metadataB,
			snapshot: exported,
		});

		await expect(fsB.readTextFile("/src/app.ts")).rejects.toThrow(
			BlobNotFoundError,
		);
		const download = await syncThetaWorkspaceBlobsToCache({
			workspaceId,
			metadata: metadataB,
			cache: blobsB,
			store: remoteBlobs,
		});

		expect(upload.map((result) => result.status)).toContain("uploaded");
		expect(download.map((result) => result.status)).toContain("downloaded");
		expect(await fsB.readTextFile("/src/app.ts")).toBe(
			"export const value = 1;\n",
		);
		expect(await metadataB.getEntry(workspaceId, "/src/app.ts")).toMatchObject({
			blobSyncStatus: "ready",
			createdByDeviceId: "device-a",
			updatedByDeviceId: "device-a",
		});
		expect(await metadataA.getEntry(workspaceId, "/src/app.ts")).toMatchObject({
			blobSyncStatus: "uploaded",
			createdByDeviceId: "device-a",
			updatedByDeviceId: "device-a",
		});
	});
});

function fixedClock(start: number, step: number): () => number {
	let value = start;
	return () => {
		const current = value;
		value += step;
		return current;
	};
}
