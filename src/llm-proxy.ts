import {
	type AssistantMessage,
	type AssistantMessageEvent,
	createAssistantMessageEventStream,
	type Context,
	type Model,
	parseStreamingJson,
	type SimpleStreamOptions,
	type StopReason,
	type ToolCall,
	type Usage,
} from "@earendil-works/pi-ai/base";
import type { ThetaLlmProxyConfig } from "./model.ts";

export type ThetaProxyStreamEvent =
	| { readonly type: "start" }
	| { readonly type: "text_start"; readonly contentIndex: number }
	| {
			readonly type: "text_delta";
			readonly contentIndex: number;
			readonly delta: string;
	  }
	| {
			readonly type: "text_end";
			readonly contentIndex: number;
			readonly contentSignature?: string;
	  }
	| { readonly type: "thinking_start"; readonly contentIndex: number }
	| {
			readonly type: "thinking_delta";
			readonly contentIndex: number;
			readonly delta: string;
	  }
	| {
			readonly type: "thinking_end";
			readonly contentIndex: number;
			readonly contentSignature?: string;
	  }
	| {
			readonly type: "toolcall_start";
			readonly contentIndex: number;
			readonly id: string;
			readonly toolName: string;
	  }
	| {
			readonly type: "toolcall_delta";
			readonly contentIndex: number;
			readonly delta: string;
	  }
	| { readonly type: "toolcall_end"; readonly contentIndex: number }
	| {
			readonly type: "done";
			readonly reason: Extract<StopReason, "stop" | "length" | "toolUse">;
			readonly usage: Usage;
	  }
	| {
			readonly type: "error";
			readonly reason: Extract<StopReason, "aborted" | "error">;
			readonly errorMessage?: string;
			readonly usage: Usage;
	  };

export type ThetaProxySerializableOptions = Pick<
	SimpleStreamOptions,
	| "temperature"
	| "maxTokens"
	| "reasoning"
	| "cacheRetention"
	| "sessionId"
	| "headers"
	| "metadata"
	| "transport"
	| "thinkingBudgets"
	| "maxRetryDelayMs"
>;

export interface ThetaProxyRequest {
	readonly model: Model<string>;
	readonly context: Context;
	readonly options?: ThetaProxySerializableOptions;
}

export interface ThetaStreamProxyOptions extends ThetaProxySerializableOptions {
	readonly proxy: ThetaLlmProxyConfig;
	readonly signal?: AbortSignal;
}

export function streamThetaProxy(
	model: Model<string>,
	context: Context,
	options: ThetaStreamProxyOptions,
): ReturnType<typeof createAssistantMessageEventStream> {
	const stream = createAssistantMessageEventStream();
	void runProxyStream(model, context, options, stream);
	return stream;
}

export function reconstructThetaProxyEvent(
	proxyEvent: ThetaProxyStreamEvent,
	partial: AssistantMessage,
): AssistantMessageEvent | undefined {
	switch (proxyEvent.type) {
		case "start":
			return { type: "start", partial };
		case "text_start":
			partial.content[proxyEvent.contentIndex] = { type: "text", text: "" };
			return {
				type: "text_start",
				contentIndex: proxyEvent.contentIndex,
				partial,
			};
		case "text_delta":
			return appendTextDelta(proxyEvent, partial);
		case "text_end":
			return endText(proxyEvent, partial);
		case "thinking_start":
			partial.content[proxyEvent.contentIndex] = {
				type: "thinking",
				thinking: "",
			};
			return {
				type: "thinking_start",
				contentIndex: proxyEvent.contentIndex,
				partial,
			};
		case "thinking_delta":
			return appendThinkingDelta(proxyEvent, partial);
		case "thinking_end":
			return endThinking(proxyEvent, partial);
		case "toolcall_start":
			partial.content[proxyEvent.contentIndex] = {
				type: "toolCall",
				id: proxyEvent.id,
				name: proxyEvent.toolName,
				arguments: {},
				partialJson: "",
			} as ToolCall & { partialJson: string };
			return {
				type: "toolcall_start",
				contentIndex: proxyEvent.contentIndex,
				partial,
			};
		case "toolcall_delta":
			return appendToolCallDelta(proxyEvent, partial);
		case "toolcall_end":
			return endToolCall(proxyEvent, partial);
		case "done":
			partial.stopReason = proxyEvent.reason;
			partial.usage = proxyEvent.usage;
			return { type: "done", reason: proxyEvent.reason, message: partial };
		case "error":
			partial.stopReason = proxyEvent.reason;
			if (proxyEvent.errorMessage !== undefined) {
				partial.errorMessage = proxyEvent.errorMessage;
			}
			partial.usage = proxyEvent.usage;
			return { type: "error", reason: proxyEvent.reason, error: partial };
	}
}

export function encodeThetaProxyEvent(event: ThetaProxyStreamEvent): string {
	return `data: ${JSON.stringify(event)}\n\n`;
}

async function runProxyStream(
	model: Model<string>,
	context: Context,
	options: ThetaStreamProxyOptions,
	stream: ReturnType<typeof createAssistantMessageEventStream>,
): Promise<void> {
	const partial = createEmptyAssistantMessage(model);
	let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
	const abortHandler = () => {
		void reader?.cancel("Request aborted by user");
	};
	options.signal?.addEventListener("abort", abortHandler);

	try {
		const requestInit: RequestInit = {
			method: "POST",
			headers: await resolveProxyHeaders(options.proxy),
			body: JSON.stringify({
				model,
				context,
				options: buildProxyRequestOptions(options),
			} satisfies ThetaProxyRequest),
		};
		if (options.signal !== undefined) {
			requestInit.signal = options.signal;
		}
		const response = await fetch(
			resolveProxyUrl(options.proxy.url),
			requestInit,
		);
		if (!response.ok) {
			throw new Error(await readProxyError(response));
		}
		if (!response.body) {
			throw new Error("Theta proxy response did not include a body.");
		}
		reader = response.body.getReader();
		await readProxyEvents(reader, partial, stream);
		stream.end();
	} catch (error) {
		const reason = options.signal?.aborted ? "aborted" : "error";
		partial.stopReason = reason;
		partial.errorMessage =
			error instanceof Error ? error.message : String(error);
		stream.push({ type: "error", reason, error: partial });
		stream.end(partial);
	} finally {
		options.signal?.removeEventListener("abort", abortHandler);
	}
}

async function readProxyEvents(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	partial: AssistantMessage,
	stream: ReturnType<typeof createAssistantMessageEventStream>,
): Promise<void> {
	const decoder = new TextDecoder();
	let buffer = "";
	while (true) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";
		for (const line of lines) {
			if (!line.startsWith("data: ")) {
				continue;
			}
			const data = line.slice(6).trim();
			if (!data) {
				continue;
			}
			const event = reconstructThetaProxyEvent(
				JSON.parse(data) as ThetaProxyStreamEvent,
				partial,
			);
			if (event) {
				stream.push(event);
			}
		}
	}
}

function buildProxyRequestOptions(
	options: ThetaStreamProxyOptions,
): ThetaProxySerializableOptions {
	return {
		...(options.temperature !== undefined
			? { temperature: options.temperature }
			: {}),
		...(options.maxTokens !== undefined
			? { maxTokens: options.maxTokens }
			: {}),
		...(options.reasoning !== undefined
			? { reasoning: options.reasoning }
			: {}),
		...(options.cacheRetention !== undefined
			? { cacheRetention: options.cacheRetention }
			: {}),
		...(options.sessionId !== undefined
			? { sessionId: options.sessionId }
			: {}),
		...(options.headers !== undefined ? { headers: options.headers } : {}),
		...(options.metadata !== undefined ? { metadata: options.metadata } : {}),
		...(options.transport !== undefined
			? { transport: options.transport }
			: {}),
		...(options.thinkingBudgets !== undefined
			? { thinkingBudgets: options.thinkingBudgets }
			: {}),
		...(options.maxRetryDelayMs !== undefined
			? { maxRetryDelayMs: options.maxRetryDelayMs }
			: {}),
	};
}

async function resolveProxyHeaders(
	proxy: ThetaLlmProxyConfig,
): Promise<Record<string, string>> {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		...proxy.headers,
	};
	const token = await resolveAuthToken(proxy.authToken);
	if (token !== undefined && headers.Authorization === undefined) {
		headers.Authorization = `Bearer ${token}`;
	}
	return headers;
}

async function resolveAuthToken(
	authToken: ThetaLlmProxyConfig["authToken"],
): Promise<string | undefined> {
	if (typeof authToken === "function") {
		return authToken();
	}
	return authToken;
}

function resolveProxyUrl(url: string | URL): string {
	return url.toString();
}

async function readProxyError(response: Response): Promise<string> {
	const fallback = `Theta proxy error: ${response.status} ${response.statusText}`;
	try {
		const data = (await response.json()) as { readonly error?: unknown };
		if (typeof data.error === "string") {
			return `Theta proxy error: ${data.error}`;
		}
	} catch {
		// Ignore non-JSON error bodies.
	}
	return fallback;
}

function createEmptyAssistantMessage(model: Model<string>): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: createEmptyUsage(),
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function createEmptyUsage(): Usage {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function appendTextDelta(
	event: Extract<ThetaProxyStreamEvent, { readonly type: "text_delta" }>,
	partial: AssistantMessage,
): AssistantMessageEvent {
	const content = partial.content[event.contentIndex];
	if (content?.type !== "text") {
		throw new Error("Received text_delta for non-text content.");
	}
	content.text += event.delta;
	return {
		type: "text_delta",
		contentIndex: event.contentIndex,
		delta: event.delta,
		partial,
	};
}

function endText(
	event: Extract<ThetaProxyStreamEvent, { readonly type: "text_end" }>,
	partial: AssistantMessage,
): AssistantMessageEvent {
	const content = partial.content[event.contentIndex];
	if (content?.type !== "text") {
		throw new Error("Received text_end for non-text content.");
	}
	if (event.contentSignature !== undefined) {
		content.textSignature = event.contentSignature;
	}
	return {
		type: "text_end",
		contentIndex: event.contentIndex,
		content: content.text,
		partial,
	};
}

function appendThinkingDelta(
	event: Extract<ThetaProxyStreamEvent, { readonly type: "thinking_delta" }>,
	partial: AssistantMessage,
): AssistantMessageEvent {
	const content = partial.content[event.contentIndex];
	if (content?.type !== "thinking") {
		throw new Error("Received thinking_delta for non-thinking content.");
	}
	content.thinking += event.delta;
	return {
		type: "thinking_delta",
		contentIndex: event.contentIndex,
		delta: event.delta,
		partial,
	};
}

function endThinking(
	event: Extract<ThetaProxyStreamEvent, { readonly type: "thinking_end" }>,
	partial: AssistantMessage,
): AssistantMessageEvent {
	const content = partial.content[event.contentIndex];
	if (content?.type !== "thinking") {
		throw new Error("Received thinking_end for non-thinking content.");
	}
	if (event.contentSignature !== undefined) {
		content.thinkingSignature = event.contentSignature;
	}
	return {
		type: "thinking_end",
		contentIndex: event.contentIndex,
		content: content.thinking,
		partial,
	};
}

function appendToolCallDelta(
	event: Extract<ThetaProxyStreamEvent, { readonly type: "toolcall_delta" }>,
	partial: AssistantMessage,
): AssistantMessageEvent {
	const content = partial.content[event.contentIndex] as
		| (ToolCall & { partialJson?: string })
		| undefined;
	if (content?.type !== "toolCall") {
		throw new Error("Received toolcall_delta for non-toolCall content.");
	}
	content.partialJson = `${content.partialJson ?? ""}${event.delta}`;
	content.arguments = parseStreamingJson(content.partialJson) ?? {};
	return {
		type: "toolcall_delta",
		contentIndex: event.contentIndex,
		delta: event.delta,
		partial,
	};
}

function endToolCall(
	event: Extract<ThetaProxyStreamEvent, { readonly type: "toolcall_end" }>,
	partial: AssistantMessage,
): AssistantMessageEvent | undefined {
	const content = partial.content[event.contentIndex] as
		| (ToolCall & { partialJson?: string })
		| undefined;
	if (content?.type !== "toolCall") {
		return undefined;
	}
	delete content.partialJson;
	return {
		type: "toolcall_end",
		contentIndex: event.contentIndex,
		toolCall: content,
		partial,
	};
}
