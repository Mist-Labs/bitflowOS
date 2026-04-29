#[starknet::contract]
pub mod EkuboAdapter {
    use core::num::traits::Zero;
    use core::traits::TryInto;
    use openzeppelin_access::ownable::OwnableComponent;
    use openzeppelin_security::ReentrancyGuardComponent;
    use starknet::{ContractAddress, get_caller_address};
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use super::super::interfaces::{
        EkuboBounds, EkuboI129, EkuboPoolKey, IERC20Dispatcher, IERC20DispatcherTrait,
        IEkuboPositionsDispatcher, IEkuboPositionsDispatcherTrait,
    };

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);
    component!(
        path: ReentrancyGuardComponent, storage: reentrancy_guard, event: ReentrancyGuardEvent,
    );

    #[abi(embed_v0)]
    impl OwnableMixinImpl = OwnableComponent::OwnableMixinImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;
    impl ReentrancyGuardInternalImpl = ReentrancyGuardComponent::InternalImpl<ContractState>;

    #[derive(Copy, Drop, Serde, starknet::Store)]
    pub struct PositionConfig {
        pub positions: ContractAddress,
        pub pool_key: EkuboPoolKey,
        pub bounds: EkuboBounds,
        pub token_id: u64,
        pub asset_is_token1: bool,
        pub enabled: bool,
        pub min_liquidity: u128,
        pub min_withdraw_token0: u128,
        pub min_withdraw_token1: u128,
    }

    #[storage]
    pub struct Storage {
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
        #[substorage(v0)]
        pub reentrancy_guard: ReentrancyGuardComponent::Storage,
        router: ContractAddress,
        emergency_disabled: bool,
        config_by_asset: Map<ContractAddress, PositionConfig>,
        liquidity_by_asset: Map<ContractAddress, u128>,
        deposited_assets_by_asset: Map<ContractAddress, u128>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        #[flat]
        OwnableEvent: OwnableComponent::Event,
        #[flat]
        ReentrancyGuardEvent: ReentrancyGuardComponent::Event,
        PositionConfigured: PositionConfigured,
        Deposited: Deposited,
        Withdrawn: Withdrawn,
        FeesCollected: FeesCollected,
        EmergencyDisabled: EmergencyDisabled,
    }

    #[derive(Drop, starknet::Event)]
    pub struct PositionConfigured {
        #[key]
        pub asset: ContractAddress,
        pub positions: ContractAddress,
        pub token_id: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Deposited {
        #[key]
        pub asset: ContractAddress,
        pub amount: u256,
        pub liquidity: u128,
        pub token_id: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Withdrawn {
        #[key]
        pub asset: ContractAddress,
        pub recipient: ContractAddress,
        pub liquidity: u128,
        pub amount0: u128,
        pub amount1: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct FeesCollected {
        #[key]
        pub asset: ContractAddress,
        pub fees0: u128,
        pub fees1: u128,
    }

    #[derive(Drop, starknet::Event)]
    pub struct EmergencyDisabled {
        pub disabled: bool,
    }

    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress, router: ContractAddress) {
        assert(owner.is_non_zero(), 'ZERO_OWNER');
        assert(router.is_non_zero(), 'ZERO_ROUTER');
        self.ownable.initializer(owner);
        self.router.write(router);
    }

    #[abi(embed_v0)]
    impl AdapterImpl of super::super::interfaces::IStrategyAdapter<ContractState> {
        fn deposit(ref self: ContractState, asset: ContractAddress, amount: u256) {
            self.assert_router();
            assert(!self.emergency_disabled.read(), 'ADAPTER_DISABLED');
            assert(amount > 0, 'ZERO_AMOUNT');
            let mut config = self.assert_config(asset);
            let amount_u128: u128 = amount.try_into().expect('AMOUNT_TOO_LARGE');
            let positions_address = config.positions;
            let token = IERC20Dispatcher { contract_address: asset };
            self.reentrancy_guard.start();
            assert(token.transfer(positions_address, amount), 'TRANSFER_FAILED');

            if config.token_id == 0 {
                config.token_id = IEkuboPositionsDispatcher { contract_address: positions_address }.mint_v2(Zero::zero());
                self.config_by_asset.write(asset, config);
            }

            let (amount0, amount1) = if config.asset_is_token1 {
                (0, amount_u128)
            } else {
                (amount_u128, 0)
            };
            assert(config.min_liquidity > 0, 'SLIPPAGE_NOT_SET');
            let liquidity = IEkuboPositionsDispatcher { contract_address: positions_address }
                .deposit_amounts(
                    config.token_id,
                    config.pool_key,
                    config.bounds,
                    amount0,
                    amount1,
                    config.min_liquidity,
                );

            self.liquidity_by_asset.write(asset, self.liquidity_by_asset.read(asset) + liquidity);
            self
                .deposited_assets_by_asset
                .write(asset, self.deposited_assets_by_asset.read(asset) + amount_u128);
            self.emit(Deposited { asset, amount, liquidity, token_id: config.token_id });
            self.reentrancy_guard.end();
        }

        fn withdraw(
            ref self: ContractState,
            asset: ContractAddress,
            amount: u256,
            recipient: ContractAddress,
        ) -> u256 {
            self.assert_router();
            assert(amount > 0, 'ZERO_AMOUNT');
            let config = self.assert_config(asset);
            assert(config.token_id != 0, 'NO_POSITION');
            let amount_u128: u128 = amount.try_into().expect('AMOUNT_TOO_LARGE');
            let current_liquidity = self.liquidity_by_asset.read(asset);
            let current_deposited = self.deposited_assets_by_asset.read(asset);
            assert(current_deposited >= amount_u128, 'INSUFFICIENT_POSITION');
            let liquidity = if amount_u128 == current_deposited {
                current_liquidity
            } else {
                current_liquidity * amount_u128 / current_deposited
            };
            assert(liquidity > 0, 'ZERO_LIQUIDITY');
            assert(
                config.min_withdraw_token0 > 0 || config.min_withdraw_token1 > 0,
                'SLIPPAGE_NOT_SET',
            );

            self.reentrancy_guard.start();
            let (amount0, amount1) = IEkuboPositionsDispatcher { contract_address: config.positions }
                .withdraw_v2(
                    config.token_id,
                    config.pool_key,
                    config.bounds,
                    liquidity,
                    config.min_withdraw_token0,
                    config.min_withdraw_token1,
                );

            self.liquidity_by_asset.write(asset, current_liquidity - liquidity);
            self.deposited_assets_by_asset.write(asset, current_deposited - amount_u128);
            let transfer_amount = if config.asset_is_token1 { amount1 } else { amount0 };
            if transfer_amount > 0 {
                assert(IERC20Dispatcher { contract_address: asset }.transfer(recipient, transfer_amount.into()), 'TRANSFER_FAILED');
            }
            self.emit(Withdrawn { asset, recipient, liquidity, amount0, amount1 });
            self.reentrancy_guard.end();
            transfer_amount.into()
        }

        fn harvest(ref self: ContractState, asset: ContractAddress) {
            self.assert_router();
            let config = self.assert_config(asset);
            assert(config.token_id != 0, 'NO_POSITION');
            self.reentrancy_guard.start();
            let (fees0, fees1) = IEkuboPositionsDispatcher { contract_address: config.positions }
                .collect_fees(config.token_id, config.pool_key, config.bounds);
            self.emit(FeesCollected { asset, fees0, fees1 });
            self.reentrancy_guard.end();
        }

        fn current_apy(self: @ContractState, asset: ContractAddress) -> u256 {
            let _ = asset;
            0
        }

        fn total_position(self: @ContractState, asset: ContractAddress) -> u256 {
            self.deposited_assets_by_asset.read(asset).into()
        }

        fn is_supported_asset(self: @ContractState, asset: ContractAddress) -> bool {
            self.config_by_asset.read(asset).enabled
        }
    }

    #[abi(embed_v0)]
    impl AdminImpl of super::super::interfaces::IAdapterAdmin<ContractState> {
        fn add_supported_asset(ref self: ContractState, asset: ContractAddress) {
            self.ownable.assert_only_owner();
            let config = self.assert_config(asset);
            self.config_by_asset.write(asset, PositionConfig { enabled: true, ..config });
        }

        fn set_emergency_disabled(ref self: ContractState, disabled: bool) {
            self.ownable.assert_only_owner();
            self.emergency_disabled.write(disabled);
            self.emit(EmergencyDisabled { disabled });
        }
    }

    #[abi(embed_v0)]
    impl EkuboAdminImpl of super::super::interfaces::IEkuboAdapterAdmin<ContractState> {
        fn configure_position(
            ref self: ContractState,
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
        ) {
            self.ownable.assert_only_owner();
            assert(asset.is_non_zero(), 'ZERO_ASSET');
            assert(positions.is_non_zero(), 'ZERO_POSITIONS');
            assert(token0.is_non_zero(), 'ZERO_TOKEN0');
            assert(token1.is_non_zero(), 'ZERO_TOKEN1');
            assert(token0 != token1, 'SAME_TOKENS');
            let config = PositionConfig {
                positions,
                pool_key: EkuboPoolKey { token0, token1, fee, tick_spacing, extension },
                bounds: EkuboBounds {
                    lower: EkuboI129 { mag: lower_mag, sign: lower_sign },
                    upper: EkuboI129 { mag: upper_mag, sign: upper_sign },
                },
                token_id,
                asset_is_token1,
                enabled: true,
                min_liquidity: 0,
                min_withdraw_token0: 0,
                min_withdraw_token1: 0,
            };
            self.config_by_asset.write(asset, config);
            self.emit(PositionConfigured { asset, positions, token_id });
        }

        fn set_slippage_limits(
            ref self: ContractState,
            asset: ContractAddress,
            min_liquidity: u128,
            min_withdraw_token0: u128,
            min_withdraw_token1: u128,
        ) {
            self.ownable.assert_only_owner();
            assert(min_liquidity > 0, 'ZERO_MIN_LIQUIDITY');
            assert(min_withdraw_token0 > 0 || min_withdraw_token1 > 0, 'ZERO_WITHDRAW_MIN');
            let mut config = self.assert_config(asset);
            config.min_liquidity = min_liquidity;
            config.min_withdraw_token0 = min_withdraw_token0;
            config.min_withdraw_token1 = min_withdraw_token1;
            self.config_by_asset.write(asset, config);
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn assert_router(self: @ContractState) {
            assert(get_caller_address() == self.router.read(), 'NOT_ROUTER');
        }

        fn assert_config(self: @ContractState, asset: ContractAddress) -> PositionConfig {
            let config = self.config_by_asset.read(asset);
            assert(config.enabled, 'UNSUPPORTED_ASSET');
            config
        }
    }
}
