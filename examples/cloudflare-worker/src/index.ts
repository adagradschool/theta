import { handleThetaLlmProxyRequest } from "@adagradschool/theta/server";
import {
	neon,
	type NeonQueryFunction,
	type NeonQueryFunctionInTransaction,
	type NeonQueryInTransaction,
} from "@neondatabase/serverless";

export interface Env {
	readonly THETA_PROXY_TOKEN: string;
	readonly THETA_BLOBS?: R2Bucket;
	readonly ELECTRIC_SYNC_URL?: string;
	readonly ELECTRIC_SOURCE_ID?: string;
	readonly ELECTRIC_SECRET?: string;
	readonly THETA_POSTGRES_URL?: string;
	readonly OPENAI_API_KEY?: string;
	readonly ANTHROPIC_API_KEY?: string;
	readonly GEMINI_API_KEY?: string;
}

const CORS_HEADERS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "POST, GET, PUT, HEAD, DELETE, OPTIONS",
	"Access-Control-Allow-Headers": "Authorization, Content-Type, X-Workspace-Id",
} as const;

export default {
	async fetch(request, env): Promise<Response> {
		if (request.method === "OPTIONS") {
			return new Response(null, { status: 204, headers: CORS_HEADERS });
		}
		const url = new URL(request.url);
		if (url.pathname.startsWith("/v1/blobs/")) {
			return handleBlobRequest(request, env);
		}
		if (url.pathname === "/v1/electric/shape") {
			return handleElectricShapeRequest(request, env);
		}
		if (url.pathname === "/v1/mutations/workspace") {
			return handleWorkspaceMutationRequest(request, env);
		}
		if (url.pathname !== "/v1/stream") {
			return Response.json({ error: "Not found." }, { status: 404 });
		}
		return handleThetaLlmProxyRequest(request, {
			headers: CORS_HEADERS,
			providerEnv: providerEnvFromBindings(env),
			hooks: {
				authenticate(authRequest) {
					return bearerToken(authRequest) === env.THETA_PROXY_TOKEN
						? { subjectId: "theta-client" }
						: undefined;
				},
			},
		});
	},
} satisfies ExportedHandler<Env>;

type WorkspaceMutationRequest = {
	readonly workspaceId: string;
	readonly mutations: readonly WorkspaceMutation[];
};

type WorkspaceMutation =
	| {
			readonly kind: "putEntry";
			readonly entry: WorkspaceEntryPayload;
			readonly expectedVersion?: string;
	  }
	| {
			readonly kind: "recordFileVersion";
			readonly version: FileVersionPayload;
	  }
	| {
			readonly kind: "deleteEntry";
			readonly workspaceId: string;
			readonly path: string;
			readonly expectedVersion?: string;
	  };

type WorkspaceEntryPayload = {
	readonly workspaceId: string;
	readonly path: string;
	readonly parentPath: string;
	readonly name: string;
	readonly kind: "file" | "directory";
	readonly version: string;
	readonly size: number;
	readonly contentHash?: string;
	readonly mimeType?: string;
	readonly metadata?: unknown;
	readonly blobSyncStatus?: string;
	readonly createdByDeviceId?: string;
	readonly updatedByDeviceId?: string;
	readonly createdAt: number;
	readonly updatedAt: number;
	readonly deletedAt?: number;
};

type FileVersionPayload = {
	readonly workspaceId: string;
	readonly path: string;
	readonly version: string;
	readonly contentHash: string;
	readonly size: number;
	readonly createdByDeviceId?: string;
	readonly createdAt: number;
};

async function handleWorkspaceMutationRequest(
	request: Request,
	env: Env,
): Promise<Response> {
	if (request.method !== "POST") {
		return Response.json(
			{ error: "Method not allowed." },
			{ status: 405, headers: CORS_HEADERS },
		);
	}
	if (bearerToken(request) !== env.THETA_PROXY_TOKEN) {
		return Response.json(
			{ error: "Unauthorized." },
			{ status: 401, headers: CORS_HEADERS },
		);
	}
	if (!env.THETA_POSTGRES_URL) {
		return Response.json(
			{ error: "Postgres mutations are not configured." },
			{ status: 503, headers: CORS_HEADERS },
		);
	}

	let body: WorkspaceMutationRequest;
	try {
		body = (await request.json()) as WorkspaceMutationRequest;
		validateWorkspaceMutationRequest(body);
	} catch (error) {
		return Response.json(
			{ error: error instanceof Error ? error.message : String(error) },
			{ status: 400, headers: CORS_HEADERS },
		);
	}

	const sql = neon(env.THETA_POSTGRES_URL);
	const conflicts = await findWorkspaceMutationConflicts(
		sql,
		body.workspaceId,
		body.mutations,
	);
	if (conflicts.length > 0) {
		return Response.json(
			{ error: "Workspace mutation conflict.", conflicts },
			{ status: 409, headers: CORS_HEADERS },
		);
	}
	await sql.transaction((tx) =>
		body.mutations.map((mutation) =>
			mutationQuery(tx, body.workspaceId, mutation),
		),
	);
	return Response.json(
		{ ok: true, applied: body.mutations.length },
		{ headers: CORS_HEADERS },
	);
}

async function handleElectricShapeRequest(
	request: Request,
	env: Env,
): Promise<Response> {
	if (request.method !== "GET") {
		return Response.json(
			{ error: "Method not allowed." },
			{ status: 405, headers: CORS_HEADERS },
		);
	}
	if (bearerToken(request) !== env.THETA_PROXY_TOKEN) {
		return Response.json(
			{ error: "Unauthorized." },
			{ status: 401, headers: CORS_HEADERS },
		);
	}
	if (
		!env.ELECTRIC_SYNC_URL ||
		!env.ELECTRIC_SOURCE_ID ||
		!env.ELECTRIC_SECRET
	) {
		return Response.json(
			{ error: "Electric sync is not configured." },
			{ status: 503, headers: CORS_HEADERS },
		);
	}

	const incoming = new URL(request.url);
	const upstream = new URL("/v1/shape", env.ELECTRIC_SYNC_URL);
	incoming.searchParams.forEach((value, key) => {
		upstream.searchParams.append(key, value);
	});
	upstream.searchParams.set("source_id", env.ELECTRIC_SOURCE_ID);
	upstream.searchParams.set("secret", env.ELECTRIC_SECRET);

	const response = await fetch(upstream, {
		headers: { Accept: request.headers.get("accept") ?? "application/json" },
		signal: request.signal,
	});
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers: exposeElectricHeaders(response.headers),
	});
}

async function handleBlobRequest(
	request: Request,
	env: Env,
): Promise<Response> {
	if (bearerToken(request) !== env.THETA_PROXY_TOKEN) {
		return Response.json(
			{ error: "Unauthorized." },
			{ status: 401, headers: CORS_HEADERS },
		);
	}
	if (!env.THETA_BLOBS) {
		return Response.json(
			{ error: "Blob storage is not configured." },
			{ status: 503, headers: CORS_HEADERS },
		);
	}

	const hash = decodeBlobHash(new URL(request.url));
	if (!hash) {
		return Response.json(
			{ error: "Missing blob hash." },
			{ status: 400, headers: CORS_HEADERS },
		);
	}

	if (request.method === "HEAD") {
		const object = await env.THETA_BLOBS.head(hash);
		if (!object) {
			return new Response(null, { status: 404, headers: CORS_HEADERS });
		}
		return new Response(null, {
			status: 204,
			headers: {
				...CORS_HEADERS,
				"Content-Length": String(object.size),
			},
		});
	}

	if (request.method === "GET") {
		const object = await env.THETA_BLOBS.get(hash);
		if (!object) {
			return Response.json(
				{ error: "Blob not found." },
				{ status: 404, headers: CORS_HEADERS },
			);
		}
		return new Response(object.body, {
			headers: {
				...CORS_HEADERS,
				"Content-Length": String(object.size),
				"Content-Type":
					object.httpMetadata?.contentType ?? "application/octet-stream",
			},
		});
	}

	if (request.method === "PUT") {
		const bytes = await request.arrayBuffer();
		const actualHash = await sha256Hash(bytes);
		if (actualHash !== hash) {
			return Response.json(
				{ error: "Blob hash mismatch.", expectedHash: hash, actualHash },
				{ status: 400, headers: CORS_HEADERS },
			);
		}
		await env.THETA_BLOBS.put(hash, bytes, {
			httpMetadata: {
				contentType:
					request.headers.get("content-type") ?? "application/octet-stream",
			},
		});
		return Response.json(
			{ hash, size: bytes.byteLength },
			{ status: 201, headers: CORS_HEADERS },
		);
	}

	if (request.method === "DELETE") {
		await env.THETA_BLOBS.delete(hash);
		return new Response(null, { status: 204, headers: CORS_HEADERS });
	}

	return Response.json(
		{ error: "Method not allowed." },
		{ status: 405, headers: CORS_HEADERS },
	);
}

type WorkspaceMutationConflict = {
	readonly path: string;
	readonly expectedVersion: string;
	readonly actualVersion: string | undefined;
};

async function findWorkspaceMutationConflicts(
	sql: NeonQueryFunction<false, false>,
	workspaceId: string,
	mutations: readonly WorkspaceMutation[],
): Promise<readonly WorkspaceMutationConflict[]> {
	const conflicts: WorkspaceMutationConflict[] = [];
	for (const mutation of mutations) {
		if (mutation.kind === "recordFileVersion") {
			continue;
		}
		const expectedVersion = mutation.expectedVersion;
		if (expectedVersion === undefined) {
			continue;
		}
		const path =
			mutation.kind === "putEntry" ? mutation.entry.path : mutation.path;
		const rows = (await sql`select version
from theta_workspace_entries
where workspace_id = ${workspaceId} and path = ${path}
limit 1`) as { version: string }[];
		const actualVersion = rows[0]?.version;
		if (actualVersion !== expectedVersion) {
			conflicts.push({ path, expectedVersion, actualVersion });
		}
	}
	return conflicts;
}

function mutationQuery(
	sql: NeonQueryFunctionInTransaction<false, false>,
	requestWorkspaceId: string,
	mutation: WorkspaceMutation,
): NeonQueryInTransaction {
	switch (mutation.kind) {
		case "putEntry": {
			const entry = mutation.entry;
			assertWorkspace(entry.workspaceId, requestWorkspaceId);
			return sql`insert into theta_workspace_entries (
  workspace_id, path, parent_path, name, kind, version, size, content_hash,
  mime_type, metadata_json, blob_sync_status, created_by_device_id,
  updated_by_device_id, created_at, updated_at, deleted_at
) values (
  ${entry.workspaceId}, ${entry.path}, ${entry.parentPath}, ${entry.name},
  ${entry.kind}, ${entry.version}, ${entry.size}, ${entry.contentHash ?? null},
  ${entry.mimeType ?? null}, ${
		entry.metadata === undefined ? null : JSON.stringify(entry.metadata)
	}, ${entry.blobSyncStatus ?? null}, ${entry.createdByDeviceId ?? null},
  ${entry.updatedByDeviceId ?? null}, ${entry.createdAt}, ${entry.updatedAt},
  ${entry.deletedAt ?? null}
)
on conflict (workspace_id, path) do update set
  parent_path = excluded.parent_path,
  name = excluded.name,
  kind = excluded.kind,
  version = excluded.version,
  size = excluded.size,
  content_hash = excluded.content_hash,
  mime_type = excluded.mime_type,
  metadata_json = excluded.metadata_json,
  blob_sync_status = excluded.blob_sync_status,
  created_by_device_id = coalesce(theta_workspace_entries.created_by_device_id, excluded.created_by_device_id),
  updated_by_device_id = excluded.updated_by_device_id,
  updated_at = excluded.updated_at,
  deleted_at = excluded.deleted_at`;
		}
		case "recordFileVersion": {
			const version = mutation.version;
			assertWorkspace(version.workspaceId, requestWorkspaceId);
			return sql`insert into theta_file_versions (
  workspace_id, path, version, content_hash, size, created_by_device_id, created_at
) values (
  ${version.workspaceId}, ${version.path}, ${version.version},
  ${version.contentHash}, ${version.size}, ${version.createdByDeviceId ?? null},
  ${version.createdAt}
)
on conflict (workspace_id, path, version) do nothing`;
		}
		case "deleteEntry":
			assertWorkspace(mutation.workspaceId, requestWorkspaceId);
			return sql`delete from theta_workspace_entries
where workspace_id = ${mutation.workspaceId} and path = ${mutation.path}`;
	}
}

function validateWorkspaceMutationRequest(
	body: WorkspaceMutationRequest,
): asserts body is WorkspaceMutationRequest {
	if (!body || typeof body !== "object") {
		throw new Error("Invalid mutation request.");
	}
	if (typeof body.workspaceId !== "string" || body.workspaceId.length === 0) {
		throw new Error("Mutation request must include workspaceId.");
	}
	if (!Array.isArray(body.mutations)) {
		throw new Error("Mutation request must include mutations.");
	}
	for (const mutation of body.mutations) {
		validateWorkspaceMutation(body.workspaceId, mutation);
	}
}

function validateWorkspaceMutation(
	workspaceId: string,
	mutation: WorkspaceMutation,
): void {
	if (!mutation || typeof mutation !== "object") {
		throw new Error("Invalid workspace mutation.");
	}
	switch (mutation.kind) {
		case "putEntry":
			assertWorkspace(mutation.entry.workspaceId, workspaceId);
			requireString(mutation.entry.path, "entry.path");
			requireString(mutation.entry.parentPath, "entry.parentPath");
			requireString(mutation.entry.name, "entry.name");
			requireString(mutation.entry.version, "entry.version");
			requireOptionalString(mutation.expectedVersion, "expectedVersion");
			break;
		case "recordFileVersion":
			assertWorkspace(mutation.version.workspaceId, workspaceId);
			requireString(mutation.version.path, "version.path");
			requireString(mutation.version.version, "version.version");
			requireString(mutation.version.contentHash, "version.contentHash");
			break;
		case "deleteEntry":
			assertWorkspace(mutation.workspaceId, workspaceId);
			requireString(mutation.path, "mutation.path");
			requireOptionalString(mutation.expectedVersion, "expectedVersion");
			break;
		default:
			throw new Error("Unknown workspace mutation kind.");
	}
}

function assertWorkspace(actual: string, expected: string): void {
	if (actual !== expected) {
		throw new Error("Mutation workspaceId mismatch.");
	}
}

function requireString(value: unknown, name: string): void {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`Mutation ${name} must be a non-empty string.`);
	}
}

function requireOptionalString(value: unknown, name: string): void {
	if (value !== undefined) {
		requireString(value, name);
	}
}

function exposeElectricHeaders(headers: Headers): Headers {
	const next = new Headers(headers);
	for (const [key, value] of Object.entries(CORS_HEADERS)) {
		next.set(key, value);
	}
	next.set(
		"Access-Control-Expose-Headers",
		[
			"electric-handle",
			"electric-offset",
			"electric-schema",
			"electric-cursor",
			"electric-up-to-date",
		].join(", "),
	);
	return next;
}

function bearerToken(request: Request): string | undefined {
	const header = request.headers.get("authorization");
	if (!header?.startsWith("Bearer ")) {
		return undefined;
	}
	return header.slice("Bearer ".length);
}

function providerEnvFromBindings(env: Env): Record<string, string> {
	return Object.fromEntries(
		Object.entries({
			OPENAI_API_KEY: env.OPENAI_API_KEY,
			ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
			GEMINI_API_KEY: env.GEMINI_API_KEY,
		}).filter((entry): entry is [string, string] => entry[1] !== undefined),
	);
}

function decodeBlobHash(url: URL): string | undefined {
	const prefix = "/v1/blobs/";
	if (!url.pathname.startsWith(prefix)) {
		return undefined;
	}
	const hash = decodeURIComponent(url.pathname.slice(prefix.length));
	return hash.startsWith("sha256:") ? hash : undefined;
}

async function sha256Hash(bytes: ArrayBuffer): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return `sha256:${Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("")}`;
}
