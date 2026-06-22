export const WORKSPACE_ID = "theta-gtd-client";
export const SESSION_ID = "theta-gtd-session-v3";
export const STORAGE_KEY_OPENAI = "theta.gtd.openaiKey";
export const STORAGE_KEY_MODEL = "theta.gtd.model";

export type CalendarItem = {
	readonly lineIndex: number;
	readonly dateKey: string;
	readonly title: string;
	readonly time?: string;
	readonly done: boolean;
};

export type ProjectRecord = {
	readonly path: string;
	readonly slug: string;
	readonly name: string;
	readonly status: "active" | "archived";
	readonly infoPath: string;
	readonly tasksPath: string;
};

export type StarterProject = {
	readonly slug: string;
	readonly name: string;
	readonly outcome: string;
	readonly intakeCues: readonly string[];
	readonly contexts: readonly string[];
};

export const starterProjects = [
	{
		slug: "errands",
		name: "Errands",
		outcome:
			"Out-of-house tasks, purchases, returns, appointments, and life logistics are grouped where they can be batched.",
		intakeCues: [
			"buy",
			"pick up",
			"return",
			"drop off",
			"appointment",
			"bank",
			"form",
		],
		contexts: ["@errands", "@home-computer", "@home-calls"],
	},
	{
		slug: "work",
		name: "Work",
		outcome:
			"Professional commitments, deliverables, meetings, and follow-ups stay current.",
		intakeCues: ["client", "team", "meeting", "review", "deadline", "proposal"],
		contexts: ["@work-computer", "@work-calls", "@work-errand"],
	},
	{
		slug: "physical",
		name: "Physical",
		outcome:
			"Health, movement, sleep, food, and body maintenance commitments are clear and actionable.",
		intakeCues: [
			"doctor",
			"dentist",
			"pharmacy",
			"workout",
			"sleep",
			"medicine",
			"gym",
			"physical therapy",
		],
		contexts: ["@physical", "@home-computer", "@home-calls", "@errands"],
	},
	{
		slug: "social",
		name: "Social",
		outcome:
			"Relationships, social plans, replies, gifts, and people-specific commitments are followed through deliberately.",
		intakeCues: [
			"call",
			"text",
			"reply",
			"dinner",
			"birthday",
			"gift",
			"friend",
			"family",
		],
		contexts: ["@social", "@home-calls", "@agenda-person", "@errands"],
	},
] as const satisfies readonly StarterProject[];
