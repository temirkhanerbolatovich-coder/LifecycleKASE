use crate::{
    ActionReceipt, ActionReserve, ApprovalPolicy, CorporateAction, CorporateActionStatus,
    CorporateActionType, Entitlement, EntitlementStatus, ErrorCode, Instrument, InstrumentStatus,
    MAX_CALCULATION_INVESTORS,
};
use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::{
    extension::StateWithExtensions, state::Account as SplTokenAccount,
};
use anchor_spl::token_interface::{
    self, BurnChecked, Mint, Token2022, TokenAccount, TransferChecked,
};

pub const MAX_REDEMPTION_SOURCES: usize = 8;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq, InitSpace)]
pub struct RedemptionSource {
    pub token_account: Pubkey,
    pub wallet: Pubkey,
    pub balance_at_snapshot: u64,
}

#[account]
#[derive(InitSpace)]
pub struct RedemptionSources {
    pub version: u8,
    pub action: Pubkey,
    pub entitlement: Pubkey,
    pub snapshot_hash: [u8; 32],
    pub source_hash: [u8; 32],
    #[max_len(8)]
    pub sources: Vec<RedemptionSource>,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct RedemptionProgress {
    pub version: u8,
    pub action: Pubkey,
    pub snapshot_hash: [u8; 32],
    pub snapshot_supply: u64,
    pub tokens_redeemed: u64,
    pub processed_entitlements: u32,
    pub bump: u8,
}

// A separate receipt preserves the deployed coupon receipt ABI.
#[account]
#[derive(InitSpace)]
pub struct RedemptionReceipt {
    pub version: u8,
    pub action: Pubkey,
    pub entitlement: Pubkey,
    pub snapshot_hash: [u8; 32],
    pub settlement_mint: Pubkey,
    pub settlement_wallet: Pubkey,
    pub amount_minor: u64,
    pub idempotency_hash: [u8; 32],
    pub executed_at: i64,
    pub bond_mint: Pubkey,
    pub source_hash: [u8; 32],
    pub tokens_redeemed: u64,
    pub mint_supply_before: u64,
    pub mint_supply_after: u64,
    pub bump: u8,
}

fn is_redemption(action_type: CorporateActionType) -> bool {
    matches!(
        action_type,
        CorporateActionType::BondRedemption | CorporateActionType::EarlyRedemption
    )
}

pub fn source_hash(
    action: Pubkey,
    entitlement: Pubkey,
    snapshot_hash: [u8; 32],
    sources: &[RedemptionSource],
) -> Result<[u8; 32]> {
    let mut encoded = Vec::new();
    sources.to_vec().serialize(&mut encoded)?;
    Ok(solana_sha256_hasher::hashv(&[
        b"LifecycleKASE:RedemptionSources:v1",
        action.as_ref(),
        entitlement.as_ref(),
        &snapshot_hash,
        &encoded,
    ])
    .to_bytes())
}

fn validate_sources(sources: &[RedemptionSource], balance: u64) -> Result<()> {
    require!(
        !sources.is_empty() && sources.len() <= MAX_REDEMPTION_SOURCES,
        ErrorCode::InvalidRedemptionSources
    );
    let mut total = 0u64;
    for (index, source) in sources.iter().enumerate() {
        require!(
            source.token_account != Pubkey::default()
                && source.wallet != Pubkey::default()
                && source.balance_at_snapshot > 0,
            ErrorCode::InvalidRedemptionSources
        );
        // The client and canonical snapshot use ascending base58 account addresses.
        if index > 0 {
            require!(
                sources[index - 1].token_account.to_string() < source.token_account.to_string(),
                ErrorCode::InvalidRedemptionSources
            );
        }
        total = total
            .checked_add(source.balance_at_snapshot)
            .ok_or(ErrorCode::CalculationOverflow)?;
    }
    require_eq!(total, balance, ErrorCode::InvalidRedemptionSources);
    Ok(())
}

pub fn verify_source_commitment(
    sources: &RedemptionSources,
    action: Pubkey,
    entitlement_key: Pubkey,
    snapshot_hash: [u8; 32],
    balance: u64,
) -> Result<()> {
    require!(
        sources.version == 1
            && sources.action == action
            && sources.entitlement == entitlement_key
            && sources.snapshot_hash == snapshot_hash,
        ErrorCode::InvalidRedemptionSources
    );
    validate_sources(&sources.sources, balance)?;
    require!(
        sources.source_hash
            == source_hash(action, entitlement_key, snapshot_hash, &sources.sources)?,
        ErrorCode::InvalidRedemptionSources
    );
    Ok(())
}

pub fn verify_progress(
    progress: &RedemptionProgress,
    action: &CorporateAction,
    action_key: Pubkey,
) -> Result<()> {
    require!(
        progress.version == 1
            && progress.action == action_key
            && progress.snapshot_hash == action.snapshot_hash
            && progress.snapshot_supply == action.total_balance
            && progress.tokens_redeemed <= progress.snapshot_supply
            && progress.processed_entitlements == action.processed_entitlements,
        ErrorCode::InvalidRedemptionExecution
    );
    Ok(())
}

pub(crate) fn burn_allocation(sources: &[RedemptionSource], tokens: u64) -> Result<Vec<u64>> {
    let mut remaining = tokens;
    let allocations = sources
        .iter()
        .map(|source| {
            let amount = source.balance_at_snapshot.min(remaining);
            remaining -= amount;
            amount
        })
        .collect();
    require_eq!(remaining, 0, ErrorCode::InvalidRedemptionSources);
    Ok(allocations)
}

fn require_current_supply(
    snapshot_supply: u64,
    tokens_redeemed: u64,
    actual_supply: u64,
) -> Result<()> {
    require!(
        snapshot_supply.checked_sub(tokens_redeemed) == Some(actual_supply),
        ErrorCode::StaleRedemptionSupply
    );
    Ok(())
}

#[derive(Accounts)]
pub struct RegisterRedemptionSources<'info> {
    #[account(mut)]
    pub corporate_action_authority: Signer<'info>,
    #[account(constraint = instrument.corporate_action_authority == corporate_action_authority.key() @ ErrorCode::UnauthorizedCorporateActionAuthority,
        constraint = instrument.status == InstrumentStatus::Active @ ErrorCode::InvalidInstrumentStatus,
        constraint = instrument.bond_mint == bond_mint.key() @ ErrorCode::InvalidMint)]
    pub instrument: Account<'info, Instrument>,
    #[account(has_one = instrument @ ErrorCode::InvalidActionInstrument,
        seeds = [b"action", instrument.key().as_ref(), corporate_action.action_id.as_ref()], bump = corporate_action.bump)]
    pub corporate_action: Account<'info, CorporateAction>,
    #[account(seeds = [b"entitlement", corporate_action.key().as_ref(), entitlement.investor_id.as_ref()], bump = entitlement.bump,
        constraint = entitlement.action == corporate_action.key() @ ErrorCode::InvalidEntitlement)]
    pub entitlement: Account<'info, Entitlement>,
    #[account(init, payer = corporate_action_authority, space = 8 + RedemptionSources::INIT_SPACE,
        seeds = [b"redemption-sources", entitlement.key().as_ref()], bump)]
    pub redemption_sources: Account<'info, RedemptionSources>,
    #[account(init_if_needed, payer = corporate_action_authority, space = 8 + RedemptionProgress::INIT_SPACE,
        seeds = [b"redemption-progress", corporate_action.key().as_ref()], bump)]
    pub redemption_progress: Account<'info, RedemptionProgress>,
    pub bond_mint: InterfaceAccount<'info, Mint>,
    pub token_2022_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

pub fn register_sources(
    ctx: Context<RegisterRedemptionSources>,
    sources: Vec<RedemptionSource>,
) -> Result<()> {
    require_eq!(
        ctx.accounts.instrument.version,
        1,
        ErrorCode::InvalidRedemptionExecution
    );
    register_sources_checked(ctx, sources)
}

pub(crate) fn register_sources_checked(
    ctx: Context<RegisterRedemptionSources>,
    sources: Vec<RedemptionSource>,
) -> Result<()> {
    let action = &ctx.accounts.corporate_action;
    let entitlement = &ctx.accounts.entitlement;
    require!(
        is_redemption(action.action_type)
            && matches!(action.version, 1 | 2)
            && entitlement.version == action.version
            && action.status == CorporateActionStatus::Calculated
            && entitlement.executed_at.is_none()
            && entitlement.snapshot_hash == action.snapshot_hash
            && matches!(
                entitlement.status,
                EntitlementStatus::Ready
                    | EntitlementStatus::NotEligible
                    | EntitlementStatus::NotEligibleZeroRounding
            ),
        ErrorCode::InvalidRedemptionExecution
    );
    validate_sources(&sources, entitlement.balance_at_snapshot)?;
    require_eq!(
        ctx.remaining_accounts.len(),
        sources.len(),
        ErrorCode::InvalidRedemptionSources
    );
    for (source, account) in sources.iter().zip(ctx.remaining_accounts) {
        require_keys_eq!(
            source.token_account,
            account.key(),
            ErrorCode::InvalidRedemptionSources
        );
        require_keys_eq!(
            *account.owner,
            ctx.accounts.token_2022_program.key(),
            ErrorCode::InvalidHolderAccount
        );
        let data = account.try_borrow_data()?;
        let holder = StateWithExtensions::<SplTokenAccount>::unpack(&data)
            .map_err(|_| error!(ErrorCode::InvalidHolderAccount))?;
        require!(
            holder.base.mint == ctx.accounts.bond_mint.key() && holder.base.owner == source.wallet,
            ErrorCode::InvalidRedemptionSources
        );
    }
    let progress = &mut ctx.accounts.redemption_progress;
    if progress.version == 0 {
        require_eq!(
            ctx.accounts.bond_mint.supply,
            action.total_balance,
            ErrorCode::StaleRedemptionSupply
        );
        progress.set_inner(RedemptionProgress {
            version: 1,
            action: action.key(),
            snapshot_hash: action.snapshot_hash,
            snapshot_supply: action.total_balance,
            tokens_redeemed: 0,
            processed_entitlements: 0,
            bump: ctx.bumps.redemption_progress,
        });
    } else {
        verify_progress(progress, action, action.key())?;
        require!(
            progress.tokens_redeemed == 0 && progress.bump == ctx.bumps.redemption_progress,
            ErrorCode::InvalidRedemptionExecution
        );
    }
    let commitment = source_hash(
        action.key(),
        entitlement.key(),
        action.snapshot_hash,
        &sources,
    )?;
    ctx.accounts
        .redemption_sources
        .set_inner(RedemptionSources {
            version: 1,
            action: action.key(),
            entitlement: entitlement.key(),
            snapshot_hash: action.snapshot_hash,
            source_hash: commitment,
            sources,
            bump: ctx.bumps.redemption_sources,
        });
    Ok(())
}

#[derive(Accounts)]
pub struct ExecuteRedemption<'info> {
    #[account(mut)]
    pub corporate_action_authority: Signer<'info>,
    #[account(constraint = instrument.corporate_action_authority == corporate_action_authority.key() @ ErrorCode::UnauthorizedCorporateActionAuthority,
        constraint = instrument.status == InstrumentStatus::Active @ ErrorCode::InvalidInstrumentStatus,
        constraint = instrument.settlement_mint == settlement_mint.key() && instrument.bond_mint == bond_mint.key() @ ErrorCode::InvalidMint)]
    pub instrument: Box<Account<'info, Instrument>>,
    #[account(has_one = instrument, seeds = [b"approval-policy", instrument.key().as_ref()], bump = approval_policy.bump)]
    pub approval_policy: Account<'info, ApprovalPolicy>,
    #[account(mut, has_one = instrument @ ErrorCode::InvalidActionInstrument,
        seeds = [b"action", instrument.key().as_ref(), corporate_action.action_id.as_ref()], bump = corporate_action.bump)]
    pub corporate_action: Box<Account<'info, CorporateAction>>,
    #[account(seeds = [b"action-reserve", corporate_action.key().as_ref()], bump = action_reserve.bump,
        constraint = action_reserve.action == corporate_action.key() && action_reserve.settlement_mint == settlement_mint.key() @ ErrorCode::InvalidActionReserve)]
    pub action_reserve: Account<'info, ActionReserve>,
    #[account(mut, seeds = [b"action-vault", corporate_action.key().as_ref()], bump,
        token::mint = settlement_mint, token::authority = action_reserve, token::token_program = token_2022_program)]
    pub reserve_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, seeds = [b"entitlement", corporate_action.key().as_ref(), entitlement.investor_id.as_ref()], bump = entitlement.bump,
        constraint = entitlement.action == corporate_action.key() @ ErrorCode::InvalidEntitlement)]
    pub entitlement: Box<Account<'info, Entitlement>>,
    #[account(seeds = [b"redemption-sources", entitlement.key().as_ref()], bump = redemption_sources.bump)]
    pub redemption_sources: Box<Account<'info, RedemptionSources>>,
    #[account(mut, seeds = [b"redemption-progress", corporate_action.key().as_ref()], bump = redemption_progress.bump)]
    pub redemption_progress: Account<'info, RedemptionProgress>,
    #[account(init, payer = corporate_action_authority, space = 8 + RedemptionReceipt::INIT_SPACE,
        seeds = [b"redemption-receipt", entitlement.key().as_ref()], bump)]
    pub redemption_receipt: Account<'info, RedemptionReceipt>,
    #[account(mut, token::mint = settlement_mint, token::authority = entitlement.settlement_wallet, token::token_program = token_2022_program)]
    pub recipient: InterfaceAccount<'info, TokenAccount>,
    pub settlement_mint: InterfaceAccount<'info, Mint>,
    #[account(mut, extensions::permanent_delegate::delegate = instrument_authority)]
    pub bond_mint: InterfaceAccount<'info, Mint>,
    /// CHECK: Fixed PDA is only used as the PermanentDelegate signer.
    #[account(seeds = [b"instrument-authority", instrument.key().as_ref()], bump = instrument.authority_bump)]
    pub instrument_authority: UncheckedAccount<'info>,
    pub token_2022_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

pub fn execute_atomic<'info>(
    mut ctx: Context<'info, ExecuteRedemption<'info>>,
    idempotency_hash: [u8; 32],
) -> Result<()> {
    require_eq!(
        ctx.accounts.instrument.version,
        1,
        ErrorCode::InvalidRedemptionExecution
    );
    execute_atomic_checked(&mut ctx, idempotency_hash, false)
}

/// Controlled sources are thawed and refrozen only around the atomic cash/burn operation.
pub fn execute_controlled_atomic<'info>(
    ctx: Context<'info, ExecuteRedemption<'info>>,
    idempotency_hash: [u8; 32],
) -> Result<()> {
    require_eq!(
        ctx.accounts.instrument.version,
        2,
        ErrorCode::InvalidRedemptionExecution
    );
    let count = ctx.accounts.redemption_sources.sources.len();
    require_eq!(
        ctx.remaining_accounts.len(),
        count * 2 + 2,
        ErrorCode::InvalidRedemptionSources
    );
    let allocations = burn_allocation(
        &ctx.accounts.redemption_sources.sources,
        ctx.accounts.entitlement.tokens_to_redeem,
    )?;
    let remaining = ctx.remaining_accounts;
    crate::controlled_registry::prepare_redemption(ctx.accounts, remaining, &allocations)?;
    let mut source_context =
        Context::new(ctx.program_id, ctx.accounts, &remaining[..count], ctx.bumps);
    execute_atomic_checked(&mut source_context, idempotency_hash, true)?;
    crate::controlled_registry::finish_redemption(source_context.accounts, remaining, &allocations)
}

fn execute_atomic_checked<'info>(
    ctx: &mut Context<'info, ExecuteRedemption<'info>>,
    idempotency_hash: [u8; 32],
    controlled: bool,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let action = &mut ctx.accounts.corporate_action;
    let entitlement = &mut ctx.accounts.entitlement;
    require!(
        is_redemption(action.action_type)
            && matches!(action.version, 1 | 2)
            && entitlement.version == action.version
            && (action.version == 1 || action.action_type == CorporateActionType::EarlyRedemption)
            && matches!(
                action.status,
                CorporateActionStatus::Approved | CorporateActionStatus::Processing
            )
            && now >= action.execute_at
            && (action.action_type != CorporateActionType::BondRedemption
                || now >= ctx.accounts.instrument.maturity_at),
        ErrorCode::InvalidRedemptionExecution
    );
    require!(idempotency_hash != [0; 32], ErrorCode::InvalidReceipt);
    require!(
        ctx.accounts.action_reserve.approved_at.is_some()
            && ctx.accounts.action_reserve.approved_by == ctx.accounts.approval_policy.approver
            && ctx.accounts.action_reserve.snapshot_hash == action.snapshot_hash
            && ctx.accounts.action_reserve.amount_minor == action.total_amount_minor,
        ErrorCode::InvalidActionReserve
    );
    require!(
        entitlement.status == EntitlementStatus::Ready
            && entitlement.executed_at.is_none()
            && entitlement.snapshot_hash == action.snapshot_hash
            && entitlement.payment_amount_minor > 0
            && entitlement.tokens_to_redeem > 0
            && entitlement.tokens_to_redeem <= entitlement.balance_at_snapshot,
        ErrorCode::InvalidRedemptionExecution
    );
    verify_source_commitment(
        &ctx.accounts.redemption_sources,
        action.key(),
        entitlement.key(),
        action.snapshot_hash,
        entitlement.balance_at_snapshot,
    )?;
    verify_progress(&ctx.accounts.redemption_progress, action, action.key())?;
    let mint_before = ctx.accounts.bond_mint.supply;
    require_current_supply(
        ctx.accounts.redemption_progress.snapshot_supply,
        ctx.accounts.redemption_progress.tokens_redeemed,
        mint_before,
    )?;
    require!(
        ctx.accounts.bond_mint.decimals == 0
            && ctx.accounts.bond_mint.mint_authority.is_none()
            && if controlled {
                ctx.accounts.bond_mint.freeze_authority
                    == Some(ctx.accounts.instrument_authority.key()).into()
            } else {
                ctx.accounts.bond_mint.freeze_authority.is_none()
            },
        ErrorCode::InvalidMint
    );
    require!(
        ctx.accounts.settlement_mint.to_account_info().data_len() == 82
            && ctx.accounts.settlement_mint.decimals == 6
            && ctx.accounts.settlement_mint.freeze_authority.is_none(),
        ErrorCode::InvalidActionReserve
    );
    let allocations = burn_allocation(
        &ctx.accounts.redemption_sources.sources,
        entitlement.tokens_to_redeem,
    )?;
    require_eq!(
        ctx.remaining_accounts.len(),
        allocations.len(),
        ErrorCode::InvalidRedemptionSources
    );
    let mut holder_before = Vec::with_capacity(allocations.len());
    for ((source, amount), account) in ctx
        .accounts
        .redemption_sources
        .sources
        .iter()
        .zip(&allocations)
        .zip(ctx.remaining_accounts)
    {
        require!(
            account.is_writable && source.token_account == account.key(),
            ErrorCode::InvalidRedemptionSources
        );
        // A zero-assignment source may be closed or recreated after capture.
        // Its immutable identity remains committed; current bytes affect no burn.
        if controlled && *amount == 0 {
            holder_before.push(0);
            continue;
        }
        require_keys_eq!(
            *account.owner,
            ctx.accounts.token_2022_program.key(),
            ErrorCode::InvalidHolderAccount
        );
        let data = account.try_borrow_data()?;
        let holder = StateWithExtensions::<SplTokenAccount>::unpack(&data)
            .map_err(|_| error!(ErrorCode::InvalidHolderAccount))?;
        require!(
            holder.base.mint == ctx.accounts.bond_mint.key()
                && holder.base.owner == source.wallet
                && holder.base.amount >= *amount,
            ErrorCode::InvalidRedemptionSources
        );
        holder_before.push(holder.base.amount);
    }
    let amount = entitlement.payment_amount_minor;
    let vault_before = ctx.accounts.reserve_vault.amount;
    let recipient_before = ctx.accounts.recipient.amount;
    let action_key = action.key();
    let reserve_seeds: &[&[u8]] = &[
        b"action-reserve",
        action_key.as_ref(),
        &[ctx.accounts.action_reserve.bump],
    ];
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_2022_program.key(),
            TransferChecked {
                from: ctx.accounts.reserve_vault.to_account_info(),
                mint: ctx.accounts.settlement_mint.to_account_info(),
                to: ctx.accounts.recipient.to_account_info(),
                authority: ctx.accounts.action_reserve.to_account_info(),
            },
            &[reserve_seeds],
        ),
        amount,
        6,
    )?;
    let instrument_key = ctx.accounts.instrument.key();
    let delegate_seeds: &[&[u8]] = &[
        b"instrument-authority",
        instrument_key.as_ref(),
        &[ctx.accounts.instrument.authority_bump],
    ];
    for (account, amount) in ctx.remaining_accounts.iter().zip(&allocations) {
        if *amount > 0 {
            token_interface::burn_checked(
                CpiContext::new_with_signer(
                    ctx.accounts.token_2022_program.key(),
                    BurnChecked {
                        mint: ctx.accounts.bond_mint.to_account_info(),
                        from: account.clone(),
                        authority: ctx.accounts.instrument_authority.to_account_info(),
                    },
                    &[delegate_seeds],
                ),
                *amount,
                0,
            )?;
        }
    }
    ctx.accounts.reserve_vault.reload()?;
    ctx.accounts.recipient.reload()?;
    ctx.accounts.bond_mint.reload()?;
    require!(
        vault_before.checked_sub(amount) == Some(ctx.accounts.reserve_vault.amount)
            && recipient_before.checked_add(amount) == Some(ctx.accounts.recipient.amount),
        ErrorCode::InvalidActionReserve
    );
    require!(
        mint_before.checked_sub(entitlement.tokens_to_redeem)
            == Some(ctx.accounts.bond_mint.supply),
        ErrorCode::StaleRedemptionSupply
    );
    for ((account, before), burned) in ctx
        .remaining_accounts
        .iter()
        .zip(holder_before)
        .zip(&allocations)
    {
        if controlled && *burned == 0 {
            require_eq!(before, 0, ErrorCode::InvalidRedemptionSources);
            continue;
        }
        let data = account.try_borrow_data()?;
        let holder = StateWithExtensions::<SplTokenAccount>::unpack(&data)
            .map_err(|_| error!(ErrorCode::InvalidHolderAccount))?;
        require!(
            before.checked_sub(*burned) == Some(holder.base.amount),
            ErrorCode::InvalidRedemptionSources
        );
    }
    entitlement.status = EntitlementStatus::Redeemed;
    entitlement.executed_at = Some(now);
    action.processed_entitlements = action
        .processed_entitlements
        .checked_add(1)
        .ok_or(ErrorCode::CalculationOverflow)?;
    require!(
        action.processed_entitlements <= action.registered_entitlements,
        ErrorCode::InvalidRedemptionExecution
    );
    let progress = &mut ctx.accounts.redemption_progress;
    progress.tokens_redeemed = progress
        .tokens_redeemed
        .checked_add(entitlement.tokens_to_redeem)
        .ok_or(ErrorCode::CalculationOverflow)?;
    progress.processed_entitlements = action.processed_entitlements;
    action.status = CorporateActionStatus::Processing;
    ctx.accounts
        .redemption_receipt
        .set_inner(RedemptionReceipt {
            version: 1,
            action: action_key,
            entitlement: entitlement.key(),
            snapshot_hash: action.snapshot_hash,
            settlement_mint: ctx.accounts.settlement_mint.key(),
            settlement_wallet: entitlement.settlement_wallet,
            amount_minor: amount,
            idempotency_hash,
            executed_at: now,
            bond_mint: ctx.accounts.bond_mint.key(),
            source_hash: ctx.accounts.redemption_sources.source_hash,
            tokens_redeemed: entitlement.tokens_to_redeem,
            mint_supply_before: mint_before,
            mint_supply_after: ctx.accounts.bond_mint.supply,
            bump: ctx.bumps.redemption_receipt,
        });
    Ok(())
}

#[derive(Accounts)]
pub struct FinalizeRedemption<'info> {
    #[account(mut)]
    pub corporate_action_authority: Signer<'info>,
    #[account(mut, constraint = instrument.corporate_action_authority == corporate_action_authority.key() @ ErrorCode::UnauthorizedCorporateActionAuthority,
        constraint = instrument.status == InstrumentStatus::Active @ ErrorCode::InvalidInstrumentStatus,
        constraint = instrument.bond_mint == bond_mint.key() @ ErrorCode::InvalidMint)]
    pub instrument: Account<'info, Instrument>,
    #[account(mut, has_one = instrument @ ErrorCode::InvalidActionInstrument,
        seeds = [b"action", instrument.key().as_ref(), corporate_action.action_id.as_ref()], bump = corporate_action.bump)]
    pub corporate_action: Account<'info, CorporateAction>,
    #[account(seeds = [b"redemption-progress", corporate_action.key().as_ref()], bump = redemption_progress.bump)]
    pub redemption_progress: Account<'info, RedemptionProgress>,
    pub bond_mint: InterfaceAccount<'info, Mint>,
    #[account(init, payer = corporate_action_authority, space = 8 + ActionReceipt::INIT_SPACE,
        seeds = [b"action-receipt", corporate_action.key().as_ref()], bump)]
    pub action_receipt: Account<'info, ActionReceipt>,
    pub system_program: Program<'info, System>,
}

pub fn finalize_redemption_receipt(
    ctx: Context<FinalizeRedemption>,
    receipt_hash: [u8; 32],
) -> Result<()> {
    let action = &mut ctx.accounts.corporate_action;
    require!(
        is_redemption(action.action_type) && action.status == CorporateActionStatus::Processing,
        ErrorCode::InvalidRedemptionExecution
    );
    require!(receipt_hash != [0; 32], ErrorCode::InvalidReceipt);
    verify_progress(&ctx.accounts.redemption_progress, action, action.key())?;
    let accounts = ctx.remaining_accounts;
    require!(
        !accounts.is_empty()
            && accounts.len() <= MAX_CALCULATION_INVESTORS
            && accounts.len() == action.investor_count as usize,
        ErrorCode::IncompleteCalculation
    );
    let mut redeemed = 0u32;
    let mut amount = 0u64;
    let mut tokens = 0u64;
    let mut balance = 0u64;
    for (index, account) in accounts.iter().enumerate() {
        require_keys_eq!(*account.owner, crate::id(), ErrorCode::InvalidEntitlement);
        require!(
            accounts[..index]
                .iter()
                .all(|previous| previous.key() != account.key()),
            ErrorCode::InvalidEntitlement
        );
        let data = account.try_borrow_data()?;
        let entitlement = Entitlement::try_deserialize(&mut &data[..])?;
        let (expected, bump) = Pubkey::find_program_address(
            &[
                b"entitlement",
                action.key().as_ref(),
                entitlement.investor_id.as_ref(),
            ],
            &crate::id(),
        );
        require!(
            expected == account.key()
                && entitlement.version == action.version
                && entitlement.bump == bump
                && entitlement.action == action.key()
                && entitlement.snapshot_hash == action.snapshot_hash,
            ErrorCode::InvalidEntitlement
        );
        balance = balance
            .checked_add(entitlement.balance_at_snapshot)
            .ok_or(ErrorCode::CalculationOverflow)?;
        match entitlement.status {
            EntitlementStatus::Redeemed => {
                require!(
                    entitlement.executed_at.is_some()
                        && entitlement.payment_amount_minor > 0
                        && entitlement.tokens_to_redeem > 0,
                    ErrorCode::InvalidReceipt
                );
                redeemed += 1;
                amount = amount
                    .checked_add(entitlement.payment_amount_minor)
                    .ok_or(ErrorCode::CalculationOverflow)?;
                tokens = tokens
                    .checked_add(entitlement.tokens_to_redeem)
                    .ok_or(ErrorCode::CalculationOverflow)?;
            }
            EntitlementStatus::NotEligible | EntitlementStatus::NotEligibleZeroRounding => {
                require!(
                    entitlement.executed_at.is_none()
                        && entitlement.payment_amount_minor == 0
                        && entitlement.tokens_to_redeem == 0,
                    ErrorCode::InvalidReceipt
                );
            }
            _ => return err!(ErrorCode::InvalidRedemptionExecution),
        }
    }
    require!(
        redeemed > 0
            && redeemed == action.processed_entitlements
            && amount == action.total_amount_minor
            && balance == action.total_balance
            && tokens == ctx.accounts.redemption_progress.tokens_redeemed,
        ErrorCode::IncompleteCalculation
    );
    if action.version == 2 {
        require!(
            action.action_type == CorporateActionType::EarlyRedemption,
            ErrorCode::InvalidRedemptionExecution
        );
        let exact_amount = tokens
            .checked_mul(
                action
                    .redemption_price_minor
                    .ok_or(ErrorCode::InvalidRedemptionParameters)?,
            )
            .ok_or(ErrorCode::CalculationOverflow)?;
        require_eq!(
            exact_amount,
            action.total_amount_minor,
            ErrorCode::IncompleteCalculation
        );
    }
    require_current_supply(action.total_balance, tokens, ctx.accounts.bond_mint.supply)?;
    if action.action_type == CorporateActionType::BondRedemption {
        require_eq!(
            ctx.accounts.bond_mint.supply,
            0,
            ErrorCode::InvalidMintSupply
        );
    }
    if ctx.accounts.bond_mint.supply == 0 {
        ctx.accounts.instrument.status = InstrumentStatus::Redeemed;
    }
    let now = Clock::get()?.unix_timestamp;
    ctx.accounts.action_receipt.set_inner(ActionReceipt {
        version: 1,
        action: action.key(),
        snapshot_hash: action.snapshot_hash,
        receipt_hash,
        total_amount_minor: amount,
        processed_entitlements: redeemed,
        finalized_at: now,
        bump: ctx.bumps.action_receipt,
    });
    action.status = CorporateActionStatus::Finalized;
    action.completed_at = Some(now);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sources() -> Vec<RedemptionSource> {
        let mut values = vec![
            RedemptionSource {
                token_account: Pubkey::new_unique(),
                wallet: Pubkey::new_unique(),
                balance_at_snapshot: 3,
            },
            RedemptionSource {
                token_account: Pubkey::new_unique(),
                wallet: Pubkey::new_unique(),
                balance_at_snapshot: 7,
            },
        ];
        values.sort_by_key(|source| source.token_account.to_string());
        values
    }
    #[test]
    fn redemption_allocation_uses_investor_floor_across_multiple_wallets() {
        let sources = sources();
        let allocated = burn_allocation(&sources, 2).unwrap();
        assert_eq!(allocated.iter().sum::<u64>(), 2);
        assert_eq!(allocated[0], 2);
        assert!(burn_allocation(&sources, 11).is_err());
        assert_eq!(
            burn_allocation(&sources, 10).unwrap().iter().sum::<u64>(),
            10
        );
    }
    #[test]
    fn immutable_sources_reject_duplicate_wrong_balance_empty_or_changed_identity() {
        let sources = sources();
        validate_sources(&sources, 10).unwrap();
        assert!(validate_sources(&sources, 9).is_err());
        assert!(validate_sources(&[], 0).is_err());
        assert!(validate_sources(&[sources[0].clone(), sources[0].clone()], 6).is_err());
        let action = Pubkey::new_unique();
        let entitlement = Pubkey::new_unique();
        let commitment = source_hash(action, entitlement, [1; 32], &sources).unwrap();
        assert_ne!(
            commitment,
            source_hash(action, entitlement, [2; 32], &sources).unwrap()
        );
        let mut changed = sources.clone();
        changed[0].wallet = Pubkey::new_unique();
        assert_ne!(
            commitment,
            source_hash(action, entitlement, [1; 32], &changed).unwrap()
        );
        changed = sources.clone();
        changed[0].balance_at_snapshot += 1;
        assert_ne!(
            commitment,
            source_hash(action, entitlement, [1; 32], &changed).unwrap()
        );
    }
    #[test]
    fn new_accounts_preserve_exact_client_layout_sizes() {
        assert_eq!(8 + RedemptionReceipt::INIT_SPACE, 306);
        assert_eq!(8 + RedemptionProgress::INIT_SPACE, 94);
        assert_eq!(8 + RedemptionSources::INIT_SPACE, 718);
    }
    #[test]
    fn source_hash_matches_the_typescript_wire_vector() {
        let sources = vec![RedemptionSource {
            token_account: Pubkey::new_from_array([4; 32]),
            wallet: Pubkey::new_from_array([5; 32]),
            balance_at_snapshot: 10,
        }];
        assert_eq!(
            source_hash(
                Pubkey::new_from_array([1; 32]),
                Pubkey::new_from_array([2; 32]),
                [3; 32],
                &sources
            )
            .unwrap(),
            [
                234, 22, 233, 37, 234, 149, 98, 155, 25, 153, 151, 123, 14, 138, 160, 43, 82, 240,
                193, 30, 8, 21, 110, 45, 42, 201, 94, 134, 131, 163, 241, 55
            ]
        );
    }
    #[test]
    fn stale_overlapping_actions_and_supply_underflow_are_rejected() {
        require_current_supply(35, 0, 35).unwrap();
        require_current_supply(35, 7, 28).unwrap();
        require_current_supply(28, 28, 0).unwrap();
        assert!(require_current_supply(35, 0, 28).is_err());
        assert!(require_current_supply(35, 7, 27).is_err());
        assert!(require_current_supply(35, 36, 0).is_err());
    }
    #[test]
    fn source_account_cannot_be_rebound_to_another_action_investor_or_snapshot() {
        let action = Pubkey::new_unique();
        let entitlement = Pubkey::new_unique();
        let sources = sources();
        let account = RedemptionSources {
            version: 1,
            action,
            entitlement,
            snapshot_hash: [1; 32],
            source_hash: source_hash(action, entitlement, [1; 32], &sources).unwrap(),
            sources,
            bump: 255,
        };
        verify_source_commitment(&account, action, entitlement, [1; 32], 10).unwrap();
        assert!(
            verify_source_commitment(&account, Pubkey::new_unique(), entitlement, [1; 32], 10)
                .is_err()
        );
        assert!(
            verify_source_commitment(&account, action, Pubkey::new_unique(), [1; 32], 10).is_err()
        );
        assert!(verify_source_commitment(&account, action, entitlement, [2; 32], 10).is_err());
        assert!(verify_source_commitment(&account, action, entitlement, [1; 32], 9).is_err());
    }
}
