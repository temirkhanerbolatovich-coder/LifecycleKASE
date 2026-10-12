//! Exact-target partial redemption keeps deployed account layouts unchanged.
use crate::{
    CorporateAction, CorporateActionStatus, CorporateActionTerms, CorporateActionType, Entitlement,
    EntitlementTerms, ErrorCode, Instrument, InstrumentStatus, MAX_CALCULATION_INVESTORS,
};
use anchor_lang::prelude::*;

/// Immutable scheduled target; the existing action account remains byte compatible.
#[account]
#[derive(InitSpace)]
pub struct ExactRedemptionTarget {
    pub version: u8,
    pub action: Pubkey,
    pub target_tokens: u64,
    pub bump: u8,
}

#[derive(Accounts)]
#[instruction(terms: CorporateActionTerms)]
pub struct CreateExactRedemptionAction<'info> {
    #[account(mut)]
    pub issuer_authority: Signer<'info>,
    #[account(constraint = instrument.issuer_authority == issuer_authority.key() @ ErrorCode::UnauthorizedIssuer)]
    pub instrument: Account<'info, Instrument>,
    #[account(init, payer = issuer_authority, space = 8 + CorporateAction::INIT_SPACE,
        seeds = [b"action", instrument.key().as_ref(), terms.action_id.as_ref()], bump)]
    pub corporate_action: Account<'info, CorporateAction>,
    #[account(init, payer = issuer_authority, space = 8 + ExactRedemptionTarget::INIT_SPACE,
        seeds = [b"redemption_target", corporate_action.key().as_ref()], bump)]
    pub exact_redemption_target: Account<'info, ExactRedemptionTarget>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(terms: EntitlementTerms)]
pub struct RegisterEntitlementV2<'info> {
    #[account(mut)]
    pub corporate_action_authority: Signer<'info>,
    #[account(constraint = instrument.corporate_action_authority == corporate_action_authority.key()
        @ ErrorCode::UnauthorizedCorporateActionAuthority,
        constraint = instrument.status == InstrumentStatus::Active @ ErrorCode::InvalidInstrumentStatus)]
    pub instrument: Account<'info, Instrument>,
    #[account(mut, has_one = instrument @ ErrorCode::InvalidActionInstrument,
        seeds = [b"action", instrument.key().as_ref(), corporate_action.action_id.as_ref()], bump = corporate_action.bump)]
    pub corporate_action: Account<'info, CorporateAction>,
    #[account(seeds = [b"redemption_target", corporate_action.key().as_ref()], bump = exact_redemption_target.bump,
        constraint = exact_redemption_target.action == corporate_action.key() @ ErrorCode::InvalidRedemptionParameters)]
    pub exact_redemption_target: Account<'info, ExactRedemptionTarget>,
    #[account(init, payer = corporate_action_authority, space = 8 + Entitlement::INIT_SPACE,
        seeds = [b"entitlement", corporate_action.key().as_ref(), terms.investor_id.as_ref()], bump)]
    pub entitlement: Account<'info, Entitlement>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FinalizeCalculationV2<'info> {
    pub corporate_action_authority: Signer<'info>,
    #[account(constraint = instrument.corporate_action_authority == corporate_action_authority.key()
        @ ErrorCode::UnauthorizedCorporateActionAuthority,
        constraint = instrument.status == InstrumentStatus::Active @ ErrorCode::InvalidInstrumentStatus)]
    pub instrument: Account<'info, Instrument>,
    #[account(mut, has_one = instrument @ ErrorCode::InvalidActionInstrument,
        seeds = [b"action", instrument.key().as_ref(), corporate_action.action_id.as_ref()], bump = corporate_action.bump)]
    pub corporate_action: Account<'info, CorporateAction>,
    #[account(seeds = [b"redemption_target", corporate_action.key().as_ref()], bump = exact_redemption_target.bump,
        constraint = exact_redemption_target.action == corporate_action.key() @ ErrorCode::InvalidRedemptionParameters)]
    pub exact_redemption_target: Account<'info, ExactRedemptionTarget>,
}

pub fn require_target(
    target: &ExactRedemptionTarget,
    action: &CorporateAction,
    action_key: Pubkey,
) -> Result<()> {
    require!(
        target.version == 2
            && target.action == action_key
            && target.target_tokens > 0
            && target.target_tokens <= action.total_balance
            && action.version == 2
            && action.action_type == CorporateActionType::EarlyRedemption,
        ErrorCode::InvalidRedemptionParameters
    );
    Ok(())
}

pub fn create(
    ctx: Context<CreateExactRedemptionAction>,
    terms: CorporateActionTerms,
    target_tokens: u64,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let instrument = &ctx.accounts.instrument;
    // Exact quantities and legacy percentages have distinct immutable scheduling contracts.
    require!(
        terms.action_type == CorporateActionType::EarlyRedemption
            && terms.redemption_percentage_bps.is_none()
            && matches!(terms.redemption_price_minor, Some(1..))
            && target_tokens > 0
            && target_tokens <= instrument.total_supply,
        ErrorCode::InvalidRedemptionParameters
    );
    terms.validate_schedule(instrument, now)?;
    require!(
        terms.execute_at < instrument.maturity_at,
        ErrorCode::InvalidActionDates
    );
    target_tokens
        .checked_mul(terms.redemption_price_minor.unwrap())
        .ok_or(ErrorCode::CalculationOverflow)?;
    ctx.accounts.corporate_action.set_inner(CorporateAction {
        version: 2,
        action_id: terms.action_id,
        instrument: instrument.key(),
        action_type: terms.action_type,
        record_at: terms.record_at,
        execute_at: terms.execute_at,
        redemption_percentage_bps: terms.redemption_percentage_bps,
        redemption_price_minor: terms.redemption_price_minor,
        snapshot_hash: [0; 32],
        snapshot_slot: 0,
        investor_count: 0,
        wallet_count: 0,
        total_balance: 0,
        total_amount_minor: 0,
        registered_entitlements: 0,
        processed_entitlements: 0,
        status: CorporateActionStatus::Scheduled,
        created_at: now,
        completed_at: None,
        bump: ctx.bumps.corporate_action,
    });
    ctx.accounts
        .exact_redemption_target
        .set_inner(ExactRedemptionTarget {
            version: 2,
            action: ctx.accounts.corporate_action.key(),
            target_tokens,
            bump: ctx.bumps.exact_redemption_target,
        });
    Ok(())
}

#[derive(Debug)]
pub struct AllocationPosition {
    pub investor_id: [u8; 16],
    pub tie_address: String,
    pub balance: u64,
    pub tokens: u64,
}

/// Check the complete immutable investor plan, independent of account order.
pub fn validate_allocation(
    positions: &[AllocationPosition],
    target: u64,
    total_balance: u64,
) -> Result<()> {
    require!(
        !positions.is_empty()
            && positions.len() <= MAX_CALCULATION_INVESTORS
            && target > 0
            && target <= total_balance,
        ErrorCode::InvalidRedemptionParameters
    );
    let mut total = 0u64;
    let mut floor_sum = 0u64;
    let mut expected = Vec::with_capacity(positions.len());
    let mut remainders = Vec::with_capacity(positions.len());
    for (index, position) in positions.iter().enumerate() {
        require!(
            position.investor_id != [0; 16]
                && !position.tie_address.is_empty()
                && position.balance > 0,
            ErrorCode::InvalidEntitlement
        );
        require!(
            positions[..index]
                .iter()
                .all(|previous| previous.investor_id != position.investor_id
                    && previous.tie_address != position.tie_address),
            ErrorCode::InvalidEntitlement
        );
        total = total
            .checked_add(position.balance)
            .ok_or(ErrorCode::CalculationOverflow)?;
        let numerator = u128::from(position.balance) * u128::from(target);
        let floor = u64::try_from(numerator / u128::from(total_balance))
            .map_err(|_| error!(ErrorCode::CalculationOverflow))?;
        floor_sum = floor_sum
            .checked_add(floor)
            .ok_or(ErrorCode::CalculationOverflow)?;
        expected.push(floor);
        remainders.push((index, numerator % u128::from(total_balance)));
    }
    require_eq!(total, total_balance, ErrorCode::IncompleteCalculation);
    let remaining = target
        .checked_sub(floor_sum)
        .ok_or(ErrorCode::InvalidEntitlement)?;
    require!(
        remaining < positions.len() as u64,
        ErrorCode::InvalidEntitlement
    );
    remainders.sort_by(|(left, left_remainder), (right, right_remainder)| {
        right_remainder.cmp(left_remainder).then_with(|| {
            positions[*left]
                .tie_address
                .cmp(&positions[*right].tie_address)
        })
    });
    for (index, _) in remainders.iter().take(remaining as usize) {
        expected[*index] += 1;
    }
    for (position, expected_tokens) in positions.iter().zip(expected) {
        require!(
            position.tokens == expected_tokens && position.tokens <= position.balance,
            ErrorCode::InvalidEntitlement
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn typescript_shared_vectors_match_program_finalization() {
        let fixture = include_str!("../../../test/fixtures/early-redemption-allocation-parity.tsv");
        let mut cases =
            std::collections::BTreeMap::<String, (u64, u64, Vec<AllocationPosition>)>::new();
        for line in fixture.lines().skip(1) {
            let fields: Vec<&str> = line.split('\t').collect();
            assert_eq!(fields.len(), 9);
            let hex = fields[1].replace('-', "");
            let mut investor_id = [0u8; 16];
            for (index, byte) in investor_id.iter_mut().enumerate() {
                *byte = u8::from_str_radix(&hex[index * 2..index * 2 + 2], 16).unwrap();
            }
            let balance: u64 = fields[3].parse().unwrap();
            let target: u64 = fields[4].parse().unwrap();
            let tokens: u64 = fields[5].parse().unwrap();
            let remaining: u64 = fields[6].parse().unwrap();
            let remainder: u128 = fields[7].parse().unwrap();
            let denominator: u64 = fields[8].parse().unwrap();
            assert_eq!(tokens + remaining, balance);
            assert_eq!(
                u128::from(balance) * u128::from(target) % u128::from(denominator),
                remainder
            );
            let case =
                cases
                    .entry(fields[0].to_owned())
                    .or_insert((target, denominator, Vec::new()));
            assert_eq!((target, denominator), (case.0, case.1));
            // Snapshot-v2 contains positive positions only; domain previews also allow zeros.
            if balance > 0 {
                case.2.push(AllocationPosition {
                    investor_id,
                    tie_address: fields[2].to_owned(),
                    balance,
                    tokens,
                });
            }
        }
        for (name, (target, total, mut positions)) in cases {
            if target == 0 {
                assert!(positions.iter().all(|row| row.tokens == 0));
                assert!(validate_allocation(&positions, target, total).is_err());
                continue;
            }
            assert!(
                validate_allocation(&positions, target, total).is_ok(),
                "{name}"
            );
            positions.reverse();
            assert!(
                validate_allocation(&positions, target, total).is_ok(),
                "{name} reversed"
            );
            positions[0].tokens ^= 1;
            assert!(
                validate_allocation(&positions, target, total).is_err(),
                "{name} tampered"
            );
        }
    }

    fn position(id: u8, address: &str, balance: u64, tokens: u64) -> AllocationPosition {
        AllocationPosition {
            investor_id: [id; 16],
            tie_address: address.to_owned(),
            balance,
            tokens,
        }
    }

    #[test]
    fn exact_plan_distributes_every_requested_token_and_ignores_registration_order() {
        let demo = vec![
            position(1, "a", 10, 2),
            position(2, "b", 20, 4),
            position(3, "c", 5, 1),
        ];
        assert!(validate_allocation(&demo, 7, 35).is_ok());
        let mut remainder = vec![
            position(1, "a", 10, 2),
            position(2, "b", 20, 5),
            position(3, "c", 5, 1),
        ];
        assert!(validate_allocation(&remainder, 8, 35).is_ok());
        remainder.reverse();
        assert!(validate_allocation(&remainder, 8, 35).is_ok());
        remainder[1].tokens = 4;
        assert!(validate_allocation(&remainder, 8, 35).is_err());
    }

    #[test]
    fn equal_remainders_use_stable_snapshot_owner_addresses_and_keep_zero_rows() {
        let mut ties = vec![
            position(3, "c", 1, 0),
            position(1, "a", 1, 1),
            position(2, "b", 1, 1),
        ];
        assert!(validate_allocation(&ties, 2, 3).is_ok());
        ties[0].tokens = 1;
        ties[1].tokens = 0;
        assert!(validate_allocation(&ties, 2, 3).is_err());
        let all = vec![
            position(1, "a", 10, 10),
            position(2, "b", 20, 20),
            position(3, "c", 5, 5),
        ];
        assert!(validate_allocation(&all, 35, 35).is_ok());
    }

    #[test]
    fn exact_plan_rejects_incomplete_duplicate_out_of_range_and_overflow_inputs() {
        let valid = vec![position(1, "a", 1, 1)];
        assert!(validate_allocation(&valid, 0, 1).is_err());
        assert!(validate_allocation(&valid, 2, 1).is_err());
        assert!(validate_allocation(&valid, 1, 2).is_err());
        assert!(validate_allocation(&[], 1, 1).is_err());
        let duplicate_id = vec![position(1, "a", 1, 1), position(1, "b", 1, 0)];
        assert!(validate_allocation(&duplicate_id, 1, 2).is_err());
        let duplicate_address = vec![position(1, "a", 1, 1), position(2, "a", 1, 0)];
        assert!(validate_allocation(&duplicate_address, 1, 2).is_err());
        let max = vec![
            position(1, "a", u64::MAX - 1, u64::MAX - 1),
            position(2, "b", 1, 1),
        ];
        assert!(validate_allocation(&max, u64::MAX, u64::MAX).is_ok());
        let overflow = vec![position(1, "a", u64::MAX, 1), position(2, "b", 1, 0)];
        assert!(validate_allocation(&overflow, 1, u64::MAX).is_err());
    }

    #[test]
    fn target_sidecar_has_fixed_abi_size_and_domain_boundaries() {
        assert_eq!(8 + ExactRedemptionTarget::INIT_SPACE, 50);
        let key = Pubkey::new_unique();
        let mut action = CorporateAction {
            version: 2,
            action_id: [1; 16],
            instrument: Pubkey::new_unique(),
            action_type: CorporateActionType::EarlyRedemption,
            record_at: 100,
            execute_at: 150,
            redemption_percentage_bps: None,
            redemption_price_minor: Some(1),
            snapshot_hash: [2; 32],
            snapshot_slot: 1,
            investor_count: 1,
            wallet_count: 1,
            total_balance: 3,
            total_amount_minor: 0,
            registered_entitlements: 0,
            processed_entitlements: 0,
            status: CorporateActionStatus::SnapshotCreated,
            created_at: 50,
            completed_at: None,
            bump: 1,
        };
        let mut target = ExactRedemptionTarget {
            version: 2,
            action: key,
            target_tokens: 2,
            bump: 1,
        };
        assert!(require_target(&target, &action, key).is_ok());
        assert!(require_target(&target, &action, Pubkey::new_unique()).is_err());
        target.target_tokens = 4;
        assert!(require_target(&target, &action, key).is_err());
        target.target_tokens = 2;
        action.version = 1;
        assert!(require_target(&target, &action, key).is_err());
    }
}
