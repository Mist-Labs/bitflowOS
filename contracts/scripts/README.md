# Deployment

Mainnet deployment is config-driven. Use `contracts/config/deployment.mainnet.json` for order,
constructor arguments, and post-deploy calls.

Required verification before sending transactions:

1. Run `scarb build`.
2. Run `scarb test`.
3. Confirm protocol addresses in `contracts/config/mainnet_protocols.json`.
4. Deploy `AttestationRegistry`, `YieldVault`, then `StrategyRouter`.
5. Wire `AttestationRegistry.set_consumer(router)` and `YieldVault.set_router(router)`.
6. Deploy route adapters and configure protocol-specific positions/vaults.
7. Register each adapter in `StrategyRouter` with conservative `max_bps`.

Sepolia protocol coverage is partial. Ekubo has official Sepolia deployments. Endur publishes
Sepolia xSTRK contracts but BTC LSTs are marked work-in-progress. Vesu and 0D do not have confirmed
Sepolia addresses in the stored official docs.
