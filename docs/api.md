# Public API

Theta's public API is a headless browser runtime contract. Apps provide a `WorkspaceFs` adapter and a thin LLM proxy; Theta provides the agent/workspace interface that UI code can subscribe to.

## Browser Entrypoint

```ts
import {
	createThetaAgent,
	createThetaWorkspace,
	type WorkspaceFs,
} from "@adagradschool/theta/browser";

const fs: WorkspaceFs = createAppWorkspaceFs();

const workspace = createThetaWorkspace({
	id: "project-1",
	name: "Project 1",
	fs,
});

const agent = createThetaAgent({
	workspace,
	systemPrompt: "You are a careful coding agent. Modify files through tools.",
	model: { provider: "anthropic", id: "claude-sonnet-4-6" },
	proxy: { url: "/api/theta/stream" },
});

agent.subscribe((event) => {
	if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
		renderAssistantDelta(event.assistantMessageEvent.delta);
	}
});

await agent.prompt("Add a README section for local development.");
```

`createThetaWorkspace` is the file boundary. The agent, editor, file tree, browser tools, and shell layer should all use the same `WorkspaceFs`.

`createThetaAgent` is the lifecycle boundary. It exposes event flow, message state, steering/follow-up queues, aborts, and model/thinking controls while keeping the browser app decoupled from runtime internals.

## Stable Event Flow

UI consumers should switch on `event.type`.

- `agent_start`
- `turn_start`
- `message_start`
- `message_update`
- `message_end`
- `tool_execution_start`
- `tool_execution_update`
- `tool_execution_end`
- `turn_end`
- `agent_end`
- `agent_error`

Theta adds `agentId` and `workspaceId` to each agent event to make multi-workspace UI state straightforward.

## Runtime Adapter Boundary

The default runtime is installed behind `createThetaAgent`. Advanced tests and host apps can still pass a `runtime` adapter directly:

```ts
const agent = createThetaAgent({
	workspace,
	runtime: {
		async prompt(messages, context) {
			for (const message of messages) {
				context.appendMessage(message);
				await context.emit({ type: "message_start", agentId: context.agentId, workspaceId: context.workspace.id, message });
				await context.emit({ type: "message_end", agentId: context.agentId, workspaceId: context.workspace.id, message });
			}
		},
		async continue() {},
	},
});
```

Runtime adapters must execute tools through `WorkspaceFs`, route LLM calls through the configured proxy, and emit Theta events in the stable event sequence.

## Server Entrypoint

Server helpers are exported from `@adagradschool/theta/server`. Server code is responsible for authenticating app users and proxying model streams without exposing provider credentials to the browser.
