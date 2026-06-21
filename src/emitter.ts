import type { ThetaEvent, ThetaEventListener } from "./events.ts";

export class ThetaEmitter<TEvent extends ThetaEvent> {
	private readonly listeners = new Set<ThetaEventListener<TEvent>>();

	subscribe(listener: ThetaEventListener<TEvent>): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	async emit(event: TEvent, signal?: AbortSignal): Promise<void> {
		for (const listener of this.listeners) {
			await listener(event, signal);
		}
	}
}
