use crate::{
    ActionReserve, ApprovalPolicy, CorporateAction, CorporateActionStatus, CorporateActionType,
    Entitlement, EntitlementStatus, ErrorCode, Instrument, InstrumentStatus,
    MAX_CALCULATION_INVESTORS,
};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, Token2022, TokenAccount, TransferChecked};

#[account]
#[derive(InitSpace)]
pub struct EntitlementReceipt {
    pub version: u8,
    pub action: Pubkey,
    pub entitlement: Pubkey,
    pub snapshot_hash: [u8; 32],
    pub settlement_mint: Pubkey,
    pub settlement_wallet: Pubkey,
    pub amount_minor: u64,
    pub idempotency_hash: [u8; 32],
    pub executed_at: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct ActionReceipt {
    pub version: u8,
    pub action: Pubkey,
    pub snapshot_hash: [u8; 32],
    pub receipt_hash: [u8; 32],
    pub total_amount_minor: u64,
    pub processed_entitlements: u32,
    pub finalized_at: i64,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct ExecuteCoupon<'info> {
    #[account(mut)]
    pub corporate_action_authority: Signer<'info>,
    #[account(constraint = instrument.corporate_action_authority == corporate_action_authority.key()
        @ ErrorCode::UnauthorizedCorporateActionAuthority,
        constraint = instrument.status == InstrumentStatus::Active @ ErrorCode::InvalidInstrumentStatus,
        constraint = instrument.settlement_mint == settlement_mint.key() @ ErrorCode::InvalidMint)]
    pub instrument: Box<Account<'info, Instrument>>,
    #[account(has_one = instrument, seeds = [b"approval-policy", instrument.key().as_ref()], bump = approval_policy.bump)]
    pub approval_policy: Account<'info, ApprovalPolicy>,
    #[account(mut, has_one = instrument @ ErrorCode::InvalidActionInstrument,
        seeds = [b"action", instrument.key().as_ref(), corporate_action.action_id.as_ref()], bump = corporate_action.bump)]
    pub corporate_action: Box<Account<'info, CorporateAction>>,
    #[account(seeds = [b"action-reserve", corporate_action.key().as_ref()], bump = action_reserve.bump,
        constraint = action_reserve.action == corporate_action.key() @ ErrorCode::InvalidActionReserve,
        constraint = action_reserve.settlement_mint == settlement_mint.key() @ ErrorCode::InvalidActionReserve)]
    pub action_reserve: Account<'info, ActionReserve>,
    #[account(mut, seeds = [b"action-vault", corporate_action.key().as_ref()], bump,
        token::mint = settlement_mint, token::authority = action_reserve, token::token_program = token_2022_program)]
    pub reserve_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, seeds = [b"entitlement", corporate_action.key().as_ref(), entitlement.investor_id.as_ref()], bump = entitlement.bump,
        constraint = entitlement.action == corporate_action.key() @ ErrorCode::InvalidEntitlement)]
    pub entitlement: Box<Account<'info, Entitlement>>,
    #[account(init, payer = corporate_action_authority, space = 8 + EntitlementReceipt::INIT_SPACE,
        seeds = [b"entitlement-receipt", entitlement.key().as_ref()], bump)]
    pub entitlement_receipt: Account<'info, EntitlementReceipt>,
    #[account(mut, token::mint = settlement_mint, token::authority = entitlement.settlement_wallet,
        token::token_program = token_2022_program)]
    pub recipient: InterfaceAccount<'info, TokenAccount>,
    pub settlement_mint: InterfaceAccount<'info, Mint>,
    pub token_2022_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

pub fn execute(ctx: Context<ExecuteCoupon>, idempotency_hash: [u8; 32]) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let action = &mut ctx.accounts.corporate_action;
    let entitlement = &mut ctx.accounts.entitlement;
    require!(
        action.action_type == CorporateActionType::CouponPayment
            && matches!(
                action.status,
                CorporateActionStatus::Approved | CorporateActionStatus::Processing
            )
            && now >= action.execute_at,
        ErrorCode::InvalidCouponExecution
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
            && entitlement.tokens_to_redeem == 0,
        ErrorCode::InvalidCouponExecution
    );
    // Restrict settlement to the plain mint supported by the reviewed custody model.
    require!(
        ctx.accounts.settlement_mint.to_account_info().data_len() == 82
            && ctx.accounts.settlement_mint.decimals == 6
            && ctx.accounts.settlement_mint.freeze_authority.is_none(),
        ErrorCode::InvalidActionReserve
    );
    let amount = entitlement.payment_amount_minor;
    let vault_before = ctx.accounts.reserve_vault.amount;
    let recipient_before = ctx.accounts.recipient.amount;
    let action_key = action.key();
    let seeds: &[&[u8]] = &[
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
            &[seeds],
        ),
        amount,
        6,
    )?;
    ctx.accounts.reserve_vault.reload()?;
    ctx.accounts.recipient.reload()?;
    require!(
        vault_before.checked_sub(amount) == Some(ctx.accounts.reserve_vault.amount)
            && recipient_before.checked_add(amount) == Some(ctx.accounts.recipient.amount),
        ErrorCode::InvalidActionReserve
    );
    entitlement.status = EntitlementStatus::Paid;
    entitlement.executed_at = Some(now);
    action.processed_entitlements = action
        .processed_entitlements
        .checked_add(1)
        .ok_or(ErrorCode::CalculationOverflow)?;
    require!(
        action.processed_entitlements <= action.registered_entitlements,
        ErrorCode::InvalidCouponExecution
    );
    action.status = CorporateActionStatus::Processing;
    ctx.accounts
        .entitlement_receipt
        .set_inner(EntitlementReceipt {
            version: 1,
            action: action_key,
            entitlement: entitlement.key(),
            snapshot_hash: action.snapshot_hash,
            settlement_mint: ctx.accounts.settlement_mint.key(),
            settlement_wallet: entitlement.settlement_wallet,
            amount_minor: amount,
            idempotency_hash,
            executed_at: now,
            bump: ctx.bumps.entitlement_receipt,
        });
    Ok(())
}

#[derive(Accounts)]
pub struct FinalizeCoupon<'info> {
    #[account(mut)]
    pub corporate_action_authority: Signer<'info>,
    #[account(constraint = instrument.corporate_action_authority == corporate_action_authority.key()
        @ ErrorCode::UnauthorizedCorporateActionAuthority)]
    pub instrument: Account<'info, Instrument>,
    #[account(mut, has_one = instrument @ ErrorCode::InvalidActionInstrument,
        seeds = [b"action", instrument.key().as_ref(), corporate_action.action_id.as_ref()], bump = corporate_action.bump)]
    pub corporate_action: Account<'info, CorporateAction>,
    #[account(init, payer = corporate_action_authority, space = 8 + ActionReceipt::INIT_SPACE,
        seeds = [b"action-receipt", corporate_action.key().as_ref()], bump)]
    pub action_receipt: Account<'info, ActionReceipt>,
    pub system_program: Program<'info, System>,
}

pub fn finalize_coupon_receipt(ctx: Context<FinalizeCoupon>, receipt_hash: [u8; 32]) -> Result<()> {
    let action = &mut ctx.accounts.corporate_action;
    require!(
        action.action_type == CorporateActionType::CouponPayment
            && action.status == CorporateActionStatus::Processing,
        ErrorCode::InvalidCouponExecution
    );
    require!(receipt_hash != [0; 32], ErrorCode::InvalidReceipt);
    let accounts = ctx.remaining_accounts;
    require!(
        !accounts.is_empty()
            && accounts.len() <= MAX_CALCULATION_INVESTORS
            && accounts.len() == action.investor_count as usize,
        ErrorCode::IncompleteCalculation
    );
    let mut paid = 0u32;
    let mut amount = 0u64;
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
        require_keys_eq!(expected, account.key(), ErrorCode::InvalidEntitlement);
        require!(
            entitlement.version == 1
                && entitlement.bump == bump
                && entitlement.action == action.key()
                && entitlement.snapshot_hash == action.snapshot_hash
                && entitlement.tokens_to_redeem == 0,
            ErrorCode::InvalidEntitlement
        );
        match entitlement.status {
            EntitlementStatus::Paid => {
                require!(
                    entitlement.executed_at.is_some() && entitlement.payment_amount_minor > 0,
                    ErrorCode::InvalidReceipt
                );
                paid += 1;
                amount = amount
                    .checked_add(entitlement.payment_amount_minor)
                    .ok_or(ErrorCode::CalculationOverflow)?;
            }
            EntitlementStatus::NotEligible | EntitlementStatus::NotEligibleZeroRounding => {
                require!(
                    entitlement.executed_at.is_none() && entitlement.payment_amount_minor == 0,
                    ErrorCode::InvalidReceipt
                );
            }
            _ => return err!(ErrorCode::InvalidCouponExecution),
        }
    }
    require!(
        paid > 0 && paid == action.processed_entitlements && amount == action.total_amount_minor,
        ErrorCode::IncompleteCalculation
    );
    let now = Clock::get()?.unix_timestamp;
    ctx.accounts.action_receipt.set_inner(ActionReceipt {
        version: 1,
        action: action.key(),
        snapshot_hash: action.snapshot_hash,
        receipt_hash,
        total_amount_minor: amount,
        processed_entitlements: paid,
        finalized_at: now,
        bump: ctx.bumps.action_receipt,
    });
    action.status = CorporateActionStatus::Finalized;
    action.completed_at = Some(now);
    Ok(())
}
