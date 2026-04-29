# BitflowOS Backend

TypeScript backend for BitflowOS. The backend is non-custodial: it creates Atomiq native BTC or Lightning BTC quotes, tracks bridge intents, and returns Starknet transaction calls for the user's wallet to deposit the received BTC wrapper into the BitflowOS vault.

StarkZap is the core wallet and Starknet UX layer. The frontend should use the backend's StarkZap config endpoint to present three first-class entry paths: external Starknet wallet, Privy embedded wallet, and Cartridge passkey/session wallet.

## Flow

```txt
BTC or Lightning BTC
  -> Atomiq BTC to Starknet swap
  -> user's Starknet wallet receives WBTC or configured BTC wrapper
  -> frontend requests BitflowOS deposit calls
  -> user signs approve + vault deposit
```

## Commands

```bash
npm install
npm run build
npm test
npm run dev
```

## Key Endpoints

- `POST /api/btc-bridge/quote`
- `GET /api/btc-bridge/intents/:id`
- `GET /api/starkzap/config`
- `GET /api/wallet/options`
- `GET /api/vault/state?userAddress=0x...`
- `POST /api/vault/deposit-calls`
- `POST /api/vault/withdraw-call`
- `POST /api/router/read-calls`
- `POST /api/alerts/farcaster/webhook`
- `POST /api/alerts/preferences`

## Security Notes

- The backend never receives Bitcoin private keys or Starknet private keys.
- Atomiq outputs to the user's Starknet wallet, not directly to the vault.
- Vault deposits are explicit wallet-signed `approve` and `deposit` calls.
- Farcaster notification tokens are stored locally under `DATA_DIR`; use managed secrets/storage in production.
