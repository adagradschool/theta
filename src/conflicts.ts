export interface ThetaTextMergeInput {
	readonly base: string;
	readonly local: string;
	readonly remote: string;
}

export interface ThetaTextEditRange {
	readonly start: number;
	readonly end: number;
	readonly replacement: string;
}

export type ThetaTextMergeResult =
	| {
			readonly status: "merged";
			readonly text: string;
	  }
	| {
			readonly status: "conflict";
			readonly reason: "overlapping_edits";
			readonly local: ThetaTextEditRange;
			readonly remote: ThetaTextEditRange;
	  };

export function mergeThetaTextConflict(
	input: ThetaTextMergeInput,
): ThetaTextMergeResult {
	if (input.local === input.remote) {
		return { status: "merged", text: input.local };
	}
	if (input.local === input.base) {
		return { status: "merged", text: input.remote };
	}
	if (input.remote === input.base) {
		return { status: "merged", text: input.local };
	}

	const local = diffSingleRange(input.base, input.local);
	const remote = diffSingleRange(input.base, input.remote);
	if (!rangesOverlap(local, remote)) {
		return { status: "merged", text: applyRanges(input.base, [local, remote]) };
	}

	return { status: "conflict", reason: "overlapping_edits", local, remote };
}

function diffSingleRange(base: string, changed: string): ThetaTextEditRange {
	let start = 0;
	while (
		start < base.length &&
		start < changed.length &&
		base[start] === changed[start]
	) {
		start += 1;
	}

	let baseEnd = base.length;
	let changedEnd = changed.length;
	while (
		baseEnd > start &&
		changedEnd > start &&
		base[baseEnd - 1] === changed[changedEnd - 1]
	) {
		baseEnd -= 1;
		changedEnd -= 1;
	}

	return {
		start,
		end: baseEnd,
		replacement: changed.slice(start, changedEnd),
	};
}

function rangesOverlap(
	left: ThetaTextEditRange,
	right: ThetaTextEditRange,
): boolean {
	if (left.start === left.end && right.start === right.end) {
		return left.start === right.start;
	}
	return left.start < right.end && right.start < left.end;
}

function applyRanges(
	base: string,
	ranges: readonly ThetaTextEditRange[],
): string {
	let text = "";
	let cursor = 0;
	for (const range of ranges.slice().sort((a, b) => a.start - b.start)) {
		text += base.slice(cursor, range.start);
		text += range.replacement;
		cursor = range.end;
	}
	text += base.slice(cursor);
	return text;
}
