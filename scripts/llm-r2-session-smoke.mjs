import {
	BlobNotFoundError,
	createHttpBlobStore,
	createLocalWorkspaceFs,
	createMemoryBlobStorage,
	createMemoryPGliteWorkspaceMetadataStore,
	createMemoryThetaSessionStore,
	createThetaAgent,
	createThetaBrowserTools,
	createThetaSessionManager,
	createThetaWorkspace,
	exportThetaWorkspaceManifest,
	importThetaWorkspaceManifest,
	syncThetaWorkspaceBlobsToCache,
	syncThetaWorkspaceBlobsToStore,
} from "../dist/index.js";

const workerBaseUrl =
	process.env.THETA_WORKER_URL ??
	"https://theta-proxy.adagradschool.workers.dev";
const token = process.env.THETA_PROXY_TOKEN;

if (!token) {
	console.error("Set THETA_PROXY_TOKEN.");
	process.exit(1);
}

const workspaceId = `llm-r2-smoke-${Date.now()}`;
const sessionId = `${workspaceId}-session`;
const filePath = "/notes/r2-llm-session.md";
const blobStore = createHttpBlobStore({
	baseUrl: new URL("/v1/blobs/", workerBaseUrl),
	headers: { Authorization: `Bearer ${token}` },
});

const metadataA = createMemoryPGliteWorkspaceMetadataStore();
const blobsA = createMemoryBlobStorage();
const fsA = createLocalWorkspaceFs({
	workspaceId,
	metadata: metadataA,
	blobs: blobsA,
	deviceId: "llm-r2-a",
});
const workspaceA = createThetaWorkspace({
	id: workspaceId,
	fs: fsA,
	tools: [
		createThetaBrowserTools({
			include: ["read", "write", "edit", "ls"],
		}),
	],
});
const sessionManager = createThetaSessionManager({
	store: createMemoryThetaSessionStore(),
});
await sessionManager.createSession({
	id: sessionId,
	workspaceId,
	title: "LLM R2 smoke",
});

const events = [];
const agent = createThetaAgent({
	id: `${workspaceId}-agent`,
	workspace: workspaceA,
	model: {
		provider: "openai",
		id: "gpt-4.1-nano",
		api: "openai-responses",
		supports: { text: true, tools: true },
	},
	proxy: {
		url: new URL("/v1/stream", workerBaseUrl),
		headers: {
			Authorization: `Bearer ${token}`,
			"X-Workspace-Id": workspaceId,
		},
	},
	systemPrompt: [
		"You are running a deterministic smoke test for Theta.",
		"Use workspace tools to modify files. Do not merely describe changes.",
		"Keep responses brief after tools complete.",
	].join(" "),
	session: { manager: sessionManager, sessionId },
	events: (event) => {
		if (
			event.type === "tool_execution_start" ||
			event.type === "tool_execution_end" ||
			event.type === "agent_error"
		) {
			events.push(summarizeEvent(event));
		}
	},
});

await agent.prompt(
	[
		`Create ${filePath}.`,
		"The exact file content must be:",
		"# R2 LLM Session Smoke",
		"",
		"- turn: one",
		"- storage: pending",
		"- marker: theta-r2-llm-smoke",
	].join("\n"),
);

await agent.prompt(
	[
		`Edit ${filePath}.`,
		"Replace the storage line with exactly:",
		"- storage: synced-via-r2",
		"Then read the file back.",
	].join("\n"),
);

const finalText = await fsA.readTextFile(filePath);
if (!finalText.includes("- storage: synced-via-r2")) {
	throw new Error(`Expected edited storage line in ${filePath}.`);
}
if (!finalText.includes("theta-r2-llm-smoke")) {
	throw new Error(`Expected smoke marker in ${filePath}.`);
}

const upload = await syncThetaWorkspaceBlobsToStore({
	workspaceId,
	metadata: metadataA,
	cache: blobsA,
	store: blobStore,
});
const manifest = await exportThetaWorkspaceManifest({
	workspaceId,
	metadata: metadataA,
});
const entryA = await metadataA.getEntry(workspaceId, filePath);
if (!entryA?.contentHash) {
	throw new Error(`Expected content hash for ${filePath}.`);
}

const metadataB = createMemoryPGliteWorkspaceMetadataStore();
const blobsB = createMemoryBlobStorage();
const fsB = createLocalWorkspaceFs({
	workspaceId,
	metadata: metadataB,
	blobs: blobsB,
	deviceId: "llm-r2-b",
});
await importThetaWorkspaceManifest({
	workspaceId,
	metadata: metadataB,
	snapshot: manifest,
});

let missingBeforeDownload = false;
try {
	await fsB.readTextFile(filePath);
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
	store: blobStore,
});
const syncedText = await fsB.readTextFile(filePath);
const entryB = await metadataB.getEntry(workspaceId, filePath);
const restoredSession = await sessionManager.restore(sessionId);

console.log(
	JSON.stringify(
		{
			workspaceId,
			sessionId,
			filePath,
			events,
			messageRoles: agent.state.messages.map((message) => message.role),
			sessionEntryKinds:
				restoredSession?.entries.map((entry) => entry.kind) ?? [],
			missingBeforeDownload,
			upload: upload.map((result) => result.status),
			download: download.map((result) => result.status),
			contentHash: entryA.contentHash,
			entryA,
			entryB,
			finalText,
			syncedText,
		},
		null,
		2,
	),
);

function summarizeEvent(event) {
	if (event.type === "agent_error") {
		return {
			type: event.type,
			error: event.error.message,
		};
	}
	return {
		type: event.type,
		toolName: event.toolName,
		input: event.input,
		isError: event.isError,
	};
}
