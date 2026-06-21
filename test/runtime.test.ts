import { describe, expect, it } from "vitest";

import {
	createThetaAgent,
	createMemoryWorkspaceFs,
	createThetaWorkspace,
	THETA_PACKAGE_INFO,
	type ThetaAgentRuntimeAdapter,
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
});
