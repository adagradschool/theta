import { PGlite } from "@electric-sql/pglite";

import {
	createLocalWorkspaceFs,
	createOpfsBlobCache,
	createPGliteWorkspaceMetadataStore,
} from "../../src/index.ts";

async function runSmoke(): Promise<void> {
	const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
	const workspaceId = `workspace-${suffix}`;
	const pg = new PGlite(`opfs-ahp://theta-pglite-${suffix}`);
	await pg.waitReady;

	const metadata = createPGliteWorkspaceMetadataStore(pg);
	const fs = createLocalWorkspaceFs({
		workspaceId,
		metadata,
		blobs: createOpfsBlobCache({ rootName: `theta-blobs-${suffix}` }),
	});

	await fs.mkdir("/src");
	await fs.writeTextFile("/src/index.ts", "export const value = 1;", {
		mimeType: "text/typescript",
	});
	const stat = await fs.stat("/src/index.ts");
	const text = await fs.readTextFile("/src/index.ts");
	const entries = await fs.readdir("/src");
	const versions = await metadata.listFileVersions(
		workspaceId,
		"/src/index.ts",
	);

	await pg.close();

	self.postMessage({
		ok: true,
		text,
		entryNames: entries.map((entry) => entry.name),
		contentHash: stat.contentHash,
		versionCount: versions.length,
	});
}

runSmoke().catch((error: unknown) => {
	self.postMessage({
		ok: false,
		error: error instanceof Error ? error.message : String(error),
		stack: error instanceof Error ? error.stack : undefined,
	});
});
