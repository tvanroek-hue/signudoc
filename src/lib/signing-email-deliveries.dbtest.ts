import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { openTestDatabase } from "./db/test-database.ts";
import { type EmailService } from "./services/email.ts";
import {
  deliverSigningEmails,
  queueSigningEmail,
} from "./signing-email-deliveries.ts";

test("signing email retries reuse the same provider key and cancel stale invitations", async () => {
  const database = await openTestDatabase();
  const envelopeId = randomUUID();
  const signerId = randomUUID();
  const userId = randomUUID();
  const linkHash = "b".repeat(64);
  const message = {
    subject: "Sign",
    template: "signing_invitation" as const,
    textBody: "Private signing link",
    to: "signer@example.test",
  };
  try {
    await database.query(
      `INSERT INTO public."user" (id, name, email, "emailVerified")
       VALUES ($1, 'Sender', $2, true)`,
      [userId, `${userId}@example.test`],
    );
    await database.query(
      `INSERT INTO envelopes (id, user_id, title, status, source_pdf_key,
         source_pdf_filename, source_pdf_size_bytes, page_count, source_pdf_hash)
       VALUES ($1, $2, 'Test envelope', 'sent', 'test.pdf', 'test.pdf', 100, 1, $3)`,
      [envelopeId, userId, "a".repeat(64)],
    );
    await database.query(
      `INSERT INTO signers (id, envelope_id, name, email, sign_order, status,
         signing_token_hash, signing_token_expires_at)
       VALUES ($1, $2, 'Recipient', $3, 1, 'notified', $4, $5)`,
      [
        signerId,
        envelopeId,
        message.to,
        linkHash,
        Math.floor(Date.now() / 1000) + 600,
      ],
    );
    const enqueue = () =>
      queueSigningEmail(database, {
        envelopeId,
        signerId,
        message,
        tokenHash: linkHash,
      });
    await enqueue();
    const keys: Array<string | undefined> = [];
    const emailService: EmailService = {
      async send(outgoing, options) {
        assert.equal(outgoing.textBody, message.textBody);
        keys.push(options?.idempotencyKey);
        if (keys.length === 1) throw new Error("Temporary provider outage");
        return { accepted: [message.to], rejected: [] };
      },
      async sendBatch() {
        throw new Error("The queue should not batch sends");
      },
    };
    const drain = () =>
      deliverSigningEmails({ database, emailService, envelopeId });
    await drain();
    const retry = await database.query(
      "SELECT status, payload FROM signing_email_deliveries WHERE envelope_id = $1",
      [envelopeId],
    );
    assert.equal(retry.rows[0]?.status, "pending");
    assert.doesNotMatch(retry.rows[0]?.payload, /Private signing link/);

    await database.query(
      "UPDATE signing_email_deliveries SET next_attempt_at = 0 WHERE envelope_id = $1",
      [envelopeId],
    );
    await Promise.all([drain(), drain()]);
    assert.equal(keys.length, 2);
    assert.equal(keys[0], keys[1]);

    await enqueue();
    await database.query(
      "UPDATE signers SET signing_token_hash = NULL WHERE id = $1",
      [signerId],
    );
    await drain();
    const results = await database.query(
      "SELECT status, payload FROM signing_email_deliveries WHERE envelope_id = $1 ORDER BY status",
      [envelopeId],
    );
    assert.deepEqual(results.rows, [
      { status: "cancelled", payload: null },
      { status: "sent", payload: null },
    ]);
    assert.equal(keys.length, 2);
  } finally {
    await database.query('DELETE FROM public."user" WHERE id = $1', [userId]);
    await database.end();
  }
});
