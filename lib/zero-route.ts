import { formatUnits, getAddress, isAddress, parseEventLogs, parseUnits, zeroAddress, type Address } from 'viem'
import { TELOS_EVM_TESTNET_CHAIN_ID, TELOS_ZERO_TESTNET_CHAIN_ID } from '@/lib/chains'
import { formatAntelopeQuantityRaw } from '@/lib/antelope-asset'
import {
  DEMO_ASSETS,
  EMPIRES_FAUCET_URL,
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
  proof?: EvmToZeroProofRequest
}

export interface ZeroToEvmBridgeSendResult {
  transactionId?: string
  requestId: number
  burnId: string
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

export interface ZeroToEvmBridgeRequest {
  request_id: number
  burn_id: string
  pair_id: number
  sender: string
  quantity: string
  evm_receiver: string
  created_at: string
  refunded?: boolean
}

export interface ZeroToEvmRelayResult {
  transactionId?: string
  requestId: number
}

export interface EvmToZeroProofRequest {
  pairId: number
  requestHash: `0x${string}`
  receiver: string
  quantity: string
  evmSender: Address
}

export interface EvmToZeroProofResult {
  transactionId?: string
  requestHash: `0x${string}`
}

export interface EmpiresFaucetResult {
  status: 'sent' | 'already_funded'
  account: string
  quantity?: string
  transactionId?: string
  message?: string
}

const ZERO_BRIDGE_TOKENS: ZeroBridgeToken[] = ['USDC', 'USDT', 'WBTC', 'EMPIRES']
const ZERO_TO_EVM_BRIDGE_TOKENS: ZeroBridgeToken[] = ['USDC', 'USDT', 'WBTC', 'EMPIRES']
const ZERO_BRIDGE_TEST_MINT_AMOUNTS: Record<ZeroBridgeToken, string> = {
  USDC: '1000',
  USDT: '1000',
  WBTC: '0.1',
  EMPIRES: '',
}

function strip0x(value: string) {
  return value.replace(/^0x/i, '')
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

export async function claimEmpiresTestTokens({
  zeroAccount,
  onStatus,
}: {
  zeroAccount: string
  onStatus: (message: string) => void
}): Promise<EmpiresFaucetResult> {
  const account = zeroAccount.trim()
  if (!EMPIRES_FAUCET_URL) throw new Error('EMPIRES faucet is not configured')
  if (!/^[a-z1-5.]{1,12}$/.test(account)) throw new Error('Enter a valid Telos Zero sender account')

  onStatus('Requesting test EMPIRES...')
  const response = await fetch(EMPIRES_FAUCET_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({ account }),
  })

  const text = await response.text()
  let payload: any
  try {
    payload = text ? JSON.parse(text) : {}
  } catch {
    payload = { error: text }
  }

  if (!response.ok) {
    throw new Error(payload?.error || `EMPIRES faucet failed: ${response.status}`)
  }

  if (payload.status === 'already_funded') {
    onStatus(payload.message || 'EMPIRES balance already funded')
  } else {
    onStatus(`${payload.quantity || 'EMPIRES'} sent`)
  }

  return payload as EmpiresFaucetResult
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

export async function getZeroToEvmBridgeRequests(): Promise<ZeroToEvmBridgeRequest[]> {
  const rows: ZeroToEvmBridgeRequest[] = []
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
        table: 'ztoereqs',
        limit: 1000,
        lower_bound: lowerBound,
      }),
    })

    if (!response.ok) {
      throw new Error(`Zero bridge pending release lookup failed: ${response.status}`)
    }

    const payload = await response.json()
    rows.push(...(payload.rows || []))
    lowerBound = payload.more ? payload.next_key : undefined
  } while (lowerBound)

  return rows
}

export async function findLatestZeroToEvmBridgeRequest({
  token,
  amount,
  zeroSender,
  evmReceiver,
  afterRequestId = -1,
  isProcessed,
}: {
  token: string
  amount: string
  zeroSender: string
  evmReceiver: string
  afterRequestId?: number
  isProcessed?: (request: ZeroToEvmBridgeRequest) => Promise<boolean>
}): Promise<ZeroToEvmBridgeRequest | undefined> {
  const asset = findZeroAsset(token, 'zero-to-evm')
  if (!asset) throw new Error(`Unsupported Telos Zero bridge token: ${token}`)
  if (!isAddress(evmReceiver)) throw new Error('Enter a valid Telos EVM receiver address')

  const amountRaw = parseUnits(amount, asset.decimals)
  const quantity = formatAntelopeQuantityRaw(amountRaw, asset.decimals, asset.zeroSymbol)
  const receiver = getAddress(evmReceiver).toLowerCase()
  const sender = zeroSender.trim()
  const rows = await getZeroToEvmBridgeRequests()

  const matches = rows
    .filter((row) => Number(row.request_id) > afterRequestId)
    .filter((row) => Number(row.pair_id) === Number(asset.pairId))
    .filter((row) => row.sender === sender)
    .filter((row) => row.quantity === quantity)
    .filter((row) => String(row.evm_receiver).toLowerCase() === receiver)
    .filter((row) => row.refunded !== true)
    .sort((a, b) => Number(b.request_id) - Number(a.request_id))

  if (!isProcessed) return matches[0]

  for (const request of matches) {
    if (!(await isProcessed(request))) return request
  }

  return undefined
}

async function getLatestZeroToEvmRequestId() {
  const rows = await getZeroToEvmBridgeRequests()
  return rows.reduce((max, row) => Math.max(max, Number(row.request_id)), -1)
}

async function waitForZeroToEvmBridgeRequest(args: Parameters<typeof findLatestZeroToEvmBridgeRequest>[0]) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const row = await findLatestZeroToEvmBridgeRequest(args)
    if (row) return row
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }

  throw new Error('Zero burn was submitted, but the bridge request row was not visible yet')
}

export async function relayZeroToEvmBridgeRequest({
  requestId,
  zeroSender,
  onStatus,
}: {
  requestId: number
  zeroSender: string
  onStatus: (message: string, txHash?: string) => void
}): Promise<ZeroToEvmRelayResult> {
  if (!Number.isFinite(requestId) || requestId < 0) {
    throw new Error('Missing Zero-to-EVM request id')
  }

  onStatus(`Sign fallback release in Anchor...`)
  const result = await signAndBroadcastZeroActions({
    expectedActor: zeroSender.trim(),
    actions: [{
      account: ZERO_BRIDGE_ACCOUNT,
      name: 'relayztoe',
      data: {
        request_id: requestId,
      },
    }],
  })

  onStatus(`Fallback release submitted. Waiting for EVM funds...`, result.transactionId)
  return {
    transactionId: result.transactionId,
    requestId,
  }
}

export async function proveEvmToZeroBridgeRequest({
  proof,
  onStatus,
}: {
  proof: EvmToZeroProofRequest
  onStatus: (message: string, txHash?: string) => void
}): Promise<EvmToZeroProofResult> {
  if (!proof.requestHash) throw new Error('Missing EVM request proof hash')
  if (!proof.receiver.trim()) throw new Error('Missing Telos Zero receiver')

  onStatus(`Sign Zero mint proof in Anchor...`)
  const result = await signAndBroadcastZeroActions({
    actions: [{
      account: ZERO_BRIDGE_ACCOUNT,
      name: 'proveetoz',
      data: {
        pair_id: proof.pairId,
        evm_request_id: strip0x(proof.requestHash).toLowerCase(),
        receiver: proof.receiver.trim(),
        quantity: proof.quantity,
        evm_sender: strip0x(proof.evmSender).toLowerCase(),
      },
    }],
  })

  onStatus(`Zero mint proof submitted. Waiting for Telos Zero mint...`, result.transactionId)
  return {
    transactionId: result.transactionId,
    requestHash: proof.requestHash,
  }
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
  const requestHash = args?.requestHash as `0x${string}` | undefined

  if (!requestHash) {
    throw new Error('Bridge deposit confirmed, but the EvmToZeroRequested event was not found')
  }

  const proofAmount = BigInt(args?.amount ?? amountLD)
  const proofSender = getAddress(args?.sender ?? fromAddress)
  const proofReceiver = typeof args?.zeroReceiver === 'string' ? args.zeroReceiver : zeroReceiver.trim()

  onStatus('EVM escrow request confirmed. Ready for Zero mint proof...', txHash)
  return {
    txHash,
    requestId: args?.requestId?.toString(),
    requestHash,
    proof: {
      pairId: Number(args?.pairId ?? asset.pairId),
      requestHash,
      receiver: proofReceiver,
      quantity: formatAntelopeQuantityRaw(proofAmount, asset.decimals, asset.zeroSymbol),
      evmSender: proofSender,
    },
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
  const quantity = formatAntelopeQuantityRaw(amountRaw, asset.decimals, asset.zeroSymbol)
  const receiver = getAddress(evmReceiver)
  const latestRequestId = await getLatestZeroToEvmRequestId()

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

  onStatus(`Zero burn request submitted. Finding bridge request...`, result.transactionId)
  const request = await waitForZeroToEvmBridgeRequest({
    token,
    amount,
    zeroSender,
    evmReceiver,
    afterRequestId: latestRequestId,
  })

  onStatus(`${quantity} burn recorded. Waiting for automatic EVM release.`, result.transactionId)

  return {
    transactionId: result.transactionId,
    requestId: Number(request.request_id),
    burnId: request.burn_id,
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
