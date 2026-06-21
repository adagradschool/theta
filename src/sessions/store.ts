import type { ThetaSessionSnapshot, ThetaSessionStore } from "./types.ts";

export function createMemoryThetaSessionStore(): ThetaSessionStore {
	return new MemoryThetaSessionStore();
}

class MemoryThetaSessionStore implements ThetaSessionStore {
	private readonly snapshots = new Map<string, ThetaSessionSnapshot>();

	async list(): Promise<readonly ThetaSessionSnapshot[]> {
		return Array.from(this.snapshots.values()).map(cloneSnapshot);
	}

	async get(sessionId: string): Promise<ThetaSessionSnapshot | undefined> {
		const snapshot = this.snapshots.get(sessionId);
		return snapshot ? cloneSnapshot(snapshot) : undefined;
	}

	async put(snapshot: ThetaSessionSnapshot): Promise<void> {
		this.snapshots.set(snapshot.session.id, cloneSnapshot(snapshot));
	}

	async delete(sessionId: string): Promise<void> {
		this.snapshots.delete(sessionId);
	}
}

export function cloneSnapshot(
	snapshot: ThetaSessionSnapshot,
): ThetaSessionSnapshot {
	return JSON.parse(JSON.stringify(snapshot)) as ThetaSessionSnapshot;
}
