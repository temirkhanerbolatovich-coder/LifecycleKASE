use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, Token2022};

declare_id!("6qLE1S9tMngm8oqWepdSwa3dUij5ZUNNdN9QV8mqm1fo");

#[program]
pub mod lifecycle_kase {
    use super::*;

    pub fn initialize_instrument(
        ctx: Context<InitializeInstrument>,
        terms: InstrumentTerms,
    ) -> Result<()> {
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
}

#[derive(Accounts)]
#[instruction(terms: InstrumentTerms)]
pub struct InitializeInstrument<'info> {
    #[account(mut)]
    pub administrator: Signer<'info>,
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
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
