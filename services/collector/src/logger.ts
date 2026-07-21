const SECRET_PATTERN = /(secret|token|authorization|api[_-]?key|private[_-]?key|p256dh|auth)/iu;

function sanitized(value: unknown, key = "", depth = 0): unknown {
  if (SECRET_PATTERN.test(key)) return "[REDACTED]";
  if (depth > 5) return "[TRUNCATED]";
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitized(item, "", depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [
      childKey,
      sanitized(child, childKey, depth + 1),
    ]));
  }
  if (typeof value === "string") {
    return value
      .replace(/([?&](?:key|token|secret)=)[^&\s]+/giu, "$1[REDACTED]")
      .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/giu, "Bearer [REDACTED]");
  }
  return value;
}

function write(level: "info" | "warn" | "error", event: string, details?: unknown): void {
  const record = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...(details === undefined ? {} : { details: sanitized(details) }),
  };
  const output = JSON.stringify(record);
  if (level === "error") console.error(output);
  else if (level === "warn") console.warn(output);
  else console.log(output);
}

export const logger = {
  info: (event: string, details?: unknown) => write("info", event, details),
  warn: (event: string, details?: unknown) => write("warn", event, details),
  error: (event: string, details?: unknown) => write("error", event, details),
};

export function sanitizeForLog(value: unknown): unknown {
  return sanitized(value);
}
