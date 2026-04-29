ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS email_address TEXT,
  ADD COLUMN IF NOT EXISTS email_alerts_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS email_alerts_verified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS user_profiles_email_address_idx
  ON user_profiles (LOWER(email_address))
  WHERE email_address IS NOT NULL;

CREATE TABLE IF NOT EXISTS email_alert_preferences (
  wallet_address TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  event_types TEXT[] NOT NULL DEFAULT '{}',
  min_severity TEXT NOT NULL DEFAULT 'info',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE alert_events
  ADD COLUMN IF NOT EXISTS delivery_channel TEXT NOT NULL DEFAULT 'farcaster',
  ADD COLUMN IF NOT EXISTS email_address TEXT;
