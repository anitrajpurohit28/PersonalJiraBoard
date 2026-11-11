// Adapted from the date/time picker in Anit_AI_enabled_personal_organization_board.
export type ReminderParts = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number; // 0-59
};

export type ReminderPeriod = "AM" | "PM";

export function pad2(value: number) {
  return String(value).padStart(2, "0");
}

export function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export function partsToLocalValue(parts: ReminderParts) {
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}T${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

export function parseLocalValue(value: string): ReminderParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec((value.length === 10 ? `${value}T09:00` : value).trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (
    !Number.isFinite(year) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }
  const probe = new Date(year, month - 1, day, hour, minute);
  if (
    probe.getFullYear() !== year ||
    probe.getMonth() !== month - 1 ||
    probe.getDate() !== day
  ) {
    return null;
  }
  return { year, month, day, hour, minute };
}

export function to12Hour(hour24: number): { hour12: number; period: ReminderPeriod } {
  const period: ReminderPeriod = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return { hour12, period };
}

export function from12Hour(hour12: number, period: ReminderPeriod) {
  const clamped = clampInt(hour12, 1, 12);
  if (period === "AM") return clamped === 12 ? 0 : clamped;
  return clamped === 12 ? 12 : clamped + 12;
}

export function formatReminderDisplay(parts: ReminderParts | null) {
  if (!parts) return "";
  const { hour12, period } = to12Hour(parts.hour);
  return `${pad2(parts.day)}/${pad2(parts.month)}/${parts.year}, ${pad2(hour12)}:${pad2(parts.minute)} ${period}`;
}

export function formatReminderTimeDisplay(parts: ReminderParts | null) {
  if (!parts) return "09:00 AM";
  const { hour12, period } = to12Hour(parts.hour);
  return `${pad2(hour12)}:${pad2(parts.minute)} ${period}`;
}

export function parseReminderDisplay(text: string): ReminderParts | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const match =
    /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})(?:[,\s]+(\d{1,2}):(\d{2})(?:\s*(AM|PM|am|pm))?)?$/.exec(
      trimmed
    );
  if (!match) {
    // Also accept YYYY-MM-DDTHH:mm typed directly.
    return parseLocalValue(trimmed);
  }
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const rawHour = match[4] == null ? 9 : Number(match[4]);
  const minute = match[5] == null ? 0 : Number(match[5]);
  const periodToken = match[6]?.toUpperCase() as ReminderPeriod | undefined;
  let hour24: number;
  if (minute < 0 || minute > 59) return null;
  if (periodToken === "AM" || periodToken === "PM") {
    if (rawHour < 1 || rawHour > 12) return null;
    hour24 = from12Hour(rawHour, periodToken);
  } else if (rawHour >= 0 && rawHour <= 23) {
    hour24 = rawHour;
  } else {
    return null;
  }
  return parseLocalValue(
    `${year}-${pad2(month)}-${pad2(day)}T${pad2(hour24)}:${pad2(clampInt(minute, 0, 59))}`
  );
}

export function parseReminderTimeText(
  text: string
): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})(?:\s*(AM|PM|am|pm))?$/.exec(text.trim());
  if (!match) return null;
  const rawHour = Number(match[1]);
  const minute = Number(match[2]);
  const periodToken = match[3]?.toUpperCase() as ReminderPeriod | undefined;
  if (!Number.isFinite(rawHour) || !Number.isFinite(minute)) return null;
  if (minute < 0 || minute > 59) return null;
  if (periodToken === "AM" || periodToken === "PM") {
    if (rawHour < 1 || rawHour > 12) return null;
    return { hour: from12Hour(rawHour, periodToken), minute };
  }
  if (rawHour < 0 || rawHour > 23) return null;
  return { hour: rawHour, minute };
}

export function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

/** Default picker seed: tomorrow at the current clock time. */
export function defaultReminderParts(from = new Date()): ReminderParts {
  const next = new Date(from);
  next.setDate(next.getDate() + 1);
  return {
    year: next.getFullYear(),
    month: next.getMonth() + 1,
    day: next.getDate(),
    hour: from.getHours(),
    minute: from.getMinutes(),
  };
}

