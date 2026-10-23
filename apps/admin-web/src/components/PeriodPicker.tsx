import { CalendarDays } from "lucide-react";

import { PRESET_LABELS, PRESETS, type Period, type Preset, presetRange } from "@/lib/period";

import { Input, Select } from "./ui";

/** Preset ranges (Today, This week, Last month, ...) or custom dates. */
export function PeriodPicker({
  preset,
  period,
  onChange,
}: {
  preset: Preset;
  period: Period;
  onChange: (preset: Preset, period: Period) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <CalendarDays className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted" />
        <Select
          className="w-44 pl-9"
          value={preset}
          // Picking a preset replaces the dates with its range; picking
          // "Custom" keeps the current dates as a starting point to edit.
          onChange={(e) => {
            const p = e.target.value as Preset;
            onChange(p, p === "custom" ? period : presetRange(p));
          }}
        >
          {[...PRESETS, "custom" as const].map((p) => (
            <option key={p} value={p}>
              {PRESET_LABELS[p]}
            </option>
          ))}
        </Select>
      </div>
      {/* Custom range: two date fields, each limited so "from" can't come
         after "to". An emptied field is ignored rather than clearing it. */}
      {preset === "custom" && (
        <>
          <Input type="date" className="w-40" value={period.from} max={period.to} onChange={(e) => e.target.value && onChange("custom", { ...period, from: e.target.value })} />
          <span className="text-muted">to</span>
          <Input type="date" className="w-40" value={period.to} min={period.from} onChange={(e) => e.target.value && onChange("custom", { ...period, to: e.target.value })} />
        </>
      )}
    </div>
  );
}
