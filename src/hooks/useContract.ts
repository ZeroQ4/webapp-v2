import { Contract } from '@ethersproject/contracts'
import { abi as MulticallABI } from '@uniswap/v3-periphery/artifacts/contracts/lens/UniswapInterfaceMulticall.sol/UniswapInterfaceMulticall.json'
import { NONFUNGIBLE_POSITION_MANAGER_ADDRESSES, MULTICALL_ADDRESS } from 'constants/addresses'
import { abi as NFTPositionManagerABI } from '@uniswap/v3-periphery/artifacts/contracts/NonfungiblePositionManager.sol/NonfungiblePositionManager.json'
import { useMemo } from 'react'
import { getContract } from 'utils'
import { useActiveWeb3ReactSol } from './web3'

// returns null on errors
export function useContract<T extends Contract = Contract>(
  addressOrAddressMap: string | { [chainId: number]: string } | undefined,
  ABI: any,
  withSignerIfPossible = true
): T | null {
  const { account, chainId, librarySol } = useActiveWeb3ReactSol()

  return useMemo(() => {
    if (!addressOrAddressMap || !ABI || !librarySol || !chainId) return null
    let address: string | undefined
    if (typeof addressOrAddressMap === 'string') address = addressOrAddressMap
    else address = addressOrAddressMap[chainId]
    if (!address) return null
    try {
      return getContract(address, ABI, librarySol, withSignerIfPossible && account ? account : undefined)
    } catch (error) {
      console.error('Failed to get contract', error)
      return null
    }
  }, [addressOrAddressMap, ABI, librarySol, chainId, withSignerIfPossible, account]) as T
}

export function useMulticall2Contract() {
  return useContract(MULTICALL_ADDRESS, MulticallABI, false)
}

export function useV3NFTPositionManagerContract(withSignerIfPossible?: boolean) {
  return useContract(NONFUNGIBLE_POSITION_MANAGER_ADDRESSES, NFTPositionManagerABI, withSignerIfPossible)
}
