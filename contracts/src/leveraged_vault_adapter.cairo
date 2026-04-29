#[starknet::contract]
pub mod LeveragedVaultAdapter {
    use openzeppelin_access::ownable::OwnableComponent;
    use openzeppelin_security::ReentrancyGuardComponent;
    use core::num::traits::Zero;
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use super::super::interfaces::{
        IERC20Dispatcher, IERC20DispatcherTrait, IVesuV2PoolDispatcher,
        IVesuV2PoolDispatcherTrait, SignedU256, VesuAmount, VesuAmountDenomination,
        VesuModifyPositionParams,
    };

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);
    component!(
        path: ReentrancyGuardComponent, storage: reentrancy_guard, event: ReentrancyGuardEvent,
    );

    #[abi(embed_v0)]
    impl OwnableMixinImpl = OwnableComponent::OwnableMixinImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;
    impl ReentrancyGuardInternalImpl = ReentrancyGuardComponent::InternalImpl<ContractState>;

    #[storage]
    pub struct Storage {
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
        #[substorage(v0)]
        pub reentrancy_guard: ReentrancyGuardComponent::Storage,
        router: ContractAddress,
        pool: ContractAddress,
        debt_asset: ContractAddress,
        min_health_factor: u256,
        emergency_disabled: bool,
        primary_collateral_asset: ContractAddress,
        collateral_assets: Map<ContractAddress, bool>,
        collateral_by_asset: Map<ContractAddress, u256>,
        debt: u256,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        #[flat]
        OwnableEvent: OwnableComponent::Event,
        #[flat]
        ReentrancyGuardEvent: ReentrancyGuardComponent::Event,
        CollateralAssetAdded: CollateralAssetAdded,
        Deposited: Deposited,
        Withdrawn: Withdrawn,
        Borrowed: Borrowed,
        Repaid: Repaid,
        EmergencyDisabled: EmergencyDisabled,
    }

    #[derive(Drop, starknet::Event)]
    pub struct CollateralAssetAdded {
        #[key]
        pub asset: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Deposited {
        #[key]
        pub asset: ContractAddress,
        pub amount: u256,
        pub collateral_delta: u256,
        pub collateral_shares_delta: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Withdrawn {
        #[key]
        pub asset: ContractAddress,
        pub amount: u256,
        pub recipient: ContractAddress,
        pub collateral_shares_delta: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Borrowed {
        pub amount: u256,
        pub recipient: ContractAddress,
        pub nominal_debt_delta: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Repaid {
        pub amount: u256,
        pub nominal_debt_delta: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct EmergencyDisabled {
        pub disabled: bool,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        owner: ContractAddress,
        router: ContractAddress,
        pool: ContractAddress,
        debt_asset: ContractAddress,
        min_health_factor: u256,
    ) {
        assert(owner.is_non_zero(), 'ZERO_OWNER');
        assert(router.is_non_zero(), 'ZERO_ROUTER');
        assert(pool.is_non_zero(), 'ZERO_POOL');
        assert(debt_asset.is_non_zero(), 'ZERO_DEBT_ASSET');
        assert(min_health_factor > 0, 'ZERO_HEALTH_FACTOR');
        self.ownable.initializer(owner);
        self.router.write(router);
        self.pool.write(pool);
        self.debt_asset.write(debt_asset);
        self.min_health_factor.write(min_health_factor);
    }

    #[abi(embed_v0)]
    impl AdapterImpl of super::super::interfaces::IStrategyAdapter<ContractState> {
        fn deposit(ref self: ContractState, asset: ContractAddress, amount: u256) {
            self.assert_router();
            assert(!self.emergency_disabled.read(), 'ADAPTER_DISABLED');
            assert(self.collateral_assets.read(asset), 'UNSUPPORTED_ASSET');
            assert(amount > 0, 'ZERO_AMOUNT');

            let pool_address = self.pool.read();
            let token = IERC20Dispatcher { contract_address: asset };
            self.reentrancy_guard.start();
            assert(token.approve(pool_address, amount), 'APPROVE_FAILED');

            let response = IVesuV2PoolDispatcher { contract_address: pool_address }
                .modify_position(self.params(asset, self.debt_asset.read(), amount, false, 0, false));

            assert(!response.collateral_delta.is_negative, 'BAD_COLLATERAL_DELTA');
            self.collateral_by_asset.write(asset, self.collateral_by_asset.read(asset) + amount);
            self.assert_collateralized(asset);
            self.emit(
                Deposited {
                    asset,
                    amount,
                    collateral_delta: response.collateral_delta.abs,
                    collateral_shares_delta: response.collateral_shares_delta.abs,
                },
            );
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
            let position = self.collateral_by_asset.read(asset);
            assert(position >= amount, 'INSUFFICIENT_POSITION');
            self.assert_health_factor_values(position - amount, self.debt.read());

            self.reentrancy_guard.start();
            let response = IVesuV2PoolDispatcher { contract_address: self.pool.read() }
                .modify_position(self.params(asset, self.debt_asset.read(), amount, true, 0, false));

            self.collateral_by_asset.write(asset, position - amount);
            self.assert_collateralized(asset);
            let token = IERC20Dispatcher { contract_address: asset };
            assert(token.transfer(recipient, amount), 'TRANSFER_FAILED');
            self.emit(
                Withdrawn {
                    asset,
                    amount,
                    recipient,
                    collateral_shares_delta: response.collateral_shares_delta.abs,
                },
            );
            self.reentrancy_guard.end();
            amount
        }

        fn harvest(ref self: ContractState, asset: ContractAddress) {
            self.assert_router();
            assert(self.collateral_assets.read(asset), 'UNSUPPORTED_ASSET');
            self.reentrancy_guard.start();
            self.assert_collateralized(asset);
            self.reentrancy_guard.end();
        }

        fn current_apy(self: @ContractState, asset: ContractAddress) -> u256 {
            let _ = asset;
            0
        }

        fn total_position(self: @ContractState, asset: ContractAddress) -> u256 {
            let (_, collateral, _) = IVesuV2PoolDispatcher { contract_address: self.pool.read() }
                .position(asset, self.debt_asset.read(), get_contract_address());
            collateral
        }

        fn is_supported_asset(self: @ContractState, asset: ContractAddress) -> bool {
            self.collateral_assets.read(asset)
        }
    }

    #[abi(embed_v0)]
    impl AdminImpl of super::super::interfaces::IAdapterAdmin<ContractState> {
        fn add_supported_asset(ref self: ContractState, asset: ContractAddress) {
            self.ownable.assert_only_owner();
            assert(asset.is_non_zero(), 'ZERO_ASSET');
            self.collateral_assets.write(asset, true);
            if !self.primary_collateral_asset.read().is_non_zero() {
                self.primary_collateral_asset.write(asset);
            }
            self.emit(CollateralAssetAdded { asset });
        }

        fn set_emergency_disabled(ref self: ContractState, disabled: bool) {
            self.ownable.assert_only_owner();
            self.emergency_disabled.write(disabled);
            self.emit(EmergencyDisabled { disabled });
        }
    }

    #[abi(embed_v0)]
    impl LeverageImpl of super::super::interfaces::ILeveragedVaultAdapterAdmin<ContractState> {
        fn borrow(ref self: ContractState, amount: u256, recipient: ContractAddress) {
            self.ownable.assert_only_owner();
            assert(!self.emergency_disabled.read(), 'ADAPTER_DISABLED');
            assert(amount > 0, 'ZERO_AMOUNT');
            let collateral_asset = self.first_collateral_asset();
            let debt_asset = self.debt_asset.read();
            self.assert_health_factor_values(
                self.collateral_by_asset.read(collateral_asset),
                self.debt.read() + amount,
            );

            self.reentrancy_guard.start();
            let response = IVesuV2PoolDispatcher { contract_address: self.pool.read() }
                .modify_position(self.params(collateral_asset, debt_asset, 0, false, amount, false));

            self.debt.write(self.debt.read() + amount);
            self.assert_collateralized(collateral_asset);
            let token = IERC20Dispatcher { contract_address: debt_asset };
            assert(token.transfer(recipient, amount), 'TRANSFER_FAILED');
            self.emit(
                Borrowed {
                    amount, recipient, nominal_debt_delta: response.nominal_debt_delta.abs,
                },
            );
            self.reentrancy_guard.end();
        }

        fn repay(ref self: ContractState, amount: u256) {
            self.ownable.assert_only_owner();
            assert(amount > 0, 'ZERO_AMOUNT');
            let debt = self.debt.read();
            assert(debt >= amount, 'REPAY_TOO_HIGH');
            let collateral_asset = self.first_collateral_asset();
            let debt_asset = self.debt_asset.read();
            let pool_address = self.pool.read();
            let token = IERC20Dispatcher { contract_address: debt_asset };
            self.reentrancy_guard.start();
            assert(token.approve(pool_address, amount), 'APPROVE_FAILED');

            let response = IVesuV2PoolDispatcher { contract_address: pool_address }
                .modify_position(self.params(collateral_asset, debt_asset, 0, false, amount, true));

            self.debt.write(debt - amount);
            self.emit(Repaid { amount, nominal_debt_delta: response.nominal_debt_delta.abs });
            self.reentrancy_guard.end();
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn assert_router(self: @ContractState) {
            assert(get_caller_address() == self.router.read(), 'NOT_ROUTER');
        }

        fn assert_collateralized(self: @ContractState, collateral_asset: ContractAddress) {
            let (is_collateralized, collateral, debt) = IVesuV2PoolDispatcher { contract_address: self.pool.read() }
                .check_collateralization(collateral_asset, self.debt_asset.read(), get_contract_address());
            assert(is_collateralized, 'NOT_COLLATERALIZED');
            self.assert_health_factor_values(collateral, debt);
        }

        fn assert_health_factor_values(self: @ContractState, collateral: u256, debt: u256) {
            if debt > 0 {
                assert(collateral >= debt * self.min_health_factor.read(), 'HEALTH_FACTOR_LOW');
            }
        }

        fn first_collateral_asset(self: @ContractState) -> ContractAddress {
            let asset = self.primary_collateral_asset.read();
            assert(self.collateral_assets.read(asset), 'NO_COLLATERAL_ASSET');
            asset
        }

        fn params(
            self: @ContractState,
            collateral_asset: ContractAddress,
            debt_asset: ContractAddress,
            collateral_abs: u256,
            collateral_negative: bool,
            debt_abs: u256,
            debt_negative: bool,
        ) -> VesuModifyPositionParams {
            VesuModifyPositionParams {
                collateral_asset,
                debt_asset,
                user: get_contract_address(),
                collateral: VesuAmount {
                    denomination: VesuAmountDenomination::Assets,
                    value: SignedU256 { abs: collateral_abs, is_negative: collateral_negative },
                },
                debt: VesuAmount {
                    denomination: VesuAmountDenomination::Assets,
                    value: SignedU256 { abs: debt_abs, is_negative: debt_negative },
                },
            }
        }
    }
}
