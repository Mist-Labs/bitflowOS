#[starknet::contract]
pub mod StrategyRouter {
    use openzeppelin_access::ownable::OwnableComponent;
    use openzeppelin_security::ReentrancyGuardComponent;
    use starknet::{ContractAddress, get_caller_address};
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use core::num::traits::Zero;
    use super::super::interfaces::{
        Allocation, IAttestationRegistryDispatcher, IAttestationRegistryDispatcherTrait,
        IStrategyAdapterDispatcher, IStrategyAdapterDispatcherTrait, IYieldVaultDispatcher,
        IYieldVaultDispatcherTrait,
    };

    const BPS_DENOMINATOR: u16 = 10000;

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);
    component!(
        path: ReentrancyGuardComponent, storage: reentrancy_guard, event: ReentrancyGuardEvent,
    );

    #[abi(embed_v0)]
    impl OwnableMixinImpl = OwnableComponent::OwnableMixinImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;
    impl ReentrancyGuardInternalImpl = ReentrancyGuardComponent::InternalImpl<ContractState>;

    #[derive(Copy, Drop, Serde, starknet::Store)]
    pub struct StrategyConfig {
        pub adapter: ContractAddress,
        pub enabled: bool,
        pub max_bps: u16,
    }

    #[storage]
    pub struct Storage {
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
        #[substorage(v0)]
        pub reentrancy_guard: ReentrancyGuardComponent::Storage,
        vault: ContractAddress,
        attestation_registry: ContractAddress,
        executors: Map<ContractAddress, bool>,
        strategies: Map<felt252, StrategyConfig>,
        positions: Map<(felt252, ContractAddress), u256>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        #[flat]
        OwnableEvent: OwnableComponent::Event,
        #[flat]
        ReentrancyGuardEvent: ReentrancyGuardComponent::Event,
        ExecutorUpdated: ExecutorUpdated,
        StrategyRegistered: StrategyRegistered,
        StrategyStatusUpdated: StrategyStatusUpdated,
        Allocated: Allocated,
        StrategyWithdrawal: StrategyWithdrawal,
        Rebalanced: Rebalanced,
        Harvested: Harvested,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ExecutorUpdated {
        #[key]
        pub executor: ContractAddress,
        pub enabled: bool,
    }

    #[derive(Drop, starknet::Event)]
    pub struct StrategyRegistered {
        #[key]
        pub strategy_id: felt252,
        pub adapter: ContractAddress,
        pub max_bps: u16,
    }

    #[derive(Drop, starknet::Event)]
    pub struct StrategyStatusUpdated {
        #[key]
        pub strategy_id: felt252,
        pub enabled: bool,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Allocated {
        #[key]
        pub strategy_id: felt252,
        #[key]
        pub asset: ContractAddress,
        pub amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct StrategyWithdrawal {
        #[key]
        pub strategy_id: felt252,
        #[key]
        pub asset: ContractAddress,
        pub amount: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Rebalanced {
        #[key]
        pub attestation_hash: felt252,
        pub allocation_count: u32,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Harvested {
        #[key]
        pub strategy_id: felt252,
        #[key]
        pub asset: ContractAddress,
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        owner: ContractAddress,
        vault: ContractAddress,
        attestation_registry: ContractAddress,
    ) {
        assert(owner.is_non_zero(), 'ZERO_OWNER');
        assert(vault.is_non_zero(), 'ZERO_VAULT');
        assert(attestation_registry.is_non_zero(), 'ZERO_REGISTRY');
        self.ownable.initializer(owner);
        self.vault.write(vault);
        self.attestation_registry.write(attestation_registry);
        self.executors.write(owner, true);
    }

    #[abi(embed_v0)]
    impl StrategyRouterImpl of super::super::interfaces::IStrategyRouter<ContractState> {
        fn set_executor(ref self: ContractState, executor: ContractAddress, enabled: bool) {
            self.ownable.assert_only_owner();
            assert(executor.is_non_zero(), 'ZERO_EXECUTOR');
            self.executors.write(executor, enabled);
            self.emit(ExecutorUpdated { executor, enabled });
        }

        fn register_strategy(
            ref self: ContractState,
            strategy_id: felt252,
            adapter: ContractAddress,
            max_bps: u16,
        ) {
            self.ownable.assert_only_owner();
            assert(strategy_id != 0, 'ZERO_STRATEGY');
            assert(adapter.is_non_zero(), 'ZERO_ADAPTER');
            assert(max_bps <= BPS_DENOMINATOR, 'MAX_BPS_TOO_HIGH');
            self.strategies.write(strategy_id, StrategyConfig { adapter, enabled: true, max_bps });
            self.emit(StrategyRegistered { strategy_id, adapter, max_bps });
        }

        fn set_strategy_status(ref self: ContractState, strategy_id: felt252, enabled: bool) {
            self.ownable.assert_only_owner();
            let mut strategy = self.strategies.read(strategy_id);
            assert(strategy.adapter.is_non_zero(), 'UNKNOWN_STRATEGY');
            strategy.enabled = enabled;
            self.strategies.write(strategy_id, strategy);
            self.emit(StrategyStatusUpdated { strategy_id, enabled });
        }

        fn allocate(
            ref self: ContractState,
            asset: ContractAddress,
            amount: u256,
            strategy_id: felt252,
        ) {
            self.assert_executor();
            assert(amount > 0, 'ZERO_AMOUNT');
            let strategy = self.assert_strategy_enabled(strategy_id);
            self.reentrancy_guard.start();
            let vault = IYieldVaultDispatcher { contract_address: self.vault.read() };
            vault.transfer_to_strategy(asset, strategy.adapter, amount);
            let adapter = IStrategyAdapterDispatcher { contract_address: strategy.adapter };
            adapter.deposit(asset, amount);

            let key = (strategy_id, asset);
            self.positions.write(key, self.positions.read(key) + amount);
            self.emit(Allocated { strategy_id, asset, amount });
            self.reentrancy_guard.end();
        }

        fn withdraw_from_strategy(
            ref self: ContractState,
            asset: ContractAddress,
            amount: u256,
            strategy_id: felt252,
        ) {
            self.assert_executor();
            assert(amount > 0, 'ZERO_AMOUNT');
            let strategy = self.assert_strategy_enabled(strategy_id);
            let key = (strategy_id, asset);
            let position = self.positions.read(key);
            assert(position >= amount, 'INSUFFICIENT_POSITION');
            self.reentrancy_guard.start();
            let adapter = IStrategyAdapterDispatcher { contract_address: strategy.adapter };
            let returned_amount = adapter.withdraw(asset, amount, self.vault.read());
            self.positions.write(key, position - amount);
            let vault = IYieldVaultDispatcher { contract_address: self.vault.read() };
            vault.record_strategy_return(asset, returned_amount);
            self.emit(StrategyWithdrawal { strategy_id, asset, amount: returned_amount });
            self.reentrancy_guard.end();
        }

        fn rebalance(ref self: ContractState, weights: Array<Allocation>, attestation_hash: felt252) {
            self.assert_executor();
            let registry = IAttestationRegistryDispatcher {
                contract_address: self.attestation_registry.read(),
            };
            assert(registry.is_valid_attestation(attestation_hash), 'INVALID_ATTESTATION');

            let mut total_bps: u16 = 0;
            let mut i: u32 = 0;
            let len = weights.len();
            while i < len {
                let allocation = *weights.at(i);
                let strategy = self.assert_strategy_enabled(allocation.strategy_id);
                assert(allocation.target_bps <= strategy.max_bps, 'ALLOCATION_TOO_HIGH');
                total_bps += allocation.target_bps;
                i += 1;
            };
            assert(total_bps <= BPS_DENOMINATOR, 'TOTAL_BPS_TOO_HIGH');

            self.reentrancy_guard.start();
            registry.mark_used(attestation_hash);
            let vault_address = self.vault.read();
            let vault = IYieldVaultDispatcher { contract_address: vault_address };
            let mut execute_i: u32 = 0;
            while execute_i < len {
                let allocation = *weights.at(execute_i);
                let strategy = self.assert_strategy_enabled(allocation.strategy_id);
                let total_assets = vault.total_assets(allocation.asset);
                let target_amount = total_assets * allocation.target_bps.into() / BPS_DENOMINATOR.into();
                let key = (allocation.strategy_id, allocation.asset);
                let current_position = self.positions.read(key);

                if target_amount > current_position {
                    let amount_to_allocate = target_amount - current_position;
                    vault.transfer_to_strategy(allocation.asset, strategy.adapter, amount_to_allocate);
                    let adapter = IStrategyAdapterDispatcher { contract_address: strategy.adapter };
                    adapter.deposit(allocation.asset, amount_to_allocate);
                    self.positions.write(key, current_position + amount_to_allocate);
                    self.emit(
                        Allocated {
                            strategy_id: allocation.strategy_id,
                            asset: allocation.asset,
                            amount: amount_to_allocate,
                        },
                    );
                } else if current_position > target_amount {
                    let amount_to_withdraw = current_position - target_amount;
                    let adapter = IStrategyAdapterDispatcher { contract_address: strategy.adapter };
                    let returned_amount = adapter.withdraw(
                        allocation.asset, amount_to_withdraw, vault_address,
                    );
                    self.positions.write(key, target_amount);
                    vault.record_strategy_return(allocation.asset, returned_amount);
                    self.emit(
                        StrategyWithdrawal {
                            strategy_id: allocation.strategy_id,
                            asset: allocation.asset,
                            amount: returned_amount,
                        },
                    );
                }
                execute_i += 1;
            };
            self.emit(Rebalanced { attestation_hash, allocation_count: len });
            self.reentrancy_guard.end();
        }

        fn harvest(ref self: ContractState, strategy_id: felt252, asset: ContractAddress) {
            self.assert_executor();
            let strategy = self.assert_strategy_enabled(strategy_id);
            self.reentrancy_guard.start();
            let adapter = IStrategyAdapterDispatcher { contract_address: strategy.adapter };
            adapter.harvest(asset);
            self.emit(Harvested { strategy_id, asset });
            self.reentrancy_guard.end();
        }

        fn get_strategy_adapter(self: @ContractState, strategy_id: felt252) -> ContractAddress {
            self.strategies.read(strategy_id).adapter
        }

        fn get_strategy_position(
            self: @ContractState,
            strategy_id: felt252,
            asset: ContractAddress,
        ) -> u256 {
            self.positions.read((strategy_id, asset))
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn assert_executor(self: @ContractState) {
            let caller = get_caller_address();
            assert(caller == self.ownable.owner() || self.executors.read(caller), 'NOT_EXECUTOR');
        }

        fn assert_strategy_enabled(self: @ContractState, strategy_id: felt252) -> StrategyConfig {
            let strategy = self.strategies.read(strategy_id);
            assert(strategy.adapter.is_non_zero(), 'UNKNOWN_STRATEGY');
            assert(strategy.enabled, 'STRATEGY_DISABLED');
            strategy
        }
    }
}
