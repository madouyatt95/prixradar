const PARIS_HOUR = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Paris",
  hour: "2-digit",
  hourCycle: "h23",
});

/** Dealabs is deliberately paused from 01:00 (included) to 07:00 (excluded), Paris time. */
export function isDealabsNightPause(scheduledAt: Date) {
  const hour = Number(PARIS_HOUR.format(scheduledAt));
  return Number.isInteger(hour) && hour >= 1 && hour < 7;
}
