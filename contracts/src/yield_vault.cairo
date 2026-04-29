#[starknet::contract]
pub mod YieldVault {
    use openzeppelin_access::ownable::OwnableComponent;
    use openzeppelin_security::ReentrancyGuardComponent;
    use core::num::traits::Zero;
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use super::super::interfaces::{IERC20Dispatcher, IERC20DispatcherTrait};

    const ONE_SHARE: u256 = 1000000000000000000;

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
        deposits_paused: bool,
        withdrawals_paused: bool,
        total_shares: u256,
        user_shares: Map<ContractAddress, u256>,
        user_asset_shares: Map<(ContractAddress, ContractAddress), u256>,
        asset_total_shares: Map<ContractAddress, u256>,
        asset_managed: Map<ContractAddress, u256>,
        asset_idle: Map<ContractAddress, u256>,
        supported_assets: Map<ContractAddress, bool>,
        asset_share_multiplier: Map<ContractAddress, u256>,
        asset_deposit_cap: Map<ContractAddress, u256>,
        asset_total_deposited: Map<ContractAddress, u256>,
        supported_asset_by_index: Map<u32, ContractAddress>,
        supported_asset_count: u32,
        user_asset_principal: Map<(ContractAddress, ContractAddress), u256>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        #[flat]
        OwnableEvent: OwnableComponent::Event,
        #[flat]
        ReentrancyGuardEvent: ReentrancyGuardComponent::Event,
        Deposited: Deposited,
        Withdrawn: Withdrawn,
        AssetSupported: AssetSupported,
        AssetAccountingConfigured: AssetAccountingConfigured,
        RouterUpdated: RouterUpdated,
        FundsSentToStrategy: FundsSentToStrategy,
        DepositsPaused: DepositsPaused,
        WithdrawalsPaused: WithdrawalsPaused,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Deposited {
        #[key]
        pub user: ContractAddress,
        #[key]
        pub asset: ContractAddress,
        pub amount: u256,
        pub shares: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Withdrawn {
        #[key]
        pub user: ContractAddress,
        #[key]
        pub asset: ContractAddress,
        pub amount: u256,
        pub shares: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct AssetSupported {
        #[key]
        pub asset: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct AssetAccountingConfigured {
        #[key]
        pub asset: ContractAddress,
        pub share_multiplier: u256,
        pub deposit_cap: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct RouterUpdated {
        pub router: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct FundsSentToStrategy {
        #[key]
        pub asset: ContractAddress,
        #[key]
        pub strategy: ContractAddress,
        pub amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct DepositsPaused {
        pub paused: bool,
    }

    #[derive(Drop, starknet::Event)]
    pub struct WithdrawalsPaused {
        pub paused: bool,
    }

    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress, router: ContractAddress) {
        assert(owner.is_non_zero(), 'ZERO_OWNER');
        assert(router.is_non_zero(), 'ZERO_ROUTER');
        self.ownable.initializer(owner);
        self.router.write(router);
    }

    #[abi(embed_v0)]
    impl YieldVaultImpl of super::super::interfaces::IYieldVault<ContractState> {
        fn deposit(ref self: ContractState, asset: ContractAddress, amount: u256) -> u256 {
            assert(!self.deposits_paused.read(), 'DEPOSITS_PAUSED');
            assert(self.supported_assets.read(asset), 'UNSUPPORTED_ASSET');
            assert(amount > 0, 'ZERO_AMOUNT');
            let multiplier = self.asset_share_multiplier.read(asset);
            assert(multiplier > 0, 'ACCOUNTING_NOT_SET');
            let cap = self.asset_deposit_cap.read(asset);
            assert(cap > 0, 'CAP_NOT_SET');
            let total_deposited = self.asset_total_deposited.read(asset);
            assert(total_deposited + amount <= cap, 'DEPOSIT_CAP');

            let caller = get_caller_address();
            let vault = get_contract_address();
            let token = IERC20Dispatcher { contract_address: asset };
            self.reentrancy_guard.start();
            let ok = token.transfer_from(caller, vault, amount);
            assert(ok, 'TRANSFER_FROM_FAILED');

            let shares = amount * multiplier / ONE_SHARE;
            assert(shares > 0, 'ZERO_SHARES');
            self.user_shares.write(caller, self.user_shares.read(caller) + shares);
            self.user_asset_shares
                .write((caller, asset), self.user_asset_shares.read((caller, asset)) + shares);
            self.total_shares.write(self.total_shares.read() + shares);
            self.asset_total_shares.write(asset, self.asset_total_shares.read(asset) + shares);
            self.asset_managed.write(asset, self.asset_managed.read(asset) + amount);
            self.asset_idle.write(asset, self.asset_idle.read(asset) + amount);
            self.asset_total_deposited.write(asset, total_deposited + amount);
            self.user_asset_principal.write(
                (caller, asset), self.user_asset_principal.read((caller, asset)) + amount,
            );

            self.emit(Deposited { user: caller, asset, amount, shares });
            self.reentrancy_guard.end();
            shares
        }

        fn withdraw(ref self: ContractState, shares: u256, preferred_asset: ContractAddress) {
            assert(!self.withdrawals_paused.read(), 'WITHDRAWALS_PAUSED');
            assert(self.supported_assets.read(preferred_asset), 'UNSUPPORTED_ASSET');
            assert(shares > 0, 'ZERO_SHARES');

            let caller = get_caller_address();
            let user_shares = self.user_shares.read(caller);
            assert(user_shares >= shares, 'INSUFFICIENT_SHARES');
            let user_asset_shares = self.user_asset_shares.read((caller, preferred_asset));
            assert(user_asset_shares >= shares, 'INSUFFICIENT_ASSET_SHARES');
            let multiplier = self.asset_share_multiplier.read(preferred_asset);
            assert(multiplier > 0, 'ACCOUNTING_NOT_SET');
            let amount = shares * ONE_SHARE / multiplier;
            assert(amount > 0, 'ZERO_AMOUNT');
            let managed = self.asset_managed.read(preferred_asset);
            assert(managed >= amount, 'INSUFFICIENT_ASSET');
            let idle = self.asset_idle.read(preferred_asset);
            assert(idle >= amount, 'INSUFFICIENT_IDLE');

            self.reentrancy_guard.start();
            self.user_shares.write(caller, user_shares - shares);
            self.user_asset_shares.write((caller, preferred_asset), user_asset_shares - shares);
            self.total_shares.write(self.total_shares.read() - shares);
            self.asset_total_shares
                .write(preferred_asset, self.asset_total_shares.read(preferred_asset) - shares);
            self.asset_managed.write(preferred_asset, managed - amount);
            self.asset_idle.write(preferred_asset, idle - amount);

            let token = IERC20Dispatcher { contract_address: preferred_asset };
            let ok = token.transfer(caller, amount);
            assert(ok, 'TRANSFER_FAILED');

            self.emit(Withdrawn { user: caller, asset: preferred_asset, amount, shares });
            self.reentrancy_guard.end();
        }

        fn transfer_to_strategy(
            ref self: ContractState,
            asset: ContractAddress,
            strategy: ContractAddress,
            amount: u256,
        ) {
            self.assert_router();
            assert(self.supported_assets.read(asset), 'UNSUPPORTED_ASSET');
            assert(amount > 0, 'ZERO_AMOUNT');
            let idle = self.asset_idle.read(asset);
            assert(idle >= amount, 'INSUFFICIENT_IDLE');
            self.reentrancy_guard.start();
            self.asset_idle.write(asset, idle - amount);

            let token = IERC20Dispatcher { contract_address: asset };
            let ok = token.transfer(strategy, amount);
            assert(ok, 'TRANSFER_FAILED');
            self.emit(FundsSentToStrategy { asset, strategy, amount });
            self.reentrancy_guard.end();
        }

        fn record_strategy_return(ref self: ContractState, asset: ContractAddress, amount: u256) {
            self.assert_router();
            assert(self.supported_assets.read(asset), 'UNSUPPORTED_ASSET');
            assert(amount > 0, 'ZERO_AMOUNT');
            self.asset_idle.write(asset, self.asset_idle.read(asset) + amount);
        }

        fn set_router(ref self: ContractState, router: ContractAddress) {
            self.ownable.assert_only_owner();
            assert(router.is_non_zero(), 'ZERO_ROUTER');
            self.router.write(router);
            self.emit(RouterUpdated { router });
        }

        fn add_supported_asset(ref self: ContractState, asset: ContractAddress) {
            self.ownable.assert_only_owner();
            assert(asset.is_non_zero(), 'ZERO_ASSET');
            assert(!self.supported_assets.read(asset), 'ASSET_EXISTS');
            self.supported_assets.write(asset, true);
            let index = self.supported_asset_count.read();
            self.supported_asset_by_index.write(index, asset);
            self.supported_asset_count.write(index + 1);
            self.emit(AssetSupported { asset });
        }

        fn set_asset_accounting(
            ref self: ContractState,
            asset: ContractAddress,
            share_multiplier: u256,
            deposit_cap: u256,
        ) {
            self.ownable.assert_only_owner();
            assert(self.supported_assets.read(asset), 'UNSUPPORTED_ASSET');
            assert(share_multiplier > 0, 'ZERO_MULTIPLIER');
            assert(deposit_cap > 0, 'ZERO_CAP');
            assert(
                self.asset_total_deposited.read(asset) <= deposit_cap,
                'CAP_BELOW_DEPOSITS',
            );
            self.asset_share_multiplier.write(asset, share_multiplier);
            self.asset_deposit_cap.write(asset, deposit_cap);
            self.emit(AssetAccountingConfigured { asset, share_multiplier, deposit_cap });
        }

        fn set_withdrawals_paused(ref self: ContractState, paused: bool) {
            self.ownable.assert_only_owner();
            self.withdrawals_paused.write(paused);
            self.emit(WithdrawalsPaused { paused });
        }

        fn set_deposits_paused(ref self: ContractState, paused: bool) {
            self.ownable.assert_only_owner();
            self.deposits_paused.write(paused);
            self.emit(DepositsPaused { paused });
        }

        fn total_assets(self: @ContractState, asset: ContractAddress) -> u256 {
            self.asset_managed.read(asset)
        }

        fn share_price(self: @ContractState) -> u256 {
            ONE_SHARE
        }

        fn get_user_position(self: @ContractState, user: ContractAddress) -> u256 {
            self.user_shares.read(user)
        }

        fn get_user_asset_position(
            self: @ContractState,
            user: ContractAddress,
            asset: ContractAddress,
        ) -> u256 {
            self.user_asset_shares.read((user, asset))
        }

        fn is_supported_asset(self: @ContractState, asset: ContractAddress) -> bool {
            self.supported_assets.read(asset)
        }

        fn get_supported_asset(self: @ContractState, index: u32) -> ContractAddress {
            assert(index < self.supported_asset_count.read(), 'INDEX_OOB');
            self.supported_asset_by_index.read(index)
        }

        fn get_supported_asset_count(self: @ContractState) -> u32 {
            self.supported_asset_count.read()
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn assert_router(self: @ContractState) {
            assert(get_caller_address() == self.router.read(), 'NOT_ROUTER');
        }
    }
}
