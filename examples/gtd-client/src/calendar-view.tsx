import type { CalendarItem } from "./app-model.ts";

export function CalendarView(props: { readonly text: string }) {
	const today = new Date();
	const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
	const monthLabel = monthStart.toLocaleDateString(undefined, {
		month: "long",
		year: "numeric",
	});
	const items = parseCalendarItems(props.text, today);
	const days = buildCalendarDays(today);
	const itemsByDate = new Map<string, CalendarItem[]>();
	for (const item of items) {
		const existing = itemsByDate.get(item.dateKey) ?? [];
		existing.push(item);
		itemsByDate.set(item.dateKey, existing);
	}
	return (
		<div className="calendar-view" data-testid="calendar-view">
			<div className="calendar-header">
				<h3>{monthLabel}</h3>
				<span>
					{items.length} dated item{items.length === 1 ? "" : "s"}
				</span>
			</div>
			<div className="calendar-weekdays">
				{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
					<span key={day}>{day}</span>
				))}
			</div>
			<div className="calendar-grid">
				{days.map((day) => {
					const dayItems = itemsByDate.get(day.dateKey) ?? [];
					return (
						<div
							className={`calendar-day ${day.inMonth ? "" : "muted"} ${
								day.isToday ? "today" : ""
							}`}
							key={day.dateKey}
						>
							<div className="calendar-day-number">{day.date.getDate()}</div>
							{dayItems.map((item) => (
								<div
									className={`calendar-event ${item.done ? "done" : ""}`}
									key={`${item.lineIndex}-${item.title}`}
								>
									{item.time ? <strong>{item.time}</strong> : null}
									<span>{item.title}</span>
								</div>
							))}
						</div>
					);
				})}
			</div>
			{items.length === 0 ? (
				<p className="calendar-empty">
					Add dated lines such as 2026-06-21 - Weekly review or 6/21 7pm
					Swimming.
				</p>
			) : null}
		</div>
	);
}

function buildCalendarDays(baseDate: Date): readonly {
	readonly date: Date;
	readonly dateKey: string;
	readonly inMonth: boolean;
	readonly isToday: boolean;
}[] {
	const monthStart = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
	const gridStart = new Date(monthStart);
	gridStart.setDate(monthStart.getDate() - monthStart.getDay());
	return Array.from({ length: 42 }, (_, index) => {
		const date = new Date(gridStart);
		date.setDate(gridStart.getDate() + index);
		return {
			date,
			dateKey: toDateKey(date),
			inMonth: date.getMonth() === baseDate.getMonth(),
			isToday: toDateKey(date) === toDateKey(baseDate),
		};
	});
}

function parseCalendarItems(
	text: string,
	baseDate: Date,
): readonly CalendarItem[] {
	return text
		.split("\n")
		.map((line, lineIndex) => parseCalendarItem(line, lineIndex, baseDate))
		.filter((item): item is CalendarItem => item !== undefined);
}

function parseCalendarItem(
	line: string,
	lineIndex: number,
	baseDate: Date,
): CalendarItem | undefined {
	const cleaned = line
		.replace(/^#+\s*/u, "")
		.replace(/^\s*-\s+\[([ xX])\]\s*/u, "")
		.replace(/^\s*-\s*/u, "")
		.trim();
	if (!cleaned) {
		return undefined;
	}
	const date = parseCalendarDate(cleaned, baseDate);
	if (!date) {
		return undefined;
	}
	const time = parseCalendarTime(cleaned);
	const title = cleaned
		.replace(/\b20\d{2}-\d{1,2}-\d{1,2}\b/u, "")
		.replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/u, "")
		.replace(monthDatePattern(), "")
		.replace(/\b\d{1,2}(?::\d{2})?\s*(am|pm)\b/iu, "")
		.replace(/\s+[-:]\s+/u, " ")
		.trim();
	return {
		lineIndex,
		dateKey: toDateKey(date),
		title: title || "Calendar item",
		...(time ? { time } : {}),
		done: /^\s*-\s+\[[xX]\]/u.test(line),
	};
}

function parseCalendarDate(text: string, baseDate: Date): Date | undefined {
	const iso = /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/u.exec(text);
	if (iso) {
		return makeDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
	}
	const slash = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/u.exec(text);
	if (slash) {
		const year =
			slash[3] === undefined
				? baseDate.getFullYear()
				: Number(slash[3].length === 2 ? `20${slash[3]}` : slash[3]);
		return makeDate(year, Number(slash[1]), Number(slash[2]));
	}
	const monthDate = monthDatePattern().exec(text);
	const monthName = monthDate?.[1];
	const day = monthDate?.[2];
	if (monthName && day) {
		const month = monthNumber(monthName);
		if (!month) {
			return undefined;
		}
		return makeDate(baseDate.getFullYear(), month, Number(day));
	}
	return undefined;
}

function parseCalendarTime(text: string): string | undefined {
	const match = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/iu.exec(text);
	if (!match) {
		return undefined;
	}
	return `${match[1]}${match[2] ? `:${match[2]}` : ""}${match[3]?.toLowerCase()}`;
}

function makeDate(year: number, month: number, day: number): Date | undefined {
	const date = new Date(year, month - 1, day);
	if (
		date.getFullYear() !== year ||
		date.getMonth() !== month - 1 ||
		date.getDate() !== day
	) {
		return undefined;
	}
	return date;
}

function toDateKey(date: Date): string {
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${date.getFullYear()}-${month}-${day}`;
}

function monthNumber(name: string): number | undefined {
	const index = monthNames.findIndex((month) => month === name.toLowerCase());
	return index === -1 ? undefined : index + 1;
}

const monthNames = [
	"january",
	"february",
	"march",
	"april",
	"may",
	"june",
	"july",
	"august",
	"september",
	"october",
	"november",
	"december",
] as const;

function monthDatePattern(): RegExp {
	return new RegExp(`\\b(${monthNames.join("|")})\\s+(\\d{1,2})\\b`, "iu");
}
