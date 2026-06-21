import type { WorkspaceFs } from "./filesystem.ts";
import type { JsonObject, JsonValue } from "./json.ts";
import type { ThetaImageContent, ThetaTextContent } from "./messages.ts";
import type { ThetaWorkspace } from "./workspace.ts";

export type ThetaToolExecutionMode = "parallel" | "sequential";

export type ThetaToolSchema = Readonly<Record<string, unknown>>;

export interface ThetaToolRenderMetadata {
	readonly title?: string;
	readonly path?: string;
	readonly language?: string;
	readonly summary?: string;
	readonly data?: JsonValue;
}

export interface ThetaToolResult<TDetails = unknown> {
	readonly content: readonly (ThetaTextContent | ThetaImageContent)[];
	readonly details?: TDetails;
	readonly isError?: boolean;
	readonly terminate?: boolean;
	readonly render?: ThetaToolRenderMetadata;
}

export type ThetaToolUpdate<TDetails = unknown> = (
	partialResult: ThetaToolResult<TDetails>,
) => void;

export interface ThetaToolExecutionContext<
	TInput extends JsonObject = JsonObject,
	TDetails = unknown,
> {
	readonly workspace: ThetaWorkspace;
	readonly fs: WorkspaceFs;
	readonly toolCallId: string;
	readonly input: TInput;
	readonly signal: AbortSignal;
	readonly update: ThetaToolUpdate<TDetails>;
}

export interface ThetaToolDefinition<
	TInput extends JsonObject = JsonObject,
	TDetails = unknown,
> {
	readonly name: string;
	readonly label: string;
	readonly description: string;
	readonly parameters: ThetaToolSchema;
	readonly executionMode?: ThetaToolExecutionMode;
	execute(
		context: ThetaToolExecutionContext<TInput, TDetails>,
	): Promise<ThetaToolResult<TDetails>>;
}

export interface ThetaToolFactoryContext {
	readonly workspace: ThetaWorkspace;
	readonly fs: WorkspaceFs;
}

export type ThetaToolFactory = (
	context: ThetaToolFactoryContext,
) =>
	| ThetaToolDefinition
	| readonly ThetaToolDefinition[]
	| Promise<ThetaToolDefinition | readonly ThetaToolDefinition[]>;

export type ThetaToolInput = ThetaToolDefinition | ThetaToolFactory;
