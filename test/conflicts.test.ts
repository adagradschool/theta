import { describe, expect, it } from "vitest";

import { mergeThetaTextConflict } from "../src/index.ts";

describe("conflict handling", () => {
	it("merges simple non-overlapping text edits", () => {
		const result = mergeThetaTextConflict({
			base: "alpha\nbeta\ngamma\n",
			local: "ALPHA\nbeta\ngamma\n",
			remote: "alpha\nbeta\nGAMMA\n",
		});

		expect(result).toEqual({
			status: "merged",
			text: "ALPHA\nbeta\nGAMMA\n",
		});
	});

	it("keeps either side when the other side is unchanged", () => {
		expect(
			mergeThetaTextConflict({
				base: "one\n",
				local: "one\n",
				remote: "two\n",
			}),
		).toEqual({ status: "merged", text: "two\n" });
	});

	it("reports overlapping edits as explicit conflicts", () => {
		const result = mergeThetaTextConflict({
			base: "alpha\nbeta\ngamma\n",
			local: "alpha\nLOCAL\ngamma\n",
			remote: "alpha\nREMOTE\ngamma\n",
		});

		expect(result).toMatchObject({
			status: "conflict",
			reason: "overlapping_edits",
			local: { replacement: "LOCAL" },
			remote: { replacement: "REMOTE" },
		});
	});
});
