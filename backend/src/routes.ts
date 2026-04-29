import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "./config.js";
import { AtomiqBridgeService } from "./services/atomiqBridge.js";
import { VaultService } from "./services/vault.js";
import { AlertService } from "./services/alerts.js";
import { StarkZapService } from "./services/starkzap.js";
import { MarketDataService } from "./services/marketData.js";
import { EkuboService } from "./services/ekubo.js";
import { KimiRecommendationService } from "./services/kimi.js";
import { ZeroGVerifierService } from "./services/zeroGVerifier.js";
import { UserProfileService } from "./services/userProfiles.js";
import { PrivyStarkZapService } from "./services/privyStarkZap.js";
import { CapitalDeploymentService } from "./services/capitalDeployment.js";

const BtcBridgeQuoteSchema = z.object({
  amountSats: z.string().regex(/^[1-9]\d*$/),
  destinationAddress: z.string(),
  outputToken: z.string().optional(),
  source: z.enum(["BTC", "BTCLN"]).optional(),
  userId: z.string().optional(),
  farcasterFid: z.number().int().positive().optional()
});

const DepositCallsSchema = z.object({
  tokenSymbol: z.string(),
  amountBaseUnits: z.string().regex(/^[1-9]\d*$/)
});

const WithdrawCallSchema = z.object({
  tokenSymbol: z.string(),
  sharesBaseUnits: z.string().regex(/^[1-9]\d*$/)
});

const RouterReadCallsSchema = z.object({
  tokenSymbol: z.string(),
  strategyId: z.string().regex(/^0x[0-9a-fA-F]+$/)
});

const RouterHarvestCallSchema = RouterReadCallsSchema;

const PrivyStarknetWalletSchema = z.object({
  userId: z.string().min(1)
});

const PrivyRawSignSchema = z.object({
  walletId: z.string().min(1),
  hash: z.string().regex(/^0x[0-9a-fA-F]+$/)
});

const VaultStateQuerySchema = z.object({
  userAddress: z.string().regex(/^0x[0-9a-fA-F]+$/).optional()
});

const EkuboQuoteSchema = z.object({
  routeKey: z.string().optional(),
  tokenSymbol: z.string().optional(),
  amountBaseUnits: z.string().regex(/^[1-9]\d*$/).optional()
});

const FarcasterWebhookSchema = z.object({
  fid: z.number().int().positive().optional(),
  event: z.union([
    z.string(),
    z.object({
      event: z.string(),
      username: z.string().optional(),
      notificationDetails: z.object({
        url: z.string().url(),
        token: z.string().min(8)
      }).optional(),
      walletAddress: z.string().optional()
    }).passthrough()
  ]),
  username: z.string().optional(),
  notificationDetails: z.object({
    url: z.string().url(),
    token: z.string().min(8)
  }).optional(),
  walletAddress: z.string().optional()
}).passthrough();

const AlertPreferenceSchema = z.object({
  fid: z.number().int().positive(),
  walletAddress: z.string().optional(),
  enabled: z.boolean(),
  eventTypes: z.array(z.string()),
  minSeverity: z.enum(["info", "warning", "critical"]).default("info")
});

const RecommendationSchema = z.object({
  walletAddress: z.string().regex(/^0x[0-9a-fA-F]+$/).optional(),
  assetSymbol: z.string().optional(),
  amountBaseUnits: z.string().regex(/^[1-9]\d*$/).optional()
});

const CapitalDeploySchema = z.object({
  recommendation: z.object({
    id: z.string(),
    walletAddress: z.string().optional(),
    assetSymbol: z.string(),
    status: z.enum(["ready", "fallback", "blocked"]),
    confidenceBps: z.number().int().min(0).max(10000),
    weights: z.array(z.object({
      strategyId: z.string(),
      label: z.string(),
      targetBps: z.number().int().min(0).max(10000),
      rationale: z.string()
    })),
    riskChecks: z.array(z.object({
      id: z.string(),
      label: z.string(),
      passed: z.boolean(),
      detail: z.string()
    })),
    reasoning: z.string(),
    attestation: z.object({
      provider: z.string(),
      verified: z.boolean(),
      verificationMode: z.enum(["0g", "external", "not_configured"]),
      chatId: z.string().optional(),
      providerAddress: z.string().optional(),
      attestationHash: z.string().optional(),
      setupRequired: z.array(z.string()).optional()
    }),
    createdAt: z.string()
  })
});

const ZeroGVerifySchema = z.object({
  providerAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  chatId: z.string().optional()
});

const FarcasterUsernameSchema = z.object({
  walletAddress: z.string().regex(/^0x[0-9a-fA-F]+$/),
  farcasterUsername: z.string(),
  farcasterFid: z.number().int().positive().optional()
});

const FarcasterClientSubscriptionSchema = z.object({
  walletAddress: z.string().regex(/^0x[0-9a-fA-F]+$/),
  fid: z.number().int().positive(),
  username: z.string().optional(),
  notificationDetails: z.object({
    url: z.string().url(),
    token: z.string().min(8)
  })
});

export async function registerRoutes(app: FastifyInstance, config: AppConfig): Promise<void> {
  const bridge = new AtomiqBridgeService(config);
  const vault = new VaultService(config);
  const alerts = new AlertService(config);
  const starkzap = new StarkZapService(config);
  const marketData = new MarketDataService();
  const ekubo = new EkuboService(config);
  const kimi = new KimiRecommendationService(config);
  const zeroG = new ZeroGVerifierService(config);
  const profiles = new UserProfileService(config);
  const privyStarkZap = new PrivyStarkZapService(config);
  const capitalDeployment = new CapitalDeploymentService(config);

  app.get("/health", async () => ({
    ok: true,
    service: "bitflowos-backend",
    network: config.starknetNetwork
  }));

  app.get("/api/config", async () => ({
    starknetNetwork: config.starknetNetwork,
    bitcoinNetwork: config.bitcoinNetwork,
    contracts: {
      vault: config.bitflowosVaultAddress,
      router: config.bitflowosStrategyRouterAddress,
      attestationRegistry: config.bitflowosAttestationRegistryAddress,
      erc4626Adapter: config.bitflowosErc4626AdapterAddress,
      leveragedVaultAdapter: config.bitflowosLeveragedVaultAdapterAddress,
      ekuboAdapter: config.bitflowosEkuboAdapterAddress
    },
    vaultAddress: config.bitflowosVaultAddress,
    tokens: Object.values(config.tokens).filter(token => token.enabled),
    strategyRoutes: Object.values(config.strategyRoutes),
    nativeBtcBridge: {
      provider: "atomiq",
      sources: ["BTC", "BTCLN"],
      defaultOutputToken: config.atomiqDefaultOutputToken
    }
  }));

  app.get("/api/starkzap/config", async () => starkzap.getFrontendConfig());

  app.get("/api/wallet/options", async () => starkzap.getFrontendConfig().walletEntryPoints);

  app.post("/api/privy/starknet-wallet", async request => {
    const input = PrivyStarknetWalletSchema.parse(request.body);
    const wallet = await privyStarkZap.getOrCreateStarknetWallet(input.userId);
    return {
      walletId: wallet.id,
      address: wallet.address,
      publicKey: wallet.public_key,
      serverUrl: `${config.privyServerUrl || `http://${config.host}:${config.port}`}/api/privy/raw-sign`
    };
  });

  app.post("/api/privy/raw-sign", async request => {
    const input = PrivyRawSignSchema.parse(request.body);
    return {
      signature: await privyStarkZap.rawSign(input.walletId, input.hash)
    };
  });

  app.get("/api/market/ticker", async () => ({
    items: await marketData.getTicker()
  }));

  app.post("/api/btc-bridge/quote", async request => {
    const input = BtcBridgeQuoteSchema.parse(request.body);
    const intent = await bridge.createBtcToStarknetIntent(input);
    if (intent.farcasterFid) {
      await alerts.send({
        fid: intent.farcasterFid,
        type: "bridge_started",
        title: "BTC bridge quote ready",
        body: "Send BTC to the quoted address to start your BitflowOS deposit.",
        targetUrl: `${config.farcasterAppUrl}/bridge/${intent.id}`
      });
    }
    return intent;
  });

  app.get("/api/btc-bridge/intents", async () => bridge.listIntents());

  app.get("/api/btc-bridge/intents/:id", async (request, reply) => {
    const id = z.object({ id: z.string().uuid() }).parse(request.params).id;
    const intent = await bridge.getIntent(id);
    if (!intent) {
      return reply.status(404).send({ error: "not_found", message: "bridge intent not found" });
    }
    return intent;
  });

  app.post("/api/vault/deposit-calls", async request => {
    const input = DepositCallsSchema.parse(request.body);
    return vault.buildDepositCalls(input);
  });

  app.post("/api/vault/withdraw-call", async request => {
    const input = WithdrawCallSchema.parse(request.body);
    return vault.buildWithdrawCall(input);
  });

  app.post("/api/router/read-calls", async request => {
    const input = RouterReadCallsSchema.parse(request.body);
    return vault.buildRouterReadCalls(input);
  });

  app.post("/api/router/harvest-call", async request => {
    const input = RouterHarvestCallSchema.parse(request.body);
    return vault.buildRouterHarvestCall(input);
  });

  app.get("/api/vault/state", async request => {
    const query = VaultStateQuerySchema.parse(request.query);
    return vault.getVaultState(query.userAddress);
  });

  app.get("/api/strategies/ekubo/quote", async request => {
    const query = EkuboQuoteSchema.parse(request.query);
    return ekubo.getRouteQuote(query);
  });

  app.post("/api/strategies/ekubo/quote", async request => {
    const input = EkuboQuoteSchema.parse(request.body);
    return ekubo.getRouteQuote(input);
  });

  app.get("/api/ai/status", async () => kimi.getStatus());

  app.post("/api/ai/recommendation", async request => {
    const input = RecommendationSchema.parse(request.body);
    return kimi.recommend(input);
  });

  app.post("/api/ai/deploy-capital", async request => {
    const input = CapitalDeploySchema.parse(request.body);
    return capitalDeployment.deploy(input);
  });

  app.post("/api/ai/verify", async request => {
    const input = ZeroGVerifySchema.parse(request.body);
    if (input.chatId) return zeroG.verifyResponse(input);
    return zeroG.verifyProvider(input.providerAddress);
  });

  app.get("/api/users/:walletAddress", async (request, reply) => {
    const { walletAddress } = z.object({
      walletAddress: z.string().regex(/^0x[0-9a-fA-F]+$/)
    }).parse(request.params);
    const profile = await profiles.get(walletAddress);
    if (!profile) {
      return reply.status(404).send({ error: "not_found", message: "user profile not found" });
    }
    return {
      ...profile,
      farcasterNotificationsEnabled: await alerts.hasEnabledSubscriptionForWallet(walletAddress)
    };
  });

  app.post("/api/users/farcaster-username", async request => {
    const input = FarcasterUsernameSchema.parse(request.body);
    const profile = await profiles.setFarcasterUsername(input);
    return {
      profile,
      alerts: [
        "bridge_started",
        "bridge_completed",
        "deposit_confirmed",
        "harvest_available",
        "withdrawal_completed",
        "position_health_warning",
        "transaction_failed"
      ],
      farcasterNotificationsEnabled: await alerts.hasEnabledSubscriptionForWallet(input.walletAddress),
      welcome: `Farcaster username saved for @${input.farcasterUsername.replace(/^@/, "")}. To receive inbox alerts, add the BitflowOS Mini App and enable notifications.`
    };
  });

  app.post("/api/alerts/farcaster/client-subscription", async request => {
    const input = FarcasterClientSubscriptionSchema.parse(request.body);
    const profile = await profiles.get(input.walletAddress);
    await alerts.upsertSubscription({
      fid: input.fid,
      url: input.notificationDetails.url,
      token: input.notificationDetails.token,
      walletAddress: input.walletAddress,
      enabled: true
    });
    await profiles.setFarcasterUsername({
      walletAddress: input.walletAddress,
      farcasterUsername: profile?.farcasterUsername ?? input.username ?? String(input.fid),
      farcasterFid: input.fid
    });
    return {
      ok: true,
      farcasterNotificationsEnabled: await alerts.hasEnabledSubscriptionForWallet(input.walletAddress)
    };
  });

  app.post("/api/alerts/farcaster/webhook", async request => {
    const payload = FarcasterWebhookSchema.parse(request.body);
    const eventName = typeof payload.event === "string" ? payload.event : payload.event.event;
    const notificationDetails = typeof payload.event === "string" ? payload.notificationDetails : payload.event.notificationDetails;
    const walletAddress = typeof payload.event === "string" ? payload.walletAddress : payload.event.walletAddress ?? payload.walletAddress;
    const username = typeof payload.event === "string" ? payload.username : payload.event.username ?? payload.username;

    if ((eventName === "miniapp_removed" || eventName === "notifications_disabled") && payload.fid) {
      await alerts.upsertSubscription({
        fid: payload.fid,
        url: notificationDetails?.url ?? "https://api.farcaster.xyz/v1/frame-notifications",
        token: notificationDetails?.token ?? "disabled",
        walletAddress,
        enabled: false
      });
      return { ok: true };
    }

    if (notificationDetails && payload.fid) {
      const profile = walletAddress
        ? await profiles.get(walletAddress)
        : username
          ? await profiles.getByUsername(username)
          : await profiles.getByFid(payload.fid);
      await alerts.upsertSubscription({
        fid: payload.fid,
        url: notificationDetails.url,
        token: notificationDetails.token,
        walletAddress: walletAddress ?? profile?.walletAddress,
        enabled: true
      });
      if (profile?.walletAddress) {
        await profiles.setFarcasterUsername({
          walletAddress: profile.walletAddress,
          farcasterUsername: profile.farcasterUsername ?? username ?? String(payload.fid),
          farcasterFid: payload.fid
        });
      }
    }

    return { ok: true };
  });

  app.post("/api/alerts/preferences", async request => {
    const input = AlertPreferenceSchema.parse(request.body);
    return alerts.setPreferences({
      fid: input.fid,
      walletAddress: input.walletAddress,
      enabled: input.enabled,
      eventTypes: input.eventTypes as any,
      minSeverity: input.minSeverity,
      updatedAt: new Date().toISOString()
    });
  });

  app.get("/api/alerts/preferences", async request => {
    const query = z.object({
      walletAddress: z.string().regex(/^0x[0-9a-fA-F]+$/)
    }).parse(request.query);
    const profile = await profiles.get(query.walletAddress);
    const existing = await alerts.getPreferencesForWallet(query.walletAddress);
    return existing ?? {
      fid: profile?.farcasterFid,
      walletAddress: query.walletAddress,
      enabled: true,
      eventTypes: [
        "bridge_started",
        "bridge_completed",
        "deposit_confirmed",
        "staking_started",
        "harvest_available",
        "withdrawal_requested",
        "withdrawal_completed",
        "position_health_warning",
        "transaction_failed"
      ],
      minSeverity: "info",
      updatedAt: new Date().toISOString()
    };
  });

  app.post("/api/alerts/position-event", async request => {
    const input = z.object({
      walletAddress: z.string().regex(/^0x[0-9a-fA-F]+$/),
      type: z.enum(["deposit_confirmed", "staking_started", "withdrawal_requested", "withdrawal_completed", "transaction_failed"]),
      title: z.string(),
      body: z.string(),
      transactionHash: z.string().optional()
    }).parse(request.body);
    return alerts.send({
      walletAddress: input.walletAddress,
      type: input.type,
      title: input.title,
      body: input.body,
      targetUrl: config.farcasterAppUrl,
      transactionHash: input.transactionHash
    });
  });
}
