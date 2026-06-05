-- Migration 009: ai_settings (per-practice AI assistant configuration)
-- One row per practice; upsert on conflict.

CREATE TABLE ai_settings (
  practice_id      UUID PRIMARY KEY REFERENCES practices (id) ON DELETE CASCADE,
  wake_word        TEXT NOT NULL DEFAULT 'hey denta',
  voice_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  continuous_mode  BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_ai_settings_updated_at
  BEFORE UPDATE ON ai_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
