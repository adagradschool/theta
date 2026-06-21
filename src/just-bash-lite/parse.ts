export type ControlOperator = "always" | "and" | "or";
export type RedirectOperator = ">" | ">>" | "<";

export interface WordPart {
	readonly text: string;
	readonly expand: boolean;
}

export interface ShellWord {
	readonly parts: readonly WordPart[];
}

export interface Redirect {
	readonly operator: RedirectOperator;
	readonly target: ShellWord;
}

export interface ParsedCommand {
	readonly words: readonly ShellWord[];
	readonly redirects: readonly Redirect[];
}

export interface ParsedPipeline {
	readonly commands: readonly ParsedCommand[];
}

export interface ParsedStep {
	readonly operator: ControlOperator;
	readonly pipeline: ParsedPipeline;
}

type Token =
	| {
			readonly type: "word";
			readonly word: ShellWord;
	  }
	| {
			readonly type: "operator";
			readonly value: OperatorValue;
	  };

type OperatorValue = ";" | "&&" | "||" | "|" | ">" | ">>" | "<";

export function parseShellScript(script: string): readonly ParsedStep[] {
	const tokens = tokenize(script);
	const steps: ParsedStep[] = [];
	let start = 0;
	let nextOperator: ControlOperator = "always";

	for (let index = 0; index <= tokens.length; index += 1) {
		const token = tokens[index];
		const atEnd = index === tokens.length;
		const isControl =
			token?.type === "operator" &&
			(token.value === ";" || token.value === "&&" || token.value === "||");
		if (!atEnd && !isControl) {
			continue;
		}
		const segment = tokens.slice(start, index);
		if (segment.length > 0) {
			steps.push({
				operator: nextOperator,
				pipeline: parsePipeline(segment),
			});
		}
		if (token?.type === "operator") {
			nextOperator =
				token.value === "&&" ? "and" : token.value === "||" ? "or" : "always";
		}
		start = index + 1;
	}

	return steps;
}

export function expandShellWord(
	word: ShellWord,
	env: Readonly<Record<string, string>>,
): string {
	return word.parts
		.map((part) => (part.expand ? expandVariables(part.text, env) : part.text))
		.join("");
}

function tokenize(script: string): readonly Token[] {
	const tokens: Token[] = [];
	let index = 0;
	while (index < script.length) {
		const char = script[index] ?? "";
		if (isWhitespace(char)) {
			index += 1;
			continue;
		}
		const operator = readOperator(script, index);
		if (operator) {
			tokens.push({ type: "operator", value: operator.value });
			index += operator.length;
			continue;
		}
		const word = readWord(script, index);
		tokens.push({ type: "word", word: word.word });
		index = word.nextIndex;
	}
	return tokens;
}

function parsePipeline(tokens: readonly Token[]): ParsedPipeline {
	const commands: ParsedCommand[] = [];
	let start = 0;
	for (let index = 0; index <= tokens.length; index += 1) {
		const token = tokens[index];
		if (
			index !== tokens.length &&
			!(token?.type === "operator" && token.value === "|")
		) {
			continue;
		}
		const segment = tokens.slice(start, index);
		if (segment.length === 0) {
			throw new Error("Invalid empty command in pipeline.");
		}
		commands.push(parseCommand(segment));
		start = index + 1;
	}
	return { commands };
}

function parseCommand(tokens: readonly Token[]): ParsedCommand {
	const words: ShellWord[] = [];
	const redirects: Redirect[] = [];
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (!token) {
			continue;
		}
		if (token.type === "word") {
			words.push(token.word);
			continue;
		}
		if (token.value === ">" || token.value === ">>" || token.value === "<") {
			const target = tokens[index + 1];
			if (!target || target.type !== "word") {
				throw new Error(`Missing redirect target after ${token.value}.`);
			}
			redirects.push({ operator: token.value, target: target.word });
			index += 1;
			continue;
		}
		throw new Error(`Unexpected shell operator: ${token.value}`);
	}
	return { words, redirects };
}

function readWord(
	script: string,
	start: number,
): { readonly word: ShellWord; readonly nextIndex: number } {
	const parts: WordPart[] = [];
	let text = "";
	let index = start;
	const flushExpandable = () => {
		if (text.length > 0) {
			parts.push({ text, expand: true });
			text = "";
		}
	};

	while (index < script.length) {
		const char = script[index] ?? "";
		if (isWhitespace(char) || readOperator(script, index)) {
			break;
		}
		if (char === "'") {
			flushExpandable();
			const quoted = readQuoted(script, index + 1, "'");
			parts.push({ text: quoted.text, expand: false });
			index = quoted.nextIndex;
			continue;
		}
		if (char === '"') {
			flushExpandable();
			const quoted = readQuoted(script, index + 1, '"');
			parts.push({ text: quoted.text, expand: true });
			index = quoted.nextIndex;
			continue;
		}
		if (char === "\\") {
			const next = script[index + 1];
			if (next === undefined) {
				text += "\\";
				index += 1;
			} else {
				text += next;
				index += 2;
			}
			continue;
		}
		text += char;
		index += 1;
	}
	flushExpandable();
	return { word: { parts }, nextIndex: index };
}

function readQuoted(
	script: string,
	start: number,
	quote: "'" | '"',
): { readonly text: string; readonly nextIndex: number } {
	let text = "";
	let index = start;
	while (index < script.length) {
		const char = script[index] ?? "";
		if (char === quote) {
			return { text, nextIndex: index + 1 };
		}
		if (quote === '"' && char === "\\") {
			const next = script[index + 1];
			if (next === undefined) {
				text += "\\";
				index += 1;
			} else {
				text += next;
				index += 2;
			}
			continue;
		}
		text += char;
		index += 1;
	}
	throw new Error(`Unterminated ${quote} quote.`);
}

function readOperator(
	script: string,
	index: number,
): { readonly value: OperatorValue; readonly length: number } | undefined {
	const char = script[index];
	const next = script[index + 1];
	if (char === "&") {
		if (next === "&") {
			return { value: "&&", length: 2 };
		}
		throw new Error("Background commands are not supported.");
	}
	if (char === "|") {
		return next === "|"
			? { value: "||", length: 2 }
			: { value: "|", length: 1 };
	}
	if (char === ">") {
		return next === ">"
			? { value: ">>", length: 2 }
			: { value: ">", length: 1 };
	}
	if (char === "<") {
		return { value: "<", length: 1 };
	}
	if (char === ";") {
		return { value: ";", length: 1 };
	}
	return undefined;
}

function expandVariables(
	text: string,
	env: Readonly<Record<string, string>>,
): string {
	let output = "";
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];
		if (char !== "$") {
			output += char;
			continue;
		}
		const next = text[index + 1];
		if (next === "{") {
			const end = text.indexOf("}", index + 2);
			if (end === -1) {
				output += "$";
				continue;
			}
			const name = text.slice(index + 2, end);
			output += env[name] ?? "";
			index = end;
			continue;
		}
		if (!next || !/[A-Za-z_]/.test(next)) {
			output += "$";
			continue;
		}
		let end = index + 2;
		while (end < text.length && /[A-Za-z0-9_]/.test(text[end] ?? "")) {
			end += 1;
		}
		const name = text.slice(index + 1, end);
		output += env[name] ?? "";
		index = end - 1;
	}
	return output;
}

function isWhitespace(char: string): boolean {
	return char === " " || char === "\t" || char === "\n" || char === "\r";
}
