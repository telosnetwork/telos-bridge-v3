import { formatEther, formatUnits, getAddress, isAddress, parseUnits, type Address } from 'viem'
import { TELOS_EVM_TESTNET_CHAIN_ID, TELOS_ZERO_TESTNET_CHAIN_ID } from '@/lib/chains'
import { ZERO_API } from '@/lib/zero-evm-demo'
import { signAndBroadcastZeroActions } from '@/lib/zero-signer'

export const ZERO_TLOS_TOKEN_CONTRACT = 'eosio.token'
export const ZERO_TLOS_EVM_DEPOSIT_ACCOUNT = 'eosio.evm'
export const ZERO_TLOS_PRECISION = 4

export interface ZeroNativeTlosQuoteResult {
  amountReceived: bigint
  amountReceivedFormatted: string
  route: string
  estimatedTime: number
}

export interface ZeroNativeTlosTransfer {
  zeroSender: string
  evmReceiver: Address
  quantity: string
  amountFormatted: string
  cleosCommand: string
}

export interface ZeroNativeTlosTransferResult extends ZeroNativeTlosTransfer {
  transactionId?: string
}

export function isZeroNativeTlosRoute(token: string, fromChain: number, toChain: number) {
  return token === 'TLOS' && fromChain === TELOS_ZERO_TESTNET_CHAIN_ID && toChain === TELOS_EVM_TESTNET_CHAIN_ID
}

export function getZeroNativeTlosTokens(fromChain: number, toChain: number): string[] {
  return fromChain === TELOS_ZERO_TESTNET_CHAIN_ID && toChain === TELOS_EVM_TESTNET_CHAIN_ID ? ['TLOS'] : []
}

export function getZeroNativeTlosChainsForToken(token: string): number[] {
  return token === 'TLOS' ? [TELOS_ZERO_TESTNET_CHAIN_ID, TELOS_EVM_TESTNET_CHAIN_ID] : []
}

export function isValidZeroAccountName(account: string) {
  return /^[a-z1-5.]{1,12}$/.test(account.trim())
}

export function quoteZeroNativeTlosSend(amount: string): ZeroNativeTlosQuoteResult {
  const raw = parseZeroTlosAmount(amount)
  return {
    amountReceived: raw,
    amountReceivedFormatted: formatUnits(raw, ZERO_TLOS_PRECISION),
    route: 'Telos Zero native transfer -> Telos EVM gas balance',
    estimatedTime: 5,
  }
}

export function buildZeroNativeTlosTransfer({
  zeroSender,
  evmReceiver,
  amount,
}: {
  zeroSender: string
  evmReceiver: string
  amount: string
}): ZeroNativeTlosTransfer {
  const sender = zeroSender.trim()
  if (!isValidZeroAccountName(sender)) throw new Error('Enter a valid Telos Zero sender account')
  if (!isAddress(evmReceiver)) throw new Error('Enter a valid Telos EVM receiver address')

  const normalizedReceiver = getAddress(evmReceiver)
  const amountFormatted = formatUnits(parseZeroTlosAmount(amount), ZERO_TLOS_PRECISION)
  const quantity = `${amountFormatted} TLOS`
  const args = JSON.stringify([sender, ZERO_TLOS_EVM_DEPOSIT_ACCOUNT, quantity, normalizedReceiver])

  return {
    zeroSender: sender,
    evmReceiver: normalizedReceiver,
    quantity,
    amountFormatted,
    cleosCommand: `cleos -u ${ZERO_API} push action ${ZERO_TLOS_TOKEN_CONTRACT} transfer '${args}' -p ${sender}@active`,
  }
}

export async function executeZeroNativeTlosTransfer({
  zeroSender,
  evmReceiver,
  amount,
  onStatus,
}: {
  zeroSender: string
  evmReceiver: string
  amount: string
  onStatus: (message: string, txHash?: string) => void
}): Promise<ZeroNativeTlosTransferResult> {
  const transfer = buildZeroNativeTlosTransfer({ zeroSender, evmReceiver, amount })

  onStatus(`Sign ${transfer.quantity} transfer in Anchor...`)
  const result = await signAndBroadcastZeroActions({
    expectedActor: transfer.zeroSender,
    actions: [{
      account: ZERO_TLOS_TOKEN_CONTRACT,
      name: 'transfer',
      data: {
        from: transfer.zeroSender,
        to: ZERO_TLOS_EVM_DEPOSIT_ACCOUNT,
        quantity: transfer.quantity,
        memo: transfer.evmReceiver,
      },
    }],
  })

  onStatus(`Zero transfer submitted. Watching ${transfer.evmReceiver.slice(0, 6)}...${transfer.evmReceiver.slice(-4)}.`, result.transactionId)
  return {
    ...transfer,
    transactionId: result.transactionId,
  }
}

export async function getZeroTlosBalance(zeroAccount: string): Promise<string | undefined> {
  const account = zeroAccount.trim()
  if (!isValidZeroAccountName(account)) return undefined

  const response = await fetch(`${ZERO_API.replace(/\/$/, '')}/v1/chain/get_currency_balance`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({
      code: ZERO_TLOS_TOKEN_CONTRACT,
      account,
      symbol: 'TLOS',
    }),
  })

  if (!response.ok) throw new Error(`Zero RPC get_currency_balance failed: ${response.status}`)
  const [balance] = await response.json()
  return typeof balance === 'string' ? balance.split(' ')[0] : undefined
}

export async function getEvmTlosBalanceWei(publicClient: any, evmReceiver: string): Promise<bigint> {
  if (!isAddress(evmReceiver)) throw new Error('Enter a valid Telos EVM receiver address')
  return publicClient.getBalance({ address: getAddress(evmReceiver) })
}

export function formatEvmTlosBalance(balanceWei: bigint) {
  return formatEther(balanceWei)
}

function parseZeroTlosAmount(amount: string) {
  return parseUnits(amount, ZERO_TLOS_PRECISION)
}
