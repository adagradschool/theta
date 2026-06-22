import {
	type AssistantMessageEvent,
	registerBuiltInApiProviders,
	streamSimple,
} from "@earendil-works/pi-ai";
import type {
	ThetaProxyRequest,
	ThetaProxyStreamEvent,
} from "./llm/llm-proxy.ts";

export interface ThetaServerProxyRequirements {
	readonly providerCredentials: "server-only";
	readonly transport: "streaming-http";
	readonly durableSync: "optional-server-infrastructure";
}

export const THETA_SERVER_PROXY_REQUIREMENTS = {
	providerCredentials: "server-only",
	transport: "streaming-http",
	durableSync: "optional-server-infrastructure",
} as const satisfies ThetaServerProxyRequirements;

export interface ThetaServerAuthContext {
	readonly subjectId: string;
	readonly workspaceId?: string;
	readonly claims?: Readonly<Record<string, unknown>>;
}

export interface ThetaServerProxyHooks {
	authenticate?(
		request: Request,
	):
		| Promise<ThetaServerAuthContext | undefined>
		| ThetaServerAuthContext
		| undefined;
}

export interface ThetaLlmProxyHandlerOptions {
	readonly hooks?: ThetaServerProxyHooks;
	readonly headers?: HeadersInit | ((request: Request) => HeadersInit);
	readonly providerEnv?: Readonly<Record<string, string>>;
}

export async function handleThetaLlmProxyRequest(
	request: Request,
	options: ThetaLlmProxyHandlerOptions = {},
): Promise<Response> {
	if (request.method !== "POST") {
		return jsonError("Method not allowed.", 405);
	}
	const authContext = await options.hooks?.authenticate?.(request);
	if (options.hooks?.authenticate && !authContext) {
		return jsonError("Unauthorized.", 401);
	}
	let body: ThetaProxyRequest;
	try {
		body = (await request.json()) as ThetaProxyRequest;
		validateProxyRequest(body);
	} catch (error) {
		return jsonError(
			error instanceof Error ? error.message : String(error),
			400,
		);
	}

	const stream = createThetaProxyResponseStream(
		body,
		request.signal,
		options.providerEnv,
	);
	return new Response(stream, {
		status: 200,
		headers: {
			"Content-Type": "text/event-stream; charset=utf-8",
			"Cache-Control": "no-cache, no-transform",
			Connection: "keep-alive",
			...headersToRecord(resolveHeaders(options.headers, request)),
		},
	});
}

function createThetaProxyResponseStream(
	body: ThetaProxyRequest,
	signal: AbortSignal,
	providerEnv: Readonly<Record<string, string>> | undefined,
): ReadableStream<Uint8Array> {
	registerBuiltInApiProviders();
	const encoder = new TextEncoder();
	return new ReadableStream<Uint8Array>({
		async start(controller) {
			const push = (event: ThetaProxyStreamEvent) => {
				controller.enqueue(
					encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
				);
			};
			try {
				const upstream = streamSimple(body.model, body.context, {
					...body.options,
					signal,
					...(providerEnv !== undefined ? { env: providerEnv } : {}),
				});
				for await (const event of upstream) {
					push(toProxyStreamEvent(event));
				}
				controller.close();
			} catch (error) {
				push({
					type: "error",
					reason: signal.aborted ? "aborted" : "error",
					errorMessage: error instanceof Error ? error.message : String(error),
					usage: createEmptyUsage(),
				});
				controller.close();
			}
		},
		cancel() {
			// Fetch request cancellation is represented by request.signal.
		},
	});
}

function toProxyStreamEvent(
	event: AssistantMessageEvent,
): ThetaProxyStreamEvent {
	switch (event.type) {
		case "start":
			return { type: "start" };
		case "text_start":
			return { type: "text_start", contentIndex: event.contentIndex };
		case "text_delta":
			return {
				type: "text_delta",
				contentIndex: event.contentIndex,
				delta: event.delta,
			};
		case "text_end":
			return createTextEndProxyEvent(event);
		case "thinking_start":
			return { type: "thinking_start", contentIndex: event.contentIndex };
		case "thinking_delta":
			return {
				type: "thinking_delta",
				contentIndex: event.contentIndex,
				delta: event.delta,
			};
		case "thinking_end":
			return createThinkingEndProxyEvent(event);
		case "toolcall_start": {
			const content = event.partial.content[event.contentIndex];
			if (content?.type !== "toolCall") {
				throw new Error("toolcall_start event did not include a tool call.");
			}
			return {
				type: "toolcall_start",
				contentIndex: event.contentIndex,
				id: content.id,
				toolName: content.name,
			};
		}
		case "toolcall_delta":
			return {
				type: "toolcall_delta",
				contentIndex: event.contentIndex,
				delta: event.delta,
			};
		case "toolcall_end":
			return { type: "toolcall_end", contentIndex: event.contentIndex };
		case "done":
			return {
				type: "done",
				reason: event.reason,
				usage: event.message.usage,
			};
		case "error":
			return withOptionalErrorMessage(
				{
					type: "error",
					reason: event.reason,
					usage: event.error.usage,
				},
				event.error.errorMessage,
			);
	}
}

function createTextEndProxyEvent(
	event: Extract<AssistantMessageEvent, { type: "text_end" }>,
): Extract<ThetaProxyStreamEvent, { readonly type: "text_end" }> {
	const content = event.partial.content[event.contentIndex];
	const contentSignature =
		content?.type === "text" ? content.textSignature : undefined;
	return {
		type: "text_end",
		contentIndex: event.contentIndex,
		...(contentSignature !== undefined ? { contentSignature } : {}),
	};
}

function createThinkingEndProxyEvent(
	event: Extract<AssistantMessageEvent, { type: "thinking_end" }>,
): Extract<ThetaProxyStreamEvent, { readonly type: "thinking_end" }> {
	const content = event.partial.content[event.contentIndex];
	const contentSignature =
		content?.type === "thinking" ? content.thinkingSignature : undefined;
	return {
		type: "thinking_end",
		contentIndex: event.contentIndex,
		...(contentSignature !== undefined ? { contentSignature } : {}),
	};
}

function withOptionalErrorMessage<
	T extends Extract<ThetaProxyStreamEvent, { readonly type: "error" }>,
>(event: Omit<T, "errorMessage">, errorMessage: string | undefined): T {
	return (errorMessage === undefined ? event : { ...event, errorMessage }) as T;
}

function validateProxyRequest(request: ThetaProxyRequest): void {
	if (!request || typeof request !== "object") {
		throw new Error("Invalid proxy request.");
	}
	if (!request.model || typeof request.model !== "object") {
		throw new Error("Proxy request must include model.");
	}
	if (!request.context || typeof request.context !== "object") {
		throw new Error("Proxy request must include context.");
	}
	if (!Array.isArray(request.context.messages)) {
		throw new Error("Proxy request context must include messages.");
	}
}

function jsonError(error: string, status: number): Response {
	return Response.json({ error }, { status });
}

function resolveHeaders(
	headers: ThetaLlmProxyHandlerOptions["headers"],
	request: Request,
): HeadersInit | undefined {
	return typeof headers === "function" ? headers(request) : headers;
}

function headersToRecord(
	headers: HeadersInit | undefined,
): Record<string, string> {
	if (!headers) {
		return {};
	}
	return Object.fromEntries(new Headers(headers).entries());
}

function createEmptyUsage() {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}
