import type {
	AgentContext,
	AgentEvent,
	AgentLoopConfig,
	AgentMessage,
	AgentTool,
	AgentToolResult,
	StreamFn,
	ToolExecutionMode,
} from "@earendil-works/pi-agent-core/base";
import {
	runAgentLoop,
	runAgentLoopContinue,
} from "@earendil-works/pi-agent-core/base";
import type {
	Api,
	AssistantMessageEvent,
	KnownProvider,
	Message,
	Model,
	TSchema,
} from "@earendil-works/pi-ai/base";
import { getModels } from "@earendil-works/pi-ai/base";
import { registerBuiltInApiProviders } from "@earendil-works/pi-ai";
import type {
	ThetaAgentRunContext,
	ThetaAgentRuntimeAdapter,
} from "./agent.ts";
import type { ThetaAgentEvent, ThetaAssistantStreamEvent } from "./events.ts";
import type { ThetaMessage, ThetaToolResultMessage } from "./messages.ts";
import type { ThetaModelRef, ThetaThinkingLevel } from "./model.ts";
import type {
	ThetaToolDefinition,
	ThetaToolResult,
	ThetaToolSchema,
} from "./tools.ts";
import type { ThetaWorkspace } from "./workspace.ts";
import type { JsonObject } from "./json.ts";

export type ThetaAgentStreamFunction = StreamFn;

export interface CreateThetaAgentRuntimeOptions {
	readonly streamFn?: StreamFn;
	readonly sessionId?: string;
	readonly maxRetryDelayMs?: number;
	readonly toolExecution?: ToolExecutionMode;
}

export function createThetaAgentRuntime(
	options: CreateThetaAgentRuntimeOptions = {},
): ThetaAgentRuntimeAdapter {
	registerBuiltInApiProviders();
	return new ThetaAgentRuntimeAdapterImpl(options);
}

class ThetaAgentRuntimeAdapterImpl implements ThetaAgentRuntimeAdapter {
	private readonly options: CreateThetaAgentRuntimeOptions;

	constructor(options: CreateThetaAgentRuntimeOptions) {
		this.options = options;
	}

	async prompt(
		messages: readonly ThetaMessage[],
		context: ThetaAgentRunContext,
	): Promise<void> {
		const runtimeContext = await createRuntimeContext(context);
		await runAgentLoop(
			messages.map(toRuntimeMessage),
			runtimeContext,
			createRuntimeLoopConfig(context, this.options),
			(event) => emitThetaEvent(event, context),
			context.signal,
			this.options.streamFn,
		);
	}

	async continue(context: ThetaAgentRunContext): Promise<void> {
		const runtimeContext = await createRuntimeContext(context);
		await runAgentLoopContinue(
			runtimeContext,
			createRuntimeLoopConfig(context, this.options),
			(event) => emitThetaEvent(event, context),
			context.signal,
			this.options.streamFn,
		);
	}
}

async function createRuntimeContext(
	context: ThetaAgentRunContext,
): Promise<AgentContext> {
	return {
		systemPrompt: context.state.systemPrompt,
		messages: context.state.messages.map(toRuntimeMessage),
		tools: await createRuntimeTools(context.workspace, context.state.tools),
	};
}

function createRuntimeLoopConfig(
	context: ThetaAgentRunContext,
	options: CreateThetaAgentRuntimeOptions,
): AgentLoopConfig {
	const config: AgentLoopConfig = {
		model: toRuntimeModel(context.state.model),
		sessionId: options.sessionId ?? context.agentId,
		convertToLlm: (messages: AgentMessage[]) =>
			messages.filter(isRuntimeLlmMessage),
		getSteeringMessages: async () =>
			context.drainSteeringMessages().map(toRuntimeMessage),
		getFollowUpMessages: async () =>
			context.drainFollowUpMessages().map(toRuntimeMessage),
	};
	const reasoning = toRuntimeThinkingLevel(context.state.thinkingLevel);
	if (reasoning !== undefined) {
		config.reasoning = reasoning;
	}
	if (options.toolExecution !== undefined) {
		config.toolExecution = options.toolExecution;
	}
	if (options.maxRetryDelayMs !== undefined) {
		config.maxRetryDelayMs = options.maxRetryDelayMs;
	}
	return config;
}

async function createRuntimeTools(
	workspace: ThetaWorkspace,
	tools: readonly ThetaToolDefinition[],
): Promise<AgentTool[]> {
	const workspaceTools = await workspace.resolveTools();
	const byName = new Map<string, ThetaToolDefinition>();
	for (const tool of [...workspaceTools, ...tools]) {
		byName.set(tool.name, tool);
	}
	return Array.from(byName.values()).map((tool) =>
		toRuntimeTool(workspace, tool),
	);
}

function toRuntimeTool(
	workspace: ThetaWorkspace,
	tool: ThetaToolDefinition,
): AgentTool {
	return {
		name: tool.name,
		label: tool.label,
		description: tool.description,
		parameters: toRuntimeSchema(tool.parameters),
		execute: async (toolCallId, params, signal, onUpdate) => {
			const result = await tool.execute({
				workspace,
				fs: workspace.fs,
				toolCallId,
				input: toJsonObject(params),
				signal: signal ?? new AbortController().signal,
				update: (partialResult) => {
					onUpdate?.(toRuntimeToolResult(partialResult));
				},
			});
			return toRuntimeToolResult(result);
		},
		...(tool.executionMode !== undefined
			? { executionMode: tool.executionMode }
			: {}),
	};
}

function toRuntimeToolResult(
	result: ThetaToolResult<unknown>,
): AgentToolResult<ThetaToolResult<unknown>> {
	return {
		content: result.content.slice(),
		details: result,
		...(result.terminate !== undefined ? { terminate: result.terminate } : {}),
	};
}

function toThetaToolResult(
	result: AgentToolResult<unknown>,
	isError?: boolean,
): ThetaToolResult {
	if (isThetaToolResult(result.details)) {
		return {
			content: result.details.content,
			...(result.details.details !== undefined
				? { details: result.details.details }
				: {}),
			...((isError ?? result.details.isError) !== undefined
				? { isError: isError ?? result.details.isError }
				: {}),
			...(result.details.terminate !== undefined
				? { terminate: result.details.terminate }
				: {}),
			...(result.details.render !== undefined
				? { render: result.details.render }
				: {}),
		};
	}
	return {
		content: result.content,
		...(result.details !== undefined ? { details: result.details } : {}),
		...(isError !== undefined ? { isError } : {}),
		...(result.terminate !== undefined ? { terminate: result.terminate } : {}),
	};
}

function isThetaToolResult(value: unknown): value is ThetaToolResult {
	return (
		typeof value === "object" &&
		value !== null &&
		"content" in value &&
		Array.isArray((value as { readonly content?: unknown }).content)
	);
}

function toRuntimeModel(model: ThetaModelRef | undefined): Model<Api> {
	if (!model) {
		throw new Error("Theta agent runtime requires an active model.");
	}
	const registered = getRegisteredModel(model);
	if (registered) {
		return {
			...registered,
			name: model.name ?? registered.name,
			...(model.api !== undefined ? { api: model.api as Api } : {}),
			...(model.contextWindow !== undefined
				? { contextWindow: model.contextWindow }
				: {}),
			...(model.maxOutputTokens !== undefined
				? { maxTokens: model.maxOutputTokens }
				: {}),
		};
	}
	return {
		id: model.id,
		name: model.name ?? model.id,
		api: (model.api ?? model.provider) as Api,
		provider: model.provider,
		baseUrl: "",
		reasoning: model.supports?.thinking ?? false,
		input: model.supports?.images === false ? ["text"] : ["text", "image"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: model.contextWindow ?? 0,
		maxTokens: model.maxOutputTokens ?? 0,
	};
}

function getRegisteredModel(model: ThetaModelRef): Model<Api> | undefined {
	try {
		return getModels(model.provider as KnownProvider).find(
			(candidate) => candidate.id === model.id,
		) as Model<Api> | undefined;
	} catch {
		return undefined;
	}
}

function toRuntimeThinkingLevel(
	level: ThetaThinkingLevel,
): Exclude<ThetaThinkingLevel, "off"> | undefined {
	return level === "off" ? undefined : level;
}

function toRuntimeSchema(schema: ThetaToolSchema): TSchema {
	return schema as TSchema;
}

function toJsonObject(value: unknown): JsonObject {
	if (typeof value === "object" && value !== null && !Array.isArray(value)) {
		return value as JsonObject;
	}
	return {};
}

function toRuntimeMessage(message: ThetaMessage): AgentMessage {
	return message as AgentMessage;
}

function toThetaMessage(message: AgentMessage): ThetaMessage {
	return message as ThetaMessage;
}

function isRuntimeLlmMessage(message: AgentMessage): message is Message {
	return (
		message.role === "user" ||
		message.role === "assistant" ||
		message.role === "toolResult"
	);
}

async function emitThetaEvent(
	event: AgentEvent,
	context: ThetaAgentRunContext,
): Promise<void> {
	const thetaEvent = toThetaAgentEvent(event, context);
	if (!thetaEvent) {
		return;
	}
	if (event.type === "message_end") {
		context.appendMessage(toThetaMessage(event.message));
	}
	await context.emit(thetaEvent);
}

function toThetaAgentEvent(
	event: AgentEvent,
	context: ThetaAgentRunContext,
): ThetaAgentEvent | undefined {
	const base = {
		agentId: context.agentId,
		workspaceId: context.workspace.id,
	};
	switch (event.type) {
		case "agent_start":
		case "agent_end":
			return undefined;
		case "turn_start":
			return { ...base, type: "turn_start" };
		case "turn_end":
			return {
				...base,
				type: "turn_end",
				message: toThetaMessage(event.message),
				toolResults: event.toolResults.map(toThetaToolResultMessage),
			};
		case "message_start":
			return {
				...base,
				type: "message_start",
				message: toThetaMessage(event.message),
			};
		case "message_update":
			return {
				...base,
				type: "message_update",
				message: toThetaMessage(event.message),
				assistantMessageEvent: toThetaStreamEvent(event.assistantMessageEvent),
			};
		case "message_end":
			return {
				...base,
				type: "message_end",
				message: toThetaMessage(event.message),
			};
		case "tool_execution_start":
			return {
				...base,
				type: "tool_execution_start",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				input: toJsonObject(event.args),
			};
		case "tool_execution_update":
			return {
				...base,
				type: "tool_execution_update",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				input: toJsonObject(event.args),
				partialResult: toThetaToolResult(event.partialResult),
			};
		case "tool_execution_end":
			return {
				...base,
				type: "tool_execution_end",
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				result: toThetaToolResult(event.result, event.isError),
				isError:
					event.isError || toThetaToolResult(event.result).isError === true,
			};
	}
}

function toThetaToolResultMessage(
	message: AgentMessage,
): ThetaToolResultMessage {
	return message as ThetaToolResultMessage;
}

function toThetaStreamEvent(
	event: AssistantMessageEvent,
): ThetaAssistantStreamEvent {
	switch (event.type) {
		case "start":
			return { type: "start" };
		case "text_delta":
			return {
				type: "text_delta",
				contentIndex: event.contentIndex,
				delta: event.delta,
			};
		case "thinking_delta":
			return {
				type: "thinking_delta",
				contentIndex: event.contentIndex,
				delta: event.delta,
			};
		case "toolcall_delta":
			return {
				type: "toolcall_delta",
				contentIndex: event.contentIndex,
				delta: event.delta,
			};
		case "done":
			return { type: "done", reason: event.reason };
		case "error":
			return { type: "error", reason: event.reason };
		case "text_start":
		case "text_end":
			return {
				type: "text_delta",
				contentIndex: event.contentIndex,
				delta: "",
			};
		case "thinking_start":
		case "thinking_end":
			return {
				type: "thinking_delta",
				contentIndex: event.contentIndex,
				delta: "",
			};
		case "toolcall_start":
		case "toolcall_end":
			return {
				type: "toolcall_delta",
				contentIndex: event.contentIndex,
				delta: "",
			};
	}
}
