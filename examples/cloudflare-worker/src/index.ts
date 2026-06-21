import { handleThetaLlmProxyRequest } from "@earendil-works/theta/server";

export interface Env {
	readonly THETA_PROXY_TOKEN: string;
	readonly THETA_BLOBS?: R2Bucket;
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
