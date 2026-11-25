import type { Metadata } from "next";

import { PublicDocumentShell } from "@/components/layout/public-document-shell";
import { RenewDownloadButton } from "@/components/downloads/renew-download-button";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Download document",
};

type ExpiredDownloadPageProps = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ access?: string }>;
};

export default async function ExpiredDownloadPage({
  params,
  searchParams,
}: ExpiredDownloadPageProps) {
  const [{ token }, { access }] = await Promise.all([params, searchParams]);

  if (access === "required" || access === "retry") {
    return (
      <PublicDocumentShell
        description="Use the access code the sender shared with you separately."
        title="Verify access to this document"
      >
        <form
          action={`/api/download/${encodeURIComponent(token)}`}
          className="grid max-w-sm gap-3"
          method="post"
        >
          {access === "retry" ? (
            <p role="alert">The access code did not match. Try again.</p>
          ) : null}
          <label htmlFor="download-access-code">Access code</label>
          <input
            autoComplete="off"
            className="rounded border p-2"
            id="download-access-code"
            maxLength={128}
            name="accessCode"
            required
            type="password"
          />
          <button className="rounded border p-2" type="submit">
            Download
          </button>
        </form>
      </PublicDocumentShell>
    );
  }

  return (
    <PublicDocumentShell
      description="Download links work for a limited time. You can have new ones sent to the email address this document was sent to."
      title="This download link has expired"
    >
      <div className="mx-auto w-full max-w-[52rem]">
        <RenewDownloadButton token={token} />
      </div>
    </PublicDocumentShell>
  );
}
