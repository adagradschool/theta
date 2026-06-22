import {
	createThetaAgent,
	type CreateThetaAgentOptions,
	type ThetaAgent,
} from "./agent.ts";
import { ThetaEmitter } from "./emitter.ts";
import type { ThetaEventListener, ThetaWorkspaceEvent } from "./events.ts";
import type { WorkspaceFs } from "../fs/filesystem.ts";
import type { JsonObject } from "./json.ts";
import type { ThetaToolDefinition, ThetaToolInput } from "./tools.ts";

export interface CreateThetaWorkspaceOptions {
	readonly id?: string;
	readonly name?: string;
	readonly fs: WorkspaceFs;
	readonly tools?: readonly ThetaToolInput[];
	readonly metadata?: JsonObject;
	readonly events?: ThetaEventListener<ThetaWorkspaceEvent>;
}

export interface ThetaWorkspace {
	readonly id: string;
	readonly name: string;
	readonly fs: WorkspaceFs;
	readonly metadata: JsonObject;
	subscribe(listener: ThetaEventListener<ThetaWorkspaceEvent>): () => void;
	resolveTools(): Promise<readonly ThetaToolDefinition[]>;
	createAgent(options?: Omit<CreateThetaAgentOptions, "workspace">): ThetaAgent;
	dispose(): void;
}

let nextWorkspaceId = 1;

export function createThetaWorkspace(
	options: CreateThetaWorkspaceOptions,
): ThetaWorkspace {
	return new ThetaWorkspaceController(options);
}

class ThetaWorkspaceController implements ThetaWorkspace {
	readonly id: string;
	readonly name: string;
	readonly fs: WorkspaceFs;
	readonly metadata: JsonObject;
	private readonly tools: readonly ThetaToolInput[];
	private readonly emitter = new ThetaEmitter<ThetaWorkspaceEvent>();
	private readonly unwatchFs: () => void;
	private disposed = false;

	constructor(options: CreateThetaWorkspaceOptions) {
		this.id = options.id ?? `theta-workspace-${nextWorkspaceId}`;
		nextWorkspaceId += 1;
		this.name = options.name ?? this.id;
		this.fs = options.fs;
		this.tools = options.tools ?? [];
		this.metadata = options.metadata ?? {};
		if (options.events) {
			this.subscribe(options.events);
		}
		this.unwatchFs = this.fs.watch("/", (event) => {
			void this.emitter.emit({
				type: "fs_event",
				workspaceId: this.id,
				event,
			});
		});
		queueMicrotask(() => {
			void this.emitter.emit({
				type: "workspace_created",
				workspace: { id: this.id, name: this.name },
			});
		});
	}

	subscribe(listener: ThetaEventListener<ThetaWorkspaceEvent>): () => void {
		return this.emitter.subscribe(listener);
	}

	async resolveTools(): Promise<readonly ThetaToolDefinition[]> {
		this.assertUsable();
		const resolved: ThetaToolDefinition[] = [];
		for (const tool of this.tools) {
			if (typeof tool === "function") {
				const produced = await tool({ workspace: this, fs: this.fs });
				resolved.push(...(Array.isArray(produced) ? produced : [produced]));
			} else {
				resolved.push(tool);
			}
		}
		return resolved;
	}

	createAgent(
		options: Omit<CreateThetaAgentOptions, "workspace"> = {},
	): ThetaAgent {
		this.assertUsable();
		return createThetaAgent({ ...options, workspace: this });
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.unwatchFs();
		void this.emitter.emit({
			type: "workspace_disposed",
			workspaceId: this.id,
		});
	}

	private assertUsable(): void {
		if (this.disposed) {
			throw new Error("Theta workspace has been disposed.");
		}
	}
}
