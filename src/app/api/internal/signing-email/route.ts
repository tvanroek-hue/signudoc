import { NextResponse } from "next/server";

import { getDb } from "@/lib/db/connection";
import { identifyRetentionCaller } from "@/lib/retention-job";
import { createLazyEmailService } from "@/lib/services/email";
import { deliverSigningEmails } from "@/lib/signing-email-deliveries";

export const maxDuration = 60;

export async function GET(request: Request) {
  if (
    identifyRetentionCaller(request.headers.get("authorization")) !==
    "authorized"
  ) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  await deliverSigningEmails({
    database: getDb(),
    emailService: createLazyEmailService(),
    limit: 10,
  });
  return new NextResponse(null, { status: 204 });
}
