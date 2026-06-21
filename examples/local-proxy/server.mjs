import { createServer } from "node:http";
import { Readable } from "node:stream";
import { handleThetaLlmProxyRequest } from "../../dist/server.js";

const PORT = Number.parseInt(process.env.PORT ?? "8787", 10);
const HOST = process.env.HOST ?? "127.0.0.1";
const THETA_PROXY_TOKEN = process.env.THETA_PROXY_TOKEN ?? "local-dev-token";

const CORS_HEADERS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "POST, OPTIONS",
	"Access-Control-Allow-Headers": "Authorization, Content-Type, X-Workspace-Id",
};

const server = createServer(async (nodeRequest, nodeResponse) => {
	try {
		const url = new URL(
			nodeRequest.url ?? "/",
			`http://${nodeRequest.headers.host ?? `${HOST}:${PORT}`}`,
		);

		if (nodeRequest.method === "OPTIONS") {
			writeHeaders(nodeResponse, 204, CORS_HEADERS);
			nodeResponse.end();
			return;
		}

		if (url.pathname !== "/v1/stream") {
			writeJson(nodeResponse, 404, { error: "Not found." });
			return;
		}

		const request = await toWebRequest(nodeRequest, url);
		const response = await handleThetaLlmProxyRequest(request, {
			headers: CORS_HEADERS,
			providerEnv: providerEnvFromProcess(),
			hooks: {
				authenticate(authRequest) {
					return bearerToken(authRequest) === THETA_PROXY_TOKEN
						? { subjectId: "local-client" }
						: undefined;
				},
			},
		});
		await writeWebResponse(nodeResponse, response);
	} catch (error) {
		writeJson(nodeResponse, 500, {
			error: error instanceof Error ? error.message : String(error),
		});
	}
});

server.listen(PORT, HOST, () => {
	console.log(
		`Theta local proxy listening on http://${HOST}:${PORT}/v1/stream`,
	);
});

async function toWebRequest(nodeRequest, url) {
	const abortController = new AbortController();
	nodeRequest.on("close", () => {
		if (!nodeRequest.complete) {
			abortController.abort();
		}
	});
	const body = shouldReadBody(nodeRequest.method)
		? Buffer.concat(await collectBody(nodeRequest))
		: undefined;
	return new Request(url, {
		method: nodeRequest.method,
		headers: headersFromNodeRequest(nodeRequest),
		...(body !== undefined ? { body } : {}),
		signal: abortController.signal,
	});
}

function shouldReadBody(method) {
	return method !== "GET" && method !== "HEAD";
}

async function collectBody(nodeRequest) {
	const chunks = [];
	for await (const chunk of nodeRequest) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	return chunks;
}

function headersFromNodeRequest(nodeRequest) {
	const headers = new Headers();
	for (const [key, value] of Object.entries(nodeRequest.headers)) {
		if (Array.isArray(value)) {
			headers.set(key, value.join(", "));
		} else if (value !== undefined) {
			headers.set(key, value);
		}
	}
	return headers;
}

async function writeWebResponse(nodeResponse, response) {
	writeHeaders(nodeResponse, response.status, response.headers);
	if (!response.body) {
		nodeResponse.end();
		return;
	}
	await new Promise((resolve, reject) => {
		Readable.fromWeb(response.body).pipe(nodeResponse);
		nodeResponse.on("finish", resolve);
		nodeResponse.on("error", reject);
	});
}

function writeHeaders(nodeResponse, status, headers) {
	nodeResponse.writeHead(status, Object.fromEntries(new Headers(headers)));
}

function writeJson(nodeResponse, status, body) {
	writeHeaders(nodeResponse, status, {
		"Content-Type": "application/json",
		...CORS_HEADERS,
	});
	nodeResponse.end(JSON.stringify(body));
}

function bearerToken(request) {
	const header = request.headers.get("authorization");
	if (!header?.startsWith("Bearer ")) {
		return undefined;
	}
	return header.slice("Bearer ".length);
}

function providerEnvFromProcess() {
	return Object.fromEntries(
		Object.entries({
			OPENAI_API_KEY: process.env.OPENAI_API_KEY,
			ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
			GEMINI_API_KEY: process.env.GEMINI_API_KEY,
		}).filter((entry) => entry[1] !== undefined),
	);
}
