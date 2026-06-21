import type {
	ImageContent,
	Message,
	TextContent,
} from "@earendil-works/pi-ai/base";
import type { JsonObject, JsonValue } from "./json.ts";

export const THETA_COMPACTION_SUMMARY_PREFIX = `The conversation history before this point was compacted into the following summary:

<summary>
`;

export const THETA_COMPACTION_SUMMARY_SUFFIX = `
</summary>`;

export const THETA_BRANCH_SUMMARY_PREFIX = `The following is a summary of a branch that this conversation came back from:

<summary>
`;

export const THETA_BRANCH_SUMMARY_SUFFIX = `</summary>`;

export interface ThetaTextContent {
	readonly type: "text";
	readonly text: string;
	readonly textSignature?: string;
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
	readonly thinkingSignature?: string;
	readonly redacted?: boolean;
}

export interface ThetaToolCallContent {
	readonly type: "toolCall";
	readonly id: string;
	readonly name: string;
	readonly arguments: JsonObject;
	readonly thoughtSignature?: string;
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
	readonly api?: string;
	readonly provider: string;
	readonly model: string;
	readonly responseModel?: string;
	readonly responseId?: string;
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

export interface ThetaBashExecutionMessage {
	readonly role: "bashExecution";
	readonly command: string;
	readonly output: string;
	readonly exitCode?: number;
	readonly cancelled: boolean;
	readonly truncated: boolean;
	readonly fullOutputPath?: string;
	readonly excludeFromContext?: boolean;
	readonly timestamp: number;
}

export interface ThetaCustomMessage<TDetails = unknown> {
	readonly role: "custom";
	readonly customType: string;
	readonly content: string | readonly (ThetaTextContent | ThetaImageContent)[];
	readonly display: boolean;
	readonly details?: TDetails;
	readonly timestamp: number;
}

export interface ThetaCompactionSummaryMessage {
	readonly role: "compactionSummary";
	readonly summary: string;
	readonly tokensBefore: number;
	readonly timestamp: number;
}

export interface ThetaBranchSummaryMessage<TDetails = unknown> {
	readonly role: "branchSummary";
	readonly summary: string;
	readonly fromId: string;
	readonly details?: TDetails;
	readonly timestamp: number;
}

// biome-ignore lint/suspicious/noEmptyInterface: Apps extend this interface with declaration merging.
export interface ThetaCustomMessages {
	// Apps extend this interface with declaration merging.
}

export type ThetaBaseMessage =
	| ThetaUserMessage
	| ThetaAssistantMessage
	| ThetaToolResultMessage<JsonValue | unknown>
	| ThetaBashExecutionMessage
	| ThetaCustomMessage
	| ThetaCompactionSummaryMessage
	| ThetaBranchSummaryMessage;

export type ThetaAppMessage = ThetaCustomMessages[keyof ThetaCustomMessages];

export type ThetaMessage = ThetaBaseMessage | ThetaAppMessage;

export type ThetaPromptInput =
	| string
	| ThetaUserMessage
	| readonly ThetaMessage[];

export function thetaBashExecutionToText(
	message: ThetaBashExecutionMessage,
): string {
	let text = `Ran \`${message.command}\`\n`;
	if (message.output) {
		text += `\`\`\`\n${message.output}\n\`\`\``;
	} else {
		text += "(no output)";
	}
	if (message.cancelled) {
		text += "\n\n(command cancelled)";
	} else if (message.exitCode !== undefined && message.exitCode !== 0) {
		text += `\n\nCommand exited with code ${message.exitCode}`;
	}
	if (message.truncated && message.fullOutputPath) {
		text += `\n\n[Output truncated. Full output: ${message.fullOutputPath}]`;
	}
	return text;
}

export function convertThetaMessagesToLlm(
	messages: readonly ThetaMessage[],
): Message[] {
	return messages.flatMap(convertThetaMessageToLlm);
}

export function convertThetaMessageToLlm(message: ThetaMessage): Message[] {
	switch (message.role) {
		case "user":
			return [toLlmUserMessage(message)];
		case "assistant":
			return [toLlmAssistantMessage(message)];
		case "toolResult":
			return [message as Message];
		case "bashExecution":
			if (message.excludeFromContext) {
				return [];
			}
			return [
				{
					role: "user",
					content: [{ type: "text", text: thetaBashExecutionToText(message) }],
					timestamp: message.timestamp,
				},
			];
		case "custom":
			return [
				{
					role: "user",
					content: toLlmTextOrImageContent(message.content),
					timestamp: message.timestamp,
				},
			];
		case "compactionSummary":
			return [
				{
					role: "user",
					content: [
						{
							type: "text",
							text:
								THETA_COMPACTION_SUMMARY_PREFIX +
								message.summary +
								THETA_COMPACTION_SUMMARY_SUFFIX,
						},
					],
					timestamp: message.timestamp,
				},
			];
		case "branchSummary":
			return [
				{
					role: "user",
					content: [
						{
							type: "text",
							text:
								THETA_BRANCH_SUMMARY_PREFIX +
								message.summary +
								THETA_BRANCH_SUMMARY_SUFFIX,
						},
					],
					timestamp: message.timestamp,
				},
			];
		default:
			return [];
	}
}

function toLlmUserMessage(message: ThetaUserMessage): Message {
	return {
		role: "user",
		content:
			typeof message.content === "string"
				? message.content
				: message.content.map(toLlmContentBlock),
		timestamp: message.timestamp,
	};
}

function toLlmAssistantMessage(message: ThetaAssistantMessage): Message {
	return {
		role: "assistant",
		content: message.content.map((content) => {
			if (content.type === "toolCall") {
				return { ...content, arguments: { ...content.arguments } };
			}
			return content;
		}),
		api: message.api ?? message.provider,
		provider: message.provider,
		model: message.model,
		...(message.responseModel !== undefined
			? { responseModel: message.responseModel }
			: {}),
		...(message.responseId !== undefined
			? { responseId: message.responseId }
			: {}),
		usage: normalizeUsage(message.usage),
		stopReason: message.stopReason,
		...(message.errorMessage !== undefined
			? { errorMessage: message.errorMessage }
			: {}),
		timestamp: message.timestamp,
	};
}

function toLlmTextOrImageContent(
	content: string | readonly (ThetaTextContent | ThetaImageContent)[],
): string | (TextContent | ImageContent)[] {
	if (typeof content === "string") {
		return [{ type: "text", text: content }];
	}
	return content.map(toLlmContentBlock);
}

function toLlmContentBlock(
	content: ThetaTextContent | ThetaImageContent,
): TextContent | ImageContent {
	if (content.type === "text") {
		return {
			type: "text",
			text: content.text,
			...(content.textSignature !== undefined
				? { textSignature: content.textSignature }
				: {}),
		};
	}
	return {
		type: "image",
		data: content.data,
		mimeType: content.mimeType,
	};
}

function normalizeUsage(
	usage: ThetaUsage | undefined,
): NonNullable<ThetaUsage> & {
	readonly cost: NonNullable<ThetaUsage["cost"]>;
} {
	if (!usage) {
		return createEmptyUsage();
	}
	return {
		...usage,
		cost: usage.cost ?? {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			total: 0,
		},
	};
}

function createEmptyUsage(): NonNullable<ThetaUsage> & {
	readonly cost: NonNullable<ThetaUsage["cost"]>;
} {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}
