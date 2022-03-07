import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import { TOKEN_PROGRAM_ID, Token as SplToken, NATIVE_MINT } from '@solana/spl-token'
import { useSolana } from '@saberhq/use-solana'

import { Currency, Token, CurrencyAmount } from '@cykura/sdk-core'
import JSBI from 'jsbi'
import { useEffect, useMemo, useState } from 'react'
import { WSOL_LOCAL, WSOL_MAIN } from '../../constants/tokens'
import { useActiveWeb3ReactSol } from '../../hooks/web3'
import { useAllTokens } from '../../hooks/Tokens'
import useInterval from 'hooks/useInterval'

/**
 * Returns a map of the given addresses to their eventually consistent ETH balances.
 */
export function useSOLBalance(uncheckedAddress: string | undefined): {
  [address: string]: CurrencyAmount<Currency> | undefined
} {
  const { chainId, account } = useActiveWeb3ReactSol()

  const { connection, connected } = useSolana()
  const [balance, setBalance] = useState<any>(0)

  useEffect(() => {
    fetchSolBalance()
  }, [account, connected])

  const fetchSolBalance = () => {
    if (!uncheckedAddress || uncheckedAddress == '11111111111111111111111111111111') return
    // Native Sol balance
    connection.getBalance(new PublicKey(uncheckedAddress)).then((data) => {
      setBalance(data)
    })
  }

  useInterval(fetchSolBalance, 10000)

  return useMemo(() => {
    return {
      [NATIVE_MINT.toString()]: CurrencyAmount.fromRawAmount(WSOL_LOCAL, balance),
    }
  }, [account, chainId, uncheckedAddress, balance, connected])
}

/**
 * Returns a map of token addresses to their eventually consistent token balances for a single account.
 */
export function useTokenBalancesWithLoadingIndicator(
  address?: string,
  tokens?: (Token | undefined)[]
): [{ [tokenAddress: string]: CurrencyAmount<Token> | undefined }, boolean] {
  const { connection, connected } = useSolana()
  const [tokenBalanceList, setTokenBalanceList] = useState<{
    [tokenAddress: string]: CurrencyAmount<Token> | undefined
  }>({})
  const [solBalances, setSolBalances] = useState<{ [key: string]: string | undefined }>({})
  const [loading, setLoading] = useState(true)

  const filteredTokens: Token[] = useMemo(() => tokens?.filter((t?: Token): t is Token => true) ?? [], [tokens])

  // Store all spl token balances here
  useEffect(() => {
    fetchTokenBalances()
  }, [address, connected])

  const fetchTokenBalances = () => {
    if (!address || address == '11111111111111111111111111111111') return
    connection
      .getParsedTokenAccountsByOwner(new PublicKey(address), {
        programId: TOKEN_PROGRAM_ID,
      })
      .then((tokensInfo) => {
        const tokenBalancesMap: { [key: string]: string | undefined } = {}
        tokensInfo?.value?.forEach((v) => {
          const add: string = v.account.data.parsed.info.mint.toString() as string
          const amt: string | undefined = v.account.data.parsed.info.tokenAmount.amount
          tokenBalancesMap[add] = amt
        })
        filteredTokens.forEach((token: Token) => {
          if (tokenBalancesMap[token.address.toString()]) {
            // set balance of token
            setSolBalances((p) => {
              p[token.address.toString()] = tokenBalancesMap[token.address.toString()]
              return p
            })
          } else {
            // account doesn't have token then set to 0
            setSolBalances((p) => {
              p[token.address.toString()] = '0'
              return p
            })
          }
        })
        const balanceList =
          filteredTokens.length > 0
            ? filteredTokens.reduce<{ [tokenAddress: string]: CurrencyAmount<Token> | undefined }>((memo, token, i) => {
                const tkAdd: string = token.address.toString()
                const value = solBalances[tkAdd]
                const amount = JSBI.BigInt(value ?? 0)
                if (amount) {
                  memo[tkAdd] = CurrencyAmount.fromRawAmount(token, amount)
                }
                return memo
              }, {})
            : {}
        setTokenBalanceList(balanceList)
      })
      .catch((e) => {
        console.log('Something went wrong trying to fetch token balances', e)
      })
      .finally(() => {
        setLoading(false)
      })
  }

  useInterval(fetchTokenBalances, 10000)
  return [tokenBalanceList, loading]
}

export function useTokenBalances(
  address?: string,
  tokens?: (Token | undefined)[]
): { [tokenAddress: string]: CurrencyAmount<Token> | undefined } {
  return useTokenBalancesWithLoadingIndicator(address, tokens)[0]
}

// get the balance for a single token/account combo
export function useTokenBalance(account?: string, token?: Token): CurrencyAmount<Token> | undefined {
  const tokenBalances = useTokenBalances(account, [token])
  if (!token) return undefined
  return tokenBalances[token.address.toString()]
}

export function useCurrencyBalances(
  account?: string,
  currencies?: (Currency | undefined)[]
): (CurrencyAmount<Currency> | undefined)[] {
  // TODO: Fetches all token balances here, Need to do something more efficient here.
  const allTokens = useAllTokens()
  const arrAllTokens = Object.keys(allTokens).map((a) => allTokens[a])

  // token balance here
  const allTokenBalances = useTokenBalances(account, arrAllTokens)

  const solBalance = useSOLBalance(account)

  return useMemo(
    () =>
      currencies?.map((currency) => {
        if (!account || !currency || !allTokenBalances) return undefined
        if (currency.symbol == 'SOL') return solBalance[WSOL_MAIN.address.toString()]
        if (currency.isToken) return allTokenBalances[currency.address.toString()]
        return undefined
      }) ?? [],
    [account, currencies, solBalance, allTokenBalances]
  )
}

export function useCurrencyBalance(account?: string, currency?: Currency): CurrencyAmount<Currency> | undefined {
  return useCurrencyBalances(account, [currency])[0]
}

// mimics useAllBalances
export function useAllTokenBalances(): { [tokenAddress: string]: CurrencyAmount<Token> | undefined } {
  const { account } = useActiveWeb3ReactSol()
  const allTokens = useAllTokens()
  const allTokensArray = useMemo(() => Object.values(allTokens ?? {}), [allTokens])
  const balances = useTokenBalances(account ?? undefined, allTokensArray)
  return balances ?? {}
}
