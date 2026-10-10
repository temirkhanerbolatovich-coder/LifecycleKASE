use crate::redemption::{
    verify_progress, verify_source_commitment, RedemptionProgress, RedemptionSources,
};
use crate::{
    financial, CorporateAction, CorporateActionStatus, CorporateActionType, ErrorCode, Instrument,
    InstrumentStatus,
};
use anchor_lang::prelude::*;

pub const MAX_CALCULATION_INVESTORS: usize = 64;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct EntitlementTerms {
    pub investor_id: [u8; 16],
    pub snapshot_hash: [u8; 32],
    pub settlement_wallet: Pubkey,
    pub balance_at_snapshot: u64,
    pub eligible: bool,
    pub payment_amount_minor: u64,
    pub tokens_to_redeem: u64,
}

#[account]
#[derive(InitSpace)]
pub struct Entitlement {
    pub version: u8,
    pub action: Pubkey,
    pub investor_id: [u8; 16],
    pub snapshot_hash: [u8; 32],
    pub settlement_wallet: Pubkey,
    pub balance_at_snapshot: u64,
    pub payment_amount_minor: u64,
    pub tokens_to_redeem: u64,
    pub status: EntitlementStatus,
    pub executed_at: Option<i64>,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub enum EntitlementStatus {
    Ready,
    NotEligible,
    NotEligibleZeroRounding,
    Paid,
    Redeemed,
}

#[derive(Accounts)]
#[instruction(terms: EntitlementTerms)]
pub struct RegisterEntitlement<'info> {
    #[account(mut)]
    pub corporate_action_authority: Signer<'info>,
    #[account(
        constraint = instrument.corporate_action_authority == corporate_action_authority.key()
            @ ErrorCode::UnauthorizedCorporateActionAuthority,
        constraint = instrument.status == InstrumentStatus::Active @ ErrorCode::InvalidInstrumentStatus
    )]
    pub instrument: Account<'info, Instrument>,
    #[account(mut, has_one = instrument @ ErrorCode::InvalidActionInstrument,
        seeds = [b"action", instrument.key().as_ref(), corporate_action.action_id.as_ref()],
        bump = corporate_action.bump)]
    pub corporate_action: Account<'info, CorporateAction>,
    #[account(init, payer = corporate_action_authority, space = 8 + Entitlement::INIT_SPACE,
        seeds = [b"entitlement", corporate_action.key().as_ref(), terms.investor_id.as_ref()], bump)]
    pub entitlement: Account<'info, Entitlement>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FinalizeCalculation<'info> {
    pub corporate_action_authority: Signer<'info>,
    #[account(
        constraint = instrument.corporate_action_authority == corporate_action_authority.key()
            @ ErrorCode::UnauthorizedCorporateActionAuthority,
        constraint = instrument.status == InstrumentStatus::Active @ ErrorCode::InvalidInstrumentStatus
    )]
    pub instrument: Account<'info, Instrument>,
    #[account(mut, has_one = instrument @ ErrorCode::InvalidActionInstrument,
        seeds = [b"action", instrument.key().as_ref(), corporate_action.action_id.as_ref()],
        bump = corporate_action.bump)]
    pub corporate_action: Account<'info, CorporateAction>,
}

#[derive(Accounts)]
pub struct ResetCalculation<'info> {
    #[account(mut)]
    pub corporate_action_authority: Signer<'info>,
    #[account(
        constraint = instrument.corporate_action_authority == corporate_action_authority.key()
            @ ErrorCode::UnauthorizedCorporateActionAuthority,
        constraint = instrument.status == InstrumentStatus::Active @ ErrorCode::InvalidInstrumentStatus
    )]
    pub instrument: Account<'info, Instrument>,
    #[account(mut, has_one = instrument @ ErrorCode::InvalidActionInstrument,
        seeds = [b"action", instrument.key().as_ref(), corporate_action.action_id.as_ref()],
        bump = corporate_action.bump)]
    pub corporate_action: Account<'info, CorporateAction>,
}

impl EntitlementTerms {
    fn checked_status(
        &self,
        instrument: &Instrument,
        action: &CorporateAction,
    ) -> Result<EntitlementStatus> {
        require!(
            self.investor_id != [0; 16]
                && self.balance_at_snapshot > 0
                && self.balance_at_snapshot <= action.total_balance,
            ErrorCode::InvalidEntitlement
        );
        require!(
            self.snapshot_hash != [0; 32] && self.snapshot_hash == action.snapshot_hash,
            ErrorCode::InvalidSnapshotHash
        );
        if !self.eligible {
            require!(
                self.payment_amount_minor == 0 && self.tokens_to_redeem == 0,
                ErrorCode::InvalidEntitlement
            );
            return Ok(EntitlementStatus::NotEligible);
        }
        require_keys_neq!(
            self.settlement_wallet,
            Pubkey::default(),
            ErrorCode::InvalidEntitlement
        );
        let expected = match action.action_type {
            CorporateActionType::CouponPayment => financial::coupon(
                self.balance_at_snapshot,
                instrument.face_value_minor,
                instrument.coupon_rate_bps,
                instrument.payments_per_year,
            ),
            CorporateActionType::BondRedemption => financial::maturity(
                self.balance_at_snapshot,
                instrument.face_value_minor,
                instrument.coupon_rate_bps,
                instrument.payments_per_year,
            ),
            CorporateActionType::EarlyRedemption => financial::early_redemption(
                self.balance_at_snapshot,
                action
                    .redemption_percentage_bps
                    .ok_or(ErrorCode::InvalidRedemptionParameters)?,
                action
                    .redemption_price_minor
                    .ok_or(ErrorCode::InvalidRedemptionParameters)?,
            ),
        }
        .map_err(|_| error!(ErrorCode::CalculationOverflow))?;
        require!(
            self.payment_amount_minor == expected.amount_minor
                && self.tokens_to_redeem == expected.tokens_to_redeem,
            ErrorCode::InvalidEntitlement
        );
        if action.action_type == CorporateActionType::EarlyRedemption
            && expected.tokens_to_redeem == 0
        {
            return Ok(EntitlementStatus::NotEligibleZeroRounding);
        }
        Ok(EntitlementStatus::Ready)
    }
}

pub fn register(ctx: Context<RegisterEntitlement>, terms: EntitlementTerms) -> Result<()> {
    let action = &mut ctx.accounts.corporate_action;
    require!(
        matches!(
            action.status,
            CorporateActionStatus::SnapshotCreated | CorporateActionStatus::Calculated
        ),
        ErrorCode::InvalidActionStatus
    );
    require!(
        action.investor_count > 0
            && action.investor_count as usize <= MAX_CALCULATION_INVESTORS
            && action.registered_entitlements < action.investor_count,
        ErrorCode::IncompleteCalculation
    );
    let status = terms.checked_status(&ctx.accounts.instrument, action)?;
    let total = action
        .total_amount_minor
        .checked_add(terms.payment_amount_minor)
        .ok_or(ErrorCode::CalculationOverflow)?;
    let count = action
        .registered_entitlements
        .checked_add(1)
        .ok_or(ErrorCode::CalculationOverflow)?;
    ctx.accounts.entitlement.set_inner(Entitlement {
        version: 1,
        action: action.key(),
        investor_id: terms.investor_id,
        snapshot_hash: terms.snapshot_hash,
        settlement_wallet: terms.settlement_wallet,
        balance_at_snapshot: terms.balance_at_snapshot,
        payment_amount_minor: terms.payment_amount_minor,
        tokens_to_redeem: terms.tokens_to_redeem,
        status,
        executed_at: None,
        bump: ctx.bumps.entitlement,
    });
    action.total_amount_minor = total;
    action.registered_entitlements = count;
    action.status = CorporateActionStatus::Calculated;
    Ok(())
}

pub fn finalize(ctx: Context<FinalizeCalculation>) -> Result<()> {
    let action = &mut ctx.accounts.corporate_action;
    let accounts = ctx.remaining_accounts;
    let redemption = action.action_type != CorporateActionType::CouponPayment;
    let stride = if redemption { 2 } else { 1 };
    let offset = usize::from(redemption);
    require!(
        action.status == CorporateActionStatus::Calculated,
        ErrorCode::InvalidActionStatus
    );
    require!(
        !accounts.is_empty()
            && action.investor_count as usize <= MAX_CALCULATION_INVESTORS
            && accounts.len() == offset + stride * action.investor_count as usize
            && action.registered_entitlements == action.investor_count,
        ErrorCode::IncompleteCalculation
    );
    if redemption {
        validate_calculation_progress(&accounts[0], action, action.key())?;
    }
    let mut balance = 0u64;
    let mut amount = 0u64;
    let mut source_accounts = Vec::new();
    for index in 0..action.investor_count as usize {
        let position = offset + index * stride;
        let account = &accounts[position];
        require_keys_eq!(*account.owner, crate::id(), ErrorCode::InvalidEntitlement);
        require!(
            accounts[..position]
                .iter()
                .all(|previous| previous.key() != account.key()),
            ErrorCode::InvalidEntitlement
        );
        let data = account.try_borrow_data()?;
        let entitlement = Entitlement::try_deserialize(&mut &data[..])?;
        if redemption {
            let sources = validate_calculation_sources(
                &accounts[position + 1],
                account.key(),
                &entitlement,
                action,
            )?;
            for source in sources.sources {
                require!(
                    !source_accounts.contains(&source.token_account),
                    ErrorCode::InvalidRedemptionSources
                );
                source_accounts.push(source.token_account);
            }
        }
        let (expected, bump) = Pubkey::find_program_address(
            &[
                b"entitlement",
                action.key().as_ref(),
                entitlement.investor_id.as_ref(),
            ],
            &crate::id(),
        );
        require_keys_eq!(expected, account.key(), ErrorCode::InvalidEntitlement);
        require!(
            entitlement.version == 1
                && entitlement.bump == bump
                && entitlement.action == action.key()
                && entitlement.snapshot_hash == action.snapshot_hash
                && entitlement.executed_at.is_none(),
            ErrorCode::InvalidEntitlement
        );
        require!(
            matches!(
                entitlement.status,
                EntitlementStatus::Ready
                    | EntitlementStatus::NotEligible
                    | EntitlementStatus::NotEligibleZeroRounding
            ),
            ErrorCode::InvalidEntitlement
        );
        balance = balance
            .checked_add(entitlement.balance_at_snapshot)
            .ok_or(ErrorCode::CalculationOverflow)?;
        amount = amount
            .checked_add(entitlement.payment_amount_minor)
            .ok_or(ErrorCode::CalculationOverflow)?;
    }
    require!(
        balance == action.total_balance && amount == action.total_amount_minor,
        ErrorCode::IncompleteCalculation
    );
    action.status = CorporateActionStatus::UnderReview;
    Ok(())
}

pub fn reset<'info>(ctx: Context<'info, ResetCalculation<'info>>) -> Result<()> {
    let action = &mut ctx.accounts.corporate_action;
    let accounts = ctx.remaining_accounts;
    let redemption = action.action_type != CorporateActionType::CouponPayment;
    let stride = if redemption { 2 } else { 1 };
    let offset = usize::from(redemption);
    require!(
        action.status == CorporateActionStatus::Calculated,
        ErrorCode::InvalidActionStatus
    );
    require!(
        action.registered_entitlements > 0
            && accounts.len() == offset + stride * action.registered_entitlements as usize
            && action.registered_entitlements as usize <= MAX_CALCULATION_INVESTORS,
        ErrorCode::IncompleteCalculation
    );
    if redemption {
        require!(accounts[0].is_writable, ErrorCode::InvalidRedemptionSources);
        validate_calculation_progress(&accounts[0], action, action.key())?;
    }
    let mut amount = 0u64;
    for index in 0..action.registered_entitlements as usize {
        let position = offset + index * stride;
        let account = &accounts[position];
        require!(account.is_writable, ErrorCode::InvalidEntitlement);
        require!(
            accounts[..position]
                .iter()
                .all(|previous| previous.key() != account.key()),
            ErrorCode::InvalidEntitlement
        );
        let entitlement = Account::<Entitlement>::try_from(account)?;
        if redemption {
            require!(
                accounts[position + 1].is_writable,
                ErrorCode::InvalidRedemptionSources
            );
            validate_calculation_sources(
                &accounts[position + 1],
                account.key(),
                &entitlement,
                action,
            )?;
        }
        let (expected, bump) = Pubkey::find_program_address(
            &[
                b"entitlement",
                action.key().as_ref(),
                entitlement.investor_id.as_ref(),
            ],
            &crate::id(),
        );
        require_keys_eq!(expected, account.key(), ErrorCode::InvalidEntitlement);
        require!(
            entitlement.version == 1
                && entitlement.bump == bump
                && entitlement.action == action.key()
                && entitlement.snapshot_hash == action.snapshot_hash
                && entitlement.executed_at.is_none()
                && matches!(
                    entitlement.status,
                    EntitlementStatus::Ready
                        | EntitlementStatus::NotEligible
                        | EntitlementStatus::NotEligibleZeroRounding
                ),
            ErrorCode::InvalidEntitlement
        );
        amount = amount
            .checked_add(entitlement.payment_amount_minor)
            .ok_or(ErrorCode::CalculationOverflow)?;
    }
    require!(
        amount == action.total_amount_minor,
        ErrorCode::IncompleteCalculation
    );
    for index in 0..action.registered_entitlements as usize {
        let position = offset + index * stride;
        let account = &accounts[position];
        Account::<Entitlement>::try_from(account)?
            .close(ctx.accounts.corporate_action_authority.to_account_info())?;
        if redemption {
            Account::<RedemptionSources>::try_from(&accounts[position + 1])?
                .close(ctx.accounts.corporate_action_authority.to_account_info())?;
        }
    }
    if redemption {
        Account::<RedemptionProgress>::try_from(&accounts[0])?
            .close(ctx.accounts.corporate_action_authority.to_account_info())?;
    }
    action.total_amount_minor = 0;
    action.registered_entitlements = 0;
    action.processed_entitlements = 0;
    action.status = CorporateActionStatus::SnapshotCreated;
    Ok(())
}

fn validate_calculation_progress(
    account: &AccountInfo,
    action: &CorporateAction,
    action_key: Pubkey,
) -> Result<()> {
    require_keys_eq!(
        *account.owner,
        crate::id(),
        ErrorCode::InvalidRedemptionSources
    );
    let data = account.try_borrow_data()?;
    let progress = RedemptionProgress::try_deserialize(&mut &data[..])?;
    let (expected, bump) = Pubkey::find_program_address(
        &[b"redemption-progress", progress.action.as_ref()],
        &crate::id(),
    );
    require!(
        expected == account.key() && bump == progress.bump && progress.tokens_redeemed == 0,
        ErrorCode::InvalidRedemptionSources
    );
    verify_progress(&progress, action, action_key)
}

fn validate_calculation_sources(
    account: &AccountInfo,
    entitlement_key: Pubkey,
    entitlement: &Entitlement,
    action: &CorporateAction,
) -> Result<RedemptionSources> {
    require_keys_eq!(
        *account.owner,
        crate::id(),
        ErrorCode::InvalidRedemptionSources
    );
    let data = account.try_borrow_data()?;
    let sources = RedemptionSources::try_deserialize(&mut &data[..])?;
    let (expected, bump) = Pubkey::find_program_address(
        &[b"redemption-sources", entitlement_key.as_ref()],
        &crate::id(),
    );
    require!(
        expected == account.key() && bump == sources.bump,
        ErrorCode::InvalidRedemptionSources
    );
    verify_source_commitment(
        &sources,
        entitlement.action,
        entitlement_key,
        action.snapshot_hash,
        entitlement.balance_at_snapshot,
    )?;
    Ok(sources)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (Instrument, CorporateAction, EntitlementTerms) {
        let instrument = Instrument {
            version: 1,
            instrument_id: [1; 16],
            issuer_authority: Pubkey::new_unique(),
            compliance_authority: Pubkey::new_unique(),
            corporate_action_authority: Pubkey::new_unique(),
            bond_mint: Pubkey::new_unique(),
            settlement_mint: Pubkey::new_unique(),
            face_value_minor: 1_000_000_000,
            coupon_rate_bps: 1000,
            payments_per_year: 2,
            issue_at: 100,
            maturity_at: 200,
            total_supply: 35,
            status: InstrumentStatus::Active,
            bump: 1,
            authority_bump: 1,
        };
        let action = CorporateAction {
            version: 1,
            action_id: [2; 16],
            instrument: Pubkey::new_unique(),
            action_type: CorporateActionType::CouponPayment,
            record_at: 120,
            execute_at: 150,
            redemption_percentage_bps: None,
            redemption_price_minor: None,
            snapshot_hash: [3; 32],
            snapshot_slot: 10,
            investor_count: 3,
            wallet_count: 3,
            total_balance: 35,
            total_amount_minor: 0,
            registered_entitlements: 0,
            processed_entitlements: 0,
            status: CorporateActionStatus::SnapshotCreated,
            created_at: 110,
            completed_at: None,
            bump: 1,
        };
        let terms = EntitlementTerms {
            investor_id: [4; 16],
            snapshot_hash: [3; 32],
            settlement_wallet: Pubkey::new_unique(),
            balance_at_snapshot: 10,
            eligible: true,
            payment_amount_minor: 500_000_000,
            tokens_to_redeem: 0,
        };
        (instrument, action, terms)
    }

    #[test]
    fn validates_coupon_maturity_and_partial_redemption_with_integer_formulas() {
        let (instrument, mut action, mut terms) = fixture();
        assert_eq!(
            terms.checked_status(&instrument, &action).unwrap(),
            EntitlementStatus::Ready
        );
        terms.payment_amount_minor += 1;
        assert!(terms.checked_status(&instrument, &action).is_err());
        action.action_type = CorporateActionType::BondRedemption;
        terms.payment_amount_minor = 10_500_000_000;
        terms.tokens_to_redeem = 10;
        assert_eq!(
            terms.checked_status(&instrument, &action).unwrap(),
            EntitlementStatus::Ready
        );
        action.action_type = CorporateActionType::EarlyRedemption;
        action.redemption_percentage_bps = Some(2000);
        action.redemption_price_minor = Some(1_000_000_000);
        terms.payment_amount_minor = 2_000_000_000;
        terms.tokens_to_redeem = 2;
        assert_eq!(
            terms.checked_status(&instrument, &action).unwrap(),
            EntitlementStatus::Ready
        );
        terms.tokens_to_redeem = 3;
        assert!(terms.checked_status(&instrument, &action).is_err());
    }

    #[test]
    fn preserves_skipped_investors_and_zero_rounding_without_ready_payments() {
        let (instrument, mut action, mut terms) = fixture();
        terms.eligible = false;
        terms.settlement_wallet = Pubkey::default();
        terms.payment_amount_minor = 0;
        assert_eq!(
            terms.checked_status(&instrument, &action).unwrap(),
            EntitlementStatus::NotEligible
        );
        terms.payment_amount_minor = 1;
        assert!(terms.checked_status(&instrument, &action).is_err());
        terms.eligible = true;
        terms.settlement_wallet = Pubkey::new_unique();
        action.action_type = CorporateActionType::EarlyRedemption;
        action.redemption_percentage_bps = Some(1000);
        action.redemption_price_minor = Some(1_000_000_000);
        terms.balance_at_snapshot = 5;
        terms.payment_amount_minor = 0;
        assert_eq!(
            terms.checked_status(&instrument, &action).unwrap(),
            EntitlementStatus::NotEligibleZeroRounding
        );
    }

    #[test]
    fn rejects_wrong_snapshot_identity_receiver_balance_and_overflow() {
        let (mut instrument, action, terms) = fixture();
        let mut bad = terms;
        bad.snapshot_hash = [5; 32];
        assert!(bad.checked_status(&instrument, &action).is_err());
        bad = terms;
        bad.investor_id = [0; 16];
        assert!(bad.checked_status(&instrument, &action).is_err());
        bad = terms;
        bad.settlement_wallet = Pubkey::default();
        assert!(bad.checked_status(&instrument, &action).is_err());
        bad = terms;
        bad.balance_at_snapshot = 36;
        assert!(bad.checked_status(&instrument, &action).is_err());
        instrument.face_value_minor = u64::MAX;
        instrument.coupon_rate_bps = 100_000;
        assert!(terms.checked_status(&instrument, &action).is_err());
    }
}
