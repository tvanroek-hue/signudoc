import { NextResponse } from "next/server";
import { z } from "zod";

import { requireVerifiedSenderSession } from "@/lib/auth/route-session";
import { getDb, queryOne } from "@/lib/db/connection";
import { logSecurityEvent } from "@/lib/security/logging";
import {
  applyRateLimit,
  buildRateLimitKey,
} from "@/lib/security/route-controls";
import { createLazyEmailService } from "@/lib/services/email";
import { changeCompletedDownloadAccess } from "@/lib/signing";
import { deliverSigningEmails } from "@/lib/signing-email-deliveries";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("retry") }),
  z.object({
    action: z.enum(["reissue", "revoke"]),
    recipientId: z.string().min(1).max(128),
  }),
]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireVerifiedSenderSession(request);
  if (session instanceof Response) return session;

  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return NextResponse.json({ error: "Expected JSON." }, { status: 415 });
  }

  const { id } = await params;
  const database = getDb();
  const owner = await queryOne(
    database,
    "SELECT id FROM envelopes WHERE id = $1 AND user_id = $2",
    [id, session.user.id],
  );
  if (!owner)
    return NextResponse.json({ error: "Envelope not found." }, { status: 404 });

  const denied = await applyRateLimit({
    category: "envelope_delivery",
    key: buildRateLimitKey(["envelope-delivery", session.user.id, id]),
    limit: 20,
    request,
    userId: session.user.id,
    windowMs: 60 * 60 * 1000,
  });
  if (denied) return denied;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "Invalid delivery action." },
      { status: 400 },
    );

  const data = parsed.data;
  if (data.action === "retry") {
    await database.query(
      `UPDATE signing_email_deliveries SET status = 'pending', attempts = 0,
       next_attempt_at = $2, locked_until = NULL
       WHERE envelope_id = $1 AND status = 'failed' AND payload IS NOT NULL`,
      [id, Math.floor(Date.now() / 1000)],
    );
  } else if (
    !(await changeCompletedDownloadAccess(
      session.user.id,
      id,
      data.recipientId,
      data.action,
      database,
    ))
  ) {
    return NextResponse.json(
      { error: "Recipient not found." },
      { status: 404 },
    );
  }

  logSecurityEvent("info", {
    category: `envelope_delivery_${data.action}`,
    message: "The envelope owner updated email delivery or download access.",
    metadata: {
      envelopeId: id,
      recipientId: data.action === "retry" ? null : data.recipientId,
    },
    userId: session.user.id,
  });

  if (data.action !== "revoke") {
    await deliverSigningEmails({
      database,
      emailService: createLazyEmailService(),
      envelopeId: id,
    });
  }
  return new NextResponse(null, { status: 204 });
}
