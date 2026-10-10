use crate::{
    CorporateAction, CorporateActionStatus, CorporateActionType, ErrorCode, Instrument,
    InstrumentStatus,
};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, CloseAccount, Mint, Token2022, TokenAccount, TransferChecked,
};

#[account]
#[derive(InitSpace)]
pub struct ApprovalPolicy {
    pub version: u8,
    pub instrument: Pubkey,
    pub approver: Pubkey,
    pub network_reserve_lamports: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct ActionReserve {
    pub version: u8,
    pub action: Pubkey,
    pub refund_authority: Pubkey,
    pub settlement_mint: Pubkey,
    pub snapshot_hash: [u8; 32],
    pub amount_minor: u64,
    pub approved_by: Pubkey,
    pub approved_at: Option<i64>,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct AssignApprover<'info> {
    #[account(mut)]
    pub issuer: Signer<'info>,
    #[account(constraint = instrument.issuer_authority == issuer.key() @ ErrorCode::UnauthorizedIssuer,
        constraint = instrument.status == InstrumentStatus::Active @ ErrorCode::InvalidInstrumentStatus)]
    pub instrument: Account<'info, Instrument>,
    #[account(init, payer = issuer, space = 8 + ApprovalPolicy::INIT_SPACE,
        seeds = [b"approval-policy", instrument.key().as_ref()], bump)]
    pub approval_policy: Account<'info, ApprovalPolicy>,
    pub system_program: Program<'info, System>,
}

pub fn assign(
    ctx: Context<AssignApprover>,
    approver: Pubkey,
    network_reserve_lamports: u64,
) -> Result<()> {
    require_keys_neq!(approver, Pubkey::default(), ErrorCode::InvalidApprover);
    require_keys_neq!(
        approver,
        ctx.accounts.instrument.issuer_authority,
        ErrorCode::InvalidApprover
    );
    require_keys_neq!(
        approver,
        ctx.accounts.instrument.corporate_action_authority,
        ErrorCode::InvalidApprover
    );
    require!(
        network_reserve_lamports >= 5_000_000,
        ErrorCode::InvalidApprovalBudget
    );
    ctx.accounts.approval_policy.set_inner(ApprovalPolicy {
        version: 1,
        instrument: ctx.accounts.instrument.key(),
        approver,
        network_reserve_lamports,
        bump: ctx.bumps.approval_policy,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct FundActionReserve<'info> {
    #[account(mut)]
    pub issuer: Signer<'info>,
    #[account(constraint = instrument.issuer_authority == issuer.key() @ ErrorCode::UnauthorizedIssuer,
        constraint = instrument.status == InstrumentStatus::Active @ ErrorCode::InvalidInstrumentStatus,
        constraint = instrument.settlement_mint == settlement_mint.key() @ ErrorCode::InvalidMint)]
    pub instrument: Account<'info, Instrument>,
    #[account(has_one = instrument, seeds = [b"approval-policy", instrument.key().as_ref()], bump = approval_policy.bump)]
    pub approval_policy: Account<'info, ApprovalPolicy>,
    #[account(mut, has_one = instrument @ ErrorCode::InvalidActionInstrument,
        seeds = [b"action", instrument.key().as_ref(), corporate_action.action_id.as_ref()], bump = corporate_action.bump)]
    pub corporate_action: Account<'info, CorporateAction>,
    #[account(init, payer = issuer, space = 8 + ActionReserve::INIT_SPACE,
        seeds = [b"action-reserve", corporate_action.key().as_ref()], bump)]
    pub action_reserve: Account<'info, ActionReserve>,
    #[account(init, payer = issuer, seeds = [b"action-vault", corporate_action.key().as_ref()], bump,
        token::mint = settlement_mint, token::authority = action_reserve, token::token_program = token_2022_program)]
    pub reserve_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = settlement_mint, token::authority = issuer, token::token_program = token_2022_program)]
    pub issuer_treasury: InterfaceAccount<'info, TokenAccount>,
    pub settlement_mint: InterfaceAccount<'info, Mint>,
    pub token_2022_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

fn require_calculation(
    action: &CorporateAction,
    hash: [u8; 32],
    amount: u64,
    status: CorporateActionStatus,
) -> Result<()> {
    require!(action.status == status, ErrorCode::InvalidActionStatus);
    require!(
        action.action_type == CorporateActionType::CouponPayment,
        ErrorCode::InvalidActionStatus
    );
    require!(
        hash != [0; 32]
            && hash == action.snapshot_hash
            && amount > 0
            && amount == action.total_amount_minor,
        ErrorCode::InvalidActionReserve
    );
    require!(
        action.investor_count > 0
            && action.registered_entitlements == action.investor_count
            && action.processed_entitlements == 0,
        ErrorCode::IncompleteCalculation
    );
    Ok(())
}

fn require_plain_mint(mint: &InterfaceAccount<Mint>, token_program: Pubkey) -> Result<()> {
    require_keys_eq!(
        *mint.to_account_info().owner,
        token_program,
        ErrorCode::InvalidTokenProgram
    );
    // Extensions/delegates/transfer fees could make the reserved amount withdrawable or inexact.
    require!(
        mint.to_account_info().data_len() == 82
            && mint.decimals == 6
            && mint.freeze_authority.is_none(),
        ErrorCode::InvalidActionReserve
    );
    Ok(())
}

pub fn fund(
    ctx: Context<FundActionReserve>,
    snapshot_hash: [u8; 32],
    amount_minor: u64,
) -> Result<()> {
    require_calculation(
        &ctx.accounts.corporate_action,
        snapshot_hash,
        amount_minor,
        CorporateActionStatus::UnderReview,
    )?;
    require_plain_mint(
        &ctx.accounts.settlement_mint,
        ctx.accounts.token_2022_program.key(),
    )?;
    require!(
        ctx.accounts.issuer.get_lamports() >= ctx.accounts.approval_policy.network_reserve_lamports,
        ErrorCode::InvalidApprovalBudget
    );
    token_interface::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_2022_program.key(),
            TransferChecked {
                from: ctx.accounts.issuer_treasury.to_account_info(),
                mint: ctx.accounts.settlement_mint.to_account_info(),
                to: ctx.accounts.reserve_vault.to_account_info(),
                authority: ctx.accounts.issuer.to_account_info(),
            },
        ),
        amount_minor,
        6,
    )?;
    ctx.accounts.reserve_vault.reload()?;
    require_eq!(
        ctx.accounts.reserve_vault.amount,
        amount_minor,
        ErrorCode::InvalidActionReserve
    );
    ctx.accounts.action_reserve.set_inner(ActionReserve {
        version: 1,
        action: ctx.accounts.corporate_action.key(),
        refund_authority: ctx.accounts.issuer.key(),
        settlement_mint: ctx.accounts.settlement_mint.key(),
        snapshot_hash,
        amount_minor,
        approved_by: Pubkey::default(),
        approved_at: None,
        bump: ctx.bumps.action_reserve,
    });
    // A funded action cannot be reset while its vault still holds committed funds.
    ctx.accounts.corporate_action.status = CorporateActionStatus::Reserved;
    Ok(())
}

#[derive(Accounts)]
pub struct ApproveAction<'info> {
    pub approver: Signer<'info>,
    #[account(constraint = instrument.status == InstrumentStatus::Active @ ErrorCode::InvalidInstrumentStatus)]
    pub instrument: Account<'info, Instrument>,
    #[account(has_one = instrument, seeds = [b"approval-policy", instrument.key().as_ref()], bump = approval_policy.bump,
        constraint = approval_policy.approver == approver.key() @ ErrorCode::UnauthorizedApprover)]
    pub approval_policy: Account<'info, ApprovalPolicy>,
    #[account(mut, has_one = instrument @ ErrorCode::InvalidActionInstrument,
        seeds = [b"action", instrument.key().as_ref(), corporate_action.action_id.as_ref()], bump = corporate_action.bump)]
    pub corporate_action: Account<'info, CorporateAction>,
    #[account(mut, seeds = [b"action-reserve", corporate_action.key().as_ref()], bump = action_reserve.bump,
        constraint = action_reserve.action == corporate_action.key() @ ErrorCode::InvalidActionReserve,
        constraint = action_reserve.settlement_mint == instrument.settlement_mint @ ErrorCode::InvalidActionReserve)]
    pub action_reserve: Account<'info, ActionReserve>,
    #[account(seeds = [b"action-vault", corporate_action.key().as_ref()], bump,
        token::mint = action_reserve.settlement_mint, token::authority = action_reserve, token::token_program = token_2022_program)]
    pub reserve_vault: InterfaceAccount<'info, TokenAccount>,
    pub token_2022_program: Program<'info, Token2022>,
}

pub fn approve(
    ctx: Context<ApproveAction>,
    snapshot_hash: [u8; 32],
    amount_minor: u64,
) -> Result<()> {
    require_calculation(
        &ctx.accounts.corporate_action,
        snapshot_hash,
        amount_minor,
        CorporateActionStatus::Reserved,
    )?;
    require!(
        ctx.accounts.action_reserve.snapshot_hash == snapshot_hash
            && ctx.accounts.action_reserve.amount_minor == amount_minor
            && ctx.accounts.action_reserve.approved_at.is_none(),
        ErrorCode::InvalidActionReserve
    );
    require!(
        ctx.accounts.reserve_vault.amount >= amount_minor,
        ErrorCode::InvalidActionReserve
    );
    require!(
        ctx.accounts.approver.get_lamports()
            >= ctx.accounts.approval_policy.network_reserve_lamports,
        ErrorCode::InvalidApprovalBudget
    );
    ctx.accounts.action_reserve.approved_by = ctx.accounts.approver.key();
    ctx.accounts.action_reserve.approved_at = Some(Clock::get()?.unix_timestamp);
    ctx.accounts.corporate_action.status = CorporateActionStatus::Approved;
    Ok(())
}

#[derive(Accounts)]
pub struct ReleaseActionReserve<'info> {
    #[account(mut)]
    pub issuer: Signer<'info>,
    #[account(constraint = instrument.issuer_authority == issuer.key() @ ErrorCode::UnauthorizedIssuer,
        constraint = instrument.settlement_mint == settlement_mint.key() @ ErrorCode::InvalidMint)]
    pub instrument: Account<'info, Instrument>,
    #[account(mut, has_one = instrument @ ErrorCode::InvalidActionInstrument,
        seeds = [b"action", instrument.key().as_ref(), corporate_action.action_id.as_ref()], bump = corporate_action.bump)]
    pub corporate_action: Account<'info, CorporateAction>,
    #[account(mut, close = issuer, seeds = [b"action-reserve", corporate_action.key().as_ref()], bump = action_reserve.bump,
        constraint = action_reserve.action == corporate_action.key() && action_reserve.refund_authority == issuer.key()
            @ ErrorCode::InvalidActionReserve)]
    pub action_reserve: Account<'info, ActionReserve>,
    #[account(mut, seeds = [b"action-vault", corporate_action.key().as_ref()], bump,
        token::mint = settlement_mint, token::authority = action_reserve, token::token_program = token_2022_program)]
    pub reserve_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = settlement_mint, token::authority = issuer, token::token_program = token_2022_program)]
    pub issuer_treasury: InterfaceAccount<'info, TokenAccount>,
    pub settlement_mint: InterfaceAccount<'info, Mint>,
    pub token_2022_program: Program<'info, Token2022>,
}

pub fn release(
    ctx: Context<ReleaseActionReserve>,
    snapshot_hash: [u8; 32],
    amount_minor: u64,
) -> Result<()> {
    require_calculation(
        &ctx.accounts.corporate_action,
        snapshot_hash,
        amount_minor,
        CorporateActionStatus::Reserved,
    )?;
    require!(
        ctx.accounts.action_reserve.approved_at.is_none()
            && ctx.accounts.action_reserve.snapshot_hash == snapshot_hash
            && ctx.accounts.action_reserve.amount_minor == amount_minor,
        ErrorCode::InvalidActionReserve
    );
    require_plain_mint(
        &ctx.accounts.settlement_mint,
        ctx.accounts.token_2022_program.key(),
    )?;
    let action_key = ctx.accounts.corporate_action.key();
    let seeds: &[&[u8]] = &[
        b"action-reserve",
        action_key.as_ref(),
        &[ctx.accounts.action_reserve.bump],
    ];
    let signer = &[seeds];
    // Return the entire balance, including unsolicited deposits, before closing the token account.
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_2022_program.key(),
            TransferChecked {
                from: ctx.accounts.reserve_vault.to_account_info(),
                mint: ctx.accounts.settlement_mint.to_account_info(),
                to: ctx.accounts.issuer_treasury.to_account_info(),
                authority: ctx.accounts.action_reserve.to_account_info(),
            },
            signer,
        ),
        ctx.accounts.reserve_vault.amount,
        6,
    )?;
    token_interface::close_account(CpiContext::new_with_signer(
        ctx.accounts.token_2022_program.key(),
        CloseAccount {
            account: ctx.accounts.reserve_vault.to_account_info(),
            destination: ctx.accounts.issuer.to_account_info(),
            authority: ctx.accounts.action_reserve.to_account_info(),
        },
        signer,
    ))?;
    ctx.accounts.corporate_action.status = CorporateActionStatus::UnderReview;
    Ok(())
}
