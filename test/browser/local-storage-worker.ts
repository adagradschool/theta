import { PGlite } from "@electric-sql/pglite";

import {
	createLocalWorkspaceFs,
	createOpfsBlobCache,
	createPGliteWorkspaceMetadataStore,
	createPGliteThetaSessionStore,
	createThetaSessionManager,
} from "../../src/index.ts";

async function runSmoke(): Promise<void> {
	const parameters = new URL(self.location.href).searchParams;
	const name = parameters.get("name");
	const phase = parameters.get("phase");
	if (!name || (phase !== "write" && phase !== "read")) {
		throw new Error("Expected smoke worker name and phase parameters.");
	}
	const workspaceId = `workspace-${name}`;
	const sessionId = `session-${name}`;
	const pg = new PGlite(`opfs-ahp://theta-pglite-${name}`);
	await pg.waitReady;

	const metadata = createPGliteWorkspaceMetadataStore(pg);
	const sessions = createPGliteThetaSessionStore({ pg, metadata });
	const fs = createLocalWorkspaceFs({
		workspaceId,
		metadata,
		blobs: createOpfsBlobCache({ rootName: `theta-blobs-${name}` }),
	});
	const manager = createThetaSessionManager({
		store: sessions,
		createId: fixedIds(`root-${name}`, `message-${name}`),
	});

	if (phase === "write") {
		await fs.mkdir("/src");
		await fs.writeTextFile("/src/index.ts", "export const value = 1;", {
			mimeType: "text/typescript",
		});
		const session = await manager.createSession({
			id: sessionId,
			workspaceId,
			title: "Browser durable smoke",
		});
		await manager.appendMessage(session.session.id, {
			role: "user",
			content: "persist this",
			timestamp: 1,
		});
	} else {
		const existing = await manager.restore(sessionId);
		if (!existing) {
			throw new Error("Expected durable session to restore.");
		}
	}

	const stat = await fs.stat("/src/index.ts");
	const text = await fs.readTextFile("/src/index.ts");
	const entries = await fs.readdir("/src");
	const versions = await metadata.listFileVersions(
		workspaceId,
		"/src/index.ts",
	);
	const restored = await manager.restore(sessionId);

	await pg.close();

	self.postMessage({
		ok: true,
		phase,
		text,
		entryNames: entries.map((entry) => entry.name),
		contentHash: stat.contentHash,
		versionCount: versions.length,
		sessionTitle: restored?.session.title,
		sessionMessages: restored?.messages.flatMap((message) =>
			message.role === "user" && typeof message.content === "string"
				? [message.content]
				: [],
		),
	});
}

runSmoke().catch((error: unknown) => {
	self.postMessage({
		ok: false,
		error: error instanceof Error ? error.message : String(error),
		stack: error instanceof Error ? error.stack : undefined,
	});
});

function fixedIds(...ids: readonly string[]): () => string {
	let index = 0;
	return () => {
		const id = ids[index];
		index += 1;
		if (!id) {
			throw new Error("Ran out of fixed ids.");
		}
		return id;
	};
}
