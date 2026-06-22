import { chromium } from "playwright";
import { createServer } from "vite";

const port = 4182;
const server = await createServer({
	root: import.meta.dirname,
	configFile: new URL("./vite.config.ts", import.meta.url).pathname,
	server: { port, strictPort: true },
});

await server.listen();

const browser = await chromium.launch({ headless: true });

try {
	const page = await browser.newPage();
	const stamp = Date.now();
	const projectName = `Smoke Project ${stamp}`;
	const projectSlug = `smoke-project-${stamp}`;
	const renamedProjectName = `Renamed Smoke Project ${stamp}`;
	const taskText = `Review smoke project ${stamp}`;
	page.on("console", (message) => {
		console.log(`[browser:${message.type()}] ${message.text()}`);
	});
	page.on("pageerror", (error) => {
		console.log(`[browser:error] ${error.stack ?? error.message}`);
	});
	const projectsShortcut = page
		.locator(".system-nav")
		.getByRole("button", { name: /Projects/ });
	await page.goto(`http://127.0.0.1:${port}`, { waitUntil: "networkidle" });
	await page.getByRole("button", { name: "Inbox" }).first().waitFor({
		timeout: 45_000,
	});
	await page.getByRole("button", { name: "Calendar Local" }).click();
	await page.getByTestId("calendar-view").waitFor();
	await page.getByText("Sun").waitFor();
	await page.getByRole("button", { name: "Add project" }).click();
	const addModal = page.locator(".add-modal");
	await addModal.getByLabel("New project").fill(projectName);
	await addModal.getByRole("button", { name: "Add project" }).click();
	await page.getByRole("button", { name: projectName }).waitFor();
	await addModal
		.getByLabel("Task list")
		.selectOption(`/projects/active/${projectSlug}/tasks.md`);
	await addModal.getByLabel("New task").fill(taskText);
	await addModal.getByRole("button", { name: "Add task" }).click();
	await addModal.getByRole("button", { name: "Close" }).click();
	await page.waitForFunction((expected) => {
		const note = document.querySelector("[data-testid='note-view']");
		return note instanceof HTMLElement && note.innerText.includes(expected);
	}, taskText);
	const editedTaskText = `Review edited smoke project ${stamp}`;
	await page
		.locator(".note-task")
		.filter({ hasText: taskText })
		.locator(".note-task-text")
		.fill(editedTaskText);
	await page.getByRole("button", { name: "Save" }).click();
	await page.waitForFunction((expected) => {
		const note = document.querySelector("[data-testid='note-view']");
		return note instanceof HTMLElement && note.innerText.includes(expected);
	}, editedTaskText);
	await projectsShortcut.click();
	await page.getByTestId("project-list-view").waitFor();
	let projectRow = page
		.locator(".project-row")
		.filter({ hasText: projectName });
	await projectRow.getByRole("button", { name: "Open" }).waitFor();
	page.once("dialog", async (dialog) => {
		await dialog.accept(renamedProjectName);
	});
	await projectRow.getByRole("button", { name: "Rename" }).click();
	projectRow = page
		.locator(".project-row")
		.filter({ hasText: renamedProjectName });
	await projectRow.getByRole("button", { name: "Archive" }).waitFor();
	await projectRow.getByRole("button", { name: "Archive" }).click();
	await page.getByTestId("project-list-view").waitFor();
	projectRow = page
		.locator(".project-row")
		.filter({ hasText: renamedProjectName });
	await projectRow.getByRole("button", { name: "Restore" }).waitFor();
	await projectRow.getByRole("button", { name: "Restore" }).click();
	projectRow = page
		.locator(".project-row")
		.filter({ hasText: renamedProjectName });
	await projectRow.getByRole("button", { name: "Archive" }).waitFor();
	page.once("dialog", async (dialog) => {
		await dialog.accept();
	});
	await projectRow.getByRole("button", { name: "Delete" }).click();
	await page.getByTestId("project-list-view").waitFor();
	await projectRow.waitFor({ state: "detached" });
	await page.getByRole("button", { name: "Settings" }).click();
	await page.getByRole("button", { name: "Nuke" }).click();
	await page.getByRole("heading", { name: "Nuke local state?" }).waitFor();
	await page.getByRole("button", { name: "Cancel" }).click();
	await page.getByRole("button", { name: "Close" }).click();
	await page.reload({ waitUntil: "networkidle" });
	await page.getByRole("button", { name: "Today Smoke" }).waitFor();
	await page.getByRole("button", { name: "Today Smoke" }).click();
	await page.waitForFunction(() => {
		const note = document.querySelector("[data-testid='note-view']");
		return (
			note instanceof HTMLElement &&
			note.innerText.includes("Persistence Smoke")
		);
	});
	const noteText = await page.getByTestId("note-view").innerText();
	if (!noteText.includes("Persistence Smoke")) {
		throw new Error(`Unexpected persisted note text: ${noteText}`);
	}
	console.log("GTD client example smoke passed");
} finally {
	await browser.close();
	await server.close();
}
