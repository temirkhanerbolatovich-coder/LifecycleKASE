use crate::program::LifecycleKase;
use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::{
    extension::StateWithExtensions, state::Account as TokenAccount,
};
use anchor_spl::token_interface::{Mint, Token2022};

declare_id!("6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo");

const MAX_ACTIVATION_HOLDER_ACCOUNTS: usize = 64;
const SNAPSHOT_GRACE_SECONDS: i64 = 300;

#[program]
pub mod lifecycle_kase {
    use super::*;

    pub fn initialize_instrument(
        ctx: Context<InitializeInstrument>,
        terms: InstrumentTerms,
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts
                .program
                .programdata_address()?
                .ok_or(ErrorCode::InvalidProgramData)?,
            ctx.accounts.program_data.key(),
            ErrorCode::InvalidProgramData
        );
        require!(
            ctx.accounts.program_data.upgrade_authority_address
                == Some(ctx.accounts.administrator.key()),
            ErrorCode::UnauthorizedAdministrator
        );
        terms.validate()?;

        let bond_mint = &ctx.accounts.bond_mint;
        let settlement_mint = &ctx.accounts.settlement_mint;
        require_keys_neq!(
            bond_mint.key(),
            settlement_mint.key(),
            ErrorCode::InvalidMint
        );
        require_keys_eq!(
            *bond_mint.to_account_info().owner,
            ctx.accounts.token_2022_program.key(),
            ErrorCode::InvalidTokenProgram
        );
        require_keys_eq!(
            *settlement_mint.to_account_info().owner,
            ctx.accounts.token_2022_program.key(),
            ErrorCode::InvalidTokenProgram
        );
        require_eq!(bond_mint.decimals, 0, ErrorCode::InvalidTokenDecimals);
        require_eq!(settlement_mint.decimals, 6, ErrorCode::InvalidTokenDecimals);
        require_eq!(
            bond_mint.supply,
            terms.total_supply,
            ErrorCode::InvalidMintSupply
        );
        require!(
            bond_mint.mint_authority.is_none(),
            ErrorCode::MintAuthorityNotRevoked
        );
        require!(
            bond_mint.freeze_authority.is_none(),
            ErrorCode::FreezeAuthorityPresent
        );

        ctx.accounts.instrument.set_inner(Instrument {
            version: 1,
            instrument_id: terms.instrument_id,
            issuer_authority: ctx.accounts.administrator.key(),
            compliance_authority: terms.compliance_authority,
            corporate_action_authority: terms.corporate_action_authority,
            bond_mint: bond_mint.key(),
            settlement_mint: settlement_mint.key(),
            face_value_minor: terms.face_value_minor,
            coupon_rate_bps: terms.coupon_rate_bps,
            payments_per_year: terms.payments_per_year,
            issue_at: terms.issue_at,
            maturity_at: terms.maturity_at,
            total_supply: terms.total_supply,
            status: InstrumentStatus::Deploying,
            bump: ctx.bumps.instrument,
            authority_bump: ctx.bumps.instrument_authority,
        });
        Ok(())
    }

    pub fn create_corporate_action(
        ctx: Context<CreateCorporateAction>,
        terms: CorporateActionTerms,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        terms.validate(&ctx.accounts.instrument, now)?;

        ctx.accounts.corporate_action.set_inner(CorporateAction {
            version: 1,
            action_id: terms.action_id,
            instrument: ctx.accounts.instrument.key(),
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
        Ok(())
    }

    pub fn activate_instrument(ctx: Context<ActivateInstrument>) -> Result<()> {
        let instrument = &mut ctx.accounts.instrument;
        require!(
            instrument.status == InstrumentStatus::Deploying,
            ErrorCode::InvalidInstrumentStatus
        );
        let bond_mint = &ctx.accounts.bond_mint;
        require_eq!(bond_mint.decimals, 0, ErrorCode::InvalidTokenDecimals);
        require_eq!(
            bond_mint.supply,
            instrument.total_supply,
            ErrorCode::InvalidMintSupply
        );
        require!(
            bond_mint.mint_authority.is_none(),
            ErrorCode::MintAuthorityNotRevoked
        );
        require!(
            bond_mint.freeze_authority.is_none(),
            ErrorCode::FreezeAuthorityPresent
        );

        let holders = ctx.remaining_accounts;
        require!(
            !holders.is_empty() && holders.len() <= MAX_ACTIVATION_HOLDER_ACCOUNTS,
            ErrorCode::InvalidHolderCount
        );
        let mut reconciled_supply = 0u64;
        for (index, holder) in holders.iter().enumerate() {
            require_keys_eq!(
                *holder.owner,
                ctx.accounts.token_2022_program.key(),
                ErrorCode::InvalidHolderAccount
            );
            require!(
                holders[..index]
                    .iter()
                    .all(|previous| previous.key() != holder.key()),
                ErrorCode::DuplicateHolderAccount
            );
            let data = holder.try_borrow_data()?;
            let token_account = StateWithExtensions::<TokenAccount>::unpack(&data)
                .map_err(|_| error!(ErrorCode::InvalidHolderAccount))?;
            require_keys_eq!(
                token_account.base.mint,
                bond_mint.key(),
                ErrorCode::InvalidHolderAccount
            );
            require!(
                token_account.base.amount > 0,
                ErrorCode::InvalidHolderAccount
            );
            reconciled_supply = reconciled_supply
                .checked_add(token_account.base.amount)
                .ok_or(ErrorCode::InvalidMintSupply)?;
        }
        require_eq!(
            reconciled_supply,
            instrument.total_supply,
            ErrorCode::InvalidMintSupply
        );
        instrument.status = InstrumentStatus::Active;
        Ok(())
    }

    pub fn cancel_action(ctx: Context<CancelAction>) -> Result<()> {
        let action = &mut ctx.accounts.corporate_action;
        require!(
            action.status == CorporateActionStatus::Scheduled,
            ErrorCode::InvalidActionStatus
        );
        action.status = CorporateActionStatus::Cancelled;
        action.completed_at = Some(Clock::get()?.unix_timestamp);
        Ok(())
    }

    pub fn register_snapshot(
        ctx: Context<RegisterSnapshot>,
        commitment: SnapshotCommitmentTerms,
    ) -> Result<()> {
        let bond_mint = &ctx.accounts.bond_mint;
        require_keys_eq!(
            *bond_mint.to_account_info().owner,
            ctx.accounts.token_2022_program.key(),
            ErrorCode::InvalidTokenProgram
        );
        require_eq!(bond_mint.decimals, 0, ErrorCode::InvalidTokenDecimals);
        require!(
            bond_mint.mint_authority.is_none(),
            ErrorCode::MintAuthorityNotRevoked
        );
        require!(
            bond_mint.freeze_authority.is_none(),
            ErrorCode::FreezeAuthorityPresent
        );
        let clock = Clock::get()?;
        let action = &mut ctx.accounts.corporate_action;
        commitment.validate(
            action,
            &ctx.accounts.instrument,
            bond_mint.supply,
            clock.unix_timestamp,
            clock.slot,
        )?;
        action.snapshot_hash = commitment.snapshot_hash;
        action.snapshot_slot = commitment.snapshot_slot;
        action.investor_count = commitment.investor_count;
        action.wallet_count = commitment.wallet_count;
        action.total_balance = commitment.total_balance;
        action.status = CorporateActionStatus::SnapshotCreated;
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(terms: InstrumentTerms)]
pub struct InitializeInstrument<'info> {
    #[account(mut)]
    pub administrator: Signer<'info>,
    pub program: Program<'info, LifecycleKase>,
    pub program_data: Account<'info, ProgramData>,
    #[account(
        init,
        payer = administrator,
        space = 8 + Instrument::INIT_SPACE,
        seeds = [b"instrument", terms.instrument_id.as_ref()],
        bump
    )]
    pub instrument: Account<'info, Instrument>,
    /// CHECK: Only the PDA address is used; this account's data is never read.
    #[account(
        seeds = [b"instrument-authority", instrument.key().as_ref()],
        bump
    )]
    pub instrument_authority: UncheckedAccount<'info>,
    #[account(extensions::permanent_delegate::delegate = instrument_authority)]
    pub bond_mint: InterfaceAccount<'info, Mint>,
    pub settlement_mint: InterfaceAccount<'info, Mint>,
    pub token_2022_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(terms: CorporateActionTerms)]
pub struct CreateCorporateAction<'info> {
    #[account(mut)]
    pub issuer_authority: Signer<'info>,
    #[account(
        constraint = instrument.issuer_authority == issuer_authority.key()
            @ ErrorCode::UnauthorizedIssuer
    )]
    pub instrument: Account<'info, Instrument>,
    #[account(
        init,
        payer = issuer_authority,
        space = 8 + CorporateAction::INIT_SPACE,
        seeds = [b"action", instrument.key().as_ref(), terms.action_id.as_ref()],
        bump
    )]
    pub corporate_action: Account<'info, CorporateAction>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ActivateInstrument<'info> {
    pub issuer_authority: Signer<'info>,
    #[account(
        mut,
        constraint = instrument.issuer_authority == issuer_authority.key()
            @ ErrorCode::UnauthorizedIssuer,
        constraint = instrument.bond_mint == bond_mint.key()
            @ ErrorCode::InvalidMint
    )]
    pub instrument: Account<'info, Instrument>,
    /// CHECK: Only the PDA address is used to verify the permanent delegate.
    #[account(
        seeds = [b"instrument-authority", instrument.key().as_ref()],
        bump = instrument.authority_bump
    )]
    pub instrument_authority: UncheckedAccount<'info>,
    #[account(extensions::permanent_delegate::delegate = instrument_authority)]
    pub bond_mint: InterfaceAccount<'info, Mint>,
    pub token_2022_program: Program<'info, Token2022>,
}

#[derive(Accounts)]
pub struct CancelAction<'info> {
    pub issuer_authority: Signer<'info>,
    #[account(
        constraint = instrument.issuer_authority == issuer_authority.key()
            @ ErrorCode::UnauthorizedIssuer
    )]
    pub instrument: Account<'info, Instrument>,
    #[account(
        mut,
        has_one = instrument @ ErrorCode::InvalidActionInstrument,
        seeds = [b"action", instrument.key().as_ref(), corporate_action.action_id.as_ref()],
        bump = corporate_action.bump
    )]
    pub corporate_action: Account<'info, CorporateAction>,
}

#[derive(Accounts)]
pub struct RegisterSnapshot<'info> {
    pub issuer_authority: Signer<'info>,
    #[account(
        constraint = instrument.issuer_authority == issuer_authority.key()
            @ ErrorCode::UnauthorizedIssuer,
        constraint = instrument.bond_mint == bond_mint.key()
            @ ErrorCode::InvalidMint
    )]
    pub instrument: Account<'info, Instrument>,
    #[account(
        mut,
        has_one = instrument @ ErrorCode::InvalidActionInstrument,
        seeds = [b"action", instrument.key().as_ref(), corporate_action.action_id.as_ref()],
        bump = corporate_action.bump
    )]
    pub corporate_action: Account<'info, CorporateAction>,
    /// CHECK: Only the PDA address is used to verify the permanent delegate.
    #[account(
        seeds = [b"instrument-authority", instrument.key().as_ref()],
        bump = instrument.authority_bump
    )]
    pub instrument_authority: UncheckedAccount<'info>,
    #[account(extensions::permanent_delegate::delegate = instrument_authority)]
    pub bond_mint: InterfaceAccount<'info, Mint>,
    pub token_2022_program: Program<'info, Token2022>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct InstrumentTerms {
    pub instrument_id: [u8; 16],
    pub compliance_authority: Pubkey,
    pub corporate_action_authority: Pubkey,
    pub face_value_minor: u64,
    pub coupon_rate_bps: u32,
    pub payments_per_year: u8,
    pub issue_at: i64,
    pub maturity_at: i64,
    pub total_supply: u64,
}

impl InstrumentTerms {
    fn validate(&self) -> Result<()> {
        require!(
            self.instrument_id != [0; 16],
            ErrorCode::InvalidInstrumentId
        );
        require_keys_neq!(
            self.compliance_authority,
            Pubkey::default(),
            ErrorCode::InvalidAuthority
        );
        require_keys_neq!(
            self.corporate_action_authority,
            Pubkey::default(),
            ErrorCode::InvalidAuthority
        );
        require!(self.face_value_minor > 0, ErrorCode::InvalidFaceValue);
        require!(
            self.coupon_rate_bps <= 100_000,
            ErrorCode::InvalidCouponRate
        );
        require!(
            matches!(self.payments_per_year, 1 | 2 | 4),
            ErrorCode::InvalidPaymentFrequency
        );
        require!(self.issue_at < self.maturity_at, ErrorCode::InvalidDates);
        require!(self.total_supply > 0, ErrorCode::InvalidMintSupply);
        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct CorporateActionTerms {
    pub action_id: [u8; 16],
    pub action_type: CorporateActionType,
    pub record_at: i64,
    pub execute_at: i64,
    pub redemption_percentage_bps: Option<u16>,
    pub redemption_price_minor: Option<u64>,
}

impl CorporateActionTerms {
    fn validate(&self, instrument: &Instrument, now: i64) -> Result<()> {
        require!(self.action_id != [0; 16], ErrorCode::InvalidActionId);
        require!(
            matches!(
                instrument.status,
                InstrumentStatus::Deploying | InstrumentStatus::Active
            ),
            ErrorCode::InvalidInstrumentStatus
        );
        require!(
            self.record_at >= now
                && self.record_at >= instrument.issue_at
                && self.record_at <= self.execute_at,
            ErrorCode::InvalidActionDates
        );

        match self.action_type {
            CorporateActionType::CouponPayment => {
                require!(
                    self.redemption_percentage_bps.is_none()
                        && self.redemption_price_minor.is_none(),
                    ErrorCode::InvalidRedemptionParameters
                );
                require!(
                    self.execute_at <= instrument.maturity_at,
                    ErrorCode::InvalidActionDates
                );
            }
            CorporateActionType::BondRedemption => {
                require!(
                    self.redemption_percentage_bps.is_none()
                        && self.redemption_price_minor.is_none(),
                    ErrorCode::InvalidRedemptionParameters
                );
                require!(
                    self.execute_at >= instrument.maturity_at,
                    ErrorCode::InvalidActionDates
                );
            }
            CorporateActionType::EarlyRedemption => {
                require!(
                    matches!(self.redemption_percentage_bps, Some(1..=10_000))
                        && matches!(self.redemption_price_minor, Some(1..)),
                    ErrorCode::InvalidRedemptionParameters
                );
                require!(
                    self.execute_at < instrument.maturity_at,
                    ErrorCode::InvalidActionDates
                );
            }
        }
        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct SnapshotCommitmentTerms {
    pub snapshot_hash: [u8; 32],
    pub snapshot_slot: u64,
    pub investor_count: u32,
    pub wallet_count: u32,
    pub total_balance: u64,
    pub mint_supply: u64,
}

impl SnapshotCommitmentTerms {
    fn validate(
        &self,
        action: &CorporateAction,
        instrument: &Instrument,
        actual_mint_supply: u64,
        now: i64,
        current_slot: u64,
    ) -> Result<()> {
        require!(
            instrument.status == InstrumentStatus::Active,
            ErrorCode::InvalidInstrumentStatus
        );
        require!(
            action.status == CorporateActionStatus::Scheduled
                && action.snapshot_hash == [0; 32]
                && action.snapshot_slot == 0,
            ErrorCode::InvalidActionStatus
        );
        require!(
            now >= action.record_at
                && now
                    <= action
                        .record_at
                        .checked_add(SNAPSHOT_GRACE_SECONDS)
                        .ok_or(ErrorCode::SnapshotWindowMissed)?,
            ErrorCode::SnapshotWindowMissed
        );
        require!(
            self.snapshot_slot > 0 && self.snapshot_slot <= current_slot,
            ErrorCode::InvalidSnapshotSlot
        );
        require!(
            self.snapshot_hash != [0; 32],
            ErrorCode::InvalidSnapshotHash
        );
        require!(
            self.investor_count > 0
                && self.wallet_count >= self.investor_count
                && self.total_balance > 0,
            ErrorCode::InvalidSnapshotCounts
        );
        require!(
            self.total_balance == self.mint_supply
                && self.mint_supply == actual_mint_supply
                && self.mint_supply <= instrument.total_supply,
            ErrorCode::InvalidMintSupply
        );
        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct Instrument {
    pub version: u8,
    pub instrument_id: [u8; 16],
    pub issuer_authority: Pubkey,
    pub compliance_authority: Pubkey,
    pub corporate_action_authority: Pubkey,
    pub bond_mint: Pubkey,
    pub settlement_mint: Pubkey,
    pub face_value_minor: u64,
    pub coupon_rate_bps: u32,
    pub payments_per_year: u8,
    pub issue_at: i64,
    pub maturity_at: i64,
    pub total_supply: u64,
    pub status: InstrumentStatus,
    pub bump: u8,
    pub authority_bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct CorporateAction {
    pub version: u8,
    pub action_id: [u8; 16],
    pub instrument: Pubkey,
    pub action_type: CorporateActionType,
    pub record_at: i64,
    pub execute_at: i64,
    pub redemption_percentage_bps: Option<u16>,
    pub redemption_price_minor: Option<u64>,
    pub snapshot_hash: [u8; 32],
    pub snapshot_slot: u64,
    pub investor_count: u32,
    pub wallet_count: u32,
    pub total_balance: u64,
    pub total_amount_minor: u64,
    pub registered_entitlements: u32,
    pub processed_entitlements: u32,
    pub status: CorporateActionStatus,
    pub created_at: i64,
    pub completed_at: Option<i64>,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub enum CorporateActionType {
    CouponPayment,
    BondRedemption,
    EarlyRedemption,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub enum CorporateActionStatus {
    Scheduled,
    Cancelled,
    SnapshotCreated,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
pub enum InstrumentStatus {
    Deploying,
    Active,
    Paused,
    Redeemed,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Instrument ID must not be nil")]
    InvalidInstrumentId,
    #[msg("Authority must not be the default public key")]
    InvalidAuthority,
    #[msg("Face value must be positive")]
    InvalidFaceValue,
    #[msg("Coupon rate is outside the supported range")]
    InvalidCouponRate,
    #[msg("Payment frequency must be 1, 2, or 4")]
    InvalidPaymentFrequency,
    #[msg("Issue date must precede maturity date")]
    InvalidDates,
    #[msg("Mint addresses must be distinct")]
    InvalidMint,
    #[msg("Mint must be owned by Token-2022")]
    InvalidTokenProgram,
    #[msg("Unexpected mint decimals")]
    InvalidTokenDecimals,
    #[msg("Bond mint supply does not match the instrument")]
    InvalidMintSupply,
    #[msg("Bond mint authority must be revoked")]
    MintAuthorityNotRevoked,
    #[msg("Bond freeze authority must be absent")]
    FreezeAuthorityPresent,
    #[msg("Program data account does not belong to this program")]
    InvalidProgramData,
    #[msg("Administrator must be the program upgrade authority")]
    UnauthorizedAdministrator,
    #[msg("Only the instrument issuer authority may create an action")]
    UnauthorizedIssuer,
    #[msg("Corporate action ID must not be nil")]
    InvalidActionId,
    #[msg("Instrument status does not allow a new action")]
    InvalidInstrumentStatus,
    #[msg("Corporate action dates are invalid")]
    InvalidActionDates,
    #[msg("Redemption parameters do not match the action type")]
    InvalidRedemptionParameters,
    #[msg("Activation requires 1 to 64 holder token accounts")]
    InvalidHolderCount,
    #[msg("Holder account is not a positive-balance Token-2022 account for this bond")]
    InvalidHolderAccount,
    #[msg("Holder token account was supplied more than once")]
    DuplicateHolderAccount,
    #[msg("Corporate action does not belong to this instrument")]
    InvalidActionInstrument,
    #[msg("Corporate action must be scheduled to cancel")]
    InvalidActionStatus,
    #[msg("Snapshot is outside the record-date window")]
    SnapshotWindowMissed,
    #[msg("Snapshot slot must be a past or current nonzero slot")]
    InvalidSnapshotSlot,
    #[msg("Snapshot hash must not be zero")]
    InvalidSnapshotHash,
    #[msg("Snapshot investor, wallet, or balance counts are invalid")]
    InvalidSnapshotCounts,
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEST_NOW: i64 = 1_750_000_000;

    fn valid_terms() -> InstrumentTerms {
        InstrumentTerms {
            instrument_id: [1; 16],
            compliance_authority: Pubkey::new_unique(),
            corporate_action_authority: Pubkey::new_unique(),
            face_value_minor: 100_000,
            coupon_rate_bps: 1_000,
            payments_per_year: 2,
            issue_at: 1_700_000_000,
            maturity_at: 1_800_000_000,
            total_supply: 35,
        }
    }

    fn valid_instrument() -> Instrument {
        let terms = valid_terms();
        Instrument {
            version: 1,
            instrument_id: terms.instrument_id,
            issuer_authority: Pubkey::new_unique(),
            compliance_authority: terms.compliance_authority,
            corporate_action_authority: terms.corporate_action_authority,
            bond_mint: Pubkey::new_unique(),
            settlement_mint: Pubkey::new_unique(),
            face_value_minor: terms.face_value_minor,
            coupon_rate_bps: terms.coupon_rate_bps,
            payments_per_year: terms.payments_per_year,
            issue_at: terms.issue_at,
            maturity_at: terms.maturity_at,
            total_supply: terms.total_supply,
            status: InstrumentStatus::Deploying,
            bump: 1,
            authority_bump: 1,
        }
    }

    fn coupon_action() -> CorporateActionTerms {
        CorporateActionTerms {
            action_id: [2; 16],
            action_type: CorporateActionType::CouponPayment,
            record_at: TEST_NOW + 100,
            execute_at: TEST_NOW + 200,
            redemption_percentage_bps: None,
            redemption_price_minor: None,
        }
    }

    fn scheduled_action() -> CorporateAction {
        let terms = coupon_action();
        CorporateAction {
            version: 1,
            action_id: terms.action_id,
            instrument: Pubkey::new_unique(),
            action_type: terms.action_type,
            record_at: terms.record_at,
            execute_at: terms.execute_at,
            redemption_percentage_bps: None,
            redemption_price_minor: None,
            snapshot_hash: [0; 32],
            snapshot_slot: 0,
            investor_count: 0,
            wallet_count: 0,
            total_balance: 0,
            total_amount_minor: 0,
            registered_entitlements: 0,
            processed_entitlements: 0,
            status: CorporateActionStatus::Scheduled,
            created_at: TEST_NOW,
            completed_at: None,
            bump: 1,
        }
    }

    fn valid_snapshot_commitment() -> SnapshotCommitmentTerms {
        SnapshotCommitmentTerms {
            snapshot_hash: [1; 32],
            snapshot_slot: 10,
            investor_count: 3,
            wallet_count: 3,
            total_balance: 35,
            mint_supply: 35,
        }
    }

    #[test]
    fn accepts_canonical_demo_terms() {
        assert!(valid_terms().validate().is_ok());
    }

    #[test]
    fn rejects_invalid_financial_terms() {
        let mut terms = valid_terms();
        terms.face_value_minor = 0;
        assert!(terms.validate().is_err());

        let mut terms = valid_terms();
        terms.coupon_rate_bps = 100_001;
        assert!(terms.validate().is_err());

        let mut terms = valid_terms();
        terms.payments_per_year = 3;
        assert!(terms.validate().is_err());

        let mut terms = valid_terms();
        terms.total_supply = 0;
        assert!(terms.validate().is_err());
    }

    #[test]
    fn rejects_invalid_identity_and_dates() {
        let mut terms = valid_terms();
        terms.instrument_id = [0; 16];
        assert!(terms.validate().is_err());

        let mut terms = valid_terms();
        terms.compliance_authority = Pubkey::default();
        assert!(terms.validate().is_err());

        let mut terms = valid_terms();
        terms.maturity_at = terms.issue_at;
        assert!(terms.validate().is_err());
    }

    #[test]
    fn accepts_all_action_types_with_valid_parameters() {
        let instrument = valid_instrument();
        assert!(coupon_action().validate(&instrument, TEST_NOW).is_ok());

        let mut maturity = coupon_action();
        maturity.action_type = CorporateActionType::BondRedemption;
        maturity.execute_at = instrument.maturity_at;
        assert!(maturity.validate(&instrument, TEST_NOW).is_ok());

        let mut early = coupon_action();
        early.action_type = CorporateActionType::EarlyRedemption;
        early.redemption_percentage_bps = Some(2_000);
        early.redemption_price_minor = Some(100_000);
        assert!(early.validate(&instrument, TEST_NOW).is_ok());
    }

    #[test]
    fn rejects_invalid_action_parameters_and_dates() {
        let instrument = valid_instrument();
        let mut action = coupon_action();
        action.action_id = [0; 16];
        assert!(action.validate(&instrument, TEST_NOW).is_err());

        let mut action = coupon_action();
        action.record_at = TEST_NOW - 1;
        assert!(action.validate(&instrument, TEST_NOW).is_err());

        let mut action = coupon_action();
        action.execute_at = action.record_at - 1;
        assert!(action.validate(&instrument, TEST_NOW).is_err());

        let mut action = coupon_action();
        action.redemption_percentage_bps = Some(2_000);
        assert!(action.validate(&instrument, TEST_NOW).is_err());

        let mut action = coupon_action();
        action.action_type = CorporateActionType::BondRedemption;
        assert!(action.validate(&instrument, TEST_NOW).is_err());

        let mut action = coupon_action();
        action.action_type = CorporateActionType::EarlyRedemption;
        action.redemption_percentage_bps = Some(0);
        action.redemption_price_minor = Some(100_000);
        assert!(action.validate(&instrument, TEST_NOW).is_err());

        let mut action = coupon_action();
        action.action_type = CorporateActionType::EarlyRedemption;
        action.redemption_percentage_bps = Some(10_001);
        action.redemption_price_minor = Some(100_000);
        assert!(action.validate(&instrument, TEST_NOW).is_err());

        let mut action = coupon_action();
        action.action_type = CorporateActionType::EarlyRedemption;
        action.redemption_percentage_bps = Some(2_000);
        action.redemption_price_minor = Some(0);
        assert!(action.validate(&instrument, TEST_NOW).is_err());

        let mut action = coupon_action();
        action.action_type = CorporateActionType::EarlyRedemption;
        action.redemption_percentage_bps = Some(2_000);
        action.redemption_price_minor = Some(100_000);
        action.execute_at = instrument.maturity_at;
        assert!(action.validate(&instrument, TEST_NOW).is_err());

        let mut redeemed = valid_instrument();
        redeemed.status = InstrumentStatus::Redeemed;
        assert!(coupon_action().validate(&redeemed, TEST_NOW).is_err());
    }

    #[test]
    fn accepts_snapshot_only_in_the_record_date_window() {
        let mut instrument = valid_instrument();
        instrument.status = InstrumentStatus::Active;
        let action = scheduled_action();
        let commitment = valid_snapshot_commitment();
        assert!(commitment
            .validate(&action, &instrument, 35, action.record_at, 10)
            .is_ok());
        assert!(commitment
            .validate(
                &action,
                &instrument,
                35,
                action.record_at + SNAPSHOT_GRACE_SECONDS,
                11,
            )
            .is_ok());
        assert!(commitment
            .validate(&action, &instrument, 35, action.record_at - 1, 11)
            .is_err());
        assert!(commitment
            .validate(
                &action,
                &instrument,
                35,
                action.record_at + SNAPSHOT_GRACE_SECONDS + 1,
                11,
            )
            .is_err());
    }

    #[test]
    fn rejects_invalid_snapshot_state_and_commitment() {
        let mut instrument = valid_instrument();
        let mut action = scheduled_action();
        let now = action.record_at;
        let commitment = valid_snapshot_commitment();
        assert!(commitment
            .validate(&action, &instrument, 35, now, 11)
            .is_err());

        instrument.status = InstrumentStatus::Active;
        action.status = CorporateActionStatus::Cancelled;
        assert!(commitment
            .validate(&action, &instrument, 35, now, 11)
            .is_err());
        action.status = CorporateActionStatus::Scheduled;

        let mut invalid = valid_snapshot_commitment();
        invalid.snapshot_hash = [0; 32];
        assert!(invalid.validate(&action, &instrument, 35, now, 11).is_err());

        let mut invalid = valid_snapshot_commitment();
        invalid.snapshot_slot = 12;
        assert!(invalid.validate(&action, &instrument, 35, now, 11).is_err());

        let mut invalid = valid_snapshot_commitment();
        invalid.investor_count = 4;
        assert!(invalid.validate(&action, &instrument, 35, now, 11).is_err());

        let mut invalid = valid_snapshot_commitment();
        invalid.total_balance = 34;
        assert!(invalid.validate(&action, &instrument, 35, now, 11).is_err());

        assert!(commitment
            .validate(&action, &instrument, 34, now, 11)
            .is_err());
    }
}
