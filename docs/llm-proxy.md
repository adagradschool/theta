# LLM Proxy

Theta keeps provider credentials off the browser by routing model calls through an app-owned HTTP endpoint.

Browser code passes the endpoint and whatever request headers the app wants:

```ts
const agent = createThetaAgent({
	workspace,
	model: { provider: "openai", id: "gpt-4.1-nano", api: "openai-responses" },
	proxy: {
		url: "/api/theta/llm",
		headers: {
			Authorization: `Bearer ${appToken}`,
			"X-Workspace-Id": workspace.id,
		},
	},
});
```

Theta does not prescribe auth. `proxy.headers` are sent as HTTP headers to the app backend, so hosts can use sessions, bearer tokens, signed headers, tenant ids, CSRF tokens, or any other existing auth scheme.

## Direct Client Keys

For bring-your-own-key apps, omit `proxy` and pass the user's provider env values through runtime options:

```ts
const agent = createThetaAgent({
	workspace,
	model: { provider: "openai", id: "gpt-4.1-nano", api: "openai-responses" },
	runtimeOptions: {
		providerEnv: {
			OPENAI_API_KEY: userStoredOpenAiKey,
		},
	},
});
```

The host app owns storage and provider selection. For example, it can read `userStoredOpenAiKey` from `localStorage`, OPFS-backed settings, or another client-side store before creating the agent.

Direct mode is only for user-owned credentials. Browser JavaScript can read these values, so app-owned or shared provider credentials should use the proxy path instead.

## Request

The browser sends:

```ts
interface ThetaProxyRequest {
	model: Model<string>;
	context: Context;
	options?: ThetaProxySerializableOptions;
}
```

`options.headers`, when present, are provider headers forwarded by the server helper to the model provider. They are separate from `proxy.headers`, which authenticate or route the browser-to-backend request.

## Response

The server returns `text/event-stream` where each event is a JSON line:

```text
data: {"type":"text_delta","contentIndex":0,"delta":"hello"}
```

`streamThetaProxy()` reconstructs provider-style assistant stream events client-side, including text, thinking, tool calls, done, and error events.

## Server Helper

`handleThetaLlmProxyRequest(request, options)` is a minimal helper exported from `@earendil-works/theta/server`. It accepts a standard `Request`, optionally calls `hooks.authenticate(request)`, streams provider output, and propagates request aborts through `request.signal`.
