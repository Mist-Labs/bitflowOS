CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS user_profiles (
  wallet_address TEXT PRIMARY KEY,
  farcaster_username TEXT,
  farcaster_fid INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_farcaster_username_idx
  ON user_profiles (LOWER(farcaster_username))
  WHERE farcaster_username IS NOT NULL;

CREATE TABLE IF NOT EXISTS farcaster_subscriptions (
  fid INTEGER PRIMARY KEY,
  url TEXT NOT NULL,
  token TEXT NOT NULL,
  wallet_address TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS farcaster_subscriptions_wallet_idx
  ON farcaster_subscriptions (LOWER(wallet_address))
  WHERE wallet_address IS NOT NULL;

CREATE TABLE IF NOT EXISTS alert_preferences (
  fid INTEGER PRIMARY KEY,
  wallet_address TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  event_types TEXT[] NOT NULL DEFAULT '{}',
  min_severity TEXT NOT NULL DEFAULT 'info',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alert_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fid INTEGER,
  wallet_address TEXT,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  target_url TEXT,
  severity TEXT NOT NULL DEFAULT 'info',
  delivered BOOLEAN NOT NULL DEFAULT FALSE,
  delivery_reason TEXT,
  transaction_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS alert_events_wallet_idx
  ON alert_events (LOWER(wallet_address))
  WHERE wallet_address IS NOT NULL;

CREATE INDEX IF NOT EXISTS alert_events_fid_idx
  ON alert_events (fid)
  WHERE fid IS NOT NULL;
