import DEFAULT_TOKEN_LIST from '@uniswap/default-token-list'
import { TokenList } from '@uniswap/token-lists'
import { useMemo } from 'react'
import { useAppSelector } from 'state/hooks'
import sortByListPriority from 'utils/listSort'
import { AppState } from '../index'
import { WrappedTokenInfo } from './wrappedTokenInfo'

export type TokenAddressMap = Readonly<{
  [chainId: number]: Readonly<{ [tokenAddress: string]: { token: WrappedTokenInfo; list: TokenList } }>
}>

const listCache: WeakMap<TokenList, TokenAddressMap> | null =
  typeof WeakMap !== 'undefined' ? new WeakMap<TokenList, TokenAddressMap>() : null

function listToTokenMap(list: TokenList): TokenAddressMap {
  const result = listCache?.get(list)
  if (result) return result

  const map = list.tokens.reduce<TokenAddressMap>((tokenMap, tokenInfo) => {
    const token = new WrappedTokenInfo(tokenInfo, list)
    if (tokenMap[token.chainId]?.[token.address] !== undefined) {
      console.error(new Error(`Duplicate token! ${token.address}`))
      return tokenMap
    }
    return {
      ...tokenMap,
      [token.chainId]: {
        ...tokenMap[token.chainId],
        [token.address]: {
          token,
          list,
        },
      },
    }
  }, {})
  listCache?.set(list, map)
  return map
}

const TRANSFORMED_DEFAULT_TOKEN_LIST = listToTokenMap(DEFAULT_TOKEN_LIST)

export function useAllLists(): AppState['lists']['byUrl'] {
  return useAppSelector((state) => state.lists.byUrl)
}

function combineMaps(map1: TokenAddressMap, map2: TokenAddressMap): TokenAddressMap {
  return {
    [1]: { ...map1[1], ...map2[1] },
    [4]: { ...map1[4], ...map2[4] },
    [3]: { ...map1[3], ...map2[3] },
    [42]: { ...map1[42], ...map2[42] },
    [5]: { ...map1[5], ...map2[5] },
  }
}

// merge tokens contained within lists from urls
function useCombinedTokenMapFromUrls(urls: string[] | undefined): TokenAddressMap {
  const lists = useAllLists()
  return useMemo(() => {
    if (!urls) return {}
    return (
      urls
        .slice()
        // sort by priority so top priority goes last
        .sort(sortByListPriority)
        .reduce((allTokens, currentUrl) => {
          const current = lists[currentUrl]?.current
          if (!current) return allTokens
          try {
            return combineMaps(allTokens, listToTokenMap(current))
          } catch (error) {
            console.error('Could not show token list due to error', error)
            return allTokens
          }
        }, {})
    )
  }, [lists, urls])
}

export function useActiveListUrls(): string[] | undefined {
  return useAppSelector((state) => state.lists.activeListUrls)
}

export function useInactiveListUrls(): string[] {
  const lists = useAllLists()
  const allActiveListUrls = useActiveListUrls()
  return Object.keys(lists).filter((url) => !allActiveListUrls?.includes(url))
}

// get all the tokens from active lists, combine with local default tokens
export function useCombinedActiveList(): TokenAddressMap {
  const activeListUrls = useActiveListUrls()
  const activeTokens = useCombinedTokenMapFromUrls(activeListUrls)
  return combineMaps(activeTokens, TRANSFORMED_DEFAULT_TOKEN_LIST)
}

export function useIsListActive(url: string): boolean {
  const activeListUrls = useActiveListUrls()
  return Boolean(activeListUrls?.includes(url))
}
