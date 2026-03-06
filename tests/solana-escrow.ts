import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { SolanaEscrow } from "../target/types/solana_escrow";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  mintTo,
  getAccount,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { assert } from "chai";

describe("solana-escrow", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.solanaEscrow as Program<SolanaEscrow>;
  const connection = provider.connection;

  // Keypairs
  const maker = Keypair.generate();
  const taker = Keypair.generate();
  const unauthorized = Keypair.generate();

  // Mints
  let mintA: PublicKey;
  let mintB: PublicKey;

  // ATAs
  let makerAtaA: PublicKey;
  let makerAtaB: PublicKey;
  let takerAtaA: PublicKey;
  let takerAtaB: PublicKey;

  // PDA addresses (set during tests)
  let escrowPda: PublicKey;
  let escrowBump: number;
  let vaultPda: PublicKey;
  let vaultBump: number;

  const escrowSeed = new BN(1);
  const amountA = new BN(1_000_000); // 1 token with 6 decimals
  const amountB = new BN(2_000_000); // 2 tokens with 6 decimals
  const decimals = 6;

  before(async () => {
    // Airdrop SOL to all participants
    const airdropAmount = 10 * LAMPORTS_PER_SOL;
    await Promise.all([
      connection.requestAirdrop(maker.publicKey, airdropAmount),
      connection.requestAirdrop(taker.publicKey, airdropAmount),
      connection.requestAirdrop(unauthorized.publicKey, airdropAmount),
    ]).then((sigs) =>
      Promise.all(
        sigs.map((sig) => connection.confirmTransaction(sig, "confirmed"))
      )
    );

    // Create mints
    mintA = await createMint(
      connection,
      maker,
      maker.publicKey,
      null,
      decimals
    );
    mintB = await createMint(
      connection,
      taker,
      taker.publicKey,
      null,
      decimals
    );

    // Derive ATAs
    makerAtaA = getAssociatedTokenAddressSync(mintA, maker.publicKey);
    makerAtaB = getAssociatedTokenAddressSync(mintB, maker.publicKey);
    takerAtaA = getAssociatedTokenAddressSync(mintA, taker.publicKey);
    takerAtaB = getAssociatedTokenAddressSync(mintB, taker.publicKey);

    // Create maker's token-A account and mint tokens
    await createAccount(connection, maker, mintA, maker.publicKey);
    await mintTo(connection, maker, mintA, makerAtaA, maker, 10_000_000);

    // Create taker's token-B account and mint tokens
    await createAccount(connection, taker, mintB, taker.publicKey);
    await mintTo(connection, taker, mintB, takerAtaB, taker, 10_000_000);

    // Derive escrow PDA
    [escrowPda, escrowBump] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("escrow"),
        maker.publicKey.toBuffer(),
        escrowSeed.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

    // Derive vault PDA
    [vaultPda, vaultBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), escrowPda.toBuffer()],
      program.programId
    );
  });

  // -------------------------------------------------------------------------
  // Error: create with zero amount_a should fail
  // -------------------------------------------------------------------------
  it("fails to create escrow with zero amount_a", async () => {
    try {
      await program.methods
        .createEscrow(escrowSeed, new BN(0), amountB, null)
        .accounts({
          maker: maker.publicKey,
          mintA,
          mintB,
          makerAtaA,
          escrow: escrowPda,
          vault: vaultPda,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([maker])
        .rpc();
      assert.fail("Expected error for zero amount_a");
    } catch (err: any) {
      assert.include(err.toString(), "InvalidAmount");
    }
  });

  // -------------------------------------------------------------------------
  // Error: create with zero amount_b should fail
  // -------------------------------------------------------------------------
  it("fails to create escrow with zero amount_b", async () => {
    try {
      await program.methods
        .createEscrow(escrowSeed, amountA, new BN(0), null)
        .accounts({
          maker: maker.publicKey,
          mintA,
          mintB,
          makerAtaA,
          escrow: escrowPda,
          vault: vaultPda,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([maker])
        .rpc();
      assert.fail("Expected error for zero amount_b");
    } catch (err: any) {
      assert.include(err.toString(), "InvalidAmount");
    }
  });

  // -------------------------------------------------------------------------
  // create_escrow — deposits tokens into vault
  // -------------------------------------------------------------------------
  it("creates an escrow and deposits tokens into vault", async () => {
    const makerBalanceBefore = (
      await getAccount(connection, makerAtaA)
    ).amount;

    await program.methods
      .createEscrow(escrowSeed, amountA, amountB, null)
      .accounts({
        maker: maker.publicKey,
        mintA,
        mintB,
        makerAtaA,
        escrow: escrowPda,
        vault: vaultPda,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .signers([maker])
      .rpc();

    // Verify escrow account data
    const escrowAccount = await program.account.escrow.fetch(escrowPda);
    assert.ok(escrowAccount.maker.equals(maker.publicKey));
    assert.isNull(escrowAccount.taker);
    assert.ok(escrowAccount.mintA.equals(mintA));
    assert.ok(escrowAccount.mintB.equals(mintB));
    assert.ok(escrowAccount.amountA.eq(amountA));
    assert.ok(escrowAccount.amountB.eq(amountB));
    assert.ok(escrowAccount.seed.eq(escrowSeed));

    // Verify vault received the tokens
    const vaultAccount = await getAccount(connection, vaultPda);
    assert.equal(vaultAccount.amount, BigInt(amountA.toNumber()));

    // Verify maker's balance decreased
    const makerBalanceAfter = (await getAccount(connection, makerAtaA)).amount;
    assert.equal(
      makerBalanceBefore - makerBalanceAfter,
      BigInt(amountA.toNumber())
    );
  });

  // -------------------------------------------------------------------------
  // cancel_escrow — maker gets tokens back
  // -------------------------------------------------------------------------
  it("cancels an escrow and returns tokens to maker", async () => {
    const makerBalanceBefore = (
      await getAccount(connection, makerAtaA)
    ).amount;

    await program.methods
      .cancelEscrow()
      .accounts({
        maker: maker.publicKey,
        mintA,
        makerAtaA,
        escrow: escrowPda,
        vault: vaultPda,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([maker])
      .rpc();

    // Verify maker got tokens back
    const makerBalanceAfter = (await getAccount(connection, makerAtaA)).amount;
    assert.equal(
      makerBalanceAfter - makerBalanceBefore,
      BigInt(amountA.toNumber())
    );

    // Verify escrow account is closed
    const escrowInfo = await connection.getAccountInfo(escrowPda);
    assert.isNull(escrowInfo);
  });

  // -------------------------------------------------------------------------
  // accept_escrow — tokens swap correctly
  // -------------------------------------------------------------------------
  describe("accept_escrow flow", () => {
    const acceptSeed = new BN(2);
    let acceptEscrowPda: PublicKey;
    let acceptVaultPda: PublicKey;

    before(async () => {
      [acceptEscrowPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("escrow"),
          maker.publicKey.toBuffer(),
          acceptSeed.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      [acceptVaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), acceptEscrowPda.toBuffer()],
        program.programId
      );

      // Create new escrow for the accept test
      await program.methods
        .createEscrow(acceptSeed, amountA, amountB, null)
        .accounts({
          maker: maker.publicKey,
          mintA,
          mintB,
          makerAtaA,
          escrow: acceptEscrowPda,
          vault: acceptVaultPda,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([maker])
        .rpc();
    });

    it("taker accepts escrow and tokens swap correctly", async () => {
      const makerAtaBBefore = await connection.getAccountInfo(makerAtaB);
      const takerAtaBBefore = (await getAccount(connection, takerAtaB)).amount;

      await program.methods
        .acceptEscrow()
        .accounts({
          taker: taker.publicKey,
          maker: maker.publicKey,
          mintA,
          mintB,
          takerAtaA,
          takerAtaB,
          makerAtaB,
          escrow: acceptEscrowPda,
          vault: acceptVaultPda,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([taker])
        .rpc();

      // Taker should have received amount_a of mint_a
      const takerAtaAAccount = await getAccount(connection, takerAtaA);
      assert.equal(takerAtaAAccount.amount, BigInt(amountA.toNumber()));

      // Maker should have received amount_b of mint_b
      const makerAtaBAccount = await getAccount(connection, makerAtaB);
      assert.equal(makerAtaBAccount.amount, BigInt(amountB.toNumber()));

      // Taker should have spent amount_b of mint_b
      const takerAtaBAfter = (await getAccount(connection, takerAtaB)).amount;
      assert.equal(
        takerAtaBBefore - takerAtaBAfter,
        BigInt(amountB.toNumber())
      );

      // Escrow account should be closed
      const escrowInfo = await connection.getAccountInfo(acceptEscrowPda);
      assert.isNull(escrowInfo);
    });
  });

  // -------------------------------------------------------------------------
  // Error: unauthorized taker should fail
  // -------------------------------------------------------------------------
  describe("unauthorized taker rejection", () => {
    const restrictedSeed = new BN(3);
    let restrictedEscrowPda: PublicKey;
    let restrictedVaultPda: PublicKey;

    before(async () => {
      [restrictedEscrowPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("escrow"),
          maker.publicKey.toBuffer(),
          restrictedSeed.toArrayLike(Buffer, "le", 8),
        ],
        program.programId
      );
      [restrictedVaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), restrictedEscrowPda.toBuffer()],
        program.programId
      );

      // Create escrow with a specific designated taker
      await program.methods
        .createEscrow(restrictedSeed, amountA, amountB, taker.publicKey)
        .accounts({
          maker: maker.publicKey,
          mintA,
          mintB,
          makerAtaA,
          escrow: restrictedEscrowPda,
          vault: restrictedVaultPda,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([maker])
        .rpc();
    });

    it("rejects an unauthorized taker", async () => {
      // Create token accounts for the unauthorized user
      const unauthorizedAtaB = getAssociatedTokenAddressSync(
        mintB,
        unauthorized.publicKey
      );
      await createAccount(
        connection,
        unauthorized,
        mintB,
        unauthorized.publicKey
      );
      await mintTo(
        connection,
        taker,
        mintB,
        unauthorizedAtaB,
        taker,
        10_000_000
      );

      const unauthorizedAtaA = getAssociatedTokenAddressSync(
        mintA,
        unauthorized.publicKey
      );

      try {
        await program.methods
          .acceptEscrow()
          .accounts({
            taker: unauthorized.publicKey,
            maker: maker.publicKey,
            mintA,
            mintB,
            takerAtaA: unauthorizedAtaA,
            takerAtaB: unauthorizedAtaB,
            makerAtaB,
            escrow: restrictedEscrowPda,
            vault: restrictedVaultPda,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .signers([unauthorized])
          .rpc();
        assert.fail("Expected unauthorized taker to be rejected");
      } catch (err: any) {
        assert.include(err.toString(), "UnauthorizedTaker");
      }
    });
  });
});
