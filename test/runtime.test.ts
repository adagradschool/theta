import { describe, expect, it } from "vitest";

import { THETA_PACKAGE_INFO } from "../src/index.ts";

describe("Theta package metadata", () => {
	it("declares browser-only runtime requirements", () => {
		expect(THETA_PACKAGE_INFO.browserOnly).toBe(true);
		expect(THETA_PACKAGE_INFO.serverProxyRequired).toBe(true);
		expect(THETA_PACKAGE_INFO.runtimeTargets).toContain("chrome-latest");
	});
});
