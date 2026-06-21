import { handleThetaLlmProxyRequest } from "@earendil-works/theta/server";

export interface Env {
	readonly THETA_PROXY_TOKEN: string;
	readonly OPENAI_API_KEY?: string;
	readonly ANTHROPIC_API_KEY?: string;
	readonly GEMINI_API_KEY?: string;
}

const CORS_HEADERS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "POST, OPTIONS",
	"Access-Control-Allow-Headers": "Authorization, Content-Type, X-Workspace-Id",
} as const;

export default {
	async fetch(request, env): Promise<Response> {
		if (request.method === "OPTIONS") {
			return new Response(null, { status: 204, headers: CORS_HEADERS });
		}
		const url = new URL(request.url);
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
