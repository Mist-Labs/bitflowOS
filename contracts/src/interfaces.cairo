use starknet::ContractAddress;

#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct Allocation {
    pub strategy_id: felt252,
    pub asset: ContractAddress,
    pub target_bps: u16,
}

#[starknet::interface]
pub trait IERC20<TContractState> {
    fn approve(ref self: TContractState, spender: ContractAddress, amount: u256) -> bool;
    fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;
    fn transfer_from(
        ref self: TContractState,
        sender: ContractAddress,
        recipient: ContractAddress,
        amount: u256,
    ) -> bool;
    fn balance_of(self: @TContractState, account: ContractAddress) -> u256;
}

#[starknet::interface]
pub trait IYieldVault<TContractState> {
    fn deposit(ref self: TContractState, asset: ContractAddress, amount: u256) -> u256;
    fn withdraw(ref self: TContractState, shares: u256, preferred_asset: ContractAddress);
    fn transfer_to_strategy(
        ref self: TContractState,
        asset: ContractAddress,
        strategy: ContractAddress,
        amount: u256,
    );
    fn record_strategy_return(ref self: TContractState, asset: ContractAddress, amount: u256);
    fn set_router(ref self: TContractState, router: ContractAddress);
    fn add_supported_asset(ref self: TContractState, asset: ContractAddress);
    fn set_asset_accounting(
        ref self: TContractState,
        asset: ContractAddress,
        share_multiplier: u256,
        deposit_cap: u256,
    );
    fn set_withdrawals_paused(ref self: TContractState, paused: bool);
    fn set_deposits_paused(ref self: TContractState, paused: bool);
    fn total_assets(self: @TContractState, asset: ContractAddress) -> u256;
    fn share_price(self: @TContractState) -> u256;
    fn get_user_position(self: @TContractState, user: ContractAddress) -> u256;
    fn get_user_asset_position(
        self: @TContractState,
        user: ContractAddress,
        asset: ContractAddress,
    ) -> u256;
    fn is_supported_asset(self: @TContractState, asset: ContractAddress) -> bool;
    fn get_supported_asset(self: @TContractState, index: u32) -> ContractAddress;
    fn get_supported_asset_count(self: @TContractState) -> u32;
}

#[starknet::interface]
pub trait IStrategyAdapter<TContractState> {
    fn deposit(ref self: TContractState, asset: ContractAddress, amount: u256);
    fn withdraw(
        ref self: TContractState,
        asset: ContractAddress,
        amount: u256,
        recipient: ContractAddress,
    ) -> u256;
    fn harvest(ref self: TContractState, asset: ContractAddress);
    fn current_apy(self: @TContractState, asset: ContractAddress) -> u256;
    fn total_position(self: @TContractState, asset: ContractAddress) -> u256;
    fn is_supported_asset(self: @TContractState, asset: ContractAddress) -> bool;
}

#[starknet::interface]
pub trait IAdapterAdmin<TContractState> {
    fn add_supported_asset(ref self: TContractState, asset: ContractAddress);
    fn set_emergency_disabled(ref self: TContractState, disabled: bool);
}

#[starknet::interface]
pub trait IErc4626VaultAdapterAdmin<TContractState> {
    fn set_asset_vault(
        ref self: TContractState,
        asset: ContractAddress,
        vault: ContractAddress,
    );
}

#[starknet::interface]
pub trait ILeveragedVaultAdapterAdmin<TContractState> {
    fn borrow(ref self: TContractState, amount: u256, recipient: ContractAddress);
    fn repay(ref self: TContractState, amount: u256);
}

#[derive(Copy, Drop, Serde)]
pub struct SignedU256 {
    pub abs: u256,
    pub is_negative: bool,
}

#[derive(Copy, Drop, Serde)]
pub enum VesuAmountDenomination {
    Native,
    Assets,
}

#[derive(Copy, Drop, Serde)]
pub struct VesuAmount {
    pub denomination: VesuAmountDenomination,
    pub value: SignedU256,
}

#[derive(Copy, Drop, Serde)]
pub struct VesuPosition {
    pub collateral_shares: u256,
    pub nominal_debt: u256,
}

#[derive(Copy, Drop, Serde)]
pub struct VesuModifyPositionParams {
    pub collateral_asset: ContractAddress,
    pub debt_asset: ContractAddress,
    pub user: ContractAddress,
    pub collateral: VesuAmount,
    pub debt: VesuAmount,
}

#[derive(Copy, Drop, Serde)]
pub struct VesuUpdatePositionResponse {
    pub collateral_delta: SignedU256,
    pub collateral_shares_delta: SignedU256,
    pub debt_delta: SignedU256,
    pub nominal_debt_delta: SignedU256,
    pub bad_debt: u256,
}

#[starknet::interface]
pub trait IVesuV2Pool<TContractState> {
    fn modify_position(
        ref self: TContractState,
        params: VesuModifyPositionParams,
    ) -> VesuUpdatePositionResponse;
    fn position(
        self: @TContractState,
        collateral_asset: ContractAddress,
        debt_asset: ContractAddress,
        user: ContractAddress,
    ) -> (VesuPosition, u256, u256);
    fn check_collateralization(
        self: @TContractState,
        collateral_asset: ContractAddress,
        debt_asset: ContractAddress,
        user: ContractAddress,
    ) -> (bool, u256, u256);
}

#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct EkuboI129 {
    pub mag: u128,
    pub sign: bool,
}

#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct EkuboBounds {
    pub lower: EkuboI129,
    pub upper: EkuboI129,
}

#[derive(Copy, Drop, Serde, starknet::Store)]
pub struct EkuboPoolKey {
    pub token0: ContractAddress,
    pub token1: ContractAddress,
    pub fee: u128,
    pub tick_spacing: u128,
    pub extension: ContractAddress,
}

#[derive(Copy, Drop, Serde)]
pub struct EkuboPoolPrice {
    pub sqrt_ratio: u256,
    pub tick: EkuboI129,
}

#[derive(Copy, Drop, Serde)]
pub struct EkuboTokenInfo {
    pub pool_price: EkuboPoolPrice,
    pub liquidity: u128,
    pub amount0: u128,
    pub amount1: u128,
    pub fees0: u128,
    pub fees1: u128,
}

#[starknet::interface]
pub trait IEkuboPositions<TContractState> {
    fn mint_v2(ref self: TContractState, referrer: ContractAddress) -> u64;
    fn deposit_amounts(
        ref self: TContractState,
        id: u64,
        pool_key: EkuboPoolKey,
        bounds: EkuboBounds,
        amount0: u128,
        amount1: u128,
        min_liquidity: u128,
    ) -> u128;
    fn withdraw_v2(
        ref self: TContractState,
        id: u64,
        pool_key: EkuboPoolKey,
        bounds: EkuboBounds,
        liquidity: u128,
        min_token0: u128,
        min_token1: u128,
    ) -> (u128, u128);
    fn collect_fees(
        ref self: TContractState,
        id: u64,
        pool_key: EkuboPoolKey,
        bounds: EkuboBounds,
    ) -> (u128, u128);
    fn get_token_info(
        self: @TContractState,
        id: u64,
        pool_key: EkuboPoolKey,
        bounds: EkuboBounds,
    ) -> EkuboTokenInfo;
}

#[starknet::interface]
pub trait IEkuboAdapterAdmin<TContractState> {
    fn configure_position(
        ref self: TContractState,
        asset: ContractAddress,
        positions: ContractAddress,
        token0: ContractAddress,
        token1: ContractAddress,
        fee: u128,
        tick_spacing: u128,
        extension: ContractAddress,
        lower_mag: u128,
        lower_sign: bool,
        upper_mag: u128,
        upper_sign: bool,
        token_id: u64,
        asset_is_token1: bool,
    );
    fn set_slippage_limits(
        ref self: TContractState,
        asset: ContractAddress,
        min_liquidity: u128,
        min_withdraw_token0: u128,
        min_withdraw_token1: u128,
    );
}

#[starknet::interface]
pub trait IERC4626Vault<TContractState> {
    fn asset(self: @TContractState) -> ContractAddress;
    fn deposit(ref self: TContractState, assets: u256, receiver: ContractAddress) -> u256;
    fn withdraw(
        ref self: TContractState,
        assets: u256,
        receiver: ContractAddress,
        owner: ContractAddress,
    ) -> u256;
    fn total_assets(self: @TContractState) -> u256;
    fn convert_to_assets(self: @TContractState, shares: u256) -> u256;
    fn convert_to_shares(self: @TContractState, assets: u256) -> u256;
    fn balance_of(self: @TContractState, account: ContractAddress) -> u256;
}

#[starknet::interface]
pub trait IAttestationRegistry<TContractState> {
    fn submit_attestation(
        ref self: TContractState,
        attestation_hash: felt252,
        input_hash: felt252,
        output_hash: felt252,
        quote_hash: felt252,
        expiry: u64,
    );
    fn is_valid_attestation(self: @TContractState, attestation_hash: felt252) -> bool;
    fn mark_used(ref self: TContractState, attestation_hash: felt252);
    fn set_consumer(ref self: TContractState, consumer: ContractAddress);
    fn set_submitter(ref self: TContractState, submitter: ContractAddress);
}

#[starknet::interface]
pub trait IStrategyRouter<TContractState> {
    fn set_executor(ref self: TContractState, executor: ContractAddress, enabled: bool);
    fn register_strategy(
        ref self: TContractState,
        strategy_id: felt252,
        adapter: ContractAddress,
        max_bps: u16,
    );
    fn set_strategy_status(ref self: TContractState, strategy_id: felt252, enabled: bool);
    fn allocate(ref self: TContractState, asset: ContractAddress, amount: u256, strategy_id: felt252);
    fn withdraw_from_strategy(
        ref self: TContractState,
        asset: ContractAddress,
        amount: u256,
        strategy_id: felt252,
    );
    fn rebalance(ref self: TContractState, weights: Array<Allocation>, attestation_hash: felt252);
    fn harvest(ref self: TContractState, strategy_id: felt252, asset: ContractAddress);
    fn get_strategy_adapter(self: @TContractState, strategy_id: felt252) -> ContractAddress;
    fn get_strategy_position(
        self: @TContractState,
        strategy_id: felt252,
        asset: ContractAddress,
    ) -> u256;
}
