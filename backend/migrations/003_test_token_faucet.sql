CREATE TABLE IF NOT EXISTS faucet_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT NOT NULL,
  token_symbol TEXT NOT NULL,
  amount TEXT NOT NULL,
  transaction_hash TEXT NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS faucet_claims_wallet_token_idx
  ON faucet_claims (LOWER(wallet_address), UPPER(token_symbol), claimed_at DESC);
