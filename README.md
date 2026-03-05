# solana-escrow

Trustless two-party token escrow. Maker deposits tokens, taker exchanges — fully atomic, no intermediary needed.

![Rust](https://img.shields.io/badge/Rust-000000?logo=rust&logoColor=white)
![Solana](https://img.shields.io/badge/Solana-9945FF?logo=solana&logoColor=white)
![Anchor](https://img.shields.io/badge/Anchor-blue)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

## Features

- Atomic token exchange
- Cancel and refund support
- SPL token compatible
- PDA-based vault authority

## Program Instructions

`initialize` | `exchange` | `cancel`

## Build

```bash
anchor build
```

## Test

```bash
anchor test
```

## Deploy

```bash
# Devnet
anchor deploy --provider.cluster devnet

# Mainnet
anchor deploy --provider.cluster mainnet
```

## Project Structure

```
programs/
  solana-escrow/
    src/
      lib.rs          # Program entry point and instructions
    Cargo.toml
tests/
  solana-escrow.ts           # Integration tests
Anchor.toml             # Anchor configuration
```

## License

MIT — see [LICENSE](LICENSE) for details.

## Author

Built by [Purple Squirrel Media](https://purplesquirrelmedia.io)
