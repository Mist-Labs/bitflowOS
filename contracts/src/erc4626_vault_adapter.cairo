#[starknet::contract]
pub mod Erc4626VaultAdapter {
    use openzeppelin_access::ownable::OwnableComponent;
    use openzeppelin_security::ReentrancyGuardComponent;
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use core::num::traits::Zero;
    use super::super::interfaces::{
        IERC20Dispatcher, IERC20DispatcherTrait, IERC4626VaultDispatcher,
        IERC4626VaultDispatcherTrait,
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
        emergency_disabled: bool,
        vault_by_asset: Map<ContractAddress, ContractAddress>,
        shares_by_asset: Map<ContractAddress, u256>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        #[flat]
        OwnableEvent: OwnableComponent::Event,
        #[flat]
        ReentrancyGuardEvent: ReentrancyGuardComponent::Event,
        VaultConfigured: VaultConfigured,
        Deposited: Deposited,
        Withdrawn: Withdrawn,
        Harvested: Harvested,
        EmergencyDisabled: EmergencyDisabled,
    }

    #[derive(Drop, starknet::Event)]
    pub struct VaultConfigured {
        #[key]
        pub asset: ContractAddress,
        pub vault: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Deposited {
        #[key]
        pub asset: ContractAddress,
        pub assets: u256,
        pub shares: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Withdrawn {
        #[key]
        pub asset: ContractAddress,
        pub assets: u256,
        pub shares: u256,
        pub recipient: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Harvested {
        #[key]
        pub asset: ContractAddress,
        pub assets: u256,
        pub shares: u256,
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
            let vault_address = self.assert_vault(asset);
            let token = IERC20Dispatcher { contract_address: asset };
            self.reentrancy_guard.start();
            assert(token.approve(vault_address, amount), 'APPROVE_FAILED');
            let vault = IERC4626VaultDispatcher { contract_address: vault_address };
            let shares = vault.deposit(amount, get_contract_address());
            assert(shares > 0, 'ZERO_SHARES');
            self.shares_by_asset.write(asset, self.shares_by_asset.read(asset) + shares);
            self.emit(Deposited { asset, assets: amount, shares });
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
            let vault = IERC4626VaultDispatcher { contract_address: self.assert_vault(asset) };
            self.reentrancy_guard.start();
            let shares_burned = vault.withdraw(amount, recipient, get_contract_address());
            let shares = self.shares_by_asset.read(asset);
            assert(shares >= shares_burned, 'INSUFFICIENT_SHARES');
            self.shares_by_asset.write(asset, shares - shares_burned);
            self.emit(Withdrawn { asset, assets: amount, shares: shares_burned, recipient });
            self.reentrancy_guard.end();
            amount
        }

        fn harvest(ref self: ContractState, asset: ContractAddress) {
            self.assert_router();
            let shares = self.shares_by_asset.read(asset);
            let vault = IERC4626VaultDispatcher { contract_address: self.assert_vault(asset) };
            self.reentrancy_guard.start();
            self.emit(Harvested { asset, assets: vault.convert_to_assets(shares), shares });
            self.reentrancy_guard.end();
        }

        fn current_apy(self: @ContractState, asset: ContractAddress) -> u256 {
            let _ = asset;
            0
        }

        fn total_position(self: @ContractState, asset: ContractAddress) -> u256 {
            let vault = IERC4626VaultDispatcher { contract_address: self.assert_vault(asset) };
            vault.convert_to_assets(self.shares_by_asset.read(asset))
        }

        fn is_supported_asset(self: @ContractState, asset: ContractAddress) -> bool {
            self.vault_by_asset.read(asset).is_non_zero()
        }
    }

    #[abi(embed_v0)]
    impl AdminImpl of super::super::interfaces::IAdapterAdmin<ContractState> {
        fn add_supported_asset(ref self: ContractState, asset: ContractAddress) {
            self.ownable.assert_only_owner();
            let vault = self.vault_by_asset.read(asset);
            assert(vault.is_non_zero(), 'VAULT_NOT_CONFIGURED');
            self.emit(VaultConfigured { asset, vault });
        }

        fn set_emergency_disabled(ref self: ContractState, disabled: bool) {
            self.ownable.assert_only_owner();
            self.emergency_disabled.write(disabled);
            self.emit(EmergencyDisabled { disabled });
        }
    }

    #[abi(embed_v0)]
    impl VaultAdminImpl of super::super::interfaces::IErc4626VaultAdapterAdmin<ContractState> {
        fn set_asset_vault(
            ref self: ContractState,
            asset: ContractAddress,
            vault: ContractAddress,
        ) {
            self.ownable.assert_only_owner();
            assert(asset.is_non_zero(), 'ZERO_ASSET');
            assert(vault.is_non_zero(), 'ZERO_VAULT');
            let configured_asset = IERC4626VaultDispatcher { contract_address: vault }.asset();
            assert(configured_asset == asset, 'ASSET_MISMATCH');
            self.vault_by_asset.write(asset, vault);
            self.emit(VaultConfigured { asset, vault });
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn assert_router(self: @ContractState) {
            assert(get_caller_address() == self.router.read(), 'NOT_ROUTER');
        }

        fn assert_vault(self: @ContractState, asset: ContractAddress) -> ContractAddress {
            let vault = self.vault_by_asset.read(asset);
            assert(vault.is_non_zero(), 'UNSUPPORTED_ASSET');
            vault
        }
    }
}
