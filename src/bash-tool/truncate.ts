import type { ThetaBashOutputTruncation } from "./types.ts";

const encoder = new TextEncoder();

export interface TruncatedText {
	readonly text: string;
	readonly truncation?: ThetaBashOutputTruncation;
}

export function truncateTextByBytes(
	text: string,
	maxBytes: number,
): TruncatedText {
	const originalBytes = encoder.encode(text).byteLength;
	if (originalBytes <= maxBytes) {
		return { text };
	}
	const marker = `[truncated ${originalBytes - maxBytes} bytes]\n`;
	const markerBytes = encoder.encode(marker).byteLength;
	const targetBytes = Math.max(0, maxBytes - markerBytes);
	const suffix = takeLastBytes(text, targetBytes);
	const output = `${marker}${suffix}`;
	const outputBytes = encoder.encode(output).byteLength;
	return {
		text: output,
		truncation: {
			originalBytes,
			outputBytes,
			omittedBytes: originalBytes - outputBytes,
			maxBytes,
		},
	};
}

function takeLastBytes(text: string, maxBytes: number): string {
	let bytes = 0;
	let output = "";
	const chars = Array.from(text);
	for (let index = chars.length - 1; index >= 0; index -= 1) {
		const char = chars[index] ?? "";
		const charBytes = encoder.encode(char).byteLength;
		if (bytes + charBytes > maxBytes) {
			break;
		}
		bytes += charBytes;
		output = `${char}${output}`;
	}
	return output;
}
