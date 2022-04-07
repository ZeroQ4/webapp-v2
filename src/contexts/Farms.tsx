import * as anchor from '@project-serum/anchor'
import { ASSOCIATED_TOKEN_PROGRAM_ID, Token, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { PublicKey } from '@solana/web3.js'
import { createContext, useContext, useEffect, useState } from 'react'
import {
  TM_LOCK_POOL,
  TM_LOCK_POOL_SIGNER,
  TM_LOCK_STK_VAULT,
  CYS_MINT,
  NO_LOCK_POOL,
  NO_LOCK_POOL_SIGNER,
  NO_LOCK_REWARDS_VAULT,
  NO_LOCK_STK_VAULT,
  PoolType,
  STAKING_PROGRAM,
  TM_LOCK_REWARDS_VAULT,
} from '../constants/addresses'
import idl from '../constants/rewards.json'
import { ConnectedWallet, useConnectedWallet, useSolana } from '@saberhq/use-solana'

const PRECISION = new anchor.BN('18446744073709551615')

interface IProps {
  children: JSX.Element[] | JSX.Element
}

export const FarmingContext = createContext({} as any)

export default function useFarming() {
  const values = useContext(FarmingContext)
  return {
    ...values,
  }
}

export function FarmingProvider(props: IProps) {
  const { connected, connection } = useSolana()
  const wallet = useConnectedWallet() as ConnectedWallet

  const provider = new anchor.Provider(connection, wallet, {
    skipPreflight: false,
  })
  const stakingProgram = new anchor.Program(idl as anchor.Idl, STAKING_PROGRAM, provider)

  // useEffect(() => {}, [])

  const value = {
    stakingProgram,
  }

  return <FarmingContext.Provider value={value}>{props.children}</FarmingContext.Provider>
}
