import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";

import { STORAGE_KEY_MODEL, STORAGE_KEY_OPENAI } from "./app-model.ts";
import { WorkspaceApp } from "./workspace-app.tsx";
import {
	deleteOpfsAppState,
	disposeReadyState,
	initialize,
	type ReadyState,
} from "./workspace-runtime.ts";

import "./styles.css";

createRoot(document.getElementById("root") as HTMLElement).render(<App />);

function App() {
	const [ready, setReady] = useState<ReadyState | undefined>();
	const [selectedPath, setSelectedPath] = useState<string | undefined>();
	const [initError, setInitError] = useState<string | undefined>();

	useEffect(() => {
		let disposed = false;
		let current: ReadyState | undefined;
		void initialize().then(
			(next) => {
				if (disposed) {
					void disposeReadyState(next);
					return;
				}
				current = next;
				setReady(next);
			},
			(error: unknown) => {
				setInitError(error instanceof Error ? error.message : String(error));
			},
		);
		return () => {
			disposed = true;
			if (current) {
				void disposeReadyState(current);
			}
		};
	}, []);

	if (initError) {
		return (
			<div className="boot-error">Failed to boot donedone: {initError}</div>
		);
	}
	if (!ready) {
		return <div className="boot">Opening local donedone workspace...</div>;
	}
	async function nukeLocalState() {
		if (!ready) {
			return;
		}
		setReady(undefined);
		setSelectedPath(undefined);
		await disposeReadyState(ready);
		localStorage.removeItem(STORAGE_KEY_OPENAI);
		localStorage.removeItem(STORAGE_KEY_MODEL);
		await deleteOpfsAppState();
		window.location.reload();
	}
	return (
		<WorkspaceApp
			workspace={ready.workspace}
			agent={ready.agent}
			providerEnv={ready.providerEnv}
			initialEntries={ready.initialEntries}
			selectedPath={selectedPath}
			onSelectPath={setSelectedPath}
			onNukeLocalState={() => void nukeLocalState()}
		/>
	);
}
