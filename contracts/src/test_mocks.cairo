#[starknet::interface]
pub trait IMockERC20<TContractState> {
    fn mint(ref self: TContractState, recipient: starknet::ContractAddress, amount: u256);
}

#[starknet::interface]
pub trait IMockProtocolAdmin<TContractState> {
    fn set_apy(ref self: TContractState, asset: starknet::ContractAddress, apy: u256);
    fn set_reward(ref self: TContractState, recipient: starknet::ContractAddress, amount: u256);
}

#[starknet::contract]
pub mod MockERC20 {
    use openzeppelin_access::ownable::OwnableComponent;
    use starknet::{ContractAddress, get_caller_address};
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableMixinImpl = OwnableComponent::OwnableMixinImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    pub struct Storage {
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
        balances: Map<ContractAddress, u256>,
        allowances: Map<(ContractAddress, ContractAddress), u256>,
        total_supply: u256,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        #[flat]
        OwnableEvent: OwnableComponent::Event,
    }

    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress) {
        self.ownable.initializer(owner);
    }

    #[abi(embed_v0)]
    impl ERC20Impl of super::super::interfaces::IERC20<ContractState> {
        fn approve(ref self: ContractState, spender: ContractAddress, amount: u256) -> bool {
            let owner = get_caller_address();
            self.allowances.write((owner, spender), amount);
            true
        }

        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u256) -> bool {
            let sender = get_caller_address();
            self.transfer_internal(sender, recipient, amount);
            true
        }

        fn transfer_from(
            ref self: ContractState,
            sender: ContractAddress,
            recipient: ContractAddress,
            amount: u256,
        ) -> bool {
            let spender = get_caller_address();
            if spender != sender {
                let allowance = self.allowances.read((sender, spender));
                assert(allowance >= amount, 'ALLOWANCE_TOO_LOW');
                self.allowances.write((sender, spender), allowance - amount);
            }
            self.transfer_internal(sender, recipient, amount);
            true
        }

        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
            self.balances.read(account)
        }
    }

    #[external(v0)]
    fn balanceOf(self: @ContractState, account: ContractAddress) -> u256 {
        self.balances.read(account)
    }

    #[external(v0)]
    fn transferFrom(
        ref self: ContractState,
        sender: ContractAddress,
        recipient: ContractAddress,
        amount: u256,
    ) -> bool {
        let spender = get_caller_address();
        if spender != sender {
            let allowance = self.allowances.read((sender, spender));
            assert(allowance >= amount, 'ALLOWANCE_TOO_LOW');
            self.allowances.write((sender, spender), allowance - amount);
        }
        self.transfer_internal(sender, recipient, amount);
        true
    }

    #[external(v0)]
    fn allowance(
        self: @ContractState,
        owner: ContractAddress,
        spender: ContractAddress,
    ) -> u256 {
        self.allowances.read((owner, spender))
    }

    #[abi(embed_v0)]
    impl MockImpl of super::IMockERC20<ContractState> {
        fn mint(ref self: ContractState, recipient: ContractAddress, amount: u256) {
            self.ownable.assert_only_owner();
            self.balances.write(recipient, self.balances.read(recipient) + amount);
            self.total_supply.write(self.total_supply.read() + amount);
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn transfer_internal(
            ref self: ContractState,
            sender: ContractAddress,
            recipient: ContractAddress,
            amount: u256,
        ) {
            assert(amount > 0, 'ZERO_AMOUNT');
            let sender_balance = self.balances.read(sender);
            assert(sender_balance >= amount, 'BALANCE_TOO_LOW');
            self.balances.write(sender, sender_balance - amount);
            self.balances.write(recipient, self.balances.read(recipient) + amount);
        }
    }
}

#[starknet::contract]
pub mod MockERC4626Vault {
    use openzeppelin_access::ownable::OwnableComponent;
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use super::super::interfaces::{IERC20Dispatcher, IERC20DispatcherTrait};

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableMixinImpl = OwnableComponent::OwnableMixinImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    pub struct Storage {
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
        asset: ContractAddress,
        shares: Map<ContractAddress, u256>,
        total_shares: u256,
        total_assets: u256,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        #[flat]
        OwnableEvent: OwnableComponent::Event,
    }

    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress, asset: ContractAddress) {
        self.ownable.initializer(owner);
        self.asset.write(asset);
    }

    #[abi(embed_v0)]
    impl VaultImpl of super::super::interfaces::IERC4626Vault<ContractState> {
        fn asset(self: @ContractState) -> ContractAddress {
            self.asset.read()
        }

        fn deposit(ref self: ContractState, assets: u256, receiver: ContractAddress) -> u256 {
            assert(assets > 0, 'ZERO_ASSETS');
            let token = IERC20Dispatcher { contract_address: self.asset.read() };
            assert(token.transfer_from(get_caller_address(), get_contract_address(), assets), 'TRANSFER_FAILED');
            self.shares.write(receiver, self.shares.read(receiver) + assets);
            self.total_shares.write(self.total_shares.read() + assets);
            self.total_assets.write(self.total_assets.read() + assets);
            assets
        }

        fn withdraw(
            ref self: ContractState,
            assets: u256,
            receiver: ContractAddress,
            owner: ContractAddress,
        ) -> u256 {
            assert(assets > 0, 'ZERO_ASSETS');
            let shares = self.shares.read(owner);
            assert(shares >= assets, 'SHARES_TOO_LOW');
            self.shares.write(owner, shares - assets);
            self.total_shares.write(self.total_shares.read() - assets);
            self.total_assets.write(self.total_assets.read() - assets);
            let token = IERC20Dispatcher { contract_address: self.asset.read() };
            assert(token.transfer(receiver, assets), 'TRANSFER_FAILED');
            assets
        }

        fn total_assets(self: @ContractState) -> u256 {
            self.total_assets.read()
        }

        fn convert_to_assets(self: @ContractState, shares: u256) -> u256 {
            shares
        }

        fn convert_to_shares(self: @ContractState, assets: u256) -> u256 {
            assets
        }

        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
            self.shares.read(account)
        }
    }
}

#[starknet::contract]
pub mod MockLeveragedVault {
    use openzeppelin_access::ownable::OwnableComponent;
    use starknet::{ContractAddress, get_caller_address, get_contract_address};
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess,
    };
    use super::super::interfaces::{
        IERC20Dispatcher, IERC20DispatcherTrait, SignedU256, VesuModifyPositionParams,
        VesuPosition, VesuUpdatePositionResponse,
    };

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableMixinImpl = OwnableComponent::OwnableMixinImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    pub struct Storage {
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
        collateral: Map<(ContractAddress, ContractAddress), u256>,
        total_collateral: Map<ContractAddress, u256>,
        debt: Map<(ContractAddress, ContractAddress), u256>,
        total_debt: Map<ContractAddress, u256>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        #[flat]
        OwnableEvent: OwnableComponent::Event,
    }

    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress) {
        self.ownable.initializer(owner);
    }

    #[abi(embed_v0)]
    impl ProtocolImpl of super::super::interfaces::IVesuV2Pool<ContractState> {
        fn modify_position(
            ref self: ContractState,
            params: VesuModifyPositionParams,
        ) -> VesuUpdatePositionResponse {
            let caller = get_caller_address();
            let collateral_abs = params.collateral.value.abs;
            let debt_abs = params.debt.value.abs;
            let mut collateral_delta = SignedU256 {
                abs: collateral_abs, is_negative: params.collateral.value.is_negative,
            };
            let mut debt_delta = SignedU256 { abs: debt_abs, is_negative: params.debt.value.is_negative };

            if collateral_abs > 0 {
                let token = IERC20Dispatcher { contract_address: params.collateral_asset };
                if params.collateral.value.is_negative {
                    let position = self.collateral.read((params.user, params.collateral_asset));
                    assert(position >= collateral_abs, 'COLLATERAL_LOW');
                    self
                        .collateral
                        .write((params.user, params.collateral_asset), position - collateral_abs);
                    self
                        .total_collateral
                        .write(params.user, self.total_collateral.read(params.user) - collateral_abs);
                    assert(token.transfer(caller, collateral_abs), 'TRANSFER_FAILED');
                } else {
                    assert(token.transfer_from(caller, get_contract_address(), collateral_abs), 'PULL_FAILED');
                    self
                        .collateral
                        .write(
                            (params.user, params.collateral_asset),
                            self.collateral.read((params.user, params.collateral_asset)) + collateral_abs,
                        );
                    self
                        .total_collateral
                        .write(params.user, self.total_collateral.read(params.user) + collateral_abs);
                }
            } else {
                collateral_delta = SignedU256 { abs: 0, is_negative: false };
            }

            if debt_abs > 0 {
                let token = IERC20Dispatcher { contract_address: params.debt_asset };
                if params.debt.value.is_negative {
                    let debt = self.debt.read((params.user, params.debt_asset));
                    assert(debt >= debt_abs, 'DEBT_TOO_LOW');
                    assert(token.transfer_from(caller, get_contract_address(), debt_abs), 'REPAY_PULL_FAILED');
                    self.debt.write((params.user, params.debt_asset), debt - debt_abs);
                    self.total_debt.write(params.user, self.total_debt.read(params.user) - debt_abs);
                } else {
                    self
                        .debt
                        .write(
                            (params.user, params.debt_asset),
                            self.debt.read((params.user, params.debt_asset)) + debt_abs,
                        );
                    self.total_debt.write(params.user, self.total_debt.read(params.user) + debt_abs);
                    assert(token.transfer(caller, debt_abs), 'BORROW_TRANSFER_FAILED');
                }
            } else {
                debt_delta = SignedU256 { abs: 0, is_negative: false };
            }

            VesuUpdatePositionResponse {
                collateral_delta,
                collateral_shares_delta: collateral_delta,
                debt_delta,
                nominal_debt_delta: debt_delta,
                bad_debt: 0,
            }
        }

        fn position(
            self: @ContractState,
            collateral_asset: ContractAddress,
            debt_asset: ContractAddress,
            user: ContractAddress,
        ) -> (VesuPosition, u256, u256) {
            let collateral = self.collateral.read((user, collateral_asset));
            let debt = self.debt.read((user, debt_asset));
            (VesuPosition { collateral_shares: collateral, nominal_debt: debt }, collateral, debt)
        }

        fn check_collateralization(
            self: @ContractState,
            collateral_asset: ContractAddress,
            debt_asset: ContractAddress,
            user: ContractAddress,
        ) -> (bool, u256, u256) {
            let _ = collateral_asset;
            let _ = debt_asset;
            let collateral = self.total_collateral.read(user);
            let debt = self.total_debt.read(user);
            (debt == 0 || collateral * 2 >= debt, collateral, debt)
        }
    }
}

#[starknet::contract]
pub mod MockEkuboProtocol {
    use core::traits::TryInto;
    use openzeppelin_access::ownable::OwnableComponent;
    use starknet::{ContractAddress, get_caller_address};
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use super::super::interfaces::{
        EkuboBounds, EkuboPoolKey, EkuboPoolPrice, EkuboTokenInfo, IERC20Dispatcher,
        IERC20DispatcherTrait,
    };

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableMixinImpl = OwnableComponent::OwnableMixinImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    pub struct Storage {
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
        apy_by_asset: Map<ContractAddress, u256>,
        positions: Map<(u64, ContractAddress), u128>,
        rewards: Map<ContractAddress, u256>,
        next_id: u64,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        #[flat]
        OwnableEvent: OwnableComponent::Event,
    }

    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress) {
        self.ownable.initializer(owner);
        self.next_id.write(1);
    }

    #[abi(embed_v0)]
    impl ProtocolImpl of super::super::interfaces::IEkuboPositions<ContractState> {
        fn mint_v2(ref self: ContractState, referrer: ContractAddress) -> u64 {
            let _ = referrer;
            let id = self.next_id.read();
            self.next_id.write(id + 1);
            id
        }

        fn deposit_amounts(
            ref self: ContractState,
            id: u64,
            pool_key: EkuboPoolKey,
            bounds: EkuboBounds,
            amount0: u128,
            amount1: u128,
            min_liquidity: u128,
        ) -> u128 {
            let _ = bounds;
            let liquidity = amount0 + amount1;
            assert(liquidity >= min_liquidity, 'LOW_LIQUIDITY');
            if amount0 > 0 {
                self.pull(pool_key.token0, amount0.into());
                self.positions.write((id, pool_key.token0), self.positions.read((id, pool_key.token0)) + amount0);
            }
            if amount1 > 0 {
                self.pull(pool_key.token1, amount1.into());
                self.positions.write((id, pool_key.token1), self.positions.read((id, pool_key.token1)) + amount1);
            }
            liquidity
        }

        fn withdraw_v2(
            ref self: ContractState,
            id: u64,
            pool_key: EkuboPoolKey,
            bounds: EkuboBounds,
            liquidity: u128,
            min_token0: u128,
            min_token1: u128,
        ) -> (u128, u128) {
            let _ = bounds;
            let _ = min_token0;
            let _ = min_token1;
            let token0_position = self.positions.read((id, pool_key.token0));
            let token1_position = self.positions.read((id, pool_key.token1));
            if token0_position >= liquidity {
                self.positions.write((id, pool_key.token0), token0_position - liquidity);
                self.release(pool_key.token0, liquidity.into(), get_caller_address());
                (liquidity, 0)
            } else {
                assert(token1_position >= liquidity, 'POSITION_LOW');
                self.positions.write((id, pool_key.token1), token1_position - liquidity);
                self.release(pool_key.token1, liquidity.into(), get_caller_address());
                (0, liquidity)
            }
        }

        fn collect_fees(
            ref self: ContractState,
            id: u64,
            pool_key: EkuboPoolKey,
            bounds: EkuboBounds,
        ) -> (u128, u128) {
            let _ = id;
            let _ = bounds;
            let fees0: u128 = self.claim(pool_key.token0).try_into().unwrap();
            let fees1: u128 = self.claim(pool_key.token1).try_into().unwrap();
            (fees0, fees1)
        }

        fn get_token_info(
            self: @ContractState,
            id: u64,
            pool_key: EkuboPoolKey,
            bounds: EkuboBounds,
        ) -> EkuboTokenInfo {
            let _ = bounds;
            EkuboTokenInfo {
                pool_price: EkuboPoolPrice {
                    sqrt_ratio: 0,
                    tick: super::super::interfaces::EkuboI129 { mag: 0, sign: false },
                },
                liquidity: self.positions.read((id, pool_key.token0)) + self.positions.read((id, pool_key.token1)),
                amount0: self.positions.read((id, pool_key.token0)),
                amount1: self.positions.read((id, pool_key.token1)),
                fees0: 0,
                fees1: 0,
            }
        }
    }

    #[abi(embed_v0)]
    impl AdminImpl of super::IMockProtocolAdmin<ContractState> {
        fn set_apy(ref self: ContractState, asset: ContractAddress, apy: u256) {
            self.ownable.assert_only_owner();
            self.apy_by_asset.write(asset, apy);
        }

        fn set_reward(ref self: ContractState, recipient: ContractAddress, amount: u256) {
            self.ownable.assert_only_owner();
            self.rewards.write(recipient, amount);
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn pull(ref self: ContractState, asset: ContractAddress, amount: u256) {
            let token = IERC20Dispatcher { contract_address: asset };
            if token.balance_of(starknet::get_contract_address()) < amount {
                assert(token.transfer_from(get_caller_address(), starknet::get_contract_address(), amount), 'PULL_FAILED');
            }
        }

        fn release(ref self: ContractState, asset: ContractAddress, amount: u256, recipient: ContractAddress) {
            let token = IERC20Dispatcher { contract_address: asset };
            assert(token.transfer(recipient, amount), 'RELEASE_FAILED');
        }

        fn claim(ref self: ContractState, recipient: ContractAddress) -> u256 {
            let amount = self.rewards.read(recipient);
            self.rewards.write(recipient, 0);
            amount
        }
    }
}
