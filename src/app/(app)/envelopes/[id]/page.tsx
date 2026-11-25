import type { EnvelopeDeliveryRecipient } from "@/components/envelopes/envelope-delivery-panel";
import {
  EnvelopeDetailShell,
  type EnvelopeDeletionNotice,
} from "@/components/envelopes/envelope-detail-shell";
import { isAdminUser } from "@/lib/auth/admin";
import { getAuthSession } from "@/lib/auth/server";
import { getDb, queryMany } from "@/lib/db/connection";
import {
  formatEnvelopeOwner,
  resolveEnvelopeViewerAccess,
} from "@/lib/envelope-access";
import { getScheduledEnvelopeDeletion } from "@/lib/envelope-deletion";
import { getEnvelopeDetailDataForUser } from "@/lib/envelopes";

const deletionDateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
  year: "numeric",
});

type EnvelopeDetailPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function EnvelopeDetailPage({
  params,
}: EnvelopeDetailPageProps) {
  const { id } = await params;

  let detailRecord: Awaited<ReturnType<typeof getEnvelopeDetailDataForUser>> =
    null;
  let initialState: "error" | "not-found" | undefined;
  let canDeleteFinished = false;
  let ownerLabel: string | undefined;
  let ownerListView: "all" | "team" = "all";
  let deliveryRecipients: EnvelopeDeliveryRecipient[] = [];
  let scheduledDeletion: EnvelopeDeletionNotice | undefined;

  try {
    const session = await getAuthSession();
    // Its sender's, or, once sent, a teammate's or any administrator's.
    const access = session
      ? await resolveEnvelopeViewerAccess(session.user.id, id, getDb())
      : null;

    detailRecord = access
      ? await getEnvelopeDetailDataForUser(access.ownerUserId, id, getDb())
      : null;
    if (access?.viewerIsOwner && detailRecord) {
      deliveryRecipients = await queryMany<EnvelopeDeliveryRecipient>(
        getDb(),
        `SELECT s.id, s.email, d.status,
           EXISTS (SELECT 1 FROM recipient_download_tokens t
             WHERE t.envelope_id = s.envelope_id AND t.signer_id = s.id) AS "hasDownloadLink"
         FROM signers s
         LEFT JOIN LATERAL (
           SELECT status FROM signing_email_deliveries d
           WHERE d.envelope_id = s.envelope_id AND d.signer_id = s.id
           ORDER BY d.created_at DESC, d.id DESC LIMIT 1
         ) d ON true
         WHERE s.envelope_id = $1
           AND (d.status IS NOT NULL OR $2::boolean AND (s.status = 'signed' OR s.role = 'cc'))
         ORDER BY s.sign_order, s.id`,
        [id, detailRecord.status === "completed"],
      );
    }
    initialState = detailRecord ? undefined : "not-found";
    ownerLabel =
      access && !access.viewerIsOwner ? formatEnvelopeOwner(access) : undefined;
    // Only an administrator may delete a finished envelope.
    canDeleteFinished =
      detailRecord !== null &&
      session !== null &&
      (await isAdminUser(session.user.id, getDb()));
    // Back to everyone's envelopes for an administrator, to the team's
    // for a teammate.
    ownerListView = canDeleteFinished ? "all" : "team";

    const scheduled = detailRecord
      ? await getScheduledEnvelopeDeletion(id, getDb())
      : null;

    scheduledDeletion = scheduled
      ? {
          deleteOnLabel: deletionDateFormatter.format(
            new Date(scheduled.deleteAfter * 1000),
          ),
          // Why is for administrators; the sender is told who asked.
          reason: canDeleteFinished ? scheduled.reason : null,
          requestedByEmail: scheduled.requestedByEmail,
        }
      : undefined;
  } catch {
    initialState = "error";
  }

  return (
    <EnvelopeDetailShell
      canDeleteFinished={canDeleteFinished}
      envelopeId={id}
      deliveryRecipients={deliveryRecipients}
      initialState={initialState}
      key={id}
      ownerLabel={ownerLabel}
      ownerListView={ownerListView}
      record={detailRecord ?? undefined}
      scheduledDeletion={scheduledDeletion}
    />
  );
}
