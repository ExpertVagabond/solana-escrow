use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{close_account, transfer_checked, CloseAccount, Mint, Token, TokenAccount, TransferChecked},
};

declare_id!("FKz12mj5HcA9wJRTmpEN2mstdat7KVrwJyy1QULaVi4J");

#[program]
pub mod solana_escrow {
    use super::*;

    pub fn create_escrow(ctx: Context<CreateEscrow>, escrow_seed: u64, amount_a: u64, amount_b: u64, optional_taker: Option<Pubkey>) -> Result<()> {
        require!(amount_a > 0, EscrowError::InvalidAmount);
        require!(amount_b > 0, EscrowError::InvalidAmount);

        let escrow = &mut ctx.accounts.escrow;
        escrow.maker = ctx.accounts.maker.key();
        escrow.taker = optional_taker;
        escrow.mint_a = ctx.accounts.mint_a.key();
        escrow.mint_b = ctx.accounts.mint_b.key();
        escrow.amount_a = amount_a;
        escrow.amount_b = amount_b;
        escrow.seed = escrow_seed;
        escrow.bump = ctx.bumps.escrow;
        escrow.vault_bump = ctx.bumps.vault;

        transfer_checked(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), TransferChecked {
                from: ctx.accounts.maker_ata_a.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.maker.to_account_info(),
                mint: ctx.accounts.mint_a.to_account_info(),
            }),
            amount_a, ctx.accounts.mint_a.decimals,
        )?;

        emit!(EscrowCreated {
            maker: ctx.accounts.maker.key(),
            taker: optional_taker,
            mint_a: ctx.accounts.mint_a.key(),
            mint_b: ctx.accounts.mint_b.key(),
            amount_a,
            amount_b,
            seed: escrow_seed,
            escrow: ctx.accounts.escrow.key(),
        });

        Ok(())
    }

    pub fn accept_escrow(ctx: Context<AcceptEscrow>) -> Result<()> {
        let escrow = &ctx.accounts.escrow;
        if let Some(expected) = escrow.taker {
            require_keys_eq!(ctx.accounts.taker.key(), expected, EscrowError::UnauthorizedTaker);
        }

        transfer_checked(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), TransferChecked {
                from: ctx.accounts.taker_ata_b.to_account_info(),
                to: ctx.accounts.maker_ata_b.to_account_info(),
                authority: ctx.accounts.taker.to_account_info(),
                mint: ctx.accounts.mint_b.to_account_info(),
            }),
            escrow.amount_b, ctx.accounts.mint_b.decimals,
        )?;

        let maker_key = escrow.maker;
        let seed_bytes = escrow.seed.to_le_bytes();
        let bump = [escrow.bump];
        let seeds: &[&[&[u8]]] = &[&[b"escrow", maker_key.as_ref(), seed_bytes.as_ref(), &bump]];

        transfer_checked(
            CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), TransferChecked {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.taker_ata_a.to_account_info(),
                authority: ctx.accounts.escrow.to_account_info(),
                mint: ctx.accounts.mint_a.to_account_info(),
            }, seeds),
            escrow.amount_a, ctx.accounts.mint_a.decimals,
        )?;

        close_account(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), CloseAccount {
            account: ctx.accounts.vault.to_account_info(),
            destination: ctx.accounts.maker.to_account_info(),
            authority: ctx.accounts.escrow.to_account_info(),
        }, seeds))?;

        emit!(EscrowAccepted {
            escrow: ctx.accounts.escrow.key(),
            maker: escrow.maker,
            taker: ctx.accounts.taker.key(),
            amount_a: escrow.amount_a,
            amount_b: escrow.amount_b,
        });

        Ok(())
    }

    pub fn cancel_escrow(ctx: Context<CancelEscrow>) -> Result<()> {
        let escrow = &ctx.accounts.escrow;
        let maker_key = escrow.maker;
        let seed_bytes = escrow.seed.to_le_bytes();
        let bump = [escrow.bump];
        let seeds: &[&[&[u8]]] = &[&[b"escrow", maker_key.as_ref(), seed_bytes.as_ref(), &bump]];

        transfer_checked(
            CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), TransferChecked {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.maker_ata_a.to_account_info(),
                authority: ctx.accounts.escrow.to_account_info(),
                mint: ctx.accounts.mint_a.to_account_info(),
            }, seeds),
            escrow.amount_a, ctx.accounts.mint_a.decimals,
        )?;

        close_account(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), CloseAccount {
            account: ctx.accounts.vault.to_account_info(),
            destination: ctx.accounts.maker.to_account_info(),
            authority: ctx.accounts.escrow.to_account_info(),
        }, seeds))?;

        emit!(EscrowCancelled {
            escrow: ctx.accounts.escrow.key(),
            maker: escrow.maker,
            amount_a: escrow.amount_a,
        });

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(escrow_seed: u64)]
pub struct CreateEscrow<'info> {
    #[account(mut)]
    pub maker: Signer<'info>,
    pub mint_a: Account<'info, Mint>,
    pub mint_b: Account<'info, Mint>,
    #[account(mut, associated_token::mint = mint_a, associated_token::authority = maker)]
    pub maker_ata_a: Account<'info, TokenAccount>,
    #[account(init, payer = maker, space = 8 + Escrow::INIT_SPACE,
        seeds = [b"escrow", maker.key().as_ref(), escrow_seed.to_le_bytes().as_ref()], bump)]
    pub escrow: Account<'info, Escrow>,
    #[account(init, payer = maker, token::mint = mint_a, token::authority = escrow,
        seeds = [b"vault", escrow.key().as_ref()], bump)]
    pub vault: Account<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
pub struct AcceptEscrow<'info> {
    #[account(mut)]
    pub taker: Signer<'info>,
    /// CHECK: validated via escrow.maker
    #[account(mut, address = escrow.maker)]
    pub maker: AccountInfo<'info>,
    pub mint_a: Account<'info, Mint>,
    pub mint_b: Account<'info, Mint>,
    #[account(init_if_needed, payer = taker, associated_token::mint = mint_a, associated_token::authority = taker)]
    pub taker_ata_a: Account<'info, TokenAccount>,
    #[account(mut, associated_token::mint = mint_b, associated_token::authority = taker)]
    pub taker_ata_b: Account<'info, TokenAccount>,
    #[account(init_if_needed, payer = taker, associated_token::mint = mint_b, associated_token::authority = maker)]
    pub maker_ata_b: Account<'info, TokenAccount>,
    #[account(mut, close = maker, has_one = maker, has_one = mint_a, has_one = mint_b,
        seeds = [b"escrow", maker.key().as_ref(), escrow.seed.to_le_bytes().as_ref()], bump = escrow.bump)]
    pub escrow: Account<'info, Escrow>,
    #[account(mut, token::mint = mint_a, token::authority = escrow,
        seeds = [b"vault", escrow.key().as_ref()], bump = escrow.vault_bump)]
    pub vault: Account<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
pub struct CancelEscrow<'info> {
    #[account(mut)]
    pub maker: Signer<'info>,
    pub mint_a: Account<'info, Mint>,
    #[account(mut, associated_token::mint = mint_a, associated_token::authority = maker)]
    pub maker_ata_a: Account<'info, TokenAccount>,
    #[account(mut, close = maker, has_one = maker, has_one = mint_a,
        seeds = [b"escrow", maker.key().as_ref(), escrow.seed.to_le_bytes().as_ref()], bump = escrow.bump)]
    pub escrow: Account<'info, Escrow>,
    #[account(mut, token::mint = mint_a, token::authority = escrow,
        seeds = [b"vault", escrow.key().as_ref()], bump = escrow.vault_bump)]
    pub vault: Account<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[account]
#[derive(InitSpace)]
pub struct Escrow {
    pub maker: Pubkey,
    pub taker: Option<Pubkey>,
    pub mint_a: Pubkey,
    pub mint_b: Pubkey,
    pub amount_a: u64,
    pub amount_b: u64,
    pub seed: u64,
    pub bump: u8,
    pub vault_bump: u8,
}

#[error_code]
pub enum EscrowError {
    #[msg("Amount must be greater than zero")]
    InvalidAmount,
    #[msg("Only the designated taker can accept this escrow")]
    UnauthorizedTaker,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[event]
pub struct EscrowCreated {
    pub maker: Pubkey,
    pub taker: Option<Pubkey>,
    pub mint_a: Pubkey,
    pub mint_b: Pubkey,
    pub amount_a: u64,
    pub amount_b: u64,
    pub seed: u64,
    pub escrow: Pubkey,
}

#[event]
pub struct EscrowAccepted {
    pub escrow: Pubkey,
    pub maker: Pubkey,
    pub taker: Pubkey,
    pub amount_a: u64,
    pub amount_b: u64,
}

#[event]
pub struct EscrowCancelled {
    pub escrow: Pubkey,
    pub maker: Pubkey,
    pub amount_a: u64,
}
