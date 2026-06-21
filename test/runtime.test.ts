import { describe, expect, it } from "vitest";

import {
	createThetaAgent,
	createMemoryWorkspaceFs,
	createThetaSessionManager,
	createThetaWorkspace,
	createMemoryThetaSessionStore,
	THETA_PACKAGE_INFO,
	type ThetaAgentRuntimeAdapter,
	type ThetaAgentEvent,
	type ThetaMessage,
} from "../src/index.ts";

describe("Theta package metadata", () => {
	it("declares browser-only runtime requirements", () => {
		expect(THETA_PACKAGE_INFO.browserOnly).toBe(true);
		expect(THETA_PACKAGE_INFO.serverProxyRequired).toBe(true);
		expect(THETA_PACKAGE_INFO.runtimeTargets).toContain("chrome-latest");
	});
});

describe("Theta public API", () => {
	it("creates a workspace and agent with stable identifiers", () => {
		const workspace = createThetaWorkspace({
			id: "workspace-1",
			name: "Workspace 1",
			fs: createMemoryWorkspaceFs(),
		});
		const agent = createThetaAgent({
			id: "agent-1",
			workspace,
			systemPrompt: "Use files.",
			model: { provider: "faux", id: "faux-model" },
		});

		expect(workspace.id).toBe("workspace-1");
		expect(agent.id).toBe("agent-1");
		expect(agent.workspace).toBe(workspace);
		expect(agent.state.systemPrompt).toBe("Use files.");
		expect(agent.state.model?.id).toBe("faux-model");
	});

	it("routes prompt input through the runtime adapter and emits lifecycle events", async () => {
		const workspace = createThetaWorkspace({
			id: "workspace-2",
			fs: createMemoryWorkspaceFs(),
		});
		const seenEvents: string[] = [];
		const runtime: ThetaAgentRuntimeAdapter = {
			async prompt(messages, context) {
				for (const message of messages) {
					context.appendMessage(message);
					await context.emit({
						type: "message_start",
						agentId: context.agentId,
						workspaceId: context.workspace.id,
						message,
					});
					await context.emit({
						type: "message_end",
						agentId: context.agentId,
						workspaceId: context.workspace.id,
						message,
					});
				}
				const assistantMessage: ThetaMessage = {
					role: "assistant",
					content: [{ type: "text", text: "done" }],
					provider: "faux",
					model: "faux-model",
					stopReason: "stop",
					timestamp: Date.now(),
				};
				context.appendMessage(assistantMessage);
				await context.emit({
					type: "message_start",
					agentId: context.agentId,
					workspaceId: context.workspace.id,
					message: assistantMessage,
				});
				await context.emit({
					type: "message_update",
					agentId: context.agentId,
					workspaceId: context.workspace.id,
					message: assistantMessage,
					assistantMessageEvent: {
						type: "text_delta",
						contentIndex: 0,
						delta: "done",
					},
				});
				await context.emit({
					type: "message_end",
					agentId: context.agentId,
					workspaceId: context.workspace.id,
					message: assistantMessage,
				});
			},
			async continue() {},
		};
		const agent = createThetaAgent({ id: "agent-2", workspace, runtime });
		agent.subscribe((event) => {
			seenEvents.push(event.type);
		});

		await agent.prompt("hello");

		expect(seenEvents).toEqual([
			"agent_start",
			"message_start",
			"message_end",
			"message_start",
			"message_update",
			"message_end",
			"agent_end",
		]);
		expect(agent.state.messages).toHaveLength(2);
		expect(agent.state.isStreaming).toBe(false);
	});

	it("fails clearly when the default runtime has no active model", async () => {
		const workspace = createThetaWorkspace({
			id: "workspace-3",
			fs: createMemoryWorkspaceFs(),
		});
		const agent = createThetaAgent({ workspace });

		await expect(agent.prompt("hello")).rejects.toThrow(
			"Theta agent runtime requires an active model.",
		);
	});

	it("persists session messages and automatically compacts after a run", async () => {
		let assistantIndex = 0;
		const runtime: ThetaAgentRuntimeAdapter = {
			async prompt(messages, context) {
				for (const message of messages) {
					context.appendMessage(message);
				}
				assistantIndex += 1;
				context.appendMessage({
					role: "assistant",
					content: [{ type: "text", text: `assistant ${assistantIndex}` }],
					provider: "faux",
					model: "faux-model",
					usage: {
						input: 100,
						output: 20,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 120,
						cost: {
							input: 0,
							output: 0,
							cacheRead: 0,
							cacheWrite: 0,
							total: 0,
						},
					},
					stopReason: "stop",
					timestamp: Date.now(),
				});
			},
			async continue() {},
		};
		const manager = createThetaSessionManager({
			store: createMemoryThetaSessionStore(),
			createId: fixedIds(
				"root",
				"entry-1",
				"entry-2",
				"entry-3",
				"entry-4",
				"entry-5",
			),
		});
		const session = await manager.createSession({ id: "session-a" });
		const events: ThetaAgentEvent[] = [];
		const agent = createThetaAgent({
			id: "agent-compact",
			workspace: createThetaWorkspace({
				id: "workspace-compact",
				fs: createMemoryWorkspaceFs(),
			}),
			model: { provider: "faux", id: "faux-model", contextWindow: 50 },
			runtime,
			session: { manager, sessionId: session.session.id },
			compaction: {
				settings: { enabled: true, reserveTokens: 0, keepRecentTokens: 2 },
				complete: async ({ messages }) => `summary:${messages.length}`,
			},
			events: (event) => {
				events.push(event);
			},
		});

		await agent.prompt("first");
		await agent.prompt("second");

		const restored = await manager.restore(session.session.id);
		expect(events.map((event) => event.type)).toContain("compaction_start");
		expect(events.map((event) => event.type)).toContain("compaction_end");
		expect(restored?.messages.map((message) => message.role)).toEqual([
			"compactionSummary",
			"user",
			"assistant",
		]);
		expect(agent.state.messages).toEqual(restored?.messages);
		expect(restored?.messages[0]).toMatchObject({
			role: "compactionSummary",
			summary: "summary:2",
		});
	});
});

function fixedIds(...ids: readonly string[]): () => string {
	let index = 0;
	return () => {
		const id = ids[index];
		index += 1;
		if (!id) {
			throw new Error("Ran out of fixed ids.");
		}
		return id;
	};
}
