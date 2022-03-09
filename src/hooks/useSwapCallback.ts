import { BigNumber } from '@ethersproject/bignumber'
import JSBI from 'jsbi'
import {
  buildTick,
  generateBitmapWord,
  nextInitializedBit,
  Pool,
  PoolVars,
  POOL_SEED,
  SwapRouter,
  TickDataProvider,
  TickMath,
  tickPosition,
  Trade as V3Trade,
  u32ToSeed,
} from '@cykura/sdk'
import { Currency, Percent, TradeType, Token as UniToken, BigintIsh, CurrencyAmount } from '@cykura/sdk-core'
import * as anchor from '@project-serum/anchor'
import { CyclosCore, IDL } from 'types/cyclos-core'
import { PROGRAM_ID, PROGRAM_ID_STR, SWAP_ROUTER_ADDRESSES } from '../constants/addresses'
import { useActiveWeb3ReactSol } from './web3'
import useTransactionDeadline from './useTransactionDeadline'
import { AccountMeta, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js'
import { useSolana } from '@saberhq/use-solana'
import { Wallet } from '@project-serum/anchor/dist/cjs/provider'
import { BN } from '@project-serum/anchor'
import { ASSOCIATED_TOKEN_PROGRAM_ID, NATIVE_MINT, Token, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { u16ToSeed } from 'state/mint/v3/utils'
import { BITMAP_SEED, OBSERVATION_SEED, TICK_SEED } from 'constants/tokens'
import { useSwapState } from 'state/swap/hooks'
import { useCurrency } from './Tokens'

enum SwapCallbackState {
  INVALID,
  LOADING,
  VALID,
}

interface SwapCall {
  address: string
  calldata: string
  value: string
}

interface SwapCallEstimate {
  call: SwapCall
}

interface SuccessfulCall extends SwapCallEstimate {
  call: SwapCall
  gasEstimate: BigNumber
}

interface FailedCall extends SwapCallEstimate {
  call: SwapCall
  error: Error
}

/**
 * Returns the swap calls that can be used to make the trade
 * @param trade trade to execute
 * @param allowedSlippage user allowed slippage
 * @param recipientAddress the address of the recipient of the swap output
 * @param signatureData the signature data of the permit of the input token amount, if available
 */
function useSwapCallArguments(
  trade: V3Trade<Currency, Currency, TradeType> | undefined, // trade to execute, required
  allowedSlippage: Percent, // in bips
  recipientAddress: string | null // the address of the recipient of the trade, or null if swap should be returned to sender
  // signatureData: SignatureData | null | undefined
): SwapCall[] {
  const { account, chainId, librarySol } = useActiveWeb3ReactSol()
  const recipient = recipientAddress ?? account
  const deadline = useTransactionDeadline()

  return []
  // return useMemo(() => {
  //   if (!trade || !recipient || !librarySol || !account || !chainId || !deadline) return []
  //   const swapRouterAddress = chainId ? SWAP_ROUTER_ADDRESSES[chainId] : undefined
  //   if (!swapRouterAddress) return []

  //   const { value, calldata } = SwapRouter.swapCallParameters(trade, {
  //     recipient,
  //     slippageTolerance: allowedSlippage,
  //     deadline: deadline.toString(),
  //     ...(signatureData
  //       ? {
  //           inputTokenPermit:
  //             'allowed' in signatureData
  //               ? {
  //                   expiry: signatureData.deadline,
  //                   nonce: signatureData.nonce,
  //                   s: signatureData.s,
  //                   r: signatureData.r,
  //                   v: signatureData.v as any,
  //                 }
  //               : {
  //                   deadline: signatureData.deadline,
  //                   amount: signatureData.amount,
  //                   s: signatureData.s,
  //                   r: signatureData.r,
  //                   v: signatureData.v as any,
  //                 },
  //         }
  //       : {}),
  //   })
  //   return [
  //     {
  //       address: swapRouterAddress,
  //       calldata,
  //       value,
  //     },
  //   ]
  // }, [account, allowedSlippage, chainId, deadline, librarySol, recipient, signatureData, trade])
}

/**
 * This is hacking out the revert reason from the ethers provider thrown error however it can.
 * This object seems to be undocumented by ethers.
 * @param error an error from the ethers provider
 */
function swapErrorToUserReadableMessage(error: any): string {
  let reason: string | undefined
  while (Boolean(error)) {
    reason = error.reason ?? error.message ?? reason
    error = error.error ?? error.data?.originalError
  }

  if (reason?.indexOf('execution reverted: ') === 0) reason = reason.substr('execution reverted: '.length)

  switch (reason) {
    case 'CyclosV2Router: EXPIRED':
      return 'The transaction could not be sent because the deadline has passed. Please check that your transaction deadline is not too low.'
    case 'CyclosV2Router: INSUFFICIENT_OUTPUT_AMOUNT':
    case 'CyclosV2Router: EXCESSIVE_INPUT_AMOUNT':
      return 'This transaction will not succeed either due to price movement or fee on transfer. Try increasing your slippage tolerance.'
    case 'TransferHelper: TRANSFER_FROM_FAILED':
      return 'The input token cannot be transferred. There may be an issue with the input token.'
    case 'CyclosV2: TRANSFER_FAILED':
      return 'The output token cannot be transferred. There may be an issue with the output token.'
    case 'CyclosV2: K':
      return 'The invariant x*y=k was not satisfied by the swap. This usually means one of the tokens you are swapping incorporates custom behavior on transfer.'
    case 'Too little received':
    case 'Too much requested':
    case 'STF':
      return 'This transaction will not succeed due to price movement. Try increasing your slippage tolerance. Note: fee on transfer and rebase tokens are incompatible.'
    case 'TF':
      return 'The output token cannot be transferred. There may be an issue with the output token. Note: fee on transfer and rebase tokens are incompatible.'
    default:
      if (reason?.indexOf('undefined is not an object') !== -1) {
        console.error(error, reason)
        return 'An error occurred when trying to execute this swap. You may need to increase your slippage tolerance. If that does not work, there may be an incompatibility with the token you are trading. Note: fee on transfer and rebase tokens are incompatible.'
      }
      return `Unknown error${
        reason ? `: "${reason}"` : ''
      }. Try increasing your slippage tolerance. Note: fee on transfer and rebase tokens are incompatible`
  }
}

// returns a function that will execute a swap, if the parameters are all valid
// and the user has approved the slippage adjusted input amount for the trade
export function useSwapCallback(
  trade: V3Trade<Currency, Currency, TradeType> | undefined, // trade to execute, required
  allowedSlippage: Percent, // in bips
  recipientAddress: string | null, // the address of the recipient of the trade, or null if swap should be returned to sender
  swapAccounts: AccountMeta[] | undefined // the bitmap and tick accounts that need to be passed for the swap
): { state: SwapCallbackState; callback: null | (() => Promise<string>); error: string | null } {
  // console.log('building callback for', trade)

  const { connection, wallet, providerMut } = useSolana()
  const {
    INPUT: { currencyId: inputCurrencyId },
    OUTPUT: { currencyId: outputCurrencyId },
  } = useSwapState()
  const inputCurrency = useCurrency(inputCurrencyId)
  const outputCurrency = useCurrency(outputCurrencyId)

  const provider = new anchor.Provider(connection, wallet as Wallet, {
    skipPreflight: true,
  })
  const cyclosCore = new anchor.Program<CyclosCore>(IDL, PROGRAM_ID_STR, provider)

  // console.log('useSwapCallback is called')
  const pool = trade?.route
  const signer = wallet?.publicKey
  // Need to calculate the allowed slippage amount to pass it in as sqrtPriceLimitX32 along with the swap txn
  const slippagePriceLimitX32 = allowedSlippage

  if (!trade || !pool || !signer || !inputCurrency || !outputCurrency) {
    return { state: SwapCallbackState.INVALID, callback: null, error: 'Missing dependencies' }
  }

  // const callback = async () => Promise.resolve('')
  const callback = async () => {
    // console.log('Is it here?')
    // Find bitmap and tick accounts required to consume the input amount
    // 1. Find current tick from pool account
    // 2. Find swap direction
    // 3. Formula to know if a tick is consumed completely

    // console.log(poolAdd.toString())
    // swapAccounts cannot be empty. If empty something went wrong fethcing them and swap wont work.
    // Throw eerror for this late
    const { token0: t0, token1: t1, fee: f } = trade.route.pools[0]

    const [pool, _] = await anchor.web3.PublicKey.findProgramAddress(
      [POOL_SEED, new PublicKey(t0.address).toBuffer(), new PublicKey(t1.address).toBuffer(), u32ToSeed(f)],
      cyclosCore.programId
    )

    // console.log(swapAccounts, pool)
    if (!swapAccounts || !pool) {
      console.log('BROKEN')
      return ''
    }
    // console.log(pool.toString(), ' --> ')
    const { observationIndex, observationCardinalityNext, tick, sqrtPriceX32, liquidity, token0, token1, fee } =
      await cyclosCore.account.poolState.fetch(pool)

    const amountIn = new BN(trade?.inputAmount.numerator.toString())
    const [factoryState, factoryStateBump] = await PublicKey.findProgramAddress([], cyclosCore.programId)

    const minterWallet0 = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      token0,
      signer,
      true
    )

    const minterWallet1 = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      token1,
      signer,
      true
    )

    const vault0 = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      token0,
      pool,
      true
    )

    const vault1 = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      token1,
      pool,
      true
    )

    const lastObservationState = (
      await PublicKey.findProgramAddress(
        [OBSERVATION_SEED, token0.toBuffer(), token1.toBuffer(), u32ToSeed(fee), u16ToSeed(observationIndex)],
        cyclosCore.programId
      )
    )[0]

    const nextObservationState = (
      await PublicKey.findProgramAddress(
        [
          OBSERVATION_SEED,
          token0.toBuffer(),
          token1.toBuffer(),
          u32ToSeed(fee),
          u16ToSeed((observationIndex + 1) % observationCardinalityNext),
        ],
        cyclosCore.programId
      )
    )[0]

    // price = reserves_1 / reserves_0
    // token 0 -> 1 (USDT -> USDC), price down
    // token 1 -> 0 (USDC -> USDT), price up

    const inputToken = new PublicKey((trade.inputAmount.currency as UniToken).address)
    const [inputTokenAccount, outputTokenAccount, inputVault, outputVault, zeroForOne] = inputToken.equals(token0)
      ? [minterWallet0, minterWallet1, vault0, vault1, true]
      : [minterWallet1, minterWallet0, vault1, vault0, false]

    const deadline = new BN(Date.now() / 1000 + 100_000)

    const tx = new Transaction()

    const isSol = inputCurrency.symbol == 'SOL' || outputCurrency.symbol == 'SOL'

    // 1. Check if respective ATA's accounts.
    // Check for all mints except SOL, as wrap and unwrap is used for SOL
    // Get ATA for WSOL Account
    const WSOL_ATA = await Token.getAssociatedTokenAddress(
      ASSOCIATED_TOKEN_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      NATIVE_MINT,
      signer
    )

    // inputCurrency ATA Creation if not exist
    if (inputCurrency.symbol != 'SOL') {
      const ata = await Token.getAssociatedTokenAddress(
        ASSOCIATED_TOKEN_PROGRAM_ID,
        TOKEN_PROGRAM_ID,
        new PublicKey(inputCurrency.wrapped.address),
        signer
      )
      const accountInfo = await connection.getAccountInfo(ata)

      if (!accountInfo) {
        console.log(`Creating ATA for ${inputCurrency.name} ${ata.toString()}`)
        tx.add(
          Token.createAssociatedTokenAccountInstruction(
            ASSOCIATED_TOKEN_PROGRAM_ID,
            TOKEN_PROGRAM_ID,
            new PublicKey(inputCurrency.wrapped.address),
            ata,
            signer,
            signer
          )
        )
      }
    }

    // outputCurrency ATA Creation if not exist
    if (outputCurrency.symbol != 'SOL') {
      const ata = await Token.getAssociatedTokenAddress(
        ASSOCIATED_TOKEN_PROGRAM_ID,
        TOKEN_PROGRAM_ID,
        new PublicKey(outputCurrency.wrapped.address),
        signer
      )
      const accountInfo = await connection.getAccountInfo(ata)

      if (!accountInfo) {
        console.log(`Creating ATA for ${outputCurrency.name} ${ata.toString()}`)
        tx.add(
          Token.createAssociatedTokenAccountInstruction(
            ASSOCIATED_TOKEN_PROGRAM_ID,
            TOKEN_PROGRAM_ID,
            new PublicKey(outputCurrency.wrapped.address),
            ata,
            signer,
            signer
          )
        )
      }
    }

    // 2. Wrap and Unwrap native SOL is one of the input tokens is SOL
    if (isSol) {
      console.log(`Wrapping native SOL`)

      // WRAP NATIVE SOL
      const account = await connection.getAccountInfo(WSOL_ATA)
      if (!account) {
        tx.add(
          Token.createAssociatedTokenAccountInstruction(
            ASSOCIATED_TOKEN_PROGRAM_ID,
            TOKEN_PROGRAM_ID,
            NATIVE_MINT,
            WSOL_ATA,
            signer,
            signer
          )
        )
      }

      // If swapping from SOL
      if (inputCurrency.symbol == 'SOL' || outputCurrency.symbol == 'SOL') {
        tx.add(
          SystemProgram.transfer({
            fromPubkey: signer,
            toPubkey: WSOL_ATA,
            lamports: amountIn.toNumber(),
          }),
          new TransactionInstruction({
            keys: [
              {
                pubkey: WSOL_ATA,
                isSigner: false,
                isWritable: true,
              },
            ],
            data: Buffer.from(new Uint8Array([17])),
            programId: TOKEN_PROGRAM_ID,
          })
        )
      }
    }

    const iAccount = inputCurrency.symbol == 'SOL' ? WSOL_ATA : inputTokenAccount
    const oAccount = outputCurrency.symbol == 'SOL' ? WSOL_ATA : outputTokenAccount

    // console.log(swapAccounts)

    const swapIx = cyclosCore.instruction.exactInput(
      deadline,
      amountIn,
      new BN(0),
      Buffer.from([swapAccounts.length]),
      {
        accounts: {
          signer,
          factoryState,
          inputTokenAccount: iAccount,
          coreProgram: cyclosCore.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        },
        remainingAccounts: [
          {
            pubkey: pool,
            isSigner: false,
            isWritable: true,
          },
          {
            pubkey: oAccount,
            isSigner: false,
            isWritable: true,
          },
          {
            pubkey: inputVault,
            isSigner: false,
            isWritable: true,
          },
          {
            pubkey: outputVault,
            isSigner: false,
            isWritable: true,
          },
          {
            pubkey: lastObservationState,
            isSigner: false,
            isWritable: true,
          },
          ...swapAccounts,
          {
            pubkey: nextObservationState,
            isSigner: false,
            isWritable: true,
          },
        ],
      }
    )

    tx.add(swapIx)

    // UNWRAP NATIVE SOL
    if (isSol) {
      console.log(`Unwrapping native SOL`)
      tx.add(Token.createCloseAccountInstruction(TOKEN_PROGRAM_ID, WSOL_ATA, signer, signer, []))
    }

    tx.recentBlockhash = (await connection.getRecentBlockhash()).blockhash
    tx.feePayer = signer

    const str = tx.serializeMessage().toString('base64')
    console.log(`https://explorer.solana.com/tx/inspector?message=${encodeURIComponent(str)}`)

    // await wallet?.signTransaction(tx)
    const hash = await providerMut?.send(tx)

    console.log('swap hash', hash)
    return hash?.signature ?? '' // This should not be the case. Check types, should not get empty string here
    // return ''
  }
  return { state: SwapCallbackState.VALID, callback, error: null }
}

export class SolanaTickDataProvider implements TickDataProvider {
  // @ts-ignore
  program: anchor.Program<CyclosCore>
  pool: PoolVars

  bitmapCache: Map<
    number,
    | {
        address: PublicKey
        word: anchor.BN
      }
    | undefined
  >

  tickCache: Map<
    number,
    | {
        address: PublicKey
        liquidityNet: JSBI
      }
    | undefined
  >

  // @ts-ignore
  constructor(program: anchor.Program<CyclosCore>, pool: PoolVars) {
    this.program = program
    this.pool = pool
    this.bitmapCache = new Map()
    this.tickCache = new Map()
  }

  /**
   * Caches ticks and bitmap accounts near the current price
   * @param tickCurrent The current pool tick
   * @param tickSpacing The pool tick spacing
   */
  async eagerLoadCache(tickCurrent: number, tickSpacing: number) {
    const compressed = JSBI.toNumber(JSBI.divide(JSBI.BigInt(tickCurrent), JSBI.BigInt(tickSpacing)))
    const { wordPos, bitPos } = tickPosition(compressed)
    const bitmapData = await this.getBitmap(wordPos)

    const ticksToFetch = [] as number[]

    let bitPosForBehind = bitPos
    for (let i = 0; i < 3; i++) {
      const { next: nextBitBehind, initialized } = nextInitializedBit(bitmapData.word, bitPosForBehind, true)
      const tick = buildTick(wordPos, nextBitBehind, tickSpacing)

      if (initialized) {
        ticksToFetch.push(tick)
      }
      if (nextBitBehind === 0 || tick === TickMath.MIN_TICK) {
        break
      }
      --bitPosForBehind
    }

    let bitPosForAhead = bitPos + 1
    for (let i = 0; i < 3; i++) {
      const { next: nextBitAhead, initialized } = nextInitializedBit(bitmapData.word, bitPosForAhead, false)
      const tick = buildTick(wordPos, nextBitAhead, tickSpacing)

      if (initialized) {
        ticksToFetch.push(tick)
      }
      if (nextBitAhead === 255 || tick === TickMath.MAX_TICK) {
        break
      }
      ++bitPosForAhead
    }

    const tickAddresses = [] as PublicKey[]
    for (const tick of ticksToFetch) {
      tickAddresses.push(await this.getTickAddress(tick))
    }
    const fetchedTicks = await this.program.account.tickState.fetchMultiple(tickAddresses)

    for (let index = 0; index < fetchedTicks.length; index++) {
      const { tick, liquidityNet } = fetchedTicks[index] as { tick: number; liquidityNet: anchor.BN }
      this.tickCache.set(tick, {
        address: tickAddresses[index],
        liquidityNet: JSBI.BigInt(liquidityNet),
      })
    }
  }

  async getTick(tick: number): Promise<{ liquidityNet: JSBI }> {
    let savedTick = this.tickCache.get(tick)

    if (!savedTick) {
      const tickState = await this.getTickAddress(tick)
      const { liquidityNet } = await this.program.account.tickState.fetch(tickState)
      savedTick = {
        address: tickState,
        liquidityNet: JSBI.BigInt(liquidityNet),
      }
      this.tickCache.set(tick, savedTick)
    }

    return {
      liquidityNet: JSBI.BigInt(savedTick.liquidityNet),
    }
  }

  /**
   * Fetches bitmap for the word. Bitmaps are cached locally after each RPC call
   * @param wordPos
   */
  async getBitmap(wordPos: number) {
    // console.log('get bitmap for word', wordPos)
    if (!this.bitmapCache.has(wordPos)) {
      const bitmapAddress = await this.getBitmapAddress(wordPos)

      let word: anchor.BN
      try {
        const { word: wordArray } = await this.program.account.tickBitmapState.fetch(bitmapAddress)
        word = generateBitmapWord(wordArray)
      } catch (error) {
        // An uninitialized bitmap will have no initialized ticks, i.e. the bitmap will be empty
        word = new anchor.BN(0)
      }

      this.bitmapCache.set(wordPos, {
        address: bitmapAddress,
        word,
      })
    }

    return this.bitmapCache.get(wordPos)!
  }

  async getTickAddress(tick: number): Promise<anchor.web3.PublicKey> {
    const addr = (
      await PublicKey.findProgramAddress(
        [
          TICK_SEED,
          this.pool.token0.toBuffer(),
          this.pool.token1.toBuffer(),
          u32ToSeed(this.pool.fee),
          u32ToSeed(tick),
        ],
        this.program.programId
      )
    )[0]
    console.log('getting tick address for', tick, addr.toString())
    return addr
  }

  async getBitmapAddress(wordPos: number): Promise<anchor.web3.PublicKey> {
    console.log('getting bitmap address for', wordPos)
    return (
      await PublicKey.findProgramAddress(
        [
          BITMAP_SEED,
          this.pool.token0.toBuffer(),
          this.pool.token1.toBuffer(),
          u32ToSeed(this.pool.fee),
          u16ToSeed(wordPos),
        ],
        this.program.programId
      )
    )[0]
  }

  /**
   * Finds the next initialized tick in the given word. Fetched bitmaps are saved in a
   * cache for quicker lookups in future.
   * @param tick The current tick
   * @param lte Whether to look for a tick less than or equal to the current one, or a tick greater than or equal to
   * @param tickSpacing The tick spacing for the pool
   * @returns
   */
  async nextInitializedTickWithinOneWord(
    tick: number,
    lte: boolean,
    tickSpacing: number
  ): Promise<[number, boolean, number, number, PublicKey]> {
    let compressed = JSBI.toNumber(JSBI.divide(JSBI.BigInt(tick), JSBI.BigInt(tickSpacing)))
    if (tick < 0 && tick % tickSpacing !== 0) {
      compressed -= 1
    }
    if (!lte) {
      compressed += 1
    }

    const { wordPos, bitPos } = tickPosition(compressed)
    const cachedState = await this.getBitmap(wordPos)

    const { next: nextBit, initialized } = nextInitializedBit(cachedState.word, bitPos, lte)
    const nextTick = buildTick(wordPos, nextBit, tickSpacing)
    return [nextTick, initialized, wordPos, bitPos, cachedState.address]
  }
}
