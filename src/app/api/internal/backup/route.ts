import { NextResponse } from "next/server";

import {
  createVercelBlobStore,
  isBackupStoreTheAppStore,
  readBackupSettings,
  runBackup,
} from "@/lib/backup";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { identifyRetentionCaller } from "@/lib/retention-job";
import { logRouteError, logSecurityEvent } from "@/lib/security/logging";
import { getClientIpAddress, getRequestPathname } from "@/lib/security/request";
import { resolveStorageDriver } from "@/lib/services/storage/driver";

// The daily backup to a second Blob store (src/lib/backup.ts), called by
// Vercel's cron job (vercel.json). It does nothing until
// BACKUP_BLOB_READ_WRITE_TOKEN is set.
//
// Callers are trusted the same way as the daily cleanup's: with CRON_SECRET
// set, only Vercel's own call gets in. Without it, anyone may call, and a
// run happens at most once in 20 hours whoever asks, which is the most an
// outside caller can make it cost.

export const maxDuration = 300;

const ANONYMOUS_RUN_INTERVAL_MS = 20 * 60 * 60 * 1000;
/** Leaves time to write the summary before the function is stopped. */
const COPY_BUDGET_MS = 240_000;

async function handle(request: Request) {
  const startedAt = Date.now();
  const caller = identifyRetentionCaller(request.headers.get("authorization"));

  if (caller === "denied") {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const settings = readBackupSettings();

  if (!settings || resolveStorageDriver() !== "blob") {
    return caller === "authorized"
      ? NextResponse.json({ status: "not_configured" })
      : new NextResponse(null, { status: 204 });
  }

  if (isBackupStoreTheAppStore(settings)) {
    logSecurityEvent("error", {
      category: "backup_misconfigured",
      message:
        "BACKUP_BLOB_READ_WRITE_TOKEN is for the app's own Blob store. Make a second store for backups and use its token.",
      path: getRequestPathname(request),
    });

    return NextResponse.json(
      { error: "The backup store is the app's own store." },
      { status: 500 },
    );
  }

  if (caller === "anonymous") {
    const ration = await consumeRateLimit({
      key: "job:backup",
      limit: 1,
      windowMs: ANONYMOUS_RUN_INTERVAL_MS,
    });

    if (!ration.allowed) {
      return new NextResponse(null, { status: 204 });
    }
  }

  try {
    const summary = await runBackup({
      deadline: startedAt + COPY_BUDGET_MS,
      keepDays: settings.keepDays,
      source: createVercelBlobStore(),
      target: createVercelBlobStore(settings.token),
    });
    const failed = summary.stoppedEarly || summary.fileFailures.length > 0;

    logSecurityEvent(failed ? "error" : "info", {
      category: "backup_finished",
      message: summary.stoppedEarly
        ? "The backup is incomplete. The run reached its file-copy time limit."
        : failed
          ? `The backup finished, but ${String(summary.fileFailures.length)} files could not be copied.`
          : "The backup finished.",
      metadata: { ...summary, fileFailures: summary.fileFailures.slice(0, 20) },
    });

    if (caller === "authorized") {
      return NextResponse.json(summary, { status: failed ? 500 : 200 });
    }

    return new NextResponse(null, { status: failed ? 500 : 204 });
  } catch (error) {
    logRouteError(error, {
      category: "backup_failure",
      ipAddress: getClientIpAddress(request.headers),
      message: "The backup failed.",
      path: getRequestPathname(request),
    });

    return new NextResponse(null, { status: 500 });
  }
}

export function GET(request: Request) {
  return handle(request);
}

export function POST(request: Request) {
  return handle(request);
}
