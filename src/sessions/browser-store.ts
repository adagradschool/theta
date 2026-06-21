import { cloneSnapshot } from "./store.ts";
import type {
	CreateBrowserThetaSessionStoreOptions,
	ThetaSessionSnapshot,
	ThetaSessionStore,
} from "./types.ts";

const DEFAULT_KEY = "theta:sessions";

export function createBrowserThetaSessionStore(
	options: CreateBrowserThetaSessionStoreOptions = {},
): ThetaSessionStore {
	const storage = options.storage ?? globalThis.localStorage;
	if (!storage) {
		throw new Error(
			"Browser session storage requires a Storage implementation.",
		);
	}
	return new BrowserThetaSessionStore(storage, options.key ?? DEFAULT_KEY);
}

class BrowserThetaSessionStore implements ThetaSessionStore {
	constructor(
		private readonly storage: Storage,
		private readonly key: string,
	) {}

	async list(): Promise<readonly ThetaSessionSnapshot[]> {
		return this.readAll().map(cloneSnapshot);
	}

	async get(sessionId: string): Promise<ThetaSessionSnapshot | undefined> {
		const snapshot = this.readAll().find(
			(candidate) => candidate.session.id === sessionId,
		);
		return snapshot ? cloneSnapshot(snapshot) : undefined;
	}

	async put(snapshot: ThetaSessionSnapshot): Promise<void> {
		const snapshots = this.readAll();
		const index = snapshots.findIndex(
			(candidate) => candidate.session.id === snapshot.session.id,
		);
		const next = cloneSnapshot(snapshot);
		if (index === -1) {
			snapshots.push(next);
		} else {
			snapshots[index] = next;
		}
		this.writeAll(snapshots);
	}

	async delete(sessionId: string): Promise<void> {
		this.writeAll(
			this.readAll().filter((snapshot) => snapshot.session.id !== sessionId),
		);
	}

	private readAll(): ThetaSessionSnapshot[] {
		const raw = this.storage.getItem(this.key);
		if (!raw) {
			return [];
		}
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) {
			throw new Error("Invalid Theta session storage payload.");
		}
		return parsed as ThetaSessionSnapshot[];
	}

	private writeAll(snapshots: readonly ThetaSessionSnapshot[]): void {
		this.storage.setItem(this.key, JSON.stringify(snapshots));
	}
}
