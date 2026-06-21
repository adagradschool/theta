import { describe, expect, it } from "vitest";
import {
	convertThetaMessagesToLlm,
	THETA_BRANCH_SUMMARY_PREFIX,
	THETA_BRANCH_SUMMARY_SUFFIX,
	THETA_COMPACTION_SUMMARY_PREFIX,
	THETA_COMPACTION_SUMMARY_SUFFIX,
	thetaBashExecutionToText,
	type ThetaMessage,
} from "../src/index.ts";

describe("Theta message serialization", () => {
	it("round-trips built-in Theta message variants through JSON", () => {
		const messages: ThetaMessage[] = [
			{
				role: "user",
				content: [
					{ type: "text", text: "hello" },
					{ type: "image", data: "base64", mimeType: "image/png", alt: "demo" },
				],
				timestamp: 1,
			},
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "plan", thinkingSignature: "sig" },
					{
						type: "toolCall",
						id: "call-1",
						name: "read",
						arguments: { path: "README.md" },
					},
				],
				api: "faux",
				provider: "faux",
				model: "faux-model",
				responseId: "response-1",
				stopReason: "toolUse",
				timestamp: 2,
			},
			{
				role: "toolResult",
				toolCallId: "call-1",
				toolName: "read",
				content: [{ type: "text", text: "file contents" }],
				details: { path: "README.md" },
				isError: false,
				timestamp: 3,
			},
			{
				role: "bashExecution",
				command: "npm test",
				output: "ok",
				exitCode: 0,
				cancelled: false,
				truncated: false,
				timestamp: 4,
			},
			{
				role: "custom",
				customType: "notice",
				content: "Heads up",
				display: true,
				details: { level: "info" },
				timestamp: 5,
			},
			{
				role: "compactionSummary",
				summary: "Earlier work.",
				tokensBefore: 123,
				timestamp: 6,
			},
			{
				role: "branchSummary",
				summary: "Branch work.",
				fromId: "branch-1",
				details: { merged: true },
				timestamp: 7,
			},
		];

		expect(JSON.parse(JSON.stringify(messages))).toEqual(messages);
	});
});

describe("Theta LLM message conversion", () => {
	it("passes core LLM message roles through with provider-compatible shape", () => {
		const llmMessages = convertThetaMessagesToLlm([
			{ role: "user", content: "hello", timestamp: 1 },
			{
				role: "assistant",
				content: [{ type: "text", text: "hi" }],
				provider: "faux",
				model: "faux-model",
				stopReason: "stop",
				timestamp: 2,
			},
			{
				role: "toolResult",
				toolCallId: "call-1",
				toolName: "read",
				content: [{ type: "text", text: "ok" }],
				isError: false,
				timestamp: 3,
			},
		]);

		expect(llmMessages.map((message) => message.role)).toEqual([
			"user",
			"assistant",
			"toolResult",
		]);
		expect(llmMessages[1]).toMatchObject({
			role: "assistant",
			api: "faux",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
			},
		});
	});

	it("converts bash execution messages into user-visible command output", () => {
		const message: ThetaMessage = {
			role: "bashExecution",
			command: "npm test",
			output: "failed",
			exitCode: 1,
			cancelled: false,
			truncated: true,
			fullOutputPath: "/tmp/theta.log",
			timestamp: 4,
		};

		expect(thetaBashExecutionToText(message)).toContain("Ran `npm test`");
		expect(convertThetaMessagesToLlm([message])).toEqual([
			{
				role: "user",
				content: [{ type: "text", text: thetaBashExecutionToText(message) }],
				timestamp: 4,
			},
		]);
	});

	it("omits bash execution messages excluded from context", () => {
		const llmMessages = convertThetaMessagesToLlm([
			{
				role: "bashExecution",
				command: "cat secret.txt",
				output: "secret",
				exitCode: 0,
				cancelled: false,
				truncated: false,
				excludeFromContext: true,
				timestamp: 5,
			},
		]);

		expect(llmMessages).toEqual([]);
	});

	it("converts custom and summary messages into synthetic user messages", () => {
		const llmMessages = convertThetaMessagesToLlm([
			{
				role: "custom",
				customType: "todo",
				content: [{ type: "text", text: "remember tests" }],
				display: true,
				timestamp: 6,
			},
			{
				role: "compactionSummary",
				summary: "Older context.",
				tokensBefore: 100,
				timestamp: 7,
			},
			{
				role: "branchSummary",
				summary: "Returned branch.",
				fromId: "branch-a",
				timestamp: 8,
			},
		]);

		expect(llmMessages).toEqual([
			{
				role: "user",
				content: [{ type: "text", text: "remember tests" }],
				timestamp: 6,
			},
			{
				role: "user",
				content: [
					{
						type: "text",
						text:
							THETA_COMPACTION_SUMMARY_PREFIX +
							"Older context." +
							THETA_COMPACTION_SUMMARY_SUFFIX,
					},
				],
				timestamp: 7,
			},
			{
				role: "user",
				content: [
					{
						type: "text",
						text:
							THETA_BRANCH_SUMMARY_PREFIX +
							"Returned branch." +
							THETA_BRANCH_SUMMARY_SUFFIX,
					},
				],
				timestamp: 8,
			},
		]);
	});
});
