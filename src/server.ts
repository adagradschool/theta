export interface ThetaServerProxyRequirements {
	readonly providerCredentials: "server-only";
	readonly transport: "streaming-http";
	readonly durableSync: "optional-server-infrastructure";
}

export const THETA_SERVER_PROXY_REQUIREMENTS = {
	providerCredentials: "server-only",
	transport: "streaming-http",
	durableSync: "optional-server-infrastructure",
} as const satisfies ThetaServerProxyRequirements;
