"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type EnvelopeDeliveryRecipient = {
  id: string;
  email: string;
  status: "pending" | "failed" | "sent" | "cancelled" | null;
  hasDownloadLink: boolean;
};

const labels = {
  cancelled: "Cancelled",
  failed: "Email failed",
  pending: "Email queued",
  sent: "Accepted by email provider",
};

export function EnvelopeDeliveryPanel({
  completed,
  envelopeId,
  recipients,
}: {
  completed: boolean;
  envelopeId: string;
  recipients: EnvelopeDeliveryRecipient[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  async function change(
    action: "retry" | "revoke" | "reissue",
    recipientId?: string,
  ) {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(
        `/api/envelopes/${encodeURIComponent(envelopeId)}/delivery`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, recipientId }),
        },
      );
      if (!response.ok) throw new Error();
      setNotice(
        action === "revoke"
          ? "Previous download links were revoked."
          : "Email queue updated.",
      );
      router.refresh();
    } catch {
      setNotice("Unable to update delivery. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (recipients.length === 0) return null;

  return (
    <section
      className="well mt-3 space-y-3 px-5 py-4"
      aria-label="Recipient delivery"
    >
      <h2 className="font-medium">Recipient delivery</h2>
      <ul className="space-y-3 text-sm">
        {recipients.map((recipient) => (
          <li key={recipient.id} className="flex flex-wrap items-center gap-3">
            <span className="break-all">{recipient.email}</span>
            {recipient.status ? <span>{labels[recipient.status]}</span> : null}
            {completed ? (
              <>
                {recipient.hasDownloadLink ? (
                  <button
                    type="button"
                    className="btn-quiet"
                    disabled={busy}
                    onClick={() => void change("revoke", recipient.id)}
                  >
                    Revoke links
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn-quiet"
                  disabled={busy}
                  onClick={() => void change("reissue", recipient.id)}
                >
                  Send fresh links
                </button>
              </>
            ) : null}
          </li>
        ))}
      </ul>
      {recipients.some((recipient) => recipient.status === "failed") ? (
        <button
          type="button"
          className="btn-quiet"
          disabled={busy}
          onClick={() => void change("retry")}
        >
          Retry failed emails
        </button>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
    </section>
  );
}
