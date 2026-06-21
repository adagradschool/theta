import { ThetaEmitter } from "./emitter.ts";
import type { ThetaAgentEvent, ThetaEventListener } from "./events.ts";
import type {
	ThetaLlmProxyConfig,
	ThetaModelRef,
	ThetaThinkingLevel,
} from "./model.ts";
import type {
	ThetaImageContent,
	ThetaMessage,
	ThetaPromptInput,
	ThetaUserMessage,
} from "./messages.ts";
import type { ThetaToolDefinition } from "./tools.ts";
import type { ThetaWorkspace } from "./workspace.ts";
import {
	createThetaAgentRuntime,
	type CreateThetaAgentRuntimeOptions,
} from "./agent-runtime.ts";

export type ThetaQueueMode = "all" | "one-at-a-time";

export interface ThetaPromptOptions {
	readonly images?: readonly ThetaImageContent[];
	readonly streamingBehavior?: "reject" | "steer" | "followUp";
}

export interface ThetaAgentState {
	readonly systemPrompt: string;
	readonly model: ThetaModelRef | undefined;
	readonly thinkingLevel: ThetaThinkingLevel;
	readonly tools: readonly ThetaToolDefinition[];
	readonly messages: readonly ThetaMessage[];
	readonly isStreaming: boolean;
	readonly streamingMessage: ThetaMessage | undefined;
	readonly pendingToolCalls: ReadonlySet<string>;
	readonly errorMessage: string | undefined;
}

interface MutableThetaAgentState {
	systemPrompt: string;
	model: ThetaModelRef | undefined;
	thinkingLevel: ThetaThinkingLevel;
	tools: ThetaToolDefinition[];
	messages: ThetaMessage[];
	isStreaming: boolean;
	streamingMessage: ThetaMessage | undefined;
	pendingToolCalls: Set<string>;
	errorMessage: string | undefined;
}

export interface ThetaAgentRunContext {
	readonly agentId: string;
	readonly workspace: ThetaWorkspace;
	readonly state: ThetaAgentState;
	readonly signal: AbortSignal;
	emit(event: ThetaAgentEvent): Promise<void>;
	appendMessage(message: ThetaMessage): void;
	drainSteeringMessages(): readonly ThetaMessage[];
	drainFollowUpMessages(): readonly ThetaMessage[];
}

export interface ThetaAgentRuntimeAdapter {
	prompt(
		messages: readonly ThetaMessage[],
		context: ThetaAgentRunContext,
	): Promise<void>;
	continue(context: ThetaAgentRunContext): Promise<void>;
}

export interface CreateThetaAgentOptions {
	readonly id?: string;
	readonly workspace: ThetaWorkspace;
	readonly systemPrompt?: string;
	readonly model?: ThetaModelRef;
	readonly thinkingLevel?: ThetaThinkingLevel;
	readonly tools?: readonly ThetaToolDefinition[];
	readonly proxy?: ThetaLlmProxyConfig;
	readonly runtime?: ThetaAgentRuntimeAdapter;
	readonly runtimeOptions?: CreateThetaAgentRuntimeOptions;
	readonly steeringMode?: ThetaQueueMode;
	readonly followUpMode?: ThetaQueueMode;
	readonly events?: ThetaEventListener<ThetaAgentEvent>;
}

export interface ThetaAgent {
	readonly id: string;
	readonly workspace: ThetaWorkspace;
	readonly proxy: ThetaLlmProxyConfig | undefined;
	readonly state: ThetaAgentState;
	steeringMode: ThetaQueueMode;
	followUpMode: ThetaQueueMode;
	subscribe(listener: ThetaEventListener<ThetaAgentEvent>): () => void;
	prompt(input: ThetaPromptInput, options?: ThetaPromptOptions): Promise<void>;
	continue(): Promise<void>;
	steer(
		input: ThetaPromptInput,
		options?: Pick<ThetaPromptOptions, "images">,
	): void;
	followUp(
		input: ThetaPromptInput,
		options?: Pick<ThetaPromptOptions, "images">,
	): void;
	clearSteeringQueue(): void;
	clearFollowUpQueue(): void;
	clearAllQueues(): void;
	hasQueuedMessages(): boolean;
	setModel(model: ThetaModelRef): void;
	setThinkingLevel(thinkingLevel: ThetaThinkingLevel): void;
	setTools(tools: readonly ThetaToolDefinition[]): void;
	abort(): void;
	waitForIdle(): Promise<void>;
	reset(): void;
	dispose(): void;
}

export class ThetaRuntimeNotConfiguredError extends Error {
	constructor() {
		super(
			"Theta agent runtime is not configured. Pass a runtime adapter or runtime options.",
		);
		this.name = "ThetaRuntimeNotConfiguredError";
	}
}

type ActiveRun = {
	readonly promise: Promise<void>;
	readonly abortController: AbortController;
};

let nextAgentId = 1;

export function createThetaAgent(options: CreateThetaAgentOptions): ThetaAgent {
	return new ThetaAgentController(options);
}

function isThetaMessageArray(
	input: ThetaPromptInput,
): input is readonly ThetaMessage[] {
	return Array.isArray(input);
}

class ThetaAgentController implements ThetaAgent {
	readonly id: string;
	readonly workspace: ThetaWorkspace;
	readonly proxy: ThetaLlmProxyConfig | undefined;
	private readonly runtime: ThetaAgentRuntimeAdapter | undefined;
	private readonly emitter = new ThetaEmitter<ThetaAgentEvent>();
	private readonly stateValue: MutableThetaAgentState;
	private readonly steeringQueue: ThetaMessage[][] = [];
	private readonly followUpQueue: ThetaMessage[][] = [];
	private activeRun: ActiveRun | undefined;
	private disposed = false;
	steeringMode: ThetaQueueMode;
	followUpMode: ThetaQueueMode;

	constructor(options: CreateThetaAgentOptions) {
		this.id = options.id ?? `theta-agent-${nextAgentId}`;
		nextAgentId += 1;
		this.workspace = options.workspace;
		this.proxy = options.proxy;
		this.runtime =
			options.runtime ?? createThetaAgentRuntime(options.runtimeOptions);
		this.steeringMode = options.steeringMode ?? "one-at-a-time";
		this.followUpMode = options.followUpMode ?? "one-at-a-time";
		this.stateValue = {
			systemPrompt: options.systemPrompt ?? "",
			model: options.model,
			thinkingLevel: options.thinkingLevel ?? "off",
			tools: options.tools?.slice() ?? [],
			messages: [],
			isStreaming: false,
			streamingMessage: undefined,
			pendingToolCalls: new Set<string>(),
			errorMessage: undefined,
		};
		if (options.events) {
			this.subscribe(options.events);
		}
	}

	get state(): ThetaAgentState {
		return this.stateValue;
	}

	subscribe(listener: ThetaEventListener<ThetaAgentEvent>): () => void {
		return this.emitter.subscribe(listener);
	}

	async prompt(
		input: ThetaPromptInput,
		options: ThetaPromptOptions = {},
	): Promise<void> {
		this.assertUsable();
		if (this.activeRun) {
			if (options.streamingBehavior === "steer") {
				this.steer(input, options);
				return;
			}
			if (options.streamingBehavior === "followUp") {
				this.followUp(input, options);
				return;
			}
			throw new Error(
				"Theta agent is already running. Queue the input with steer or followUp.",
			);
		}

		const runtime = this.getRuntime();
		const messages = this.normalizePromptInput(input, options.images);
		await this.runWithLifecycle((context) => runtime.prompt(messages, context));
	}

	async continue(): Promise<void> {
		this.assertUsable();
		if (this.activeRun) {
			throw new Error("Theta agent is already running.");
		}
		const runtime = this.getRuntime();
		await this.runWithLifecycle((context) => runtime.continue(context));
	}

	steer(
		input: ThetaPromptInput,
		options: Pick<ThetaPromptOptions, "images"> = {},
	): void {
		this.assertUsable();
		this.steeringQueue.push(this.normalizePromptInput(input, options.images));
	}

	followUp(
		input: ThetaPromptInput,
		options: Pick<ThetaPromptOptions, "images"> = {},
	): void {
		this.assertUsable();
		this.followUpQueue.push(this.normalizePromptInput(input, options.images));
	}

	clearSteeringQueue(): void {
		this.steeringQueue.length = 0;
	}

	clearFollowUpQueue(): void {
		this.followUpQueue.length = 0;
	}

	clearAllQueues(): void {
		this.clearSteeringQueue();
		this.clearFollowUpQueue();
	}

	hasQueuedMessages(): boolean {
		return this.steeringQueue.length > 0 || this.followUpQueue.length > 0;
	}

	setModel(model: ThetaModelRef): void {
		this.stateValue.model = model;
	}

	setThinkingLevel(thinkingLevel: ThetaThinkingLevel): void {
		this.stateValue.thinkingLevel = thinkingLevel;
	}

	setTools(tools: readonly ThetaToolDefinition[]): void {
		this.stateValue.tools = tools.slice();
	}

	abort(): void {
		this.activeRun?.abortController.abort();
	}

	waitForIdle(): Promise<void> {
		return this.activeRun?.promise ?? Promise.resolve();
	}

	reset(): void {
		this.stateValue.messages = [];
		this.stateValue.isStreaming = false;
		this.stateValue.streamingMessage = undefined;
		this.stateValue.pendingToolCalls = new Set<string>();
		this.stateValue.errorMessage = undefined;
		this.clearAllQueues();
	}

	dispose(): void {
		this.abort();
		this.disposed = true;
		this.clearAllQueues();
	}

	private getRuntime(): ThetaAgentRuntimeAdapter {
		if (!this.runtime) {
			throw new ThetaRuntimeNotConfiguredError();
		}
		return this.runtime;
	}

	private normalizePromptInput(
		input: ThetaPromptInput,
		images: readonly ThetaImageContent[] = [],
	): ThetaMessage[] {
		if (isThetaMessageArray(input)) {
			return input.slice();
		}
		if (typeof input !== "string") {
			return [input];
		}
		const content: ThetaUserMessage["content"] =
			images.length === 0 ? input : [{ type: "text", text: input }, ...images];
		return [{ role: "user", content, timestamp: Date.now() }];
	}

	private drainQueue(
		queue: ThetaMessage[][],
		mode: ThetaQueueMode,
	): ThetaMessage[] {
		if (queue.length === 0) {
			return [];
		}
		if (mode === "all") {
			const drained = queue.flat();
			queue.length = 0;
			return drained;
		}
		return queue.shift() ?? [];
	}

	private async runWithLifecycle(
		executor: (context: ThetaAgentRunContext) => Promise<void>,
	): Promise<void> {
		const abortController = new AbortController();
		const idlePromise = this.createIdlePromise();
		this.activeRun = { promise: idlePromise.promise, abortController };
		this.stateValue.isStreaming = true;
		this.stateValue.errorMessage = undefined;
		let runError: unknown;

		try {
			await this.emit({
				type: "agent_start",
				agentId: this.id,
				workspaceId: this.workspace.id,
			});
			await executor(this.createRunContext(abortController.signal));
		} catch (error) {
			runError = error;
			this.stateValue.errorMessage =
				error instanceof Error ? error.message : String(error);
			try {
				await this.emit({
					type: "agent_error",
					agentId: this.id,
					workspaceId: this.workspace.id,
					error: error instanceof Error ? error : new Error(String(error)),
				});
			} catch (listenerError) {
				runError = listenerError;
			}
		}

		try {
			await this.emit({
				type: "agent_end",
				agentId: this.id,
				workspaceId: this.workspace.id,
				messages: this.stateValue.messages,
			});
		} catch (error) {
			runError = error;
		} finally {
			this.stateValue.isStreaming = false;
			this.stateValue.streamingMessage = undefined;
			this.stateValue.pendingToolCalls = new Set<string>();
			this.activeRun = undefined;
			idlePromise.resolve();
		}

		if (runError) {
			throw runError;
		}
	}

	private createIdlePromise(): { promise: Promise<void>; resolve: () => void } {
		let resolvePromise: () => void = () => {};
		const promise = new Promise<void>((resolve) => {
			resolvePromise = resolve;
		});
		return { promise, resolve: resolvePromise };
	}

	private createRunContext(signal: AbortSignal): ThetaAgentRunContext {
		return {
			agentId: this.id,
			workspace: this.workspace,
			state: this.state,
			signal,
			emit: (event) => this.emit(event),
			appendMessage: (message) => {
				this.stateValue.messages.push(message);
			},
			drainSteeringMessages: () =>
				this.drainQueue(this.steeringQueue, this.steeringMode),
			drainFollowUpMessages: () =>
				this.drainQueue(this.followUpQueue, this.followUpMode),
		};
	}

	private async emit(event: ThetaAgentEvent): Promise<void> {
		this.reduceEvent(event);
		await this.emitter.emit(event, this.activeRun?.abortController.signal);
	}

	private reduceEvent(event: ThetaAgentEvent): void {
		switch (event.type) {
			case "message_start":
			case "message_update":
				this.stateValue.streamingMessage = event.message;
				break;
			case "message_end":
				this.stateValue.streamingMessage = undefined;
				break;
			case "tool_execution_start":
				this.stateValue.pendingToolCalls.add(event.toolCallId);
				break;
			case "tool_execution_end":
				this.stateValue.pendingToolCalls.delete(event.toolCallId);
				break;
			case "turn_end":
				if (event.message.role === "assistant" && event.message.errorMessage) {
					this.stateValue.errorMessage = event.message.errorMessage;
				}
				break;
			case "agent_error":
				this.stateValue.errorMessage = event.error.message;
				break;
			default:
				break;
		}
	}

	private assertUsable(): void {
		if (this.disposed) {
			throw new Error("Theta agent has been disposed.");
		}
	}
}
