// Date ranges for reports, as plain YYYY-MM-DD strings (what the API
// takes). Computed from the browser's clock; the shop runs on Ghana time
// (UTC), and the API applies its own shop timezone to the dates given.

export type Period = { from: string; to: string };

// The ready-made ranges, in the order the period picker lists them.
export const PRESETS = [
  "today",
  "yesterday",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "last_30",
  "this_year",
] as const;
export type Preset = (typeof PRESETS)[number] | "custom";

export const PRESET_LABELS: Record<Preset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  this_week: "This week",
  last_week: "Last week",
  this_month: "This month",
  last_month: "Last month",
  last_30: "Last 30 days",
  this_year: "This year",
  custom: "Custom dates",
};

// A date as YYYY-MM-DD in local time (toISOString would use UTC, which
// can be a different day near midnight).
export function iso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
/** Monday of d's week -- weeks start on Monday, as in the API's tallies. */
const monday = (d: Date) => addDays(d, -((d.getDay() + 6) % 7));

// The from/to dates of a preset, relative to now. Ranges like "this week"
// end today rather than on Sunday.
export function presetRange(preset: Exclude<Preset, "custom">, now = new Date()): Period {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (preset) {
    case "today":
      return { from: iso(today), to: iso(today) };
    case "yesterday":
      return { from: iso(addDays(today, -1)), to: iso(addDays(today, -1)) };
    case "this_week":
      return { from: iso(monday(today)), to: iso(today) };
    case "last_week": {
      const start = addDays(monday(today), -7);
      return { from: iso(start), to: iso(addDays(start, 6)) };
    }
    case "this_month":
      return { from: iso(new Date(today.getFullYear(), today.getMonth(), 1)), to: iso(today) };
    case "last_month":
      return {
        from: iso(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
        to: iso(new Date(today.getFullYear(), today.getMonth(), 0)),
      };
    case "last_30":
      return { from: iso(addDays(today, -29)), to: iso(today) };
    case "this_year":
      return { from: iso(new Date(today.getFullYear(), 0, 1)), to: iso(today) };
  }
}

/** Sensible tally grouping for a range: days up to ~2 months, then weeks
 * up to ~6 months, then months. */
export function defaultGrouping(p: Period): "day" | "week" | "month" {
  const days = (new Date(p.to).getTime() - new Date(p.from).getTime()) / 86_400_000 + 1;
  return days <= 62 ? "day" : days <= 190 ? "week" : "month";
}

// A range in words, for page titles: "Friday, 23 Oct 2026",
// "1 Oct – 23 Oct 2026" and so on (the start's year only when it differs).
export function describePeriod(p: Period): string {
  const fmt = (s: string, withYear: boolean) =>
    new Date(`${s}T00:00:00`).toLocaleDateString("en-GH", { weekday: p.from === p.to ? "long" : undefined, day: "numeric", month: "short", year: withYear ? "numeric" : undefined });
  if (p.from === p.to) return fmt(p.from, true);
  return `${fmt(p.from, p.from.slice(0, 4) !== p.to.slice(0, 4))} – ${fmt(p.to, true)}`;
}
