//! Version-two instruments keep every bond account frozen between atomic program operations.
//! Captures stop transfers until the complete snapshot and assigned redemption units are bound.
use crate::redemption::{self, ExecuteRedemption, RedemptionSource, RedemptionSources};
use crate::*;
use anchor_spl::token_2022::spl_token_2022::{
    extension::{
        cpi_guard::CpiGuard, default_account_state::DefaultAccountState,
        memo_transfer::MemoTransfer, permanent_delegate::PermanentDelegate,
        BaseStateWithExtensions, ExtensionType, StateWithExtensions,
    },
    instruction::AuthorityType,
    state::{Account as SplAccount, AccountState, Mint as SplMint},
};
use anchor_spl::token_interface::{
    self, FreezeAccount, Mint, MintTo, SetAuthority, ThawAccount, Token2022, TokenAccount,
    TransferChecked,
};

pub const MAX_CONTROLLED_HOLDINGS: usize = 64;

#[account]
#[derive(InitSpace)]
pub struct ControlledPolicy {
    pub version: u8,
    pub instrument: Pubkey,
    pub mint: Pubkey,
    pub capture_action: Pubkey,
    pub active_redemption: Pubkey,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct ControlledHolding {
    pub version: u8,
    pub instrument: Pubkey,
    pub mint: Pubkey,
    pub token_account: Pubkey,
    pub wallet: Pubkey,
    pub reserved_tokens: u64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq, InitSpace)]
pub struct CapturedHolding {
    pub token_account: Pubkey,
    pub wallet: Pubkey,
    pub balance: u64,
}

#[account]
#[derive(InitSpace)]
pub struct ControlledCapture {
    pub version: u8,
    pub instrument: Pubkey,
    pub action: Pubkey,
    pub started_slot: u64,
    pub started_at: i64,
    pub snapshot_hash: [u8; 32],
    pub committed: bool,
    pub finished: bool,
    #[max_len(64)]
    pub holdings: Vec<CapturedHolding>,
    // One marker for each raw snapshot source, including zero-assignment reservations.
    #[max_len(64)]
    pub reserved_sources: Vec<u8>,
    pub reserved_entitlements: u32,
    pub reserved_tokens: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct UnitReservation {
    pub version: u8,
    pub action: Pubkey,
    pub entitlement: Pubkey,
    pub snapshot_hash: [u8; 32],
    pub source_hash: [u8; 32],
    #[max_len(8)]
    pub allocations: Vec<u64>,
    pub consumed: bool,
    pub bump: u8,
}

fn require_controlled(instrument: &Instrument) -> Result<()> {
    require_eq!(instrument.version, 2, ErrorCode::InvalidControlledPolicy);
    Ok(())
}

fn read_program_account<T: AccountDeserialize>(account: &AccountInfo) -> Result<T> {
    require_keys_eq!(
        *account.owner,
        crate::id(),
        ErrorCode::InvalidControlledPolicy
    );
    T::try_deserialize(&mut &account.try_borrow_data()?[..])
}

fn write_program_account<T: AccountSerialize>(account: &AccountInfo, value: &T) -> Result<()> {
    require!(account.is_writable, ErrorCode::InvalidControlledPolicy);
    value.try_serialize(&mut &mut account.try_borrow_mut_data()?[..])
}

fn verify_policy(
    policy: &ControlledPolicy,
    key: Pubkey,
    instrument: Pubkey,
    mint: Pubkey,
) -> Result<()> {
    let (expected, bump) =
        Pubkey::find_program_address(&[b"controlled-policy", instrument.as_ref()], &crate::id());
    require!(
        policy.version == 1
            && policy.instrument == instrument
            && policy.mint == mint
            && expected == key
            && policy.bump == bump,
        ErrorCode::InvalidControlledPolicy
    );
    Ok(())
}

fn verify_holding(
    holding: &ControlledHolding,
    key: Pubkey,
    instrument: Pubkey,
    mint: Pubkey,
    token: Pubkey,
    wallet: Pubkey,
) -> Result<()> {
    let (expected, bump) = Pubkey::find_program_address(
        &[b"controlled-holding", instrument.as_ref(), token.as_ref()],
        &crate::id(),
    );
    require!(
        holding.version == 1
            && holding.instrument == instrument
            && holding.mint == mint
            && holding.token_account == token
            && holding.wallet == wallet
            && expected == key
            && holding.bump == bump,
        ErrorCode::InvalidControlledHolding
    );
    Ok(())
}

fn verify_capture(
    capture: &ControlledCapture,
    key: Pubkey,
    instrument: Pubkey,
    action: Pubkey,
) -> Result<()> {
    let (expected, bump) =
        Pubkey::find_program_address(&[b"controlled-capture", action.as_ref()], &crate::id());
    require!(
        capture.version == 1
            && capture.instrument == instrument
            && capture.action == action
            && expected == key
            && capture.bump == bump,
        ErrorCode::IncompleteControlledCapture
    );
    Ok(())
}

pub fn verify_controlled_mint(
    account: &AccountInfo,
    authority: Pubkey,
    initialized: bool,
) -> Result<()> {
    require_keys_eq!(
        *account.owner,
        anchor_spl::token_2022::ID,
        ErrorCode::InvalidControlledMint
    );
    let data = account.try_borrow_data()?;
    let mint = StateWithExtensions::<SplMint>::unpack(&data)?;
    let extensions = mint.get_extension_types()?;
    require!(
        extensions.len() == 2
            && extensions.contains(&ExtensionType::DefaultAccountState)
            && extensions.contains(&ExtensionType::PermanentDelegate),
        ErrorCode::InvalidControlledMint
    );
    require!(
        mint.get_extension::<DefaultAccountState>()?.state == AccountState::Frozen as u8
            && Option::<Pubkey>::from(mint.get_extension::<PermanentDelegate>()?.delegate)
                == Some(authority)
            && Option::<Pubkey>::from(mint.base.freeze_authority) == Some(authority)
            && mint.base.decimals == 0,
        ErrorCode::InvalidControlledMint
    );
    if initialized {
        require!(
            mint.base.mint_authority.is_none(),
            ErrorCode::MintAuthorityNotRevoked
        );
    }
    Ok(())
}

fn frozen_token(account: &AccountInfo, mint: Pubkey) -> Result<SplAccount> {
    require_keys_eq!(
        *account.owner,
        anchor_spl::token_2022::ID,
        ErrorCode::InvalidControlledHolding
    );
    let data = account.try_borrow_data()?;
    let token = StateWithExtensions::<SplAccount>::unpack(&data)?;
    let extensions = token.get_extension_types()?;
    require!(
        token.base.mint == mint
            && token.base.state == AccountState::Frozen
            && token.base.delegate.is_none()
            && token.base.close_authority.is_none()
            && extensions.contains(&ExtensionType::ImmutableOwner)
            && extensions.len() <= 3
            && extensions
                .iter()
                .enumerate()
                .all(|(index, extension)| !extensions[..index].contains(extension))
            && extensions.iter().all(|extension| matches!(
                extension,
                ExtensionType::ImmutableOwner
                    | ExtensionType::CpiGuard
                    | ExtensionType::MemoTransfer
            )),
        ErrorCode::InvalidControlledHolding
    );
    // Owners can toggle both while frozen. Neither blocks PDA-delegate burns.
    // Required memos can still reject incoming transfers; token CPI enforces that rule atomically.
    for extension in &extensions {
        let payload = match extension {
            ExtensionType::CpiGuard => token.get_extension_bytes::<CpiGuard>()?,
            ExtensionType::MemoTransfer => token.get_extension_bytes::<MemoTransfer>()?,
            _ => continue,
        };
        require!(
            payload.len() == 1 && matches!(payload[0], 0 | 1),
            ErrorCode::InvalidControlledHolding
        );
    }
    Ok(token.base)
}

fn available_units(balance: u64, reserved: u64, amount: u64) -> Result<()> {
    require!(
        amount > 0
            && balance
                .checked_sub(reserved)
                .is_some_and(|free| amount <= free),
        ErrorCode::ReservedUnits
    );
    Ok(())
}

fn change_freeze<'info>(
    token: AccountInfo<'info>,
    mint: AccountInfo<'info>,
    authority: AccountInfo<'info>,
    program: AccountInfo<'info>,
    instrument: Pubkey,
    bump: u8,
    freeze: bool,
) -> Result<()> {
    let bump_seed = [bump];
    let seeds: &[&[u8]] = &[b"instrument-authority", instrument.as_ref(), &bump_seed];
    if freeze {
        token_interface::freeze_account(CpiContext::new_with_signer(
            program.key(),
            FreezeAccount {
                account: token,
                mint,
                authority,
            },
            &[seeds],
        ))
    } else {
        token_interface::thaw_account(CpiContext::new_with_signer(
            program.key(),
            ThawAccount {
                account: token,
                mint,
                authority,
            },
            &[seeds],
        ))
    }
}

#[derive(Accounts)]
#[instruction(terms: InstrumentTerms)]
pub struct InitializeControlledInstrument<'info> {
    #[account(mut)]
    pub administrator: Signer<'info>,
    pub program: Program<'info, LifecycleKase>,
    pub program_data: Account<'info, ProgramData>,
    #[account(init, payer=administrator, space=8+Instrument::INIT_SPACE, seeds=[b"instrument", terms.instrument_id.as_ref()], bump)]
    pub instrument: Account<'info, Instrument>,
    /// CHECK: The PDA is the permanent delegate and freeze authority; it has no data.
    #[account(seeds=[b"instrument-authority", instrument.key().as_ref()], bump)]
    pub instrument_authority: UncheckedAccount<'info>,
    #[account(init, payer=administrator, space=8+ControlledPolicy::INIT_SPACE, seeds=[b"controlled-policy", instrument.key().as_ref()], bump)]
    pub controlled_policy: Account<'info, ControlledPolicy>,
    #[account(mut)]
    pub bond_mint: InterfaceAccount<'info, Mint>,
    pub settlement_mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub treasury: InterfaceAccount<'info, TokenAccount>,
    pub token_2022_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

pub fn initialize(
    ctx: Context<InitializeControlledInstrument>,
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
    let instrument_key = ctx.accounts.instrument.key();
    let mint_key = ctx.accounts.bond_mint.key();
    verify_controlled_mint(
        &ctx.accounts.bond_mint.to_account_info(),
        ctx.accounts.instrument_authority.key(),
        false,
    )?;
    require!(
        ctx.accounts.bond_mint.supply == 0
            && Option::<Pubkey>::from(ctx.accounts.bond_mint.mint_authority)
                == Some(ctx.accounts.administrator.key()),
        ErrorCode::InvalidControlledMint
    );
    require_keys_neq!(
        mint_key,
        ctx.accounts.settlement_mint.key(),
        ErrorCode::InvalidMint
    );
    require_keys_eq!(
        *ctx.accounts.settlement_mint.to_account_info().owner,
        ctx.accounts.token_2022_program.key(),
        ErrorCode::InvalidTokenProgram
    );
    require_eq!(
        ctx.accounts.settlement_mint.decimals,
        6,
        ErrorCode::InvalidTokenDecimals
    );
    {
        let settlement_info = ctx.accounts.settlement_mint.to_account_info();
        let data = settlement_info.try_borrow_data()?;
        let settlement = StateWithExtensions::<SplMint>::unpack(&data)?;
        require!(
            settlement.get_extension_types()?.is_empty()
                && settlement.base.freeze_authority.is_none(),
            ErrorCode::InvalidControlledMint
        );
    }
    let treasury = frozen_token(&ctx.accounts.treasury.to_account_info(), mint_key)?;
    require!(
        treasury.owner == ctx.accounts.administrator.key() && treasury.amount == 0,
        ErrorCode::InvalidControlledHolding
    );
    change_freeze(
        ctx.accounts.treasury.to_account_info(),
        ctx.accounts.bond_mint.to_account_info(),
        ctx.accounts.instrument_authority.to_account_info(),
        ctx.accounts.token_2022_program.to_account_info(),
        instrument_key,
        ctx.bumps.instrument_authority,
        false,
    )?;
    token_interface::mint_to(
        CpiContext::new(
            ctx.accounts.token_2022_program.key(),
            MintTo {
                mint: ctx.accounts.bond_mint.to_account_info(),
                to: ctx.accounts.treasury.to_account_info(),
                authority: ctx.accounts.administrator.to_account_info(),
            },
        ),
        terms.total_supply,
    )?;
    change_freeze(
        ctx.accounts.treasury.to_account_info(),
        ctx.accounts.bond_mint.to_account_info(),
        ctx.accounts.instrument_authority.to_account_info(),
        ctx.accounts.token_2022_program.to_account_info(),
        instrument_key,
        ctx.bumps.instrument_authority,
        true,
    )?;
    token_interface::set_authority(
        CpiContext::new(
            ctx.accounts.token_2022_program.key(),
            SetAuthority {
                current_authority: ctx.accounts.administrator.to_account_info(),
                account_or_mint: ctx.accounts.bond_mint.to_account_info(),
            },
        ),
        AuthorityType::MintTokens,
        None,
    )?;
    ctx.accounts.instrument.set_inner(Instrument {
        version: 2,
        instrument_id: terms.instrument_id,
        issuer_authority: ctx.accounts.administrator.key(),
        compliance_authority: terms.compliance_authority,
        corporate_action_authority: terms.corporate_action_authority,
        bond_mint: mint_key,
        settlement_mint: ctx.accounts.settlement_mint.key(),
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
    ctx.accounts.controlled_policy.set_inner(ControlledPolicy {
        version: 1,
        instrument: instrument_key,
        mint: mint_key,
        capture_action: Pubkey::default(),
        active_redemption: Pubkey::default(),
        bump: ctx.bumps.controlled_policy,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct RegisterControlledHolding<'info> {
    #[account(mut)]
    pub corporate_action_authority: Signer<'info>,
    #[account(constraint=instrument.corporate_action_authority == corporate_action_authority.key() @ ErrorCode::UnauthorizedCorporateActionAuthority)]
    pub instrument: Account<'info, Instrument>,
    #[account(seeds=[b"controlled-policy", instrument.key().as_ref()], bump=controlled_policy.bump)]
    pub controlled_policy: Account<'info, ControlledPolicy>,
    #[account(init, payer=corporate_action_authority, space=8+ControlledHolding::INIT_SPACE, seeds=[b"controlled-holding", instrument.key().as_ref(), bond_account.key().as_ref()], bump)]
    pub controlled_holding: Account<'info, ControlledHolding>,
    pub bond_account: InterfaceAccount<'info, TokenAccount>,
    pub token_2022_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

pub fn register_holding(ctx: Context<RegisterControlledHolding>) -> Result<()> {
    let instrument = &ctx.accounts.instrument;
    require_controlled(instrument)?;
    require!(
        matches!(
            instrument.status,
            InstrumentStatus::Deploying | InstrumentStatus::Active
        ),
        ErrorCode::InvalidInstrumentStatus
    );
    verify_policy(
        &ctx.accounts.controlled_policy,
        ctx.accounts.controlled_policy.key(),
        instrument.key(),
        instrument.bond_mint,
    )?;
    require!(
        ctx.accounts.controlled_policy.capture_action == Pubkey::default(),
        ErrorCode::InstrumentLocked
    );
    let token = frozen_token(
        &ctx.accounts.bond_account.to_account_info(),
        instrument.bond_mint,
    )?;
    ctx.accounts
        .controlled_holding
        .set_inner(ControlledHolding {
            version: 1,
            instrument: instrument.key(),
            mint: instrument.bond_mint,
            token_account: ctx.accounts.bond_account.key(),
            wallet: token.owner,
            reserved_tokens: 0,
            bump: ctx.bumps.controlled_holding,
        });
    Ok(())
}

#[derive(Accounts)]
pub struct ActivateControlledInstrument<'info> {
    pub issuer_authority: Signer<'info>,
    #[account(mut, constraint=instrument.issuer_authority == issuer_authority.key() @ ErrorCode::UnauthorizedIssuer, constraint=instrument.bond_mint == bond_mint.key() @ ErrorCode::InvalidMint)]
    pub instrument: Account<'info, Instrument>,
    #[account(seeds=[b"controlled-policy", instrument.key().as_ref()], bump=controlled_policy.bump)]
    pub controlled_policy: Account<'info, ControlledPolicy>,
    /// CHECK: PDA mint authorities are verified against this address.
    #[account(seeds=[b"instrument-authority", instrument.key().as_ref()], bump=instrument.authority_bump)]
    pub instrument_authority: UncheckedAccount<'info>,
    pub bond_mint: InterfaceAccount<'info, Mint>,
    pub token_2022_program: Program<'info, Token2022>,
}

fn capture_holdings(
    accounts: &[AccountInfo],
    instrument: Pubkey,
    mint: Pubkey,
    supply: u64,
) -> Result<Vec<CapturedHolding>> {
    require!(
        !accounts.is_empty()
            && accounts.len().is_multiple_of(2)
            && accounts.len() <= MAX_CONTROLLED_HOLDINGS * 2,
        ErrorCode::IncompleteControlledCapture
    );
    let mut holdings: Vec<CapturedHolding> = Vec::new();
    let mut balance = 0u64;
    for pair in accounts.as_chunks::<2>().0 {
        let token = frozen_token(&pair[0], mint)?;
        require!(
            token.amount > 0
                && holdings
                    .iter()
                    .all(|old| old.token_account != pair[0].key()),
            ErrorCode::IncompleteControlledCapture
        );
        let holding: ControlledHolding = read_program_account(&pair[1])?;
        verify_holding(
            &holding,
            pair[1].key(),
            instrument,
            mint,
            pair[0].key(),
            token.owner,
        )?;
        require_eq!(holding.reserved_tokens, 0, ErrorCode::ReservedUnits);
        balance = balance
            .checked_add(token.amount)
            .ok_or(ErrorCode::CalculationOverflow)?;
        holdings.push(CapturedHolding {
            token_account: pair[0].key(),
            wallet: token.owner,
            balance: token.amount,
        });
    }
    require_eq!(balance, supply, ErrorCode::InvalidMintSupply);
    Ok(holdings)
}

pub fn activate(ctx: Context<ActivateControlledInstrument>) -> Result<()> {
    require_controlled(&ctx.accounts.instrument)?;
    require!(
        ctx.accounts.instrument.status == InstrumentStatus::Deploying,
        ErrorCode::InvalidInstrumentStatus
    );
    verify_policy(
        &ctx.accounts.controlled_policy,
        ctx.accounts.controlled_policy.key(),
        ctx.accounts.instrument.key(),
        ctx.accounts.bond_mint.key(),
    )?;
    require!(
        ctx.accounts.controlled_policy.capture_action == Pubkey::default()
            && ctx.accounts.controlled_policy.active_redemption == Pubkey::default(),
        ErrorCode::InstrumentLocked
    );
    verify_controlled_mint(
        &ctx.accounts.bond_mint.to_account_info(),
        ctx.accounts.instrument_authority.key(),
        true,
    )?;
    require_eq!(
        ctx.accounts.bond_mint.supply,
        ctx.accounts.instrument.total_supply,
        ErrorCode::InvalidMintSupply
    );
    capture_holdings(
        ctx.remaining_accounts,
        ctx.accounts.instrument.key(),
        ctx.accounts.bond_mint.key(),
        ctx.accounts.bond_mint.supply,
    )?;
    ctx.accounts.instrument.status = InstrumentStatus::Active;
    Ok(())
}

#[derive(Accounts)]
pub struct ControlledTransfer<'info> {
    pub corporate_action_authority: Signer<'info>,
    pub holder: Signer<'info>,
    #[account(constraint=instrument.corporate_action_authority == corporate_action_authority.key() @ ErrorCode::UnauthorizedCorporateActionAuthority, constraint=instrument.bond_mint == bond_mint.key() @ ErrorCode::InvalidMint)]
    pub instrument: Account<'info, Instrument>,
    #[account(seeds=[b"controlled-policy", instrument.key().as_ref()], bump=controlled_policy.bump)]
    pub controlled_policy: Account<'info, ControlledPolicy>,
    /// CHECK: The immutable PDA delegate signs only this atomic transfer.
    #[account(seeds=[b"instrument-authority", instrument.key().as_ref()], bump=instrument.authority_bump)]
    pub instrument_authority: UncheckedAccount<'info>,
    pub bond_mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub source: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub destination: InterfaceAccount<'info, TokenAccount>,
    pub source_holding: Account<'info, ControlledHolding>,
    pub destination_holding: Account<'info, ControlledHolding>,
    pub token_2022_program: Program<'info, Token2022>,
}

pub fn transfer(ctx: Context<ControlledTransfer>, amount: u64) -> Result<()> {
    let instrument = &ctx.accounts.instrument;
    require_controlled(instrument)?;
    require!(
        matches!(
            instrument.status,
            InstrumentStatus::Deploying | InstrumentStatus::Active
        ),
        ErrorCode::InvalidInstrumentStatus
    );
    verify_policy(
        &ctx.accounts.controlled_policy,
        ctx.accounts.controlled_policy.key(),
        instrument.key(),
        instrument.bond_mint,
    )?;
    require!(
        ctx.accounts.controlled_policy.capture_action == Pubkey::default(),
        ErrorCode::InstrumentLocked
    );
    require_keys_neq!(
        ctx.accounts.source.key(),
        ctx.accounts.destination.key(),
        ErrorCode::InvalidControlledHolding
    );
    verify_controlled_mint(
        &ctx.accounts.bond_mint.to_account_info(),
        ctx.accounts.instrument_authority.key(),
        true,
    )?;
    let source = frozen_token(&ctx.accounts.source.to_account_info(), instrument.bond_mint)?;
    let destination = frozen_token(
        &ctx.accounts.destination.to_account_info(),
        instrument.bond_mint,
    )?;
    require_keys_eq!(
        source.owner,
        ctx.accounts.holder.key(),
        ErrorCode::InvalidControlledHolding
    );
    verify_holding(
        &ctx.accounts.source_holding,
        ctx.accounts.source_holding.key(),
        instrument.key(),
        instrument.bond_mint,
        ctx.accounts.source.key(),
        source.owner,
    )?;
    verify_holding(
        &ctx.accounts.destination_holding,
        ctx.accounts.destination_holding.key(),
        instrument.key(),
        instrument.bond_mint,
        ctx.accounts.destination.key(),
        destination.owner,
    )?;
    available_units(
        source.amount,
        ctx.accounts.source_holding.reserved_tokens,
        amount,
    )?;
    require!(
        destination.amount >= ctx.accounts.destination_holding.reserved_tokens,
        ErrorCode::ReservedUnits
    );
    for token in [
        ctx.accounts.source.to_account_info(),
        ctx.accounts.destination.to_account_info(),
    ] {
        change_freeze(
            token,
            ctx.accounts.bond_mint.to_account_info(),
            ctx.accounts.instrument_authority.to_account_info(),
            ctx.accounts.token_2022_program.to_account_info(),
            instrument.key(),
            instrument.authority_bump,
            false,
        )?;
    }
    let key = instrument.key();
    let bump = [instrument.authority_bump];
    let seeds: &[&[u8]] = &[b"instrument-authority", key.as_ref(), &bump];
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_2022_program.key(),
            TransferChecked {
                from: ctx.accounts.source.to_account_info(),
                mint: ctx.accounts.bond_mint.to_account_info(),
                to: ctx.accounts.destination.to_account_info(),
                authority: ctx.accounts.instrument_authority.to_account_info(),
            },
            &[seeds],
        ),
        amount,
        0,
    )?;
    for token in [
        ctx.accounts.source.to_account_info(),
        ctx.accounts.destination.to_account_info(),
    ] {
        change_freeze(
            token,
            ctx.accounts.bond_mint.to_account_info(),
            ctx.accounts.instrument_authority.to_account_info(),
            ctx.accounts.token_2022_program.to_account_info(),
            instrument.key(),
            instrument.authority_bump,
            true,
        )?;
    }
    Ok(())
}

#[derive(Accounts)]
pub struct BeginControlledCapture<'info> {
    #[account(mut)]
    pub corporate_action_authority: Signer<'info>,
    #[account(constraint=instrument.corporate_action_authority == corporate_action_authority.key() @ ErrorCode::UnauthorizedCorporateActionAuthority)]
    pub instrument: Account<'info, Instrument>,
    #[account(has_one=instrument @ ErrorCode::InvalidActionInstrument, seeds=[b"action", instrument.key().as_ref(), corporate_action.action_id.as_ref()], bump=corporate_action.bump)]
    pub corporate_action: Account<'info, CorporateAction>,
    #[account(mut, seeds=[b"controlled-policy", instrument.key().as_ref()], bump=controlled_policy.bump)]
    pub controlled_policy: Account<'info, ControlledPolicy>,
    #[account(init, payer=corporate_action_authority, space=8+ControlledCapture::INIT_SPACE, seeds=[b"controlled-capture", corporate_action.key().as_ref()], bump)]
    pub controlled_capture: Account<'info, ControlledCapture>,
    pub system_program: Program<'info, System>,
}

pub fn begin_capture(ctx: Context<BeginControlledCapture>) -> Result<()> {
    require_controlled(&ctx.accounts.instrument)?;
    require!(
        ctx.accounts.instrument.status == InstrumentStatus::Active,
        ErrorCode::InvalidInstrumentStatus
    );
    let action = &ctx.accounts.corporate_action;
    require!(
        action.status == CorporateActionStatus::Scheduled && action.snapshot_hash == [0; 32],
        ErrorCode::InvalidActionStatus
    );
    let clock = Clock::get()?;
    require!(
        clock.slot > 0
            && clock.unix_timestamp >= action.record_at
            && clock.unix_timestamp
                <= action
                    .record_at
                    .checked_add(SNAPSHOT_GRACE_SECONDS)
                    .ok_or(ErrorCode::SnapshotWindowMissed)?,
        ErrorCode::SnapshotWindowMissed
    );
    let policy = &mut ctx.accounts.controlled_policy;
    verify_policy(
        policy,
        policy.key(),
        ctx.accounts.instrument.key(),
        ctx.accounts.instrument.bond_mint,
    )?;
    require!(
        policy.capture_action == Pubkey::default() && policy.active_redemption == Pubkey::default(),
        ErrorCode::InstrumentLocked
    );
    policy.capture_action = action.key();
    if action.action_type != CorporateActionType::CouponPayment {
        policy.active_redemption = action.key();
    }
    ctx.accounts
        .controlled_capture
        .set_inner(ControlledCapture {
            version: 1,
            instrument: ctx.accounts.instrument.key(),
            action: action.key(),
            started_slot: clock.slot,
            started_at: clock.unix_timestamp,
            snapshot_hash: [0; 32],
            committed: false,
            finished: false,
            holdings: vec![],
            reserved_sources: vec![],
            reserved_entitlements: 0,
            reserved_tokens: 0,
            bump: ctx.bumps.controlled_capture,
        });
    Ok(())
}

#[derive(Accounts)]
pub struct RecordControlledSnapshot<'info> {
    pub corporate_action_authority: Signer<'info>,
    #[account(constraint=instrument.corporate_action_authority == corporate_action_authority.key() @ ErrorCode::UnauthorizedCorporateActionAuthority, constraint=instrument.bond_mint == bond_mint.key() @ ErrorCode::InvalidMint)]
    pub instrument: Account<'info, Instrument>,
    #[account(mut, has_one=instrument @ ErrorCode::InvalidActionInstrument, seeds=[b"action", instrument.key().as_ref(), corporate_action.action_id.as_ref()], bump=corporate_action.bump)]
    pub corporate_action: Account<'info, CorporateAction>,
    #[account(seeds=[b"controlled-policy", instrument.key().as_ref()], bump=controlled_policy.bump)]
    pub controlled_policy: Account<'info, ControlledPolicy>,
    #[account(mut, seeds=[b"controlled-capture", corporate_action.key().as_ref()], bump=controlled_capture.bump)]
    pub controlled_capture: Account<'info, ControlledCapture>,
    pub bond_mint: InterfaceAccount<'info, Mint>,
    pub token_2022_program: Program<'info, Token2022>,
}

pub fn record_snapshot(
    ctx: Context<RecordControlledSnapshot>,
    commitment: SnapshotCommitmentTerms,
) -> Result<()> {
    require_controlled(&ctx.accounts.instrument)?;
    let capture = &mut ctx.accounts.controlled_capture;
    verify_capture(
        capture,
        capture.key(),
        ctx.accounts.instrument.key(),
        ctx.accounts.corporate_action.key(),
    )?;
    verify_policy(
        &ctx.accounts.controlled_policy,
        ctx.accounts.controlled_policy.key(),
        ctx.accounts.instrument.key(),
        ctx.accounts.bond_mint.key(),
    )?;
    require!(
        !capture.committed
            && !capture.finished
            && ctx.accounts.controlled_policy.capture_action == capture.action,
        ErrorCode::IncompleteControlledCapture
    );
    require_eq!(
        commitment.snapshot_slot,
        capture.started_slot,
        ErrorCode::InvalidSnapshotSlot
    );
    commitment.validate(
        &ctx.accounts.corporate_action,
        &ctx.accounts.instrument,
        ctx.accounts.bond_mint.supply,
        capture.started_at,
        Clock::get()?.slot,
    )?;
    let holdings = capture_holdings(
        ctx.remaining_accounts,
        ctx.accounts.instrument.key(),
        ctx.accounts.bond_mint.key(),
        ctx.accounts.bond_mint.supply,
    )?;
    let mut wallets = Vec::new();
    for holding in &holdings {
        if !wallets.contains(&holding.wallet) {
            wallets.push(holding.wallet);
        }
    }
    require_eq!(
        commitment.wallet_count as usize,
        wallets.len(),
        ErrorCode::InvalidSnapshotCounts
    );
    capture.reserved_sources = vec![0; holdings.len()];
    capture.holdings = holdings;
    capture.snapshot_hash = commitment.snapshot_hash;
    capture.committed = true;
    let action = &mut ctx.accounts.corporate_action;
    action.snapshot_hash = commitment.snapshot_hash;
    action.snapshot_slot = capture.started_slot;
    action.investor_count = commitment.investor_count;
    action.wallet_count = commitment.wallet_count;
    action.total_balance = commitment.total_balance;
    action.status = CorporateActionStatus::SnapshotCreated;
    Ok(())
}

fn captured_source_indices(
    capture: &ControlledCapture,
    sources: &[RedemptionSource],
) -> Result<Vec<usize>> {
    sources
        .iter()
        .map(|source| {
            capture
                .holdings
                .iter()
                .position(|holding| {
                    holding.token_account == source.token_account
                        && holding.wallet == source.wallet
                        && holding.balance == source.balance_at_snapshot
                })
                .ok_or_else(|| error!(ErrorCode::IncompleteControlledCapture))
        })
        .collect()
}

pub fn register_controlled_sources<'info>(
    ctx: Context<'info, RegisterRedemptionSources<'info>>,
    sources: Vec<RedemptionSource>,
) -> Result<()> {
    require_controlled(&ctx.accounts.instrument)?;
    let count = sources.len();
    require_eq!(
        ctx.remaining_accounts.len(),
        count + 2,
        ErrorCode::IncompleteControlledCapture
    );
    let policy: ControlledPolicy = read_program_account(&ctx.remaining_accounts[count])?;
    let capture: ControlledCapture = read_program_account(&ctx.remaining_accounts[count + 1])?;
    verify_policy(
        &policy,
        ctx.remaining_accounts[count].key(),
        ctx.accounts.instrument.key(),
        ctx.accounts.bond_mint.key(),
    )?;
    verify_capture(
        &capture,
        ctx.remaining_accounts[count + 1].key(),
        ctx.accounts.instrument.key(),
        ctx.accounts.corporate_action.key(),
    )?;
    require!(
        policy.capture_action == capture.action
            && policy.active_redemption == capture.action
            && capture.committed
            && !capture.finished
            && capture.snapshot_hash == ctx.accounts.corporate_action.snapshot_hash,
        ErrorCode::IncompleteControlledCapture
    );
    captured_source_indices(&capture, &sources)?;
    for (source, token) in sources.iter().zip(&ctx.remaining_accounts[..count]) {
        let current = frozen_token(token, ctx.accounts.bond_mint.key())?;
        require!(
            token.key() == source.token_account
                && current.owner == source.wallet
                && current.amount == source.balance_at_snapshot,
            ErrorCode::IncompleteControlledCapture
        );
    }
    let sliced = Context {
        program_id: ctx.program_id,
        accounts: ctx.accounts,
        remaining_accounts: &ctx.remaining_accounts[..count],
        bumps: ctx.bumps,
    };
    redemption::register_sources_checked(sliced, sources)
}

#[derive(Accounts)]
pub struct ReserveControlledRedemption<'info> {
    #[account(mut)]
    pub corporate_action_authority: Signer<'info>,
    #[account(constraint=instrument.corporate_action_authority == corporate_action_authority.key() @ ErrorCode::UnauthorizedCorporateActionAuthority, constraint=instrument.bond_mint == bond_mint.key() @ ErrorCode::InvalidMint)]
    pub instrument: Account<'info, Instrument>,
    #[account(has_one=instrument @ ErrorCode::InvalidActionInstrument, seeds=[b"action", instrument.key().as_ref(), corporate_action.action_id.as_ref()], bump=corporate_action.bump)]
    pub corporate_action: Account<'info, CorporateAction>,
    #[account(seeds=[b"controlled-policy", instrument.key().as_ref()], bump=controlled_policy.bump)]
    pub controlled_policy: Account<'info, ControlledPolicy>,
    #[account(mut, seeds=[b"controlled-capture", corporate_action.key().as_ref()], bump=controlled_capture.bump)]
    pub controlled_capture: Account<'info, ControlledCapture>,
    #[account(seeds=[b"entitlement", corporate_action.key().as_ref(), entitlement.investor_id.as_ref()], bump=entitlement.bump)]
    pub entitlement: Account<'info, Entitlement>,
    #[account(seeds=[b"redemption-sources", entitlement.key().as_ref()], bump=redemption_sources.bump)]
    pub redemption_sources: Account<'info, RedemptionSources>,
    #[account(seeds=[b"redemption-progress", corporate_action.key().as_ref()], bump=redemption_progress.bump)]
    pub redemption_progress: Account<'info, RedemptionProgress>,
    #[account(init, payer=corporate_action_authority, space=8+UnitReservation::INIT_SPACE, seeds=[b"unit-reservation", entitlement.key().as_ref()], bump)]
    pub unit_reservation: Account<'info, UnitReservation>,
    pub bond_mint: InterfaceAccount<'info, Mint>,
    pub token_2022_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

pub fn reserve(ctx: Context<ReserveControlledRedemption>) -> Result<()> {
    require_controlled(&ctx.accounts.instrument)?;
    let action = &ctx.accounts.corporate_action;
    let entitlement = &ctx.accounts.entitlement;
    require!(
        action.action_type != CorporateActionType::CouponPayment
            && matches!(
                action.status,
                CorporateActionStatus::UnderReview | CorporateActionStatus::Approved
            )
            && action.processed_entitlements == 0
            && entitlement.executed_at.is_none()
            && entitlement.action == action.key(),
        ErrorCode::InvalidUnitReservation
    );
    redemption::verify_progress(&ctx.accounts.redemption_progress, action, action.key())?;
    require_eq!(
        ctx.accounts.redemption_progress.tokens_redeemed,
        0,
        ErrorCode::InvalidUnitReservation
    );
    redemption::verify_source_commitment(
        &ctx.accounts.redemption_sources,
        action.key(),
        entitlement.key(),
        action.snapshot_hash,
        entitlement.balance_at_snapshot,
    )?;
    verify_policy(
        &ctx.accounts.controlled_policy,
        ctx.accounts.controlled_policy.key(),
        ctx.accounts.instrument.key(),
        ctx.accounts.bond_mint.key(),
    )?;
    let capture = &mut ctx.accounts.controlled_capture;
    verify_capture(
        capture,
        capture.key(),
        ctx.accounts.instrument.key(),
        action.key(),
    )?;
    require!(
        capture.committed
            && !capture.finished
            && capture.snapshot_hash == action.snapshot_hash
            && ctx.accounts.controlled_policy.capture_action == action.key()
            && ctx.accounts.controlled_policy.active_redemption == action.key(),
        ErrorCode::IncompleteControlledCapture
    );
    let sources = &ctx.accounts.redemption_sources.sources;
    let allocations = redemption::burn_allocation(sources, entitlement.tokens_to_redeem)?;
    require_eq!(
        ctx.remaining_accounts.len(),
        sources.len() * 2,
        ErrorCode::InvalidUnitReservation
    );
    let indices = captured_source_indices(capture, sources)?;
    for (index, ((source, amount), captured_index)) in
        sources.iter().zip(&allocations).zip(indices).enumerate()
    {
        require_eq!(
            capture.reserved_sources[captured_index],
            0,
            ErrorCode::InvalidUnitReservation
        );
        let token_info = &ctx.remaining_accounts[index];
        let token = frozen_token(token_info, ctx.accounts.bond_mint.key())?;
        require!(
            token_info.key() == source.token_account
                && token.owner == source.wallet
                && token.amount == source.balance_at_snapshot,
            ErrorCode::InvalidUnitReservation
        );
        let holding_info = &ctx.remaining_accounts[sources.len() + index];
        let mut holding: ControlledHolding = read_program_account(holding_info)?;
        verify_holding(
            &holding,
            holding_info.key(),
            ctx.accounts.instrument.key(),
            ctx.accounts.bond_mint.key(),
            source.token_account,
            source.wallet,
        )?;
        require_eq!(holding.reserved_tokens, 0, ErrorCode::ReservedUnits);
        holding.reserved_tokens = *amount;
        write_program_account(holding_info, &holding)?;
        capture.reserved_sources[captured_index] = 1;
    }
    capture.reserved_entitlements = capture
        .reserved_entitlements
        .checked_add(1)
        .ok_or(ErrorCode::CalculationOverflow)?;
    capture.reserved_tokens = capture
        .reserved_tokens
        .checked_add(entitlement.tokens_to_redeem)
        .ok_or(ErrorCode::CalculationOverflow)?;
    ctx.accounts.unit_reservation.set_inner(UnitReservation {
        version: 1,
        action: action.key(),
        entitlement: entitlement.key(),
        snapshot_hash: action.snapshot_hash,
        source_hash: ctx.accounts.redemption_sources.source_hash,
        allocations,
        consumed: false,
        bump: ctx.bumps.unit_reservation,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct FinishControlledCapture<'info> {
    pub corporate_action_authority: Signer<'info>,
    #[account(constraint=instrument.corporate_action_authority == corporate_action_authority.key() @ ErrorCode::UnauthorizedCorporateActionAuthority)]
    pub instrument: Account<'info, Instrument>,
    #[account(has_one=instrument @ ErrorCode::InvalidActionInstrument, seeds=[b"action", instrument.key().as_ref(), corporate_action.action_id.as_ref()], bump=corporate_action.bump)]
    pub corporate_action: Account<'info, CorporateAction>,
    #[account(mut, seeds=[b"controlled-policy", instrument.key().as_ref()], bump=controlled_policy.bump)]
    pub controlled_policy: Account<'info, ControlledPolicy>,
    #[account(mut, seeds=[b"controlled-capture", corporate_action.key().as_ref()], bump=controlled_capture.bump)]
    pub controlled_capture: Account<'info, ControlledCapture>,
}

fn verify_reservation(
    reservation: &UnitReservation,
    key: Pubkey,
    action: Pubkey,
    entitlement: Pubkey,
    snapshot_hash: [u8; 32],
) -> Result<()> {
    let (expected, bump) =
        Pubkey::find_program_address(&[b"unit-reservation", entitlement.as_ref()], &crate::id());
    require!(
        reservation.version == 1
            && reservation.action == action
            && reservation.entitlement == entitlement
            && reservation.snapshot_hash == snapshot_hash
            && !reservation.consumed
            && expected == key
            && reservation.bump == bump,
        ErrorCode::InvalidUnitReservation
    );
    Ok(())
}

pub fn finish_capture(ctx: Context<FinishControlledCapture>) -> Result<()> {
    require_controlled(&ctx.accounts.instrument)?;
    let action = &ctx.accounts.corporate_action;
    verify_policy(
        &ctx.accounts.controlled_policy,
        ctx.accounts.controlled_policy.key(),
        ctx.accounts.instrument.key(),
        ctx.accounts.instrument.bond_mint,
    )?;
    let capture = &mut ctx.accounts.controlled_capture;
    verify_capture(
        capture,
        capture.key(),
        ctx.accounts.instrument.key(),
        action.key(),
    )?;
    require!(
        capture.committed
            && !capture.finished
            && capture.snapshot_hash == action.snapshot_hash
            && ctx.accounts.controlled_policy.capture_action == action.key(),
        ErrorCode::IncompleteControlledCapture
    );
    if action.action_type == CorporateActionType::CouponPayment {
        require!(
            ctx.remaining_accounts.is_empty() && capture.reserved_entitlements == 0,
            ErrorCode::IncompleteControlledCapture
        );
    } else {
        require!(
            matches!(
                action.status,
                CorporateActionStatus::UnderReview | CorporateActionStatus::Approved
            ) && action.processed_entitlements == 0
                && ctx.remaining_accounts.len() == action.investor_count as usize * 2
                && capture.reserved_entitlements == action.investor_count
                && capture.reserved_sources.len() == capture.holdings.len()
                && capture.reserved_sources.iter().all(|value| *value == 1)
                && ctx.accounts.controlled_policy.active_redemption == action.key(),
            ErrorCode::IncompleteControlledCapture
        );
        let mut total = 0u64;
        let mut seen = Vec::new();
        for pair in ctx.remaining_accounts.as_chunks::<2>().0 {
            require!(
                !seen.contains(&pair[0].key()),
                ErrorCode::IncompleteControlledCapture
            );
            seen.push(pair[0].key());
            let entitlement: Entitlement = read_program_account(&pair[0])?;
            let (expected, bump) = Pubkey::find_program_address(
                &[
                    b"entitlement",
                    action.key().as_ref(),
                    entitlement.investor_id.as_ref(),
                ],
                &crate::id(),
            );
            require!(
                expected == pair[0].key()
                    && entitlement.bump == bump
                    && entitlement.version == action.version
                    && entitlement.action == action.key()
                    && entitlement.snapshot_hash == action.snapshot_hash
                    && entitlement.executed_at.is_none(),
                ErrorCode::InvalidUnitReservation
            );
            let reservation: UnitReservation = read_program_account(&pair[1])?;
            verify_reservation(
                &reservation,
                pair[1].key(),
                action.key(),
                pair[0].key(),
                action.snapshot_hash,
            )?;
            let assigned = reservation
                .allocations
                .iter()
                .try_fold(0u64, |sum, amount| {
                    sum.checked_add(*amount)
                        .ok_or(ErrorCode::CalculationOverflow)
                })?;
            require_eq!(
                assigned,
                entitlement.tokens_to_redeem,
                ErrorCode::InvalidUnitReservation
            );
            total = total
                .checked_add(assigned)
                .ok_or(ErrorCode::CalculationOverflow)?;
        }
        require_eq!(
            total,
            capture.reserved_tokens,
            ErrorCode::IncompleteControlledCapture
        );
    }
    capture.finished = true;
    ctx.accounts.controlled_policy.capture_action = Pubkey::default();
    Ok(())
}

#[derive(Accounts)]
pub struct AbortControlledCapture<'info> {
    #[account(mut)]
    pub corporate_action_authority: Signer<'info>,
    #[account(constraint=instrument.corporate_action_authority == corporate_action_authority.key() @ ErrorCode::UnauthorizedCorporateActionAuthority)]
    pub instrument: Account<'info, Instrument>,
    #[account(has_one=instrument @ ErrorCode::InvalidActionInstrument, seeds=[b"action", instrument.key().as_ref(), corporate_action.action_id.as_ref()], bump=corporate_action.bump)]
    pub corporate_action: Account<'info, CorporateAction>,
    #[account(mut, seeds=[b"controlled-policy", instrument.key().as_ref()], bump=controlled_policy.bump)]
    pub controlled_policy: Account<'info, ControlledPolicy>,
    #[account(mut, close=corporate_action_authority, seeds=[b"controlled-capture", corporate_action.key().as_ref()], bump=controlled_capture.bump)]
    pub controlled_capture: Account<'info, ControlledCapture>,
}

pub fn abort_capture(ctx: Context<AbortControlledCapture>) -> Result<()> {
    require_controlled(&ctx.accounts.instrument)?;
    verify_policy(
        &ctx.accounts.controlled_policy,
        ctx.accounts.controlled_policy.key(),
        ctx.accounts.instrument.key(),
        ctx.accounts.instrument.bond_mint,
    )?;
    let capture = &ctx.accounts.controlled_capture;
    verify_capture(
        capture,
        capture.key(),
        ctx.accounts.instrument.key(),
        ctx.accounts.corporate_action.key(),
    )?;
    require!(
        !capture.committed
            && !capture.finished
            && capture.reserved_entitlements == 0
            && capture.reserved_tokens == 0
            && ctx.accounts.corporate_action.status == CorporateActionStatus::Scheduled
            && ctx.accounts.controlled_policy.capture_action == capture.action,
        ErrorCode::IncompleteControlledCapture
    );
    ctx.accounts.controlled_policy.capture_action = Pubkey::default();
    if ctx.accounts.controlled_policy.active_redemption == capture.action {
        ctx.accounts.controlled_policy.active_redemption = Pubkey::default();
    }
    Ok(())
}

#[derive(Accounts)]
pub struct CompleteControlledRedemption<'info> {
    pub corporate_action_authority: Signer<'info>,
    #[account(constraint=instrument.corporate_action_authority == corporate_action_authority.key() @ ErrorCode::UnauthorizedCorporateActionAuthority)]
    pub instrument: Account<'info, Instrument>,
    #[account(has_one=instrument @ ErrorCode::InvalidActionInstrument, seeds=[b"action", instrument.key().as_ref(), corporate_action.action_id.as_ref()], bump=corporate_action.bump)]
    pub corporate_action: Account<'info, CorporateAction>,
    #[account(mut, seeds=[b"controlled-policy", instrument.key().as_ref()], bump=controlled_policy.bump)]
    pub controlled_policy: Account<'info, ControlledPolicy>,
}

pub fn complete_redemption(ctx: Context<CompleteControlledRedemption>) -> Result<()> {
    require_controlled(&ctx.accounts.instrument)?;
    let policy = &mut ctx.accounts.controlled_policy;
    verify_policy(
        policy,
        policy.key(),
        ctx.accounts.instrument.key(),
        ctx.accounts.instrument.bond_mint,
    )?;
    require!(
        policy.capture_action == Pubkey::default()
            && policy.active_redemption == ctx.accounts.corporate_action.key()
            && ctx.accounts.corporate_action.status == CorporateActionStatus::Finalized,
        ErrorCode::InstrumentLocked
    );
    policy.active_redemption = Pubkey::default();
    Ok(())
}

pub fn prepare_redemption<'info>(
    ctx: &mut ExecuteRedemption<'info>,
    remaining: &[AccountInfo<'info>],
    allocations: &[u64],
) -> Result<()> {
    require_controlled(&ctx.instrument)?;
    let count = allocations.len();
    require!(
        count == ctx.redemption_sources.sources.len() && remaining.len() == count * 2 + 2,
        ErrorCode::InvalidUnitReservation
    );
    let policy: ControlledPolicy = read_program_account(&remaining[count])?;
    verify_policy(
        &policy,
        remaining[count].key(),
        ctx.instrument.key(),
        ctx.bond_mint.key(),
    )?;
    require!(
        policy.capture_action == Pubkey::default()
            && policy.active_redemption == ctx.corporate_action.key(),
        ErrorCode::InstrumentLocked
    );
    let reservation: UnitReservation = read_program_account(&remaining[count + 1])?;
    verify_reservation(
        &reservation,
        remaining[count + 1].key(),
        ctx.corporate_action.key(),
        ctx.entitlement.key(),
        ctx.corporate_action.snapshot_hash,
    )?;
    require!(
        reservation.source_hash == ctx.redemption_sources.source_hash
            && reservation.allocations == allocations,
        ErrorCode::InvalidUnitReservation
    );
    verify_controlled_mint(
        &ctx.bond_mint.to_account_info(),
        ctx.instrument_authority.key(),
        true,
    )?;
    for (index, (source, amount)) in ctx
        .redemption_sources
        .sources
        .iter()
        .zip(allocations)
        .enumerate()
    {
        require_keys_eq!(
            remaining[index].key(),
            source.token_account,
            ErrorCode::InvalidUnitReservation
        );
        let holding_info = &remaining[count + 2 + index];
        let mut holding: ControlledHolding = read_program_account(holding_info)?;
        verify_holding(
            &holding,
            holding_info.key(),
            ctx.instrument.key(),
            ctx.bond_mint.key(),
            source.token_account,
            source.wallet,
        )?;
        require_eq!(
            holding.reserved_tokens,
            *amount,
            ErrorCode::InvalidUnitReservation
        );
        if *amount == 0 {
            // This source is untouched: closing or reallocating it cannot affect cash or burned units.
            continue;
        }
        let token = frozen_token(&remaining[index], ctx.bond_mint.key())?;
        require!(
            token.owner == source.wallet && token.amount >= *amount,
            ErrorCode::ReservedUnits
        );
        holding.reserved_tokens = holding
            .reserved_tokens
            .checked_sub(*amount)
            .ok_or(ErrorCode::ReservedUnits)?;
        write_program_account(holding_info, &holding)?;
        change_freeze(
            remaining[index].clone(),
            ctx.bond_mint.to_account_info(),
            ctx.instrument_authority.to_account_info(),
            ctx.token_2022_program.to_account_info(),
            ctx.instrument.key(),
            ctx.instrument.authority_bump,
            false,
        )?;
    }
    Ok(())
}

pub fn finish_redemption<'info>(
    ctx: &mut ExecuteRedemption<'info>,
    remaining: &[AccountInfo<'info>],
    allocations: &[u64],
) -> Result<()> {
    let count = allocations.len();
    require_eq!(
        remaining.len(),
        count * 2 + 2,
        ErrorCode::InvalidUnitReservation
    );
    for (index, amount) in allocations.iter().enumerate() {
        if *amount > 0 {
            change_freeze(
                remaining[index].clone(),
                ctx.bond_mint.to_account_info(),
                ctx.instrument_authority.to_account_info(),
                ctx.token_2022_program.to_account_info(),
                ctx.instrument.key(),
                ctx.instrument.authority_bump,
                true,
            )?;
        }
    }
    let info = &remaining[count + 1];
    let mut reservation: UnitReservation = read_program_account(info)?;
    verify_reservation(
        &reservation,
        info.key(),
        ctx.corporate_action.key(),
        ctx.entitlement.key(),
        ctx.corporate_action.snapshot_hash,
    )?;
    reservation.consumed = true;
    write_program_account(info, &reservation)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw_frozen_token(
        extra_extensions: &[(ExtensionType, &[u8])],
        state: AccountState,
    ) -> Result<SplAccount> {
        let mint = Pubkey::new_unique();
        let key = Pubkey::new_unique();
        let token_program = anchor_spl::token_2022::ID;
        let mut lamports = 1;
        let mut data = vec![0; 166];
        data[..32].copy_from_slice(mint.as_ref());
        data[32..64].copy_from_slice(Pubkey::new_unique().as_ref());
        data[64..72].copy_from_slice(&10u64.to_le_bytes());
        data[108] = state as u8;
        data[165] = 2;
        data.extend_from_slice(&(ExtensionType::ImmutableOwner as u16).to_le_bytes());
        data.extend_from_slice(&0u16.to_le_bytes());
        for (extension, value) in extra_extensions {
            data.extend_from_slice(&(*extension as u16).to_le_bytes());
            data.extend_from_slice(&(value.len() as u16).to_le_bytes());
            data.extend_from_slice(value);
        }
        frozen_token(
            &AccountInfo::new(
                &key,
                false,
                false,
                &mut lamports,
                &mut data,
                &token_program,
                false,
            ),
            mint,
        )
    }

    #[test]
    fn frozen_holdings_allow_known_owner_extensions_but_reject_other_extensions() {
        assert!(raw_frozen_token(&[], AccountState::Frozen).is_ok());
        for extension in [ExtensionType::CpiGuard, ExtensionType::MemoTransfer] {
            for state in [0, 1] {
                assert!(raw_frozen_token(&[(extension, &[state])], AccountState::Frozen).is_ok());
            }
            assert!(raw_frozen_token(&[(extension, &[2])], AccountState::Frozen).is_err());
            assert!(raw_frozen_token(&[(extension, &[0, 0])], AccountState::Frozen).is_err());
            assert!(raw_frozen_token(&[(extension, &[1])], AccountState::Initialized).is_err());
            assert!(raw_frozen_token(
                &[(extension, &[0]), (extension, &[1])],
                AccountState::Frozen
            )
            .is_err());
        }
        assert!(raw_frozen_token(
            &[
                (ExtensionType::CpiGuard, &[1]),
                (ExtensionType::MemoTransfer, &[1])
            ],
            AccountState::Frozen
        )
        .is_ok());
        assert!(raw_frozen_token(
            &[(ExtensionType::TransferHookAccount, &[0])],
            AccountState::Frozen
        )
        .is_err());
        assert!(raw_frozen_token(
            &[(ExtensionType::ImmutableOwner, &[])],
            AccountState::Frozen
        )
        .is_err());
    }

    #[test]
    fn transfers_leave_reserved_units_in_the_original_account() {
        assert!(available_units(10, 2, 8).is_ok());
        assert!(available_units(10, 2, 9).is_err());
        assert!(available_units(2, 2, 1).is_err());
        assert!(available_units(1, 2, 1).is_err());
        assert!(available_units(u64::MAX, 0, u64::MAX).is_ok());
        assert!(available_units(10, 0, 0).is_err());
    }

    #[test]
    fn captured_sources_bind_wallet_account_and_balance() {
        let token = Pubkey::new_unique();
        let wallet = Pubkey::new_unique();
        let capture = ControlledCapture {
            version: 1,
            instrument: Pubkey::new_unique(),
            action: Pubkey::new_unique(),
            started_slot: 42,
            started_at: 100,
            snapshot_hash: [1; 32],
            committed: true,
            finished: false,
            holdings: vec![CapturedHolding {
                token_account: token,
                wallet,
                balance: 10,
            }],
            reserved_sources: vec![0],
            reserved_entitlements: 0,
            reserved_tokens: 0,
            bump: 1,
        };
        let source = RedemptionSource {
            token_account: token,
            wallet,
            balance_at_snapshot: 10,
        };
        assert_eq!(
            captured_source_indices(&capture, std::slice::from_ref(&source)).unwrap(),
            vec![0]
        );
        let mut wrong = source.clone();
        wrong.wallet = Pubkey::new_unique();
        assert!(captured_source_indices(&capture, &[wrong]).is_err());
        let mut wrong = source.clone();
        wrong.balance_at_snapshot = 9;
        assert!(captured_source_indices(&capture, &[wrong]).is_err());
        let mut wrong = source;
        wrong.token_account = Pubkey::new_unique();
        assert!(captured_source_indices(&capture, &[wrong]).is_err());
    }
}
