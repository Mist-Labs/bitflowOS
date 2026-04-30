import { Account, RpcProvider } from "starknet";
import type { AppConfig } from "../config.js";
import { toUint256Calldata } from "../lib/amounts.js";
import { assertStarknetAddress } from "../lib/starknet.js";
import type { FaucetClaimRecord } from "../types.js";
import { JsonStore } from "../storage/jsonStore.js";
import { getPool } from "../storage/postgres.js";

const FAUCET_TOKEN_SYMBOL = "SBTC_TEST";
const FAUCET_AMOUNT = "1";
const FAUCET_WINDOW_MS = 24 * 60 * 60 * 1000;

export class FaucetService {
  private readonly claims: JsonStore<FaucetClaimRecord>;

  constructor(private readonly config: AppConfig) {
    this.claims = JsonStore.forCollection<FaucetClaimRecord>(config.dataDir, "faucet-claims");
  }

  async mintTestToken(input: { walletAddress: string }): Promise<{
    tokenSymbol: string;
    amount: string;
    walletAddress: string;
    transactionHash: string;
    nextClaimAt: string;
  }> {
    const walletAddress = assertStarknetAddress(input.walletAddress, "walletAddress").toLowerCase();
    const lastClaim = await this.getLastClaim(walletAddress, FAUCET_TOKEN_SYMBOL);
    const waitMs = getFaucetWaitMs(lastClaim?.claimedAt);
    if (waitMs > 0) {
      throw new Error(`This wallet already received ${FAUCET_AMOUNT} ${FAUCET_TOKEN_SYMBOL}. Try again in ${formatWait(waitMs)}.`);
    }
    if (!this.config.starknetAccountAddress || !this.config.starknetPrivateKey) {
      throw new Error("Test token faucet is not configured. Set STARKNET_ACCOUNT_ADDRESS and STARKNET_PRIVATE_KEY on the backend.");
    }
    const token = this.config.tokens[FAUCET_TOKEN_SYMBOL];
    if (!token?.enabled) {
      throw new Error(`${FAUCET_TOKEN_SYMBOL} is not enabled in backend token config.`);
    }

    const [amountLow, amountHigh] = toUint256Calldata(BigInt(FAUCET_AMOUNT));
    const provider = new RpcProvider({ nodeUrl: this.config.starknetRpcUrl });
    const account = new Account({
      provider,
      address: this.config.starknetAccountAddress,
      signer: this.config.starknetPrivateKey
    });
    const execution = await account.execute([{
      contractAddress: token.address,
      entrypoint: "mint",
      calldata: [walletAddress, amountLow, amountHigh]
    }]);
    const claimedAt = new Date().toISOString();
    await this.recordClaim({
      walletAddress,
      tokenSymbol: FAUCET_TOKEN_SYMBOL,
      amount: FAUCET_AMOUNT,
      transactionHash: execution.transaction_hash,
      claimedAt
    });
    return {
      tokenSymbol: FAUCET_TOKEN_SYMBOL,
      amount: FAUCET_AMOUNT,
      walletAddress,
      transactionHash: execution.transaction_hash,
      nextClaimAt: new Date(new Date(claimedAt).getTime() + FAUCET_WINDOW_MS).toISOString()
    };
  }

  private async getLastClaim(walletAddress: string, tokenSymbol: string): Promise<FaucetClaimRecord | undefined> {
    if (this.config.databaseUrl) {
      const result = await getPool(this.config.databaseUrl).query(
        `SELECT wallet_address, token_symbol, amount, transaction_hash, claimed_at
         FROM faucet_claims
         WHERE LOWER(wallet_address) = $1 AND UPPER(token_symbol) = $2
         ORDER BY claimed_at DESC
         LIMIT 1`,
        [walletAddress.toLowerCase(), tokenSymbol.toUpperCase()]
      );
      return result.rows[0] ? rowToClaim(result.rows[0]) : undefined;
    }
    return this.claims.find(claim => (
      claim.walletAddress.toLowerCase() === walletAddress.toLowerCase()
      && claim.tokenSymbol.toUpperCase() === tokenSymbol.toUpperCase()
    ));
  }

  private async recordClaim(claim: FaucetClaimRecord): Promise<void> {
    if (this.config.databaseUrl) {
      await getPool(this.config.databaseUrl).query(
        `INSERT INTO faucet_claims (
           wallet_address, token_symbol, amount, transaction_hash, claimed_at
         ) VALUES ($1, $2, $3, $4, $5)`,
        [claim.walletAddress, claim.tokenSymbol, claim.amount, claim.transactionHash, claim.claimedAt]
      );
      return;
    }
    await this.claims.upsert(claim, candidate => (
      candidate.walletAddress.toLowerCase() === claim.walletAddress.toLowerCase()
      && candidate.tokenSymbol.toUpperCase() === claim.tokenSymbol.toUpperCase()
    ));
  }
}

export function getFaucetWaitMs(claimedAt?: string, now = Date.now()): number {
  if (!claimedAt) return 0;
  const nextClaimAt = new Date(claimedAt).getTime() + FAUCET_WINDOW_MS;
  return Math.max(0, nextClaimAt - now);
}

function rowToClaim(row: any): FaucetClaimRecord {
  return {
    walletAddress: row.wallet_address,
    tokenSymbol: row.token_symbol,
    amount: row.amount,
    transactionHash: row.transaction_hash,
    claimedAt: new Date(row.claimed_at).toISOString()
  };
}

function formatWait(waitMs: number): string {
  const hours = Math.floor(waitMs / (60 * 60 * 1000));
  const minutes = Math.ceil((waitMs % (60 * 60 * 1000)) / (60 * 1000));
  if (hours <= 0) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  return `${hours}h ${minutes}m`;
}
