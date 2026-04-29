#[feature("deprecated-starknet-consts")]
use starknet::{ContractAddress, contract_address_const};
use snforge_std::{
    declare, start_cheat_block_timestamp_global, start_cheat_caller_address,
    stop_cheat_caller_address,
    ContractClassTrait, DeclareResultTrait,
};

use contracts::interfaces::Allocation;
use contracts::interfaces::IAdapterAdminDispatcher;
use contracts::interfaces::IAdapterAdminDispatcherTrait;
use contracts::interfaces::IAttestationRegistryDispatcher;
use contracts::interfaces::IAttestationRegistryDispatcherTrait;
use contracts::interfaces::IAttestationRegistrySafeDispatcher;
use contracts::interfaces::IAttestationRegistrySafeDispatcherTrait;
use contracts::interfaces::IERC20Dispatcher;
use contracts::interfaces::IERC20DispatcherTrait;
use contracts::interfaces::IErc4626VaultAdapterAdminDispatcher;
use contracts::interfaces::IErc4626VaultAdapterAdminDispatcherTrait;
use contracts::interfaces::IEkuboAdapterAdminDispatcher;
use contracts::interfaces::IEkuboAdapterAdminDispatcherTrait;
use contracts::interfaces::ILeveragedVaultAdapterAdminDispatcher;
use contracts::interfaces::ILeveragedVaultAdapterAdminDispatcherTrait;
use contracts::interfaces::ILeveragedVaultAdapterAdminSafeDispatcher;
use contracts::interfaces::ILeveragedVaultAdapterAdminSafeDispatcherTrait;
use contracts::interfaces::IStrategyAdapterSafeDispatcher;
use contracts::interfaces::IStrategyAdapterSafeDispatcherTrait;
use contracts::interfaces::IStrategyAdapterDispatcher;
use contracts::interfaces::IStrategyAdapterDispatcherTrait;
use contracts::interfaces::IStrategyRouterSafeDispatcher;
use contracts::interfaces::IStrategyRouterSafeDispatcherTrait;
use contracts::interfaces::IStrategyRouterDispatcher;
use contracts::interfaces::IStrategyRouterDispatcherTrait;
use contracts::interfaces::IYieldVaultSafeDispatcher;
use contracts::interfaces::IYieldVaultSafeDispatcherTrait;
use contracts::interfaces::IYieldVaultDispatcher;
use contracts::interfaces::IYieldVaultDispatcherTrait;
use contracts::test_mocks::IMockERC20Dispatcher;
use contracts::test_mocks::IMockERC20DispatcherTrait;
use contracts::test_mocks::IMockProtocolAdminDispatcher;
use contracts::test_mocks::IMockProtocolAdminDispatcherTrait;

fn OWNER() -> ContractAddress {
    contract_address_const::<'OWNER'>()
}

fn USER() -> ContractAddress {
    contract_address_const::<'USER'>()
}

fn SUBMITTER() -> ContractAddress {
    contract_address_const::<'SUBMITTER'>()
}

fn PROTOCOL() -> ContractAddress {
    contract_address_const::<'PROTOCOL'>()
}

fn OTHER() -> ContractAddress {
    contract_address_const::<'OTHER'>()
}

fn deploy_contract(name: ByteArray, calldata: Array<felt252>) -> ContractAddress {
    let contract = declare(name).unwrap().contract_class();
    let (contract_address, _) = contract.deploy(@calldata).unwrap();
    contract_address
}

fn deploy_token() -> ContractAddress {
    deploy_contract("MockERC20", array![OWNER().into()])
}

fn mint_token(token: ContractAddress, recipient: ContractAddress, amount: u256) {
    let mint_dispatcher = IMockERC20Dispatcher { contract_address: token };
    start_cheat_caller_address(token, OWNER());
    mint_dispatcher.mint(recipient, amount);
    stop_cheat_caller_address(token);
}

fn add_vault_asset(vault: ContractAddress, token: ContractAddress) {
    let vault_dispatcher = IYieldVaultDispatcher { contract_address: vault };
    start_cheat_caller_address(vault, OWNER());
    vault_dispatcher.add_supported_asset(token);
    vault_dispatcher.set_asset_accounting(token, 1000000000000000000_u256, 10_000_000_000_u256);
}

#[test]
fn vault_deposit_mints_ybtc_shares_and_tracks_supported_asset() {
    let token = deploy_token();
    let vault = deploy_contract("YieldVault", array![OWNER().into(), OWNER().into()]);

    let vault_dispatcher = IYieldVaultDispatcher { contract_address: vault };
    let token_dispatcher = IERC20Dispatcher { contract_address: token };
    let mint_dispatcher = IMockERC20Dispatcher { contract_address: token };

    start_cheat_caller_address(token, OWNER());
    mint_dispatcher.mint(USER(), 1_000_000_u256);

    start_cheat_caller_address(vault, OWNER());
    vault_dispatcher.add_supported_asset(token);
    vault_dispatcher.set_asset_accounting(token, 1000000000000000000_u256, 10_000_000_000_u256);

    start_cheat_caller_address(token, USER());
    assert(token_dispatcher.approve(vault, 500_000_u256), 'APPROVE_FAILED');
    stop_cheat_caller_address(token);

    start_cheat_caller_address(vault, USER());
    let shares = vault_dispatcher.deposit(token, 500_000_u256);

    assert(shares == 500_000_u256, 'BAD_SHARES');
    assert(vault_dispatcher.get_user_position(USER()) == 500_000_u256, 'BAD_POSITION');
    assert(vault_dispatcher.get_user_asset_position(USER(), token) == 500_000_u256, 'BAD_ASSET_POSITION');
    assert(vault_dispatcher.total_assets(token) == 500_000_u256, 'BAD_TOTAL_ASSETS');
    assert(vault_dispatcher.get_supported_asset_count() == 1, 'BAD_ASSET_COUNT');
    assert(vault_dispatcher.get_supported_asset(0) == token, 'BAD_ASSET');
    assert(token_dispatcher.balance_of(vault) == 500_000_u256, 'BAD_VAULT_BALANCE');
}

#[test]
#[feature("safe_dispatcher")]
fn vault_rejects_unsupported_asset() {
    let token = deploy_token();
    let vault = deploy_contract("YieldVault", array![OWNER().into(), OWNER().into()]);
    mint_token(token, USER(), 100_u256);

    let token_dispatcher = IERC20Dispatcher { contract_address: token };
    let safe_vault = IYieldVaultSafeDispatcher { contract_address: vault };

    start_cheat_caller_address(token, USER());
    assert(token_dispatcher.approve(vault, 100_u256), 'APPROVE_FAILED');
    stop_cheat_caller_address(token);

    start_cheat_caller_address(vault, USER());
    match safe_vault.deposit(token, 100_u256) {
        Result::Ok(_) => core::panic_with_felt252('SHOULD_HAVE_FAILED'),
        Result::Err(panic_data) => assert(*panic_data.at(0) == 'UNSUPPORTED_ASSET', *panic_data.at(0)),
    };
}

#[test]
#[feature("safe_dispatcher")]
fn vault_pause_blocks_deposits() {
    let token = deploy_token();
    let vault = deploy_contract("YieldVault", array![OWNER().into(), OWNER().into()]);
    add_vault_asset(vault, token);
    mint_token(token, USER(), 100_u256);

    let vault_dispatcher = IYieldVaultDispatcher { contract_address: vault };
    let safe_vault = IYieldVaultSafeDispatcher { contract_address: vault };
    let token_dispatcher = IERC20Dispatcher { contract_address: token };

    start_cheat_caller_address(vault, OWNER());
    vault_dispatcher.set_deposits_paused(true);

    start_cheat_caller_address(token, USER());
    assert(token_dispatcher.approve(vault, 100_u256), 'APPROVE_FAILED');
    stop_cheat_caller_address(token);

    start_cheat_caller_address(vault, USER());
    match safe_vault.deposit(token, 100_u256) {
        Result::Ok(_) => core::panic_with_felt252('SHOULD_HAVE_FAILED'),
        Result::Err(panic_data) => assert(*panic_data.at(0) == 'DEPOSITS_PAUSED', *panic_data.at(0)),
    };
}

#[test]
#[feature("safe_dispatcher")]
fn vault_requires_accounting_before_deposit_and_enforces_cap() {
    let token = deploy_token();
    let vault = deploy_contract("YieldVault", array![OWNER().into(), OWNER().into()]);
    let vault_dispatcher = IYieldVaultDispatcher { contract_address: vault };
    let safe_vault = IYieldVaultSafeDispatcher { contract_address: vault };
    let token_dispatcher = IERC20Dispatcher { contract_address: token };

    mint_token(token, USER(), 1_000_u256);

    start_cheat_caller_address(vault, OWNER());
    vault_dispatcher.add_supported_asset(token);

    start_cheat_caller_address(token, USER());
    assert(token_dispatcher.approve(vault, 1_000_u256), 'APPROVE_FAILED');
    stop_cheat_caller_address(token);

    start_cheat_caller_address(vault, USER());
    match safe_vault.deposit(token, 100_u256) {
        Result::Ok(_) => core::panic_with_felt252('SHOULD_HAVE_FAILED'),
        Result::Err(panic_data) => assert(*panic_data.at(0) == 'ACCOUNTING_NOT_SET', *panic_data.at(0)),
    };

    start_cheat_caller_address(vault, OWNER());
    vault_dispatcher.set_asset_accounting(token, 2_000_000_000_000_000_000_u256, 150_u256);

    start_cheat_caller_address(vault, USER());
    let shares = vault_dispatcher.deposit(token, 100_u256);
    assert(shares == 200_u256, 'BAD_MULTIPLIER_SHARES');

    match safe_vault.deposit(token, 100_u256) {
        Result::Ok(_) => core::panic_with_felt252('SHOULD_HAVE_FAILED'),
        Result::Err(panic_data) => assert(*panic_data.at(0) == 'DEPOSIT_CAP', *panic_data.at(0)),
    };
}

#[test]
#[feature("safe_dispatcher")]
fn vault_only_owner_can_add_supported_asset() {
    let token = deploy_token();
    let vault = deploy_contract("YieldVault", array![OWNER().into(), OWNER().into()]);
    let safe_vault = IYieldVaultSafeDispatcher { contract_address: vault };

    start_cheat_caller_address(vault, USER());
    match safe_vault.add_supported_asset(token) {
        Result::Ok(_) => core::panic_with_felt252('SHOULD_HAVE_FAILED'),
        Result::Err(_) => {},
    };
}

#[test]
fn attestation_registry_rejects_replay_after_router_rebalance() {
    start_cheat_block_timestamp_global(100);

    let registry = deploy_contract("AttestationRegistry", array![OWNER().into(), SUBMITTER().into()]);
    let vault = deploy_contract("YieldVault", array![OWNER().into(), OWNER().into()]);
    let router = deploy_contract(
        "StrategyRouter", array![OWNER().into(), vault.into(), registry.into()],
    );
    let adapter = deploy_contract("Erc4626VaultAdapter", array![OWNER().into(), router.into()]);
    let token = deploy_token();
    let vault_protocol = deploy_contract("MockERC4626Vault", array![OWNER().into(), token.into()]);

    let registry_dispatcher = IAttestationRegistryDispatcher { contract_address: registry };
    let router_dispatcher = IStrategyRouterDispatcher { contract_address: router };
    let adapter_admin = IErc4626VaultAdapterAdminDispatcher { contract_address: adapter };

    start_cheat_caller_address(registry, OWNER());
    registry_dispatcher.set_consumer(router);

    start_cheat_caller_address(router, OWNER());
    router_dispatcher.register_strategy('VESU', adapter, 7000);

    start_cheat_caller_address(adapter, OWNER());
    adapter_admin.set_asset_vault(token, vault_protocol);

    start_cheat_caller_address(registry, SUBMITTER());
    registry_dispatcher.submit_attestation(111, 222, 333, 444, 200);
    assert(registry_dispatcher.is_valid_attestation(111), 'ATTESTATION_INVALID');

    let allocations = array![Allocation { strategy_id: 'VESU', asset: token, target_bps: 5000 }];
    start_cheat_caller_address(registry, router);
    start_cheat_caller_address(router, OWNER());
    router_dispatcher.rebalance(allocations, 111);

    assert(!registry_dispatcher.is_valid_attestation(111), 'ATTESTATION_REPLAYABLE');
}

#[test]
#[feature("safe_dispatcher")]
fn attestation_registry_rejects_expired_and_duplicate_attestations() {
    start_cheat_block_timestamp_global(100);
    let registry = deploy_contract("AttestationRegistry", array![OWNER().into(), SUBMITTER().into()]);
    let dispatcher = IAttestationRegistryDispatcher { contract_address: registry };
    let safe_dispatcher = IAttestationRegistrySafeDispatcher { contract_address: registry };

    start_cheat_caller_address(registry, SUBMITTER());
    match safe_dispatcher.submit_attestation(1, 2, 3, 4, 99) {
        Result::Ok(_) => core::panic_with_felt252('SHOULD_HAVE_FAILED'),
        Result::Err(panic_data) => assert(*panic_data.at(0) == 'EXPIRED', *panic_data.at(0)),
    };

    dispatcher.submit_attestation(1, 2, 3, 4, 200);
    match safe_dispatcher.submit_attestation(1, 2, 3, 4, 200) {
        Result::Ok(_) => core::panic_with_felt252('SHOULD_HAVE_FAILED'),
        Result::Err(panic_data) => assert(*panic_data.at(0) == 'ATTESTATION_EXISTS', *panic_data.at(0)),
    };
}

#[test]
fn attestation_registry_owner_can_rotate_submitter() {
    start_cheat_block_timestamp_global(100);
    let registry = deploy_contract("AttestationRegistry", array![OWNER().into(), SUBMITTER().into()]);
    let dispatcher = IAttestationRegistryDispatcher { contract_address: registry };

    start_cheat_caller_address(registry, OWNER());
    dispatcher.set_submitter(OTHER());

    start_cheat_caller_address(registry, OTHER());
    dispatcher.submit_attestation(99, 1, 2, 3, 200);
    assert(dispatcher.is_valid_attestation(99), 'ROTATED_SUBMITTER_INVALID');
}

#[test]
#[feature("safe_dispatcher")]
fn router_rejects_rebalance_above_strategy_cap() {
    start_cheat_block_timestamp_global(100);
    let registry = deploy_contract("AttestationRegistry", array![OWNER().into(), SUBMITTER().into()]);
    let vault = deploy_contract("YieldVault", array![OWNER().into(), OWNER().into()]);
    let router = deploy_contract("StrategyRouter", array![OWNER().into(), vault.into(), registry.into()]);
    let adapter = deploy_contract("Erc4626VaultAdapter", array![OWNER().into(), router.into()]);
    let token = deploy_token();

    let registry_dispatcher = IAttestationRegistryDispatcher { contract_address: registry };
    let router_dispatcher = IStrategyRouterDispatcher { contract_address: router };
    let safe_router = IStrategyRouterSafeDispatcher { contract_address: router };

    start_cheat_caller_address(registry, OWNER());
    registry_dispatcher.set_consumer(router);

    start_cheat_caller_address(router, OWNER());
    router_dispatcher.register_strategy('VESU', adapter, 4000);

    start_cheat_caller_address(registry, SUBMITTER());
    registry_dispatcher.submit_attestation(777, 1, 2, 3, 200);

    start_cheat_caller_address(registry, router);
    start_cheat_caller_address(router, OWNER());
    let allocations = array![Allocation { strategy_id: 'VESU', asset: token, target_bps: 5000 }];
    match safe_router.rebalance(allocations, 777) {
        Result::Ok(_) => core::panic_with_felt252('SHOULD_HAVE_FAILED'),
        Result::Err(panic_data) => assert(*panic_data.at(0) == 'ALLOCATION_TOO_HIGH', *panic_data.at(0)),
    };
}

#[test]
fn router_rebalance_executes_target_allocations_and_returns_idle() {
    start_cheat_block_timestamp_global(100);
    let registry = deploy_contract("AttestationRegistry", array![OWNER().into(), SUBMITTER().into()]);
    let vault = deploy_contract("YieldVault", array![OWNER().into(), OWNER().into()]);
    let router = deploy_contract(
        "StrategyRouter", array![OWNER().into(), vault.into(), registry.into()],
    );
    let adapter = deploy_contract("Erc4626VaultAdapter", array![OWNER().into(), router.into()]);
    let token = deploy_token();
    let vault_protocol = deploy_contract("MockERC4626Vault", array![OWNER().into(), token.into()]);

    let registry_dispatcher = IAttestationRegistryDispatcher { contract_address: registry };
    let vault_dispatcher = IYieldVaultDispatcher { contract_address: vault };
    let router_dispatcher = IStrategyRouterDispatcher { contract_address: router };
    let adapter_admin = IErc4626VaultAdapterAdminDispatcher { contract_address: adapter };
    let adapter_dispatcher = IStrategyAdapterDispatcher { contract_address: adapter };
    let token_dispatcher = IERC20Dispatcher { contract_address: token };

    start_cheat_caller_address(registry, OWNER());
    registry_dispatcher.set_consumer(router);

    start_cheat_caller_address(vault, OWNER());
    vault_dispatcher.set_router(router);
    vault_dispatcher.add_supported_asset(token);
    vault_dispatcher.set_asset_accounting(token, 1000000000000000000_u256, 10_000_000_000_u256);

    start_cheat_caller_address(adapter, OWNER());
    adapter_admin.set_asset_vault(token, vault_protocol);

    start_cheat_caller_address(router, OWNER());
    router_dispatcher.register_strategy('VESU', adapter, 7000);

    mint_token(token, USER(), 1_000_u256);
    mint_token(token, vault_protocol, 1_000_u256);

    start_cheat_caller_address(token, USER());
    assert(token_dispatcher.approve(vault, 1_000_u256), 'APPROVE_FAILED');
    stop_cheat_caller_address(token);

    start_cheat_caller_address(vault, USER());
    vault_dispatcher.deposit(token, 1_000_u256);

    start_cheat_caller_address(registry, SUBMITTER());
    registry_dispatcher.submit_attestation(901, 1, 2, 3, 200);

    start_cheat_caller_address(registry, router);
    start_cheat_caller_address(router, OWNER());
    start_cheat_caller_address(vault, router);
    start_cheat_caller_address(adapter, router);
    router_dispatcher.rebalance(
        array![Allocation { strategy_id: 'VESU', asset: token, target_bps: 5000 }],
        901,
    );

    assert(router_dispatcher.get_strategy_position('VESU', token) == 500_u256, 'BAD_REBAL_POS');
    assert(adapter_dispatcher.total_position(token) == 500_u256, 'BAD_REBAL_ADAPTER');
    assert(token_dispatcher.balance_of(vault) == 500_u256, 'BAD_IDLE_AFTER_ALLOC');

    start_cheat_caller_address(registry, SUBMITTER());
    registry_dispatcher.submit_attestation(902, 4, 5, 6, 200);

    start_cheat_caller_address(registry, router);
    start_cheat_caller_address(router, OWNER());
    start_cheat_caller_address(vault, router);
    start_cheat_caller_address(adapter, router);
    router_dispatcher.rebalance(
        array![Allocation { strategy_id: 'VESU', asset: token, target_bps: 2000 }],
        902,
    );

    assert(router_dispatcher.get_strategy_position('VESU', token) == 200_u256, 'BAD_REBAL_UNWIND');
    assert(adapter_dispatcher.total_position(token) == 200_u256, 'BAD_ADAPTER_UNWIND');
    assert(token_dispatcher.balance_of(vault) == 800_u256, 'BAD_IDLE_AFTER_UNWIND');
    assert(vault_dispatcher.total_assets(token) == 1_000_u256, 'BAD_MANAGED_REBALANCE');
}

#[test]
fn ekubo_adapter_deposits_withdraws_and_harvests_against_protocol() {
    let token = deploy_token();
    let protocol = deploy_contract("MockEkuboProtocol", array![OWNER().into()]);
    let adapter = deploy_contract("EkuboAdapter", array![OWNER().into(), OWNER().into()]);

    mint_token(token, adapter, 1_000_u256);
    mint_token(token, protocol, 1_000_u256);

    let adapter_admin = IEkuboAdapterAdminDispatcher { contract_address: adapter };
    let adapter_dispatcher = IStrategyAdapterDispatcher { contract_address: adapter };
    let protocol_admin = IMockProtocolAdminDispatcher { contract_address: protocol };
    let token_dispatcher = IERC20Dispatcher { contract_address: token };

    start_cheat_caller_address(adapter, OWNER());
    adapter_admin.configure_position(
        token,
        protocol,
        token,
        OTHER(),
        3402823669209384634633746074317682114,
        1000,
        contract_address_const::<0>(),
        1000,
        true,
        1000,
        false,
        0,
        false,
    );
    adapter_admin.set_slippage_limits(token, 1, 1, 0);

    start_cheat_caller_address(protocol, OWNER());
    protocol_admin.set_reward(adapter, 9_u256);

    start_cheat_caller_address(protocol, adapter);
    start_cheat_caller_address(adapter, OWNER());
    adapter_dispatcher.deposit(token, 500_u256);
    assert(adapter_dispatcher.total_position(token) == 500_u256, 'BAD_EKUBO_POSITION');
    adapter_dispatcher.harvest(token);
    adapter_dispatcher.withdraw(token, 200_u256, USER());

    assert(token_dispatcher.balance_of(USER()) == 200_u256, 'BAD_WITHDRAW_BALANCE');
    assert(adapter_dispatcher.total_position(token) == 300_u256, 'BAD_EKUBO_AFTER_WITHDRAW');
}

#[test]
fn router_allocate_and_withdraw_moves_assets_through_vault_and_adapter() {
    let token = deploy_token();
    let vault = deploy_contract("YieldVault", array![OWNER().into(), OWNER().into()]);
    let router = deploy_contract("StrategyRouter", array![OWNER().into(), vault.into(), OWNER().into()]);
    let vault_protocol = deploy_contract("MockERC4626Vault", array![OWNER().into(), token.into()]);
    let adapter = deploy_contract("Erc4626VaultAdapter", array![OWNER().into(), router.into()]);

    let vault_dispatcher = IYieldVaultDispatcher { contract_address: vault };
    let router_dispatcher = IStrategyRouterDispatcher { contract_address: router };
    let adapter_admin = IErc4626VaultAdapterAdminDispatcher { contract_address: adapter };
    let adapter_dispatcher = IStrategyAdapterDispatcher { contract_address: adapter };
    let token_dispatcher = IERC20Dispatcher { contract_address: token };

    start_cheat_caller_address(vault, OWNER());
    vault_dispatcher.set_router(router);
    vault_dispatcher.add_supported_asset(token);
    vault_dispatcher.set_asset_accounting(token, 1000000000000000000_u256, 10_000_000_000_u256);

    start_cheat_caller_address(adapter, OWNER());
    adapter_admin.set_asset_vault(token, vault_protocol);

    start_cheat_caller_address(router, OWNER());
    router_dispatcher.register_strategy('VESU', adapter, 7000);

    mint_token(token, USER(), 1_000_u256);
    mint_token(token, vault_protocol, 1_000_u256);

    start_cheat_caller_address(token, USER());
    assert(token_dispatcher.approve(vault, 1_000_u256), 'APPROVE_FAILED');
    stop_cheat_caller_address(token);

    start_cheat_caller_address(vault, USER());
    vault_dispatcher.deposit(token, 1_000_u256);

    start_cheat_caller_address(router, OWNER());
    start_cheat_caller_address(vault, router);
    start_cheat_caller_address(adapter, router);
    router_dispatcher.allocate(token, 600_u256, 'VESU');
    assert(router_dispatcher.get_strategy_position('VESU', token) == 600_u256, 'BAD_ROUTER_POSITION');
    assert(adapter_dispatcher.total_position(token) == 600_u256, 'BAD_ADAPTER_POSITION');

    router_dispatcher.withdraw_from_strategy(token, 250_u256, 'VESU');
    assert(router_dispatcher.get_strategy_position('VESU', token) == 350_u256, 'BAD_ROUTER_AFTER_WITHDRAW');
    assert(token_dispatcher.balance_of(vault) == 650_u256, 'BAD_VAULT_TOKEN_BALANCE');
    assert(vault_dispatcher.total_assets(token) == 1_000_u256, 'BAD_MANAGED_AFTER_STRATEGY');
}

#[test]
#[feature("safe_dispatcher")]
fn vault_rejects_user_withdraw_when_idle_liquidity_is_insufficient() {
    let token = deploy_token();
    let vault = deploy_contract("YieldVault", array![OWNER().into(), OWNER().into()]);
    let router = deploy_contract("StrategyRouter", array![OWNER().into(), vault.into(), OWNER().into()]);
    let vault_protocol = deploy_contract("MockERC4626Vault", array![OWNER().into(), token.into()]);
    let adapter = deploy_contract("Erc4626VaultAdapter", array![OWNER().into(), router.into()]);

    let vault_dispatcher = IYieldVaultDispatcher { contract_address: vault };
    let safe_vault = IYieldVaultSafeDispatcher { contract_address: vault };
    let router_dispatcher = IStrategyRouterDispatcher { contract_address: router };
    let adapter_admin = IErc4626VaultAdapterAdminDispatcher { contract_address: adapter };
    let token_dispatcher = IERC20Dispatcher { contract_address: token };

    start_cheat_caller_address(vault, OWNER());
    vault_dispatcher.set_router(router);
    vault_dispatcher.add_supported_asset(token);
    vault_dispatcher.set_asset_accounting(token, 1000000000000000000_u256, 10_000_000_000_u256);

    start_cheat_caller_address(adapter, OWNER());
    adapter_admin.set_asset_vault(token, vault_protocol);

    start_cheat_caller_address(router, OWNER());
    router_dispatcher.register_strategy('VESU', adapter, 7000);

    mint_token(token, USER(), 1_000_u256);
    mint_token(token, vault_protocol, 1_000_u256);

    start_cheat_caller_address(token, USER());
    assert(token_dispatcher.approve(vault, 1_000_u256), 'APPROVE_FAILED');
    stop_cheat_caller_address(token);

    start_cheat_caller_address(vault, USER());
    vault_dispatcher.deposit(token, 1_000_u256);

    start_cheat_caller_address(router, OWNER());
    start_cheat_caller_address(vault, router);
    start_cheat_caller_address(adapter, router);
    router_dispatcher.allocate(token, 900_u256, 'VESU');

    start_cheat_caller_address(vault, USER());
    match safe_vault.withdraw(500_u256, token) {
        Result::Ok(_) => core::panic_with_felt252('SHOULD_HAVE_FAILED'),
        Result::Err(panic_data) => assert(*panic_data.at(0) == 'INSUFFICIENT_IDLE', *panic_data.at(0)),
    };
}

#[test]
fn erc4626_adapter_deposits_and_withdraws_phase_2_vaults() {
    let token = deploy_token();
    let vault_protocol = deploy_contract("MockERC4626Vault", array![OWNER().into(), token.into()]);
    let adapter = deploy_contract("Erc4626VaultAdapter", array![OWNER().into(), OWNER().into()]);

    mint_token(token, adapter, 1_000_u256);
    mint_token(token, vault_protocol, 1_000_u256);

    let adapter_admin = IErc4626VaultAdapterAdminDispatcher { contract_address: adapter };
    let adapter_dispatcher = IStrategyAdapterDispatcher { contract_address: adapter };
    let token_dispatcher = IERC20Dispatcher { contract_address: token };

    start_cheat_caller_address(adapter, OWNER());
    adapter_admin.set_asset_vault(token, vault_protocol);

    start_cheat_caller_address(adapter, OWNER());
    adapter_dispatcher.deposit(token, 600_u256);
    assert(adapter_dispatcher.total_position(token) == 600_u256, 'BAD_4626_POSITION');

    adapter_dispatcher.withdraw(token, 250_u256, USER());
    assert(adapter_dispatcher.total_position(token) == 350_u256, 'BAD_4626_WITHDRAW');
    assert(token_dispatcher.balance_of(USER()) == 250_u256, 'BAD_4626_USER_BAL');
}

#[test]
#[feature("safe_dispatcher")]
fn leveraged_adapter_manages_collateral_debt_and_health_checks() {
    let collateral = deploy_token();
    let debt_asset = deploy_token();
    let protocol = deploy_contract("MockLeveragedVault", array![OWNER().into()]);
    let adapter = deploy_contract(
        "LeveragedVaultAdapter",
        array![OWNER().into(), OWNER().into(), protocol.into(), debt_asset.into(), 2, 0],
    );

    mint_token(collateral, adapter, 1_000_u256);
    mint_token(collateral, protocol, 1_000_u256);
    mint_token(debt_asset, protocol, 1_000_u256);

    let adapter_admin = IAdapterAdminDispatcher { contract_address: adapter };
    let adapter_dispatcher = IStrategyAdapterDispatcher { contract_address: adapter };
    let leverage_admin = ILeveragedVaultAdapterAdminDispatcher { contract_address: adapter };
    let safe_leverage_admin = ILeveragedVaultAdapterAdminSafeDispatcher {
        contract_address: adapter,
    };
    let collateral_dispatcher = IERC20Dispatcher { contract_address: collateral };
    let debt_dispatcher = IERC20Dispatcher { contract_address: debt_asset };

    start_cheat_caller_address(adapter, OWNER());
    adapter_admin.add_supported_asset(collateral);

    start_cheat_caller_address(protocol, adapter);
    start_cheat_caller_address(adapter, OWNER());
    adapter_dispatcher.deposit(collateral, 800_u256);
    assert(adapter_dispatcher.total_position(collateral) == 800_u256, 'BAD_LEV_COLLATERAL');

    match safe_leverage_admin.borrow(500_u256, adapter) {
        Result::Ok(_) => core::panic_with_felt252('SHOULD_HAVE_FAILED'),
        Result::Err(panic_data) => assert(*panic_data.at(0) == 'HEALTH_FACTOR_LOW', *panic_data.at(0)),
    };

    leverage_admin.borrow(300_u256, adapter);
    assert(debt_dispatcher.balance_of(adapter) == 300_u256, 'BAD_BORROW_BAL');

    leverage_admin.repay(100_u256);
    assert(debt_dispatcher.balance_of(adapter) == 200_u256, 'BAD_REPAY_BAL');

    adapter_dispatcher.harvest(collateral);
    adapter_dispatcher.withdraw(collateral, 200_u256, USER());
    assert(adapter_dispatcher.total_position(collateral) == 600_u256, 'BAD_LEV_WITHDRAW');
    assert(collateral_dispatcher.balance_of(USER()) == 200_u256, 'BAD_LEV_USER_BAL');
}

#[test]
#[feature("safe_dispatcher")]
fn adapter_blocks_non_router_deposit() {
    let token = deploy_token();
    let vault_protocol = deploy_contract("MockERC4626Vault", array![OWNER().into(), token.into()]);
    let adapter = deploy_contract("Erc4626VaultAdapter", array![OWNER().into(), OWNER().into()]);
    let admin_dispatcher = IErc4626VaultAdapterAdminDispatcher { contract_address: adapter };
    let safe_adapter = IStrategyAdapterSafeDispatcher { contract_address: adapter };

    start_cheat_caller_address(adapter, OWNER());
    admin_dispatcher.set_asset_vault(token, vault_protocol);

    start_cheat_caller_address(adapter, USER());
    match safe_adapter.deposit(token, 10_u256) {
        Result::Ok(_) => core::panic_with_felt252('SHOULD_HAVE_FAILED'),
        Result::Err(panic_data) => {
            assert(*panic_data.at(0) == 'NOT_ROUTER', *panic_data.at(0));
        },
    };
}
