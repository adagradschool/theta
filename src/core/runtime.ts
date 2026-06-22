export type ThetaRuntimeTarget =
	| "chrome-latest"
	| "edge-latest"
	| "firefox-latest"
	| "safari-latest";

export interface ThetaPackageInfo {
	readonly name: "@adagradschool/theta";
	readonly browserOnly: true;
	readonly serverProxyRequired: true;
	readonly runtimeTargets: readonly ThetaRuntimeTarget[];
}

export const THETA_PACKAGE_INFO = {
	name: "@adagradschool/theta",
	browserOnly: true,
	serverProxyRequired: true,
	runtimeTargets: [
		"chrome-latest",
		"edge-latest",
		"firefox-latest",
		"safari-latest",
	],
} as const satisfies ThetaPackageInfo;
