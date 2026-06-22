import { useState } from "react";

export function SettingsPanel(props: {
	readonly apiKey: string;
	readonly model: string;
	readonly onApiKeyChange: (value: string) => void;
	readonly onModelChange: (value: string) => void;
	readonly onClose: () => void;
	readonly onNukeLocalState: () => void;
}) {
	const [confirmNukeOpen, setConfirmNukeOpen] = useState(false);
	return (
		<div className="settings-backdrop">
			<section className="settings-panel" aria-label="Settings">
				<div className="settings-header">
					<div>
						<p className="eyebrow">Settings</p>
						<h2>Connect donedone</h2>
					</div>
					<button type="button" onClick={props.onClose}>
						Close
					</button>
				</div>
				<div className="settings-fields">
					<label>
						<span>OpenAI key</span>
						<input
							aria-label="OpenAI API key"
							type="password"
							value={props.apiKey}
							placeholder="sk-..."
							onChange={(event) =>
								props.onApiKeyChange(event.currentTarget.value)
							}
						/>
					</label>
					<label>
						<span>Model</span>
						<input
							aria-label="Model"
							value={props.model}
							onChange={(event) =>
								props.onModelChange(event.currentTarget.value)
							}
						/>
					</label>
				</div>
				<div className="settings-note">
					Your key stays in this browser for the BYOK example.
				</div>
				<div className="settings-reset">
					<div>
						<strong>Nuke local state</strong>
						<p>Reset this browser's workspace, chat history, and saved key.</p>
					</div>
					<button
						type="button"
						className="danger-action"
						onClick={() => setConfirmNukeOpen(true)}
					>
						Nuke
					</button>
				</div>
			</section>
			{confirmNukeOpen ? (
				<section
					className="confirm-modal"
					aria-label="Confirm nuke local state"
				>
					<div>
						<p className="eyebrow">Confirm reset</p>
						<h2>Nuke local state?</h2>
					</div>
					<p>
						This removes the local workspace files, chat/session history, PGlite
						database, OPFS blobs, and saved OpenAI settings in this browser. The
						app will reload into a clean workspace.
					</p>
					<div className="confirm-actions">
						<button type="button" onClick={() => setConfirmNukeOpen(false)}>
							Cancel
						</button>
						<button
							type="button"
							className="danger-action"
							onClick={props.onNukeLocalState}
						>
							Nuke state
						</button>
					</div>
				</section>
			) : null}
		</div>
	);
}
