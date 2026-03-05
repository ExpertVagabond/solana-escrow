# solana-escrow

Two-party on-chain SPL token escrow with optional taker restriction on Solana.

![Rust](https://img.shields.io/badge/Rust-000000?logo=rust) ![Solana](https://img.shields.io/badge/Solana-9945FF?logo=solana&logoColor=white) ![Anchor](https://img.shields.io/badge/Anchor-blue) ![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

## Overview

A Solana Anchor program for trustless two-party token swaps. A maker deposits Token A into a PDA-owned vault and specifies how much of Token B they want in return. Any taker (or a designated taker) can fulfill the escrow by providing Token B, which atomically releases Token A. The maker can cancel at any time to reclaim their deposit. Uses `transfer_checked` for decimal-safe CPI transfers.

## Program Instructions

| Instruction | Description | Key Accounts |
|---|---|---|
| `create_escrow` | Maker deposits Token A and defines swap terms (amounts, optional taker lock) | `maker` (signer), `mint_a`, `mint_b`, `maker_ata_a`, `escrow` (PDA), `vault` (PDA) |
| `accept_escrow` | Taker sends Token B to maker and receives Token A from vault; vault is closed | `taker` (signer), `maker`, `mint_a`, `mint_b`, `taker_ata_a`, `taker_ata_b`, `maker_ata_b`, `escrow`, `vault` |
| `cancel_escrow` | Maker reclaims Token A from vault; escrow and vault accounts are closed | `maker` (signer), `mint_a`, `maker_ata_a`, `escrow`, `vault` |

## Account Structures

### Escrow

| Field | Type | Description |
|---|---|---|
| `maker` | `Pubkey` | Escrow creator |
| `taker` | `Option<Pubkey>` | Optional designated taker (open to anyone if `None`) |
| `mint_a` | `Pubkey` | Token the maker deposits |
| `mint_b` | `Pubkey` | Token the maker wants in return |
| `amount_a` | `u64` | Amount of Token A deposited |
| `amount_b` | `u64` | Amount of Token B required from taker |
| `seed` | `u64` | Unique seed allowing multiple escrows per maker |
| `bump` | `u8` | PDA bump seed |
| `vault_bump` | `u8` | Vault PDA bump seed |

## PDA Seeds

- **Escrow:** `["escrow", maker, seed_bytes]`
- **Vault:** `["vault", escrow]`

## Error Codes

| Error | Description |
|---|---|
| `InvalidAmount` | Amounts must be greater than zero |
| `UnauthorizedTaker` | Only the designated taker can accept |

## Build & Test

```bash
anchor build
anchor test
```

## Deploy

```bash
solana config set --url devnet
anchor deploy
```

## License

[MIT](LICENSE)
