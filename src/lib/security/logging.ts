// Security events and audit records as structured log lines.
//
// Each line is one JSON object, so a Vercel log drain (Settings, Drains in
// the Vercel team) hands them to Datadog, Splunk, Elastic, Axiom, Better
// Stack or any other SIEM as fields rather than text. Every line has
// "source": "signudoc" and a "type":
//
// - "security": something worth an operator's attention (a refused request,
//   a failure), from logSecurityEvent.
// - "audit": a copy of a row just committed to one of the two audit trails,
//   from logAuditRecord. "trail" is "site" (system_audit_events) or
//   "envelope" (audit_events). The database rows stay the record; "sequence"
//   and "rowHash" match a line to its row and show a gap in what arrived.
//
// AUDIT_LOG=off stops the audit lines, for an install that does not want
// email addresses and IP addresses in its function logs. Security lines
// are always written.

type SecurityLogLevel = "error" | "info" | "warn";

type SecurityLogInput = {
  category: string;
  ipAddress?: string | null;
  message: string;
  metadata?: Record<string, unknown>;
  path?: string;
  userId?: string | null;
};

const TOKEN_PATH_PATTERNS = [
  /^\/sign\/[^/]+/i,
  /^\/embed\/sign\/[^/]+/i,
  /^\/api\/signing\/[^/]+/i,
  /^\/api\/download\/[^/]+/i,
  /^\/download\/[^/]+/i,
] as const;

function normalizeLoggedPath(path: string): string {
  if (path.startsWith("/")) {
    return path;
  }

  try {
    return new URL(path).pathname;
  } catch {
    return path;
  }
}

function getConsoleMethod(level: SecurityLogLevel) {
  if (level === "info") {
    return console.info;
  }

  if (level === "warn") {
    return console.warn;
  }

  return console.error;
}

export function redactSensitivePath(path: string): string {
  const normalizedPath = normalizeLoggedPath(path);

  for (const pattern of TOKEN_PATH_PATTERNS) {
    if (pattern.test(normalizedPath)) {
      return normalizedPath.replace(pattern, (match) => {
        const segments = match.split("/");

        if (segments.length < 3) {
          return match;
        }

        segments[segments.length - 1] = "[redacted]";

        return segments.join("/");
      });
    }
  }

  return normalizedPath;
}

export function logSecurityEvent(
  level: SecurityLogLevel,
  input: SecurityLogInput,
): void {
  const consoleMethod = getConsoleMethod(level);

  consoleMethod(
    toLogLine({
      category: input.category,
      ipAddress: input.ipAddress ?? null,
      level,
      message: input.message,
      metadata: input.metadata ?? null,
      path: input.path ? redactSensitivePath(input.path) : null,
      type: "security",
      userId: input.userId ?? null,
    }),
  );
}

export type AuditLogRecord = {
  actorEmail: string | null;
  /** "user" for the site trail; the envelope trail's actor type otherwise. */
  actorType?: string | null;
  actorUserId?: string | null;
  /** Seconds since the epoch, as stored. */
  createdAt: number;
  envelopeId?: string | null;
  event: string;
  id: string;
  ipAddress: string | null;
  metadata: unknown;
  rowHash: string | null;
  sequence: number | null;
  targetUserId?: string | null;
  trail: "envelope" | "site";
  userAgent: string | null;
};

export function isAuditLogEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.AUDIT_LOG?.trim().toLowerCase() !== "off";
}

/** Writes one committed audit row as a log line. Never throws. */
export function logAuditRecord(record: AuditLogRecord): void {
  if (!isAuditLogEnabled()) {
    return;
  }

  try {
    console.info(
      toLogLine({
        actorEmail: record.actorEmail,
        actorType: record.actorType ?? null,
        actorUserId: record.actorUserId ?? null,
        envelopeId: record.envelopeId ?? null,
        event: record.event,
        id: record.id,
        ipAddress: record.ipAddress,
        level: "info",
        metadata: record.metadata ?? null,
        occurredAt: new Date(record.createdAt * 1000).toISOString(),
        rowHash: record.rowHash,
        sequence: record.sequence,
        targetUserId: record.targetUserId ?? null,
        trail: record.trail,
        type: "audit",
        userAgent: record.userAgent,
      }),
    );
  } catch {
    // A log line is a copy. Failing to write one must not fail the change.
  }
}

/** One JSON object on one line, with the fields every line shares. */
export function toLogLine(
  fields: Record<string, unknown> & { level: string; type: string },
): string {
  return JSON.stringify({
    source: "signudoc",
    time: new Date().toISOString(),
    ...fields,
  });
}

export function logRouteError(
  error: unknown,
  input: Omit<SecurityLogInput, "message"> & {
    message: string;
  },
): void {
  logSecurityEvent("error", input);
  console.error(error);
}
