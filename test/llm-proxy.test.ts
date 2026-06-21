import {
	fauxAssistantMessage,
	registerFauxProvider,
	type AssistantMessage,
	type Model,
} from "@earendil-works/pi-ai/base";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createMemoryWorkspaceFs,
	createThetaAgent,
	createThetaWorkspace,
	encodeThetaProxyEvent,
	reconstructThetaProxyEvent,
	streamThetaProxy,
	type ThetaProxyStreamEvent,
} from "../src/index.ts";
import { handleThetaLlmProxyRequest } from "../src/server.ts";

const USAGE = {
	input: 1,
	output: 1,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 2,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const MODEL = {
	id: "faux-model",
	name: "Faux",
	api: "faux",
	provider: "faux",
	baseUrl: "",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 1000,
	maxTokens: 100,
} satisfies Model<string>;

afterEach(() => {
	vi.restoreAllMocks();
});

describe("Theta LLM proxy contract", () => {
	it("reconstructs text and tool-call streaming events", async () => {
		const partial = createPartial();
		const events: ThetaProxyStreamEvent[] = [
			{ type: "start" },
			{ type: "text_start", contentIndex: 0 },
			{ type: "text_delta", contentIndex: 0, delta: "he" },
			{ type: "text_delta", contentIndex: 0, delta: "llo" },
			{ type: "text_end", contentIndex: 0 },
			{
				type: "toolcall_start",
				contentIndex: 1,
				id: "tool-1",
				toolName: "echo",
			},
			{ type: "toolcall_delta", contentIndex: 1, delta: '{"text"' },
			{ type: "toolcall_delta", contentIndex: 1, delta: ':"ok"}' },
			{ type: "toolcall_end", contentIndex: 1 },
			{ type: "done", reason: "toolUse", usage: USAGE },
		];

		const reconstructed = events
			.map((event) => reconstructThetaProxyEvent(event, partial))
			.filter((event) => event !== undefined);

		expect(reconstructed.at(-1)).toMatchObject({
			type: "done",
			reason: "toolUse",
		});
		expect(partial.content).toEqual([
			{ type: "text", text: "hello" },
			{
				type: "toolCall",
				id: "tool-1",
				name: "echo",
				arguments: { text: "ok" },
			},
		]);
	});

	it("sends caller-supplied headers to the proxy request", async () => {
		let capturedRequest: Request | undefined;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				capturedRequest = new Request(input, init);
				return new Response(
					encodeThetaProxyEvent({ type: "start" }) +
						encodeThetaProxyEvent({ type: "text_start", contentIndex: 0 }) +
						encodeThetaProxyEvent({
							type: "text_delta",
							contentIndex: 0,
							delta: "ok",
						}) +
						encodeThetaProxyEvent({ type: "text_end", contentIndex: 0 }) +
						encodeThetaProxyEvent({
							type: "done",
							reason: "stop",
							usage: USAGE,
						}),
					{ status: 200 },
				);
			}),
		);

		const stream = streamThetaProxy(
			MODEL,
			{ messages: [{ role: "user", content: "hi", timestamp: 1 }] },
			{
				proxy: {
					url: "https://proxy.example.test/theta",
					headers: {
						Authorization: "Bearer app-token",
						"X-Workspace-Id": "workspace-1",
					},
				},
				headers: { "X-Provider-Trace": "trace-1" },
			},
		);
		const final = await stream.result();

		expect(final.content).toEqual([{ type: "text", text: "ok" }]);
		expect(capturedRequest?.headers.get("authorization")).toBe(
			"Bearer app-token",
		);
		expect(capturedRequest?.headers.get("x-workspace-id")).toBe("workspace-1");
		const body = (await capturedRequest?.json()) as { options: unknown };
		expect(body.options).toMatchObject({
			headers: { "X-Provider-Trace": "trace-1" },
		});
	});

	it("uses the proxy from createThetaAgent", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(
						encodeThetaProxyEvent({ type: "start" }) +
							encodeThetaProxyEvent({ type: "text_start", contentIndex: 0 }) +
							encodeThetaProxyEvent({
								type: "text_delta",
								contentIndex: 0,
								delta: "proxied",
							}) +
							encodeThetaProxyEvent({ type: "text_end", contentIndex: 0 }) +
							encodeThetaProxyEvent({
								type: "done",
								reason: "stop",
								usage: USAGE,
							}),
						{ status: 200 },
					),
			),
		);
		const workspace = createThetaWorkspace({
			id: "proxy-workspace",
			fs: createMemoryWorkspaceFs(),
		});
		const agent = createThetaAgent({
			workspace,
			model: { provider: "faux", id: "faux-model", api: "faux" },
			proxy: {
				url: "https://proxy.example.test/theta",
				headers: { "X-App-Auth": "secret" },
			},
		});

		await agent.prompt("hi");

		const assistant = [...agent.state.messages]
			.reverse()
			.find((message) => message.role === "assistant");
		expect(assistant?.content).toEqual([{ type: "text", text: "proxied" }]);
		expect(fetch).toHaveBeenCalledOnce();
	});

	it("streams provider output from the server helper", async () => {
		const registration = registerFauxProvider();
		registration.setResponses([fauxAssistantMessage("server ok")]);
		try {
			const response = await handleThetaLlmProxyRequest(
				new Request("https://proxy.example.test/theta", {
					method: "POST",
					body: JSON.stringify({
						model: registration.getModel(),
						context: {
							messages: [{ role: "user", content: "hi", timestamp: 1 }],
						},
					}),
				}),
				{
					hooks: {
						authenticate(request) {
							return request.headers.get("authorization") === "Bearer ok"
								? { subjectId: "user-1" }
								: undefined;
						},
					},
				},
			);

			expect(response.status).toBe(401);
		} finally {
			registration.unregister();
		}
	});

	it("allows host auth and streams when the host accepts headers", async () => {
		const registration = registerFauxProvider();
		registration.setResponses([fauxAssistantMessage("server ok")]);
		try {
			const response = await handleThetaLlmProxyRequest(
				new Request("https://proxy.example.test/theta", {
					method: "POST",
					headers: { Authorization: "Bearer ok" },
					body: JSON.stringify({
						model: registration.getModel(),
						context: {
							messages: [{ role: "user", content: "hi", timestamp: 1 }],
						},
					}),
				}),
				{
					hooks: {
						authenticate(request) {
							return request.headers.get("authorization") === "Bearer ok"
								? { subjectId: "user-1" }
								: undefined;
						},
					},
				},
			);

			expect(response.status).toBe(200);
			const text = await response.text();
			expect(text).toContain("server ok");
			expect(text).toContain('"type":"done"');
		} finally {
			registration.unregister();
		}
	});

	it("passes provider env bindings to the server-side stream", async () => {
		let seenApiKey: string | undefined;
		const registration = registerFauxProvider();
		registration.setResponses([
			(_context, options) => {
				seenApiKey = options?.env?.OPENAI_API_KEY;
				return fauxAssistantMessage("env ok");
			},
		]);
		try {
			const response = await handleThetaLlmProxyRequest(
				new Request("https://proxy.example.test/theta", {
					method: "POST",
					body: JSON.stringify({
						model: registration.getModel(),
						context: {
							messages: [{ role: "user", content: "hi", timestamp: 1 }],
						},
					}),
				}),
				{ providerEnv: { OPENAI_API_KEY: "worker-secret" } },
			);

			expect(response.status).toBe(200);
			expect(await response.text()).toContain("env ok");
			expect(seenApiKey).toBe("worker-secret");
		} finally {
			registration.unregister();
		}
	});
});

function createPartial(): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "faux",
		provider: "faux",
		model: "faux-model",
		usage: USAGE,
		stopReason: "stop",
		timestamp: 1,
	};
}
