import {
	createAssistantMessageEventStream,
	type AssistantMessage,
	type Model,
	Type,
} from "@earendil-works/pi-ai/base";
import { describe, expect, it } from "vitest";

import {
	createMemoryWorkspaceFs,
	createThetaAgent,
	createThetaWorkspace,
	type ThetaAgentEvent,
	type ThetaToolDefinition,
} from "../src/index.ts";

const USAGE = {
	input: 1,
	output: 1,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 2,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function assistantMessage(
	content: AssistantMessage["content"],
	stopReason: AssistantMessage["stopReason"] = "stop",
): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "faux",
		provider: "faux",
		model: "faux-model",
		usage: USAGE,
		stopReason,
		timestamp: Date.now(),
	};
}

function createFauxStream(messages: readonly AssistantMessage[]) {
	let index = 0;
	return () => {
		const stream = createAssistantMessageEventStream();
		const message = messages[index] ?? assistantMessage([], "error");
		index += 1;
		queueMicrotask(() => {
			stream.push({ type: "start", partial: { ...message, content: [] } });
			for (
				let contentIndex = 0;
				contentIndex < message.content.length;
				contentIndex += 1
			) {
				const block = message.content[contentIndex];
				if (!block) {
					continue;
				}
				if (block.type === "text") {
					stream.push({
						type: "text_delta",
						contentIndex,
						delta: block.text,
						partial: message,
					});
				}
				if (block.type === "toolCall") {
					stream.push({
						type: "toolcall_delta",
						contentIndex,
						delta: JSON.stringify(block.arguments),
						partial: message,
					});
				}
			}
			if (message.stopReason === "error" || message.stopReason === "aborted") {
				stream.push({
					type: "error",
					reason: message.stopReason,
					error: message,
				});
			} else {
				stream.push({ type: "done", reason: message.stopReason, message });
			}
		});
		return stream;
	};
}

function createWorkspace() {
	return createThetaWorkspace({
		id: "workspace",
		fs: createMemoryWorkspaceFs(),
	});
}

function createModel() {
	return {
		provider: "faux",
		id: "faux-model",
		api: "faux",
		supports: { text: true, tools: true, thinking: true },
	};
}

describe("Theta agent runtime", () => {
	it("streams assistant messages through the agent runtime adapter", async () => {
		const events: ThetaAgentEvent[] = [];
		const agent = createThetaAgent({
			id: "agent",
			workspace: createWorkspace(),
			model: createModel(),
			thinkingLevel: "medium",
			runtimeOptions: {
				streamFn: createFauxStream([
					assistantMessage([{ type: "text", text: "done" }]),
				]),
			},
			events: (event) => {
				events.push(event);
			},
		});

		await agent.prompt("hello");

		expect(agent.state.messages.map((message) => message.role)).toEqual([
			"user",
			"assistant",
		]);
		expect(events.map((event) => event.type)).toContain("turn_start");
		expect(events.map((event) => event.type)).toContain("message_update");
		expect(agent.state.isStreaming).toBe(false);
	});

	it("executes Theta tools through agent tool calling", async () => {
		const echoTool: ThetaToolDefinition<{ readonly text: string }> = {
			name: "echo",
			label: "Echo",
			description: "Echo text.",
			parameters: Type.Object({ text: Type.String() }) as unknown as Readonly<
				Record<string, unknown>
			>,
			async execute(context) {
				context.update({
					content: [{ type: "text", text: `partial:${context.input.text}` }],
				});
				return {
					content: [{ type: "text", text: context.input.text }],
					details: { echoed: context.input.text },
				};
			},
		};
		const events: ThetaAgentEvent[] = [];
		const agent = createThetaAgent({
			id: "agent-tools",
			workspace: createWorkspace(),
			model: createModel(),
			tools: [echoTool],
			runtimeOptions: {
				streamFn: createFauxStream([
					assistantMessage(
						[
							{
								type: "toolCall",
								id: "tool-1",
								name: "echo",
								arguments: { text: "hello" },
							},
						],
						"toolUse",
					),
					assistantMessage([{ type: "text", text: "finished" }]),
				]),
			},
			events: (event) => {
				events.push(event);
			},
		});

		await agent.prompt("run echo");

		expect(agent.state.messages.map((message) => message.role)).toEqual([
			"user",
			"assistant",
			"toolResult",
			"assistant",
		]);
		expect(events.some((event) => event.type === "tool_execution_update")).toBe(
			true,
		);
		const toolEnd = events.find((event) => event.type === "tool_execution_end");
		expect(toolEnd).toMatchObject({
			type: "tool_execution_end",
			toolCallId: "tool-1",
			toolName: "echo",
			isError: false,
		});
	});

	it("drains follow-up messages through the agent loop", async () => {
		let callCount = 0;
		const agent = createThetaAgent({
			id: "agent-follow-up",
			workspace: createWorkspace(),
			model: createModel(),
			runtimeOptions: {
				streamFn: (model: Model<string>) => {
					callCount += 1;
					return createFauxStream([
						assistantMessage([{ type: "text", text: model.id }]),
					])();
				},
			},
		});

		agent.followUp("next");
		await agent.prompt("first");

		expect(callCount).toBe(2);
		expect(agent.state.messages.map((message) => message.role)).toEqual([
			"user",
			"assistant",
			"user",
			"assistant",
		]);
	});

	it("propagates aborts into the runtime stream function", async () => {
		let capturedSignal: AbortSignal | undefined;
		const agent = createThetaAgent({
			id: "agent-abort",
			workspace: createWorkspace(),
			model: createModel(),
			runtimeOptions: {
				streamFn: (_model, _context, options) => {
					capturedSignal = options?.signal;
					const stream = createAssistantMessageEventStream();
					queueMicrotask(() => {
						const message = assistantMessage([], "aborted");
						stream.push({ type: "error", reason: "aborted", error: message });
					});
					return stream;
				},
			},
		});

		const run = agent.prompt("stop");
		agent.abort();
		await run;

		expect(capturedSignal?.aborted).toBe(true);
	});
});
