type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

export function parseAlertEvidence(value: string) {
  try {
    return record(JSON.parse(value));
  } catch {
    return null;
  }
}

export function evidenceNumber(value: string, field: string) {
  const evidence = parseAlertEvidence(value);
  if (!evidence) return null;
  const rootCandidate = evidence[field];
  if (typeof rootCandidate === "number" && Number.isFinite(rootCandidate)) return rootCandidate;
  const analysis = record(evidence.analysis);
  const analysisCandidate = analysis?.[field];
  return typeof analysisCandidate === "number" && Number.isFinite(analysisCandidate)
    ? analysisCandidate
    : null;
}

export function evidenceEligible(value: string) {
  return parseAlertEvidence(value)?.notificationEligible === true;
}

export function evidenceBoolean(value: string, field: string) {
  const evidence = parseAlertEvidence(value);
  if (!evidence) return null;
  const rootCandidate = evidence[field];
  if (typeof rootCandidate === "boolean") return rootCandidate;
  const analysis = record(evidence.analysis);
  const checks = record(analysis?.checks);
  const checkCandidate = checks?.[field];
  return typeof checkCandidate === "boolean" ? checkCandidate : null;
}
