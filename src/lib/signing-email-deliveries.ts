import { randomUUID } from "node:crypto";

import {
  type DbExecutor,
  type DbPool,
  queryOne,
  withTransaction,
} from "./db/connection.ts";
import { recordEmailSent } from "./services/audit.ts";
import {
  type EmailService,
  type TransactionalEmailMessage,
} from "./services/email.ts";
import {
  decryptPrivateKey,
  encryptPrivateKey,
  secretKeyFor,
} from "./services/seal-identity.ts";

const MAX_ATTEMPTS = 5;
const LOCK_SECONDS = 120;

type Delivery = {
  attempts: number;
  envelopeId: string;
  id: string;
  lockedUntil: number;
  payload: string;
  signerId: string | null;
  template: "signing_invitation" | "completion_notification";
};

function deliveryKey(id: string) {
  return secretKeyFor(`signudoc/signing-email/v1/${id}`);
}

export async function queueSigningEmail(
  database: DbExecutor,
  input: {
    envelopeId: string;
    message: TransactionalEmailMessage;
    signerId: string | null;
    tokenHash?: string;
  },
): Promise<void> {
  const id = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  // The rendered message contains bearer links. Keep it encrypted even in
  // database exports and erase it after it has finished serving its purpose.
  const payload = encryptPrivateKey(
    JSON.stringify(input.message),
    deliveryKey(id),
  );

  await database.query(
    `INSERT INTO signing_email_deliveries
       (id, envelope_id, signer_id, token_hash, template, payload, next_attempt_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
    [
      id,
      input.envelopeId,
      input.signerId,
      input.tokenHash ?? null,
      input.message.template,
      payload,
      now,
    ],
  );
}

async function claimDelivery(database: DbPool, envelopeId: string | null) {
  const now = Math.floor(Date.now() / 1000);
  await database.query(
    `UPDATE signing_email_deliveries SET status = 'failed', locked_until = NULL
     WHERE status = 'pending' AND attempts >= $1 AND locked_until <= $2
       AND ($3::text IS NULL OR envelope_id = $3)`,
    [MAX_ATTEMPTS, now, envelopeId],
  );

  return queryOne<Delivery>(
    database,
    `WITH due AS (
       SELECT id FROM signing_email_deliveries
       WHERE status = 'pending' AND next_attempt_at <= $1
         AND (locked_until IS NULL OR locked_until <= $1) AND attempts < $2
         AND ($3::text IS NULL OR envelope_id = $3)
       ORDER BY next_attempt_at, id LIMIT 1 FOR UPDATE SKIP LOCKED
     )
     UPDATE signing_email_deliveries d SET attempts = attempts + 1, locked_until = $4
     FROM due WHERE d.id = due.id
     RETURNING d.id, d.payload, d.attempts, d.template, d.locked_until AS "lockedUntil",
       d.envelope_id AS "envelopeId", d.signer_id AS "signerId"`,
    [now, MAX_ATTEMPTS, envelopeId, now + LOCK_SECONDS],
  );
}

async function deliveryIsCurrent(database: DbPool, delivery: Delivery) {
  const result = await queryOne<{ valid: boolean }>(
    database,
    `SELECT EXISTS (
       SELECT 1 FROM signing_email_deliveries d JOIN envelopes e ON e.id = d.envelope_id
       LEFT JOIN signers s ON s.id = d.signer_id AND s.envelope_id = e.id
       WHERE d.id = $1 AND d.attempts = $2 AND d.status = 'pending' AND d.locked_until = $4
         AND (
           (d.template = 'completion_notification' AND e.status = 'completed'
             AND (d.signer_id IS NULL OR EXISTS (
               SELECT 1 FROM recipient_download_tokens t
               WHERE t.envelope_id = e.id AND t.signer_id = d.signer_id
                 AND t.token_hash = d.token_hash AND t.expires_at > $3
             )))
           OR (d.template = 'signing_invitation' AND e.status = 'sent'
             AND s.status = 'notified' AND s.signing_token_hash = d.token_hash
             AND s.signing_token_expires_at > $3)
         )
     ) AS valid`,
    [
      delivery.id,
      delivery.attempts,
      Math.floor(Date.now() / 1000),
      delivery.lockedUntil,
    ],
  );
  return result?.valid === true;
}

export async function deliverSigningEmails({
  database,
  emailService,
  envelopeId = null,
  limit = 25,
}: {
  database: DbPool;
  emailService: EmailService;
  envelopeId?: string | null;
  limit?: number;
}) {
  for (let index = 0; index < limit; index += 1) {
    const delivery = await claimDelivery(database, envelopeId);
    if (!delivery) return;

    try {
      const payload = decryptPrivateKey(
        delivery.payload,
        deliveryKey(delivery.id),
      );
      if (!payload || !(await deliveryIsCurrent(database, delivery))) {
        await database.query(
          `UPDATE signing_email_deliveries
           SET status = 'cancelled', payload = NULL, locked_until = NULL
           WHERE id = $1 AND attempts = $2 AND locked_until = $3`,
          [delivery.id, delivery.attempts, delivery.lockedUntil],
        );
        continue;
      }

      const message: TransactionalEmailMessage = JSON.parse(payload);
      const result = await emailService.send(message, {
        idempotencyKey: `signing-email/${delivery.id}`,
      });
      await withTransaction(async (tx) => {
        const changed = await tx.query(
          `UPDATE signing_email_deliveries
           SET status = 'sent', payload = NULL, locked_until = NULL
           WHERE id = $1 AND attempts = $2 AND status = 'pending' AND locked_until = $3`,
          [delivery.id, delivery.attempts, delivery.lockedUntil],
        );
        if (changed.rowCount) {
          await recordEmailSent(
            {
              envelopeId: delivery.envelopeId,
              messageId: result.messageId,
              recipient: message.to,
              signerId: delivery.signerId,
              template: delivery.template,
            },
            tx,
          );
        }
      }, database);
    } catch {
      const now = Math.floor(Date.now() / 1000);
      await database.query(
        `UPDATE signing_email_deliveries SET
           status = CASE WHEN attempts >= $3 THEN 'failed' ELSE 'pending' END,
           locked_until = NULL, next_attempt_at = $4
         WHERE id = $1 AND attempts = $2 AND status = 'pending' AND locked_until = $5`,
        [
          delivery.id,
          delivery.attempts,
          MAX_ATTEMPTS,
          now + 60 * 2 ** (delivery.attempts - 1),
          delivery.lockedUntil,
        ],
      );
    }
  }
}
