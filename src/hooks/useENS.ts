import { isAddress } from '../utils'
import useENSAddress from './useENSAddress'
import useENSName from './useENSName'

/**
 * Given a name or address, does a lookup to resolve to an address and name
 * @param nameOrAddress ENS name or address
 */
export default function useENS(nameOrAddress?: string | null): {
  loading: boolean
  address: string | null
  name: string | null
} {
  // const validated = isAddress(nameOrAddress)
  // const reverseLookup = useENSName(validated ? validated : undefined)
  // const lookup = useENSAddress(nameOrAddress)
  console.log('useENS function runs')
  return {
    // loading: reverseLookup.loading || lookup.loading,
    loading: false,
    // address: validated ? validated : lookup.address,
    address: nameOrAddress ?? '',
    // name: reverseLookup.ENSName ? reverseLookup.ENSName : !validated && lookup.address ? nameOrAddress || null : null,
    name: nameOrAddress ?? '',
  }
}
