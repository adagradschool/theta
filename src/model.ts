export type ThetaThinkingLevel =
	| "off"
	| "minimal"
	| "low"
	| "medium"
	| "high"
	| "xhigh";

export type ThetaTransport = "sse" | "websocket" | "websocket-cached" | "auto";

export interface ThetaModelRef {
	readonly provider: string;
	readonly id: string;
	readonly api?: string;
	readonly name?: string;
	readonly contextWindow?: number;
	readonly maxOutputTokens?: number;
	readonly supports?: {
		readonly text?: boolean;
		readonly images?: boolean;
		readonly tools?: boolean;
		readonly thinking?: boolean;
	};
}

export interface ThetaLlmProxyConfig {
	readonly url: string | URL;
	readonly authToken?:
		| string
		| (() => string | undefined | Promise<string | undefined>);
	readonly headers?: Readonly<Record<string, string>>;
	readonly transport?: ThetaTransport;
}
