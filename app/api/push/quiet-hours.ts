export type QuietHours = {
  quietHours: boolean;
  quietStart: string;
  quietEnd: string;
  timezone: string;
};

function minutesAt(date: Date, timezone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    const minute = Number(parts.find((part) => part.type === "minute")?.value);
    return Number.isInteger(hour) && Number.isInteger(minute)
      ? hour * 60 + minute
      : null;
  } catch {
    return null;
  }
}

function parsedMinutes(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : null;
}

export function isQuietNow(value: QuietHours, now = new Date()) {
  if (!value.quietHours) return false;
  const current = minutesAt(now, value.timezone);
  const start = parsedMinutes(value.quietStart);
  const end = parsedMinutes(value.quietEnd);
  if (current === null || start === null || end === null || start === end) return false;
  return start < end
    ? current >= start && current < end
    : current >= start || current < end;
}
