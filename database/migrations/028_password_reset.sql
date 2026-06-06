-- Migration 028: password reset tokens

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,          -- SHA-256 of the raw token sent in the email
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '1 hour'),
  used       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_prt_user ON password_reset_tokens (user_id);
CREATE INDEX idx_prt_hash ON password_reset_tokens (token_hash) WHERE used = FALSE;

-- Auto-purge expired tokens (run via cron or on each request)
-- DELETE FROM password_reset_tokens WHERE expires_at < NOW() OR used = TRUE;
