import type { JsonObject, JsonValue } from "./json.ts";

export interface ThetaTextContent {
	readonly type: "text";
	readonly text: string;
}

export interface ThetaImageContent {
	readonly type: "image";
	readonly data: string;
	readonly mimeType: string;
	readonly alt?: string;
}

export interface ThetaThinkingContent {
	readonly type: "thinking";
	readonly thinking: string;
	readonly redacted?: boolean;
}

export interface ThetaToolCallContent {
	readonly type: "toolCall";
	readonly id: string;
	readonly name: string;
	readonly arguments: JsonObject;
}

export type ThetaUserContent =
	| string
	| readonly (ThetaTextContent | ThetaImageContent)[];
export type ThetaAssistantContent = readonly (
	| ThetaTextContent
	| ThetaThinkingContent
	| ThetaToolCallContent
)[];
export type ThetaToolResultContent = readonly (
	| ThetaTextContent
	| ThetaImageContent
)[];

export interface ThetaUserMessage {
	readonly role: "user";
	readonly content: ThetaUserContent;
	readonly timestamp: number;
}

export type ThetaStopReason =
	| "stop"
	| "length"
	| "toolUse"
	| "error"
	| "aborted";

export interface ThetaUsage {
	readonly input: number;
	readonly output: number;
	readonly cacheRead: number;
	readonly cacheWrite: number;
	readonly totalTokens: number;
	readonly cost?: {
		readonly input: number;
		readonly output: number;
		readonly cacheRead: number;
		readonly cacheWrite: number;
		readonly total: number;
	};
}

export interface ThetaAssistantMessage {
	readonly role: "assistant";
	readonly content: ThetaAssistantContent;
	readonly provider: string;
	readonly model: string;
	readonly api?: string;
	readonly usage?: ThetaUsage;
	readonly stopReason: ThetaStopReason;
	readonly errorMessage?: string;
	readonly timestamp: number;
}

export interface ThetaToolResultMessage<TDetails = unknown> {
	readonly role: "toolResult";
	readonly toolCallId: string;
	readonly toolName: string;
	readonly content: ThetaToolResultContent;
	readonly details?: TDetails;
	readonly isError: boolean;
	readonly timestamp: number;
}

// biome-ignore lint/suspicious/noEmptyInterface: Apps extend this interface with declaration merging.
export interface ThetaCustomMessages {
	// Apps extend this interface with declaration merging.
}

export type ThetaBaseMessage =
	| ThetaUserMessage
	| ThetaAssistantMessage
	| ThetaToolResultMessage<JsonValue | unknown>;

export type ThetaCustomMessage = ThetaCustomMessages[keyof ThetaCustomMessages];

export type ThetaMessage = ThetaBaseMessage | ThetaCustomMessage;

export type ThetaPromptInput =
	| string
	| ThetaUserMessage
	| readonly ThetaMessage[];
