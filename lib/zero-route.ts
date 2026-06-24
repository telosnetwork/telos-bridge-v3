import { formatUnits, getAddress, isAddress, parseEventLogs, parseUnits, zeroAddress, type Address } from 'viem'
import { TELOS_EVM_TESTNET_CHAIN_ID, TELOS_ZERO_TESTNET_CHAIN_ID } from '@/lib/chains'
import {
  DEMO_ASSETS,
  ERC20_ABI,
  EVM_ESCROW_BRIDGE,
  EVM_ESCROW_BRIDGE_ABI,
  ZERO_API,
  ZERO_BRIDGE_ACCOUNT,
  type DemoAsset,
} from '@/lib/zero-evm-demo'
import { signAndBroadcastZeroActions } from '@/lib/zero-signer'

export type ZeroBridgeToken = 'USDC' | 'USDT' | 'WBTC' | 'EMPIRES'

export interface ZeroBridgeQuoteResult {
  amountReceived: bigint
  amountReceivedFormatted: string
  route: string
  estimatedTime: number
}

export interface ZeroBridgeSendResult {
  txHash: `0x${string}`
  requestId?: string
  requestHash?: `0x${string}`
}

export interface ZeroToEvmBridgeSendResult {
  transactionId?: string
  zeroSender: string
  evmReceiver: Address
  quantity: string
  amountRaw: bigint
  evmSymbol: string
}

export interface ZeroBridgeProcessedRequest {
  request_id: number
  evm_request_id: string
  pair_id: number
  receiver: string
  quantity: string
  evm_sender: string
  processed_at: string
}

const ZERO_BRIDGE_TOKENS: ZeroBridgeToken[] = ['USDC', 'USDT', 'WBTC']
const ZERO_TO_EVM_BRIDGE_TOKENS: ZeroBridgeToken[] = ['USDC', 'USDT', 'WBTC', 'EMPIRES']
const ZERO_BRIDGE_TEST_MINT_AMOUNTS: Record<ZeroBridgeToken, string> = {
  USDC: '1000',
  USDT: '1000',
  WBTC: '0.1',
  EMPIRES: '',
}

function findZeroAsset(token: string, direction: 'evm-to-zero' | 'zero-to-evm' = 'evm-to-zero'): DemoAsset | undefined {
  const supported = direction === 'zero-to-evm' ? ZERO_TO_EVM_BRIDGE_TOKENS : ZERO_BRIDGE_TOKENS
  return DEMO_ASSETS.find((asset) => asset.key === token && supported.includes(asset.key as ZeroBridgeToken))
}

export function isZeroBridgeToken(token: string): token is ZeroBridgeToken {
  return Boolean(findZeroAsset(token) || findZeroAsset(token, 'zero-to-evm'))
}

export function isZeroBridgeEvmToZeroRoute(token: string, fromChain: number, toChain: number) {
  return (
    fromChain === TELOS_EVM_TESTNET_CHAIN_ID &&
    toChain === TELOS_ZERO_TESTNET_CHAIN_ID &&
    Boolean(findZeroAsset(token))
  )
}

export function isZeroBridgeZeroToEvmRoute(token: string, fromChain: number, toChain: number) {
  return (
    fromChain === TELOS_ZERO_TESTNET_CHAIN_ID &&
    toChain === TELOS_EVM_TESTNET_CHAIN_ID &&
    Boolean(findZeroAsset(token, 'zero-to-evm'))
  )
}

export function isZeroBridgeRoute(token: string, fromChain: number, toChain: number) {
  return isZeroBridgeEvmToZeroRoute(token, fromChain, toChain) || isZeroBridgeZeroToEvmRoute(token, fromChain, toChain)
}

export function getZeroBridgeTokens(fromChain: number, toChain: number): ZeroBridgeToken[] {
  if (fromChain === TELOS_EVM_TESTNET_CHAIN_ID && toChain === TELOS_ZERO_TESTNET_CHAIN_ID) {
    return ZERO_BRIDGE_TOKENS
  }
  if (fromChain === TELOS_ZERO_TESTNET_CHAIN_ID && toChain === TELOS_EVM_TESTNET_CHAIN_ID) {
    return ZERO_TO_EVM_BRIDGE_TOKENS
  }
  return []
}

export function getZeroBridgeChainsForToken(token: string): number[] {
  return isZeroBridgeToken(token) ? [TELOS_EVM_TESTNET_CHAIN_ID, TELOS_ZERO_TESTNET_CHAIN_ID] : []
}

export function getZeroBridgeTokenAddress(token: string): Address | undefined {
  return (findZeroAsset(token) || findZeroAsset(token, 'zero-to-evm'))?.tokenAddress
}

export function getZeroBridgeReceiveSymbol(token: string, fromChain?: number, toChain?: number): string | undefined {
  if (fromChain === TELOS_ZERO_TESTNET_CHAIN_ID && toChain === TELOS_EVM_TESTNET_CHAIN_ID) {
    return findZeroAsset(token, 'zero-to-evm')?.evmSymbol
  }
  return findZeroAsset(token)?.zeroSymbol
}

export function getZeroBridgeSendSymbol(token: string, fromChain?: number, toChain?: number): string | undefined {
  if (fromChain === TELOS_ZERO_TESTNET_CHAIN_ID && toChain === TELOS_EVM_TESTNET_CHAIN_ID) {
    return findZeroAsset(token, 'zero-to-evm')?.zeroSymbol
  }
  if (fromChain === TELOS_EVM_TESTNET_CHAIN_ID && toChain === TELOS_ZERO_TESTNET_CHAIN_ID) {
    return findZeroAsset(token)?.evmSymbol
  }
  return undefined
}

export function getZeroBridgeTestMintAmount(token: string): string | undefined {
  if (!ZERO_BRIDGE_TOKENS.includes(token as ZeroBridgeToken)) return undefined
  const amount = ZERO_BRIDGE_TEST_MINT_AMOUNTS[token as ZeroBridgeToken]
  return amount || undefined
}

export function quoteZeroBridgeSend(token: string, amount: string, direction: 'evm-to-zero' | 'zero-to-evm' = 'evm-to-zero'): ZeroBridgeQuoteResult {
  const asset = findZeroAsset(token, direction)
  if (!asset) throw new Error(`Unsupported Telos Zero bridge token: ${token}`)

  const amountReceived = parseUnits(amount, asset.decimals)
  return {
    amountReceived,
    amountReceivedFormatted: formatUnits(amountReceived, asset.decimals),
    route: direction === 'zero-to-evm'
      ? 'Telos Zero burn -> Telos EVM release'
      : 'Telos EVM escrow -> Telos Zero mint',
    estimatedTime: 15,
  }
}

export async function getZeroBridgeBalance(token: string, zeroAccount: string): Promise<string | undefined> {
  const asset = findZeroAsset(token, 'zero-to-evm')
  const account = zeroAccount.trim()
  if (!asset || !account) return undefined

  const response = await fetch(`${ZERO_API.replace(/\/$/, '')}/v1/chain/get_currency_balance`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({
      code: asset.zeroContract,
      account,
      symbol: asset.zeroSymbol,
    }),
  })

  if (!response.ok) throw new Error(`Zero RPC get_currency_balance failed: ${response.status}`)
  const [balance] = await response.json()
  if (typeof balance !== 'string') return '0'
  return balance.split(' ')[0] || '0'
}

export async function getZeroBridgeProcessedRequest(requestHash: `0x${string}` | string): Promise<ZeroBridgeProcessedRequest | undefined> {
  const normalizedRequestHash = requestHash.toLowerCase().replace(/^0x/, '')
  let lowerBound: string | undefined

  do {
    const response = await fetch(`${ZERO_API.replace(/\/$/, '')}/v1/chain/get_table_rows`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({
        json: true,
        code: ZERO_BRIDGE_ACCOUNT,
        scope: ZERO_BRIDGE_ACCOUNT,
        table: 'etozreqs',
        limit: 1000,
        lower_bound: lowerBound,
      }),
    })

    if (!response.ok) {
      throw new Error(`Zero bridge status failed: ${response.status}`)
    }

    const payload = await response.json()
    const row = (payload.rows || []).find((entry: ZeroBridgeProcessedRequest) => {
      return String(entry.evm_request_id).toLowerCase() === normalizedRequestHash
    })

    if (row) return row
    lowerBound = payload.more ? payload.next_key : undefined
  } while (lowerBound)

  return undefined
}

export async function executeZeroBridgeSend({
  walletClient,
  publicClient,
  token,
  amount,
  fromAddress,
  zeroReceiver,
  onStatus,
}: {
  walletClient: any
  publicClient: any
  token: string
  amount: string
  fromAddress: Address
  zeroReceiver: string
  onStatus: (message: string, txHash?: `0x${string}`) => void
}): Promise<ZeroBridgeSendResult> {
  const asset = findZeroAsset(token)
  if (!asset?.tokenAddress) throw new Error(`Missing ${token} testnet token address`)
  if (!EVM_ESCROW_BRIDGE) throw new Error('Missing Telos Zero bridge escrow address')
  if (!zeroReceiver.trim()) throw new Error('Enter a Telos Zero receiver account')

  const amountLD = parseUnits(amount, asset.decimals)

  onStatus(`Checking ${asset.evmSymbol} approval...`)
  const allowance = await publicClient.readContract({
    address: asset.tokenAddress,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [fromAddress, EVM_ESCROW_BRIDGE],
  }) as bigint

  if (allowance < amountLD) {
    onStatus(`Approve ${asset.evmSymbol} spend...`)
    const approveTx = await walletClient.writeContract({
      address: asset.tokenAddress,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [EVM_ESCROW_BRIDGE, amountLD],
      account: fromAddress,
      chain: undefined,
    })
    const approvalReceipt = await publicClient.waitForTransactionReceipt({ hash: approveTx })
    if (approvalReceipt.status !== 'success') {
      throw new Error(`Token approval reverted on-chain: ${approveTx}`)
    }
    onStatus('Approved. Confirm bridge...')
  }

  onStatus('Confirm bridge in wallet...')
  const txHash = await walletClient.writeContract({
    address: EVM_ESCROW_BRIDGE,
    abi: EVM_ESCROW_BRIDGE_ABI,
    functionName: 'depositToZero',
    args: [asset.pairId, amountLD, zeroReceiver.trim()],
    account: fromAddress,
    chain: undefined,
  })

  onStatus('Transaction submitted, waiting for confirmation...', txHash)
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
  if (receipt.status !== 'success') {
    throw new Error(`Bridge deposit reverted on-chain: ${txHash}`)
  }

  const logs = parseEventLogs({
    abi: EVM_ESCROW_BRIDGE_ABI,
    eventName: 'EvmToZeroRequested',
    logs: receipt.logs,
  })
  const args = logs[0]?.args as any

  onStatus('EVM escrow request confirmed. Awaiting Telos Zero proof relay...', txHash)
  return {
    txHash,
    requestId: args?.requestId?.toString(),
    requestHash: args?.requestHash,
  }
}

export async function executeZeroToEvmBridgeSend({
  token,
  amount,
  zeroSender,
  evmReceiver,
  onStatus,
}: {
  token: string
  amount: string
  zeroSender: string
  evmReceiver: string
  onStatus: (message: string, txHash?: string) => void
}): Promise<ZeroToEvmBridgeSendResult> {
  const asset = findZeroAsset(token, 'zero-to-evm')
  if (!asset) throw new Error(`Unsupported Telos Zero bridge token: ${token}`)
  if (!isAddress(evmReceiver)) throw new Error('Enter a valid Telos EVM receiver address')
  if (!zeroSender.trim()) throw new Error('Enter a Telos Zero sender account')

  const amountRaw = parseUnits(amount, asset.decimals)
  const quantity = `${formatUnits(amountRaw, asset.decimals)} ${asset.zeroSymbol}`
  const receiver = getAddress(evmReceiver)

  onStatus(`Sign ${quantity} burn request in Anchor...`)
  const result = await signAndBroadcastZeroActions({
    expectedActor: zeroSender.trim(),
    actions: [{
      account: asset.zeroContract,
      name: 'transfer',
      data: {
        from: zeroSender.trim(),
        to: ZERO_BRIDGE_ACCOUNT,
        quantity,
        memo: receiver,
      },
    }],
  })

  onStatus(`Zero burn request submitted. Awaiting EVM release...`, result.transactionId)

  return {
    transactionId: result.transactionId,
    zeroSender: result.signer.actor,
    evmReceiver: receiver,
    quantity,
    amountRaw,
    evmSymbol: asset.evmSymbol,
  }
}

export async function mintZeroBridgeTestToken({
  walletClient,
  publicClient,
  token,
  toAddress,
  onStatus,
}: {
  walletClient: any
  publicClient: any
  token: string
  toAddress: Address
  onStatus: (message: string, txHash?: `0x${string}`) => void
}) {
  const asset = findZeroAsset(token)
  const amount = getZeroBridgeTestMintAmount(token)
  if (!asset?.tokenAddress || !amount) throw new Error(`Missing ${token} testnet token address`)

  const amountLD = parseUnits(amount, asset.decimals)
  onStatus(`Confirm ${asset.evmSymbol} mint...`)
  const txHash = await walletClient.writeContract({
    address: asset.tokenAddress,
    abi: ERC20_ABI,
    functionName: 'mint',
    args: [toAddress, amountLD],
    account: toAddress,
    chain: undefined,
  })

  onStatus('Mint submitted, waiting for confirmation...', txHash)
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
  if (receipt.status !== 'success') {
    throw new Error(`Test token mint reverted on-chain: ${txHash}`)
  }

  onStatus(`${amount} ${asset.evmSymbol} ready`, txHash)
  return {
    txHash,
    amount,
    symbol: asset.evmSymbol,
  }
}

export function hasZeroBridgeConfig(token: string) {
  const asset = findZeroAsset(token) || findZeroAsset(token, 'zero-to-evm')
  return Boolean(EVM_ESCROW_BRIDGE && asset?.tokenAddress && EVM_ESCROW_BRIDGE !== zeroAddress)
}
