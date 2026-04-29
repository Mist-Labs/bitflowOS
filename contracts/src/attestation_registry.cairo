#[starknet::contract]
pub mod AttestationRegistry {
    use openzeppelin_access::ownable::OwnableComponent;
    use core::num::traits::Zero;
    use starknet::{ContractAddress, get_block_timestamp, get_caller_address};
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };

    #[derive(Copy, Drop, Serde, starknet::Store)]
    pub struct Attestation {
        pub input_hash: felt252,
        pub output_hash: felt252,
        pub quote_hash: felt252,
        pub expiry: u64,
        pub exists: bool,
        pub used: bool,
    }

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableMixinImpl = OwnableComponent::OwnableMixinImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    #[storage]
    pub struct Storage {
        #[substorage(v0)]
        pub ownable: OwnableComponent::Storage,
        submitter: ContractAddress,
        consumer: ContractAddress,
        attestations: Map<felt252, Attestation>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        #[flat]
        OwnableEvent: OwnableComponent::Event,
        AttestationSubmitted: AttestationSubmitted,
        AttestationUsed: AttestationUsed,
        ConsumerUpdated: ConsumerUpdated,
        SubmitterUpdated: SubmitterUpdated,
    }

    #[derive(Drop, starknet::Event)]
    pub struct AttestationSubmitted {
        #[key]
        pub attestation_hash: felt252,
        pub expiry: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct AttestationUsed {
        #[key]
        pub attestation_hash: felt252,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ConsumerUpdated {
        pub consumer: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct SubmitterUpdated {
        pub submitter: ContractAddress,
    }

    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress, submitter: ContractAddress) {
        assert(owner.is_non_zero(), 'ZERO_OWNER');
        assert(submitter.is_non_zero(), 'ZERO_SUBMITTER');
        self.ownable.initializer(owner);
        self.submitter.write(submitter);
    }

    #[abi(embed_v0)]
    impl AttestationRegistryImpl of super::super::interfaces::IAttestationRegistry<ContractState> {
        fn submit_attestation(
            ref self: ContractState,
            attestation_hash: felt252,
            input_hash: felt252,
            output_hash: felt252,
            quote_hash: felt252,
            expiry: u64,
        ) {
            self.assert_submitter();
            assert(attestation_hash != 0, 'ZERO_ATTESTATION');
            assert(input_hash != 0, 'ZERO_INPUT');
            assert(output_hash != 0, 'ZERO_OUTPUT');
            assert(quote_hash != 0, 'ZERO_QUOTE');
            assert(expiry > get_block_timestamp(), 'EXPIRED');

            let existing = self.attestations.read(attestation_hash);
            assert(!existing.exists, 'ATTESTATION_EXISTS');

            self.attestations.write(
                attestation_hash,
                Attestation {
                    input_hash,
                    output_hash,
                    quote_hash,
                    expiry,
                    exists: true,
                    used: false,
                },
            );
            self.emit(AttestationSubmitted { attestation_hash, expiry });
        }

        fn is_valid_attestation(self: @ContractState, attestation_hash: felt252) -> bool {
            let attestation = self.attestations.read(attestation_hash);
            attestation.exists && !attestation.used && attestation.expiry >= get_block_timestamp()
        }

        fn mark_used(ref self: ContractState, attestation_hash: felt252) {
            self.assert_consumer();
            let mut attestation = self.attestations.read(attestation_hash);
            assert(attestation.exists, 'UNKNOWN_ATTESTATION');
            assert(!attestation.used, 'ATTESTATION_USED');
            assert(attestation.expiry >= get_block_timestamp(), 'EXPIRED');
            attestation.used = true;
            self.attestations.write(attestation_hash, attestation);
            self.emit(AttestationUsed { attestation_hash });
        }

        fn set_consumer(ref self: ContractState, consumer: ContractAddress) {
            self.ownable.assert_only_owner();
            assert(consumer.is_non_zero(), 'ZERO_CONSUMER');
            self.consumer.write(consumer);
            self.emit(ConsumerUpdated { consumer });
        }

        fn set_submitter(ref self: ContractState, submitter: ContractAddress) {
            self.ownable.assert_only_owner();
            assert(submitter.is_non_zero(), 'ZERO_SUBMITTER');
            self.submitter.write(submitter);
            self.emit(SubmitterUpdated { submitter });
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn assert_submitter(self: @ContractState) {
            let caller = get_caller_address();
            assert(caller == self.submitter.read() || caller == self.ownable.owner(), 'NOT_SUBMITTER');
        }

        fn assert_consumer(self: @ContractState) {
            let caller = get_caller_address();
            assert(caller == self.consumer.read() || caller == self.ownable.owner(), 'NOT_CONSUMER');
        }
    }
}
