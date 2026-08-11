CREATE TABLE IF NOT EXISTS facebook_email_receipts (
  mailbox TEXT NOT NULL,
  uid TEXT NOT NULL,
  message_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('processed', 'ignored', 'review')),
  source_id TEXT,
  external_id TEXT,
  error_code TEXT,
  processed_at TEXT NOT NULL,
  PRIMARY KEY (mailbox, uid)
);

CREATE INDEX IF NOT EXISTS facebook_email_receipts_processed_idx
  ON facebook_email_receipts(processed_at, status);
