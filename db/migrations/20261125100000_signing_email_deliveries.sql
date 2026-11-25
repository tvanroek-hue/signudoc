CREATE TABLE signing_email_deliveries (
  id uuid PRIMARY KEY,
  envelope_id text NOT NULL REFERENCES envelopes(id) ON DELETE CASCADE,
  signer_id text REFERENCES signers(id) ON DELETE CASCADE,
  token_hash text,
  template text NOT NULL CHECK (template IN ('signing_invitation', 'completion_notification')),
  payload text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at bigint NOT NULL,
  locked_until bigint,
  created_at bigint NOT NULL
);

CREATE INDEX signing_email_due
  ON signing_email_deliveries (next_attempt_at, id) WHERE status = 'pending';
CREATE INDEX signing_email_envelope ON signing_email_deliveries (envelope_id);
