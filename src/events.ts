import type { FsEvent } from "./filesystem.ts";
import type { JsonObject } from "./json.ts";
import type {
	ThetaAssistantMessage,
	ThetaMessage,
	ThetaToolResultMessage,
} from "./messages.ts";
import type { ThetaSessionCompactionEntry } from "./sessions/index.ts";
import type { ThetaToolResult } from "./tools.ts";

export interface ThetaWorkspaceSnapshot {
	readonly id: string;
	readonly name: string;
}

export type ThetaSyncStatus =
	| "disabled"
	| "connecting"
	| "connected"
	| "offline"
	| "error";

export type ThetaWorkspaceEvent =
	| {
			readonly type: "workspace_created";
			readonly workspace: ThetaWorkspaceSnapshot;
	  }
	| { readonly type: "workspace_disposed"; readonly workspaceId: string }
	| {
			readonly type: "fs_event";
			readonly workspaceId: string;
			readonly event: FsEvent;
	  }
	| {
			readonly type: "sync_status";
			readonly workspaceId: string;
			readonly status: ThetaSyncStatus;
			readonly message?: string;
	  };

export type ThetaAssistantStreamEvent =
	| { readonly type: "start" }
	| {
			readonly type: "text_delta";
			readonly contentIndex: number;
			readonly delta: string;
	  }
	| {
			readonly type: "thinking_delta";
			readonly contentIndex: number;
			readonly delta: string;
	  }
	| {
			readonly type: "toolcall_delta";
			readonly contentIndex: number;
			readonly delta: string;
	  }
	| {
			readonly type: "done";
			readonly reason: ThetaAssistantMessage["stopReason"];
	  }
	| {
			readonly type: "error";
			readonly reason: Extract<
				ThetaAssistantMessage["stopReason"],
				"error" | "aborted"
			>;
	  };

export type ThetaAgentEvent =
	| {
			readonly type: "agent_start";
			readonly agentId: string;
			readonly workspaceId: string;
	  }
	| {
			readonly type: "agent_end";
			readonly agentId: string;
			readonly workspaceId: string;
			readonly messages: readonly ThetaMessage[];
	  }
	| {
			readonly type: "turn_start";
			readonly agentId: string;
			readonly workspaceId: string;
	  }
	| {
			readonly type: "turn_end";
			readonly agentId: string;
			readonly workspaceId: string;
			readonly message: ThetaMessage;
			readonly toolResults: readonly ThetaToolResultMessage[];
	  }
	| {
			readonly type: "message_start";
			readonly agentId: string;
			readonly workspaceId: string;
			readonly message: ThetaMessage;
	  }
	| {
			readonly type: "message_update";
			readonly agentId: string;
			readonly workspaceId: string;
			readonly message: ThetaMessage;
			readonly assistantMessageEvent: ThetaAssistantStreamEvent;
	  }
	| {
			readonly type: "message_end";
			readonly agentId: string;
			readonly workspaceId: string;
			readonly message: ThetaMessage;
	  }
	| {
			readonly type: "tool_execution_start";
			readonly agentId: string;
			readonly workspaceId: string;
			readonly toolCallId: string;
			readonly toolName: string;
			readonly input: JsonObject;
	  }
	| {
			readonly type: "tool_execution_update";
			readonly agentId: string;
			readonly workspaceId: string;
			readonly toolCallId: string;
			readonly toolName: string;
			readonly input: JsonObject;
			readonly partialResult: ThetaToolResult;
	  }
	| {
			readonly type: "tool_execution_end";
			readonly agentId: string;
			readonly workspaceId: string;
			readonly toolCallId: string;
			readonly toolName: string;
			readonly result: ThetaToolResult;
			readonly isError: boolean;
	  }
	| {
			readonly type: "agent_error";
			readonly agentId: string;
			readonly workspaceId: string;
			readonly error: Error;
	  }
	| {
			readonly type: "compaction_start";
			readonly agentId: string;
			readonly workspaceId: string;
			readonly sessionId: string;
			readonly tokens: number;
	  }
	| {
			readonly type: "compaction_end";
			readonly agentId: string;
			readonly workspaceId: string;
			readonly sessionId: string;
			readonly entry: ThetaSessionCompactionEntry;
	  };

export type ThetaEvent = ThetaWorkspaceEvent | ThetaAgentEvent;

export type ThetaEventListener<TEvent extends ThetaEvent = ThetaEvent> = (
	event: TEvent,
	signal?: AbortSignal,
) => void | Promise<void>;
