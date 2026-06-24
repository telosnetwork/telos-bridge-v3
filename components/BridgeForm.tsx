'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useAccount, useBalance, useSwitchChain, useWalletClient, usePublicClient, useReadContract } from 'wagmi'
import { createPublicClient, formatUnits, http, isAddress, parseAbiItem, parseEther, type Address } from 'viem'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { SUPPORTED_CHAINS, CHAIN_MAP, TELOS_EVM_TESTNET_CHAIN_ID, TELOS_ZERO_TESTNET_CHAIN_ID, isTelosZeroChain } from '@/lib/chains'
import { TOKEN_ICONS } from '@/lib/constants'
import { CHAIN_RPC_URLS } from '@/lib/rpcs'
import { isTlosOftRoute, quoteOftSend, executeOftSend, isMstOftRoute, quoteMstSend, executeMstSend, getMstSupportedChains, TLOS_OFT_ADDRESSES, MST_OFT_ADDRESSES, type OftQuoteResult } from '@/lib/oft'
import { isOftV2Route, getAvailableOftV2Tokens, quoteOftV2Send, executeOftV2Send, OFT_V2_TOKENS, type OftV2QuoteResult } from '@/lib/oft-v2'
import { claimEmpiresTestTokens, executeZeroBridgeSend, executeZeroToEvmBridgeSend, findLatestZeroToEvmBridgeRequest, getZeroBridgeBalance, getZeroBridgeChainsForToken, getZeroBridgeProcessedRequest, getZeroBridgeReceiveSymbol, getZeroBridgeSendSymbol, getZeroBridgeTestMintAmount, getZeroBridgeTokenAddress, getZeroBridgeTokens, hasZeroBridgeConfig, isZeroBridgeEvmToZeroRoute, isZeroBridgeRoute, isZeroBridgeZeroToEvmRoute, mintZeroBridgeTestToken, proveEvmToZeroBridgeRequest, quoteZeroBridgeSend, relayZeroToEvmBridgeRequest, type EvmToZeroProofRequest, type ZeroBridgeQuoteResult } from '@/lib/zero-route'
import { buildZeroNativeTlosTransfer, executeZeroNativeTlosTransfer, formatEvmTlosBalance, getEvmTlosBalanceWei, getZeroNativeTlosChainsForToken, getZeroNativeTlosTokens, getZeroTlosBalance, isValidZeroAccountName, isZeroNativeTlosRoute, quoteZeroNativeTlosSend, type ZeroNativeTlosQuoteResult } from '@/lib/zero-native-tlos'
import { connectZeroSigner, type ZeroSignerAccount } from '@/lib/zero-signer'
import { EVM_ESCROW_BRIDGE, EVM_ESCROW_BRIDGE_ABI } from '@/lib/zero-evm-demo'
import { AmountInput } from './AmountInput'
import { ChainSelectorModal } from './ChainSelectorModal'
import { TokenSelectorModal } from './TokenSelectorModal'
import { LoadingSpinner, SkeletonLoader } from './LoadingSpinner'
import { QuoteDisplay } from './QuoteDisplay'
import { BridgeSettings } from './BridgeSettings'
import { ErrorDisplay, createError, type ErrorInfo } from './ErrorDisplay'
import { TransactionStepper, type TransactionStep } from './TransactionStepper'
import { RecentTransactions, addTransaction, updateTransaction, type BridgeTransaction } from './RecentTransactions'
import { SuccessCelebration } from './SuccessCelebration'
import { useAnimation } from './AnimationProvider'
import { fetchLayerZeroTxStatus, isLayerZeroTerminalStatus } from '@/lib/layerzeroscan'

// Token logos for the "You receive" section
const TOKEN_LOGOS = TOKEN_ICONS
const ISSUE_REPORT_BASE_URL = 'https://github.com/telosnetwork/telos-bridge-v3/issues/new'

// ERC20 ABI for balanceOf
const ERC20_ABI = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: 'balance', type: 'uint256' }] },
  { name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint8' }] },
  { name: 'symbol', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'string' }] },
]

interface ZeroToEvmPendingRelease {
  requestId: number
  burnId: string
  zeroSender: string
  quantity: string
  receiver: Address
  tokenAddress: Address
  baselineRaw: bigint
  expectedRaw: bigint
  symbol: string
  releaseSearchFromBlock?: bigint
}

const ZERO_TO_EVM_RELEASED_EVENT = parseAbiItem(
  'event ZeroToEvmReleased(bytes32 indexed zeroBurnId, uint256 indexed pairId, address indexed receiver, uint256 amount, string zeroSender)'
)

function normalizeBytes32(value: string): `0x${string}` {
  return `0x${value.replace(/^0x/i, '').toLowerCase().padStart(64, '0')}` as `0x${string}`
}

// Get token address on a given chain
function getTokenAddress(token: string, chainId: number): string | undefined {
  if (token === 'TLOS') {
    return chainId === 40 ? undefined : TLOS_OFT_ADDRESSES[chainId]
  }
  // MST OFT
  if (token === 'MST' && MST_OFT_ADDRESSES[chainId]) return MST_OFT_ADDRESSES[chainId]
  // V2 OFT tokens (Stargate or LZ)
  const v2Config = OFT_V2_TOKENS[token]
  if (v2Config) {
    if (chainId === 40) return v2Config.address
    return v2Config.peers[chainId]
  }
  return undefined
}

// Canonical token addresses (for balance checking - NOT OFT adapters/pools)
// For Stargate tokens: use the underlying ERC20, not the Stargate pool
// For WBTC: on ETH it's the canonical WBTC, on other chains the OFT IS the token
const CANONICAL_TOKENS: Record<string, Record<number, string>> = {
  USDC: {
    40: '0xF1815bd50389c46847f0Bda824eC8da914045D14',   // Telos: Bridged USDC (Stargate)
    1: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',    // ETH: USDC
    8453: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',  // Base: USDC
    56: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d',    // BSC: USDC
    42161: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // Arbitrum: USDC
    137: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',   // Polygon: USDC
    43114: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', // Avalanche: USDC
    10: '0x0b2c639c533813f4aa9d7837caf62653d097ff85',    // OP: USDC
    534352: '0x06eFdBFf2a14a7c8E15944D1F4A48F9F95F663A4', // Scroll: USDC
    5000: '0x09Bc4E0D10E52d373A6010e0e42ae39b59ac6320',   // Mantle: USDC
    1329: '0x3894085Ef7Ff0f0aeDf52E2A2704928d1Ec074F1',   // Sei: USDC
    100: '0xDDAfBB505ad214D7b80b1f830fcCc89B60fb7A83',    // Gnosis: USDC
  },
  USDT: {
    40: '0x674843C06FF83502ddb4D37c2E09C01cdA38cbc8',   // Telos: USDT
    1: '0xdac17f958d2ee523a2206206994597c13d831ec7',    // ETH: USDT
    56: '0x55d398326f99059ff775485246999027b3197955',    // BSC: USDT
    42161: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', // Arbitrum: USDT
    137: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f',   // Polygon: USDT
    43114: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7', // Avalanche: USDT
    10: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',    // OP: USDT
    5000: '0x201EBa5CC46D216Ce6DC03F6a759e8E766e956aE',   // Mantle: USDT
  },
  WBTC: {
    40: '0x0555E30da8f98308EdB960aa94C0Db47230d2B9c',   // Telos: WBTC OFT (IS the token)
    1: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',    // ETH: canonical WBTC (OFT is adapter)
    56: '0x0555E30da8f98308EdB960aa94C0Db47230d2B9c',    // BSC: WBTC OFT (IS the token)
    43114: '0x0555E30da8f98308EdB960aa94C0Db47230d2B9c', // AVAX: WBTC OFT (IS the token)
    8453: '0x0555E30da8f98308EdB960aa94C0Db47230d2B9c',  // Base: WBTC OFT (IS the token)
    10: '0x68f180fcCe6836688e9084f035309E29Bf0A2095',    // OP: canonical WBTC
  },
  ETH: {
    40: '0xBAb93B7ad7fE8692A878B95a8e689423437cc500',   // Telos: WETH underlying
    // On ETH/Base/Arb/OP etc, ETH is the NATIVE token - use native balance, not ERC20
    // Don't add entries here for chains where ETH is native
  },
}

// Get canonical token address for balance checking
function getCanonicalTokenAddress(token: string, chainId: number): string | undefined {
  if (token === 'TLOS') return getTokenAddress(token, chainId)
  
  // ETH is native on most chains - only check ERC20 on Telos
  if (token === 'ETH') {
    if (chainId === 40) return CANONICAL_TOKENS['ETH']?.[40]
    return undefined // Use native balance on other chains
  }
  
  // Check canonical mapping first
  if (CANONICAL_TOKENS[token]?.[chainId]) {
    return CANONICAL_TOKENS[token][chainId]
  }
  
  // Fall back to OFT address (for chains not in canonical map)
  return getTokenAddress(token, chainId)
}

function getChainLabel(chainId: number): string {
  return CHAIN_MAP.get(chainId)?.name ?? `Chain ${chainId}`
}

function buildIssueReportUrl({
  token,
  fromChain,
  toChain,
  amount,
  walletChainId,
  routeLabel,
  error,
}: {
  token: string
  fromChain: number
  toChain: number
  amount: string
  walletChainId?: number
  routeLabel: string
  error: ErrorInfo | null
}) {
  const fromChainLabel = getChainLabel(fromChain)
  const toChainLabel = getChainLabel(toChain)
  const walletChainLabel = walletChainId ? `${getChainLabel(walletChainId)} (${walletChainId})` : 'Not connected'

  const bodyLines = [
    '## What happened',
    'Describe the issue you ran into.',
    '',
    '## Route context',
    `- Token: ${token}`,
    `- From chain: ${fromChainLabel} (${fromChain})`,
    `- To chain: ${toChainLabel} (${toChain})`,
    `- Amount entered: ${amount || 'Not provided'}`,
    `- Route type: ${routeLabel}`,
    `- Wallet network: ${walletChainLabel}`,
  ]

  if (error) {
    bodyLines.push(
      '',
      '## App error',
      `- Error type: ${error.type}`,
      `- Message: ${error.message}`,
    )

    if (error.details) {
      bodyLines.push(`- Details: ${error.details}`)
    }
  }

  bodyLines.push(
    '',
    '## Reproduction steps',
    '1. Open the bridge route above.',
    '2. Enter the same token, chains, and amount.',
    '3. Describe what happened next.',
  )

  const params = new URLSearchParams({
    title: `Bridge issue: ${token} ${fromChainLabel} -> ${toChainLabel}`,
    body: bodyLines.join('\n'),
  })

  return `${ISSUE_REPORT_BASE_URL}?${params.toString()}`
}

export function BridgeForm() {
  const { address, chainId: walletChainId } = useAccount()
  const { openConnectModal } = useConnectModal()
  const { switchChainAsync } = useSwitchChain()
  const { data: walletClient } = useWalletClient()
  const { reduceMotion } = useAnimation()
  const [fromChain, setFromChain] = useState(TELOS_EVM_TESTNET_CHAIN_ID)
  const [toChain, setToChain] = useState(TELOS_ZERO_TESTNET_CHAIN_ID)
  const [token, setToken] = useState('USDC')
  const [amount, setAmount] = useState('')
  const [zeroReceiver, setZeroReceiver] = useState('')
  const [zeroSender, setZeroSender] = useState('')
  const [evmReceiver, setEvmReceiver] = useState('')
  const [zeroTlosBalance, setZeroTlosBalance] = useState<string | undefined>()
  const [zeroBridgeBalance, setZeroBridgeBalance] = useState<string | undefined>()
  const [zeroSigner, setZeroSigner] = useState<ZeroSignerAccount | null>(null)
  const [connectingZeroSigner, setConnectingZeroSigner] = useState(false)
  const [slippage, setSlippage] = useState(0.5)
  const [showSettings, setShowSettings] = useState(false)

  const [quoting, setQuoting] = useState(false)
  const [oftQuote, setOftQuote] = useState<OftQuoteResult | null>(null)
  const [v2Quote, setV2Quote] = useState<OftV2QuoteResult | null>(null)
  const [zeroQuote, setZeroQuote] = useState<ZeroBridgeQuoteResult | null>(null)
  const [zeroNativeQuote, setZeroNativeQuote] = useState<ZeroNativeTlosQuoteResult | null>(null)
  const [error, setError] = useState<ErrorInfo | null>(null)
  const [bridging, setBridging] = useState(false)
  const [bridgeStatus, setBridgeStatus] = useState<string | null>(null)
  const [transactionStep, setTransactionStep] = useState<TransactionStep>('idle')
  const [transactionHash, setTransactionHash] = useState<string | undefined>()
  const [destinationTransactionHash, setDestinationTransactionHash] = useState<string | undefined>()
  const [destinationTransactionChainId, setDestinationTransactionChainId] = useState<number | undefined>()
  const [zeroRequestHash, setZeroRequestHash] = useState<`0x${string}` | undefined>()
  const [currentTransactionId, setCurrentTransactionId] = useState<string | undefined>()
  const [showRecentTransactions, setShowRecentTransactions] = useState(false)
  const [showSuccessCelebration, setShowSuccessCelebration] = useState(false)
  const [mintingTestToken, setMintingTestToken] = useState(false)
  const [testMintStatus, setTestMintStatus] = useState<string | null>(null)
  const [claimingEmpires, setClaimingEmpires] = useState(false)
  const [empiresFaucetStatus, setEmpiresFaucetStatus] = useState<string | null>(null)
  const [zeroNativePending, setZeroNativePending] = useState<{
    receiver: Address
    baselineWei: bigint
    expectedWei: bigint
  } | null>(null)
  const [evmToZeroPending, setEvmToZeroPending] = useState<EvmToZeroProofRequest | null>(null)
  const [zeroToEvmPending, setZeroToEvmPending] = useState<ZeroToEvmPendingRelease | null>(null)
  const sourceEvmChainId = isTelosZeroChain(fromChain) ? undefined : fromChain
  const wagmiPublicClient = usePublicClient({ chainId: sourceEvmChainId })
  // Fallback: create a direct viem client if wagmi hasn't hydrated yet
  const publicClient = wagmiPublicClient ?? (sourceEvmChainId && CHAIN_RPC_URLS[sourceEvmChainId] ? createPublicClient({
    transport: http(CHAIN_RPC_URLS[sourceEvmChainId]),
  }) : undefined)
  const quoteTimeout = useRef<NodeJS.Timeout | null>(null)

  const { data: nativeBalance } = useBalance({
    address,
    chainId: sourceEvmChainId,
    query: { enabled: Boolean(address && sourceEvmChainId) },
  })

  const isNativeToken = (token === 'TLOS' && fromChain === 40) || (token === 'ETH' && Boolean(sourceEvmChainId) && fromChain !== 40)
  const isZeroEvmToZeroRoute = isZeroBridgeEvmToZeroRoute(token, fromChain, toChain)
  const isZeroToEvmRoute = isZeroBridgeZeroToEvmRoute(token, fromChain, toChain)
  const isZeroRoute = isZeroBridgeRoute(token, fromChain, toChain)
  const isZeroNativeTlos = isZeroNativeTlosRoute(token, fromChain, toChain)
  const isZeroSignedRoute = isZeroNativeTlos || isZeroToEvmRoute
  const needsZeroSignerConnection = isZeroSignedRoute && !zeroSigner
  const isEvmToZeroMintProofPending = isZeroEvmToZeroRoute && Boolean(evmToZeroPending) && transactionStep === 'bridging'
  const zeroRouteConfigured = !isZeroRoute || hasZeroBridgeConfig(token)
  const zeroToEvmPublicClient = useMemo(() => {
    if (!isZeroSignedRoute) return undefined
    const rpcUrl = CHAIN_RPC_URLS[TELOS_EVM_TESTNET_CHAIN_ID]
    return rpcUrl ? createPublicClient({ transport: http(rpcUrl) }) : undefined
  }, [isZeroSignedRoute])

  // Get ERC20 token address for the selected token on fromChain
  const tokenAddress = isZeroEvmToZeroRoute ? getZeroBridgeTokenAddress(token) : getCanonicalTokenAddress(token, fromChain)

  // Fetch ERC20 balance when the selected asset is not the native coin on this chain.
  const { data: erc20BalanceData, refetch: refetchErc20Balance } = useReadContract({
    address: tokenAddress as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    chainId: sourceEvmChainId,
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!sourceEvmChainId && !!tokenAddress && !isNativeToken }
  })

  const { data: erc20Decimals } = useReadContract({
    address: tokenAddress as `0x${string}`,
    abi: ERC20_ABI,
    functionName: 'decimals',
    chainId: sourceEvmChainId,
    query: { enabled: !!sourceEvmChainId && !!tokenAddress && !isNativeToken }
  })

  // Combine native and ERC20 balance
  // For TLOS on Telos: use native balance
  // For ETH on non-Telos chains: use native balance (ETH is native)
  // For ERC20 tokens: use ERC20 balance
  let displayBalance = isNativeToken ? nativeBalance : undefined

  if (isZeroNativeTlos && zeroTlosBalance !== undefined) {
    displayBalance = {
      formatted: zeroTlosBalance,
      value: BigInt(0),
      decimals: 4,
      symbol: 'TLOS',
    } as any
  }

  if (isZeroToEvmRoute && zeroBridgeBalance !== undefined) {
    displayBalance = {
      formatted: zeroBridgeBalance,
      value: BigInt(0),
      decimals: 0,
      symbol: getZeroBridgeReceiveSymbol(token, fromChain, toChain) ?? token,
    } as any
  }
  
  if (!isZeroSignedRoute && !isNativeToken && erc20BalanceData !== undefined && erc20Decimals !== undefined) {
    const bal = BigInt(erc20BalanceData as any)
    const dec = Number(erc20Decimals)
    displayBalance = {
      ...nativeBalance,
      formatted: formatUnits(bal, dec),
      value: bal,
      decimals: dec,
      symbol: token,
    } as any
  } else if (token === 'ETH' && fromChain !== 40 && nativeBalance) {
    // ETH on non-Telos chains: show native balance with ETH symbol
    displayBalance = {
      ...nativeBalance,
      symbol: 'ETH',
    } as any
  }

  const isOft = !isZeroRoute && !isZeroNativeTlos && isTlosOftRoute(fromChain, toChain, token, token)
  const isMst = !isZeroRoute && !isZeroNativeTlos && isMstOftRoute(fromChain, toChain, token, token)
  const isV2 = !isZeroRoute && !isZeroNativeTlos && !isOft && !isMst && isOftV2Route(token, fromChain, toChain)
  const hasQuote = !!(oftQuote || v2Quote || zeroQuote || zeroNativeQuote)
  const wrongNetwork = Boolean(!isZeroSignedRoute && address && sourceEvmChainId && walletChainId !== sourceEvmChainId)

  const chainName = (id: number) => getChainLabel(id)
  const chainIcon = (id: number) => CHAIN_MAP.get(id)?.icon

  // Check for insufficient balance
  const insufficientBalance = !!((address || isZeroSignedRoute) && displayBalance && amount && parseFloat(amount) > parseFloat(displayBalance.formatted))
  const canRelayLatestZeroToEvm = Boolean(
    isZeroToEvmRoute &&
    !zeroToEvmPending &&
    amount &&
    parseFloat(amount) > 0 &&
    isValidZeroAccountName(zeroSender) &&
    isAddress(evmReceiver)
  )
  const routeLabel = isMst
    ? 'MST OFT V1'
    : isOft
      ? 'TLOS OFT V1'
      : isZeroNativeTlos
        ? 'Telos Zero -> Telos EVM TLOS'
        : isZeroToEvmRoute
          ? 'Telos Zero -> Telos EVM'
          : isZeroEvmToZeroRoute
            ? 'Telos EVM -> Telos Zero'
            : isV2
              ? 'OFT V2'
              : 'Unsupported or unknown route'
  const issueReportUrl = buildIssueReportUrl({
    token,
    fromChain,
    toChain,
    amount,
    walletChainId,
    routeLabel,
    error,
  })
  const sendTokenSymbol = isZeroRoute ? getZeroBridgeSendSymbol(token, fromChain, toChain) ?? token : token
  const receiveTokenSymbol = isZeroRoute ? getZeroBridgeReceiveSymbol(token, fromChain, toChain) ?? token : token

  // Get chains that support the selected token
  const getChainsForToken = useCallback((tok: string) => {
    const chainIds = new Set<number>()
    // TLOS V1 OFT chains
    if (tok === 'TLOS') {
      Object.keys(TLOS_OFT_ADDRESSES).forEach(id => chainIds.add(Number(id)))
    }
    // MST V1 OFT chains
    else if (tok === 'MST') {
      Object.keys(MST_OFT_ADDRESSES).forEach(id => chainIds.add(Number(id)))
    }
    // V2 OFT tokens: Telos + peer chains
    else if (OFT_V2_TOKENS[tok]) {
      chainIds.add(40) // Telos always
      Object.keys(OFT_V2_TOKENS[tok].peers).forEach(id => chainIds.add(Number(id)))
    }
    getZeroNativeTlosChainsForToken(tok).forEach(id => chainIds.add(id))
    getZeroBridgeChainsForToken(tok).forEach(id => chainIds.add(id))
    return SUPPORTED_CHAINS.filter(c => chainIds.has(c.id))
  }, [])

  const filteredChains = getChainsForToken(token)

  // Build token list: TLOS (always) + V2 OFT tokens available for this route
  const availableTokens = useCallback(() => {
    const zeroNativeTokens = getZeroNativeTlosTokens(fromChain, toChain)
    const zeroTokens = getZeroBridgeTokens(fromChain, toChain)
    const zeroRouteTokens = [...zeroNativeTokens, ...zeroTokens]
    if (zeroRouteTokens.length) return Array.from(new Set(zeroRouteTokens))

    const tokens = ['TLOS']
    const mstChains = getMstSupportedChains()
    if (mstChains.includes(fromChain) && mstChains.includes(toChain)) {
      tokens.push('MST')
    }
    const v2tokens = getAvailableOftV2Tokens(fromChain, toChain)
    tokens.push(...v2tokens)
    return tokens
  }, [fromChain, toChain])

  const tokenList = availableTokens()

  // Reset token if not available on new route
  useEffect(() => {
    if (!tokenList.includes(token)) setToken(tokenList[0] || 'TLOS')
  }, [tokenList, token])

  useEffect(() => {
    if (!isZeroNativeTlos || !isValidZeroAccountName(zeroSender)) {
      setZeroTlosBalance(undefined)
      return
    }

    let cancelled = false
    const timeoutId = setTimeout(async () => {
      try {
        const balance = await getZeroTlosBalance(zeroSender)
        if (!cancelled) setZeroTlosBalance(balance)
      } catch {
        if (!cancelled) setZeroTlosBalance(undefined)
      }
    }, 350)

    return () => {
      cancelled = true
      clearTimeout(timeoutId)
    }
  }, [isZeroNativeTlos, zeroSender])

  useEffect(() => {
    if (!isZeroToEvmRoute || !isValidZeroAccountName(zeroSender)) {
      setZeroBridgeBalance(undefined)
      return
    }

    let cancelled = false
    const timeoutId = setTimeout(async () => {
      try {
        const balance = await getZeroBridgeBalance(token, zeroSender)
        if (!cancelled) setZeroBridgeBalance(balance)
      } catch {
        if (!cancelled) setZeroBridgeBalance(undefined)
      }
    }, 350)

    return () => {
      cancelled = true
      clearTimeout(timeoutId)
    }
  }, [isZeroToEvmRoute, token, zeroSender])

  useEffect(() => {
    if (isZeroSignedRoute && address && !evmReceiver) {
      setEvmReceiver(address)
    }
  }, [isZeroSignedRoute, address, evmReceiver])

  // Reset chains if not valid for selected token
  useEffect(() => {
    const validIds = filteredChains.map(c => c.id)
    if (!validIds.includes(fromChain)) {
      setFromChain(validIds[0] || 40)
    }
    if (!validIds.includes(toChain) || toChain === fromChain) {
      const other = validIds.find(id => id !== fromChain)
      if (other) setToChain(other)
    }
  }, [token, filteredChains, fromChain])

  const clearQuotes = () => { 
    setOftQuote(null); setV2Quote(null); setZeroQuote(null); setZeroNativeQuote(null); setError(null); setBridgeStatus(null);
    setTransactionStep('idle'); setTransactionHash(undefined); setDestinationTransactionHash(undefined); setDestinationTransactionChainId(undefined); setZeroRequestHash(undefined); setCurrentTransactionId(undefined);
	    setZeroNativePending(null); setEvmToZeroPending(null); setZeroToEvmPending(null);
    setShowSuccessCelebration(false);
  }

  const doQuote = useCallback(async () => {
    if (!amount || parseFloat(amount) <= 0 || (!publicClient && !isZeroRoute && !isZeroNativeTlos)) return
    if (isZeroEvmToZeroRoute && !zeroReceiver.trim()) return
    if (isZeroSignedRoute && (!isValidZeroAccountName(zeroSender) || !isAddress(evmReceiver))) return
    setQuoting(true); setError(null); setOftQuote(null); setV2Quote(null); setZeroQuote(null); setZeroNativeQuote(null)
    try {
      if (isZeroNativeTlos) {
        setZeroNativeQuote(quoteZeroNativeTlosSend(amount))
      } else if (isZeroRoute) {
        if (!zeroRouteConfigured) {
          throw new Error('Missing Telos Zero bridge testnet configuration')
        }
        setZeroQuote(quoteZeroBridgeSend(token, amount, isZeroToEvmRoute ? 'zero-to-evm' : 'evm-to-zero'))
      } else if (isOft && publicClient) {
        const oq = await quoteOftSend(publicClient, fromChain, toChain, amount,
          address || '0x0000000000000000000000000000000000000001' as `0x${string}`)
        setOftQuote(oq)
      } else if (isMst && publicClient) {
        const mq = await quoteMstSend(publicClient, fromChain, toChain, amount,
          address || '0x0000000000000000000000000000000000000001' as `0x${string}`)
        setOftQuote(mq)
      } else if (isV2 && publicClient) {
        const vq = await quoteOftV2Send(publicClient, token, fromChain, toChain, amount,
          address || '0x0000000000000000000000000000000000000001' as `0x${string}`)
        setV2Quote(vq)
      } else {
        setError(createError('unsupported_route', `${token} cannot be bridged on this route`, 
          `No available bridge routes found for ${token} from ${chainName(fromChain)} to ${chainName(toChain)}`))
      }
    } catch (e: any) {
      const message = e.message || 'Failed to get quote'
      setError(createError('quote_failed', 'Unable to get bridge quote', message))
    } finally { setQuoting(false) }
  }, [fromChain, toChain, token, amount, address, publicClient, isOft, isMst, isV2, isZeroRoute, isZeroEvmToZeroRoute, isZeroToEvmRoute, isZeroSignedRoute, isZeroNativeTlos, zeroRouteConfigured, zeroReceiver, zeroSender, evmReceiver])

  // Auto-quote with debounce
  useEffect(() => {
    if (quoteTimeout.current) clearTimeout(quoteTimeout.current)
    setOftQuote(null); setV2Quote(null); setZeroQuote(null)
    if (!amount || parseFloat(amount) <= 0) return
    if (isZeroEvmToZeroRoute && !zeroReceiver.trim()) return
    if (isZeroSignedRoute && (!isValidZeroAccountName(zeroSender) || !isAddress(evmReceiver))) return
    quoteTimeout.current = setTimeout(() => doQuote(), 800)
    return () => { if (quoteTimeout.current) clearTimeout(quoteTimeout.current) }
  }, [amount, fromChain, toChain, token, zeroReceiver, zeroSender, evmReceiver, isZeroEvmToZeroRoute, isZeroSignedRoute, doQuote])

  useEffect(() => {
    if (isTelosZeroChain(fromChain) || isTelosZeroChain(toChain)) {
      return
    }
    if (!transactionHash || !currentTransactionId || transactionStep === 'idle' || transactionStep === 'completed') {
      return
    }

    let cancelled = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let controller: AbortController | null = null
    const destinationChainLabel = getChainLabel(toChain)

    const scheduleNextPoll = () => {
      if (!cancelled) {
        timeoutId = setTimeout(pollDeliveryStatus, 8000)
      }
    }

    const pollDeliveryStatus = async () => {
      controller?.abort()
      controller = new AbortController()

      try {
        const status = await fetchLayerZeroTxStatus(transactionHash, controller.signal)

        if (cancelled || !status) {
          scheduleNextPoll()
          return
        }

        if (status.status === 'DELIVERED') {
          setBridgeStatus(`Destination confirmed on ${destinationChainLabel}.`)
          setTransactionStep('completed')
          setShowSuccessCelebration(true)
          if (status.destinationTxHash) {
            setDestinationTransactionHash(status.destinationTxHash)
            setDestinationTransactionChainId(toChain)
          }
          updateTransaction(currentTransactionId, {
            status: 'completed',
            toTxHash: status.destinationTxHash,
            toTxChain: toChain,
          })
          return
        }

        if (status.status === 'CONFIRMING') {
          setBridgeStatus(`Destination transaction submitted on ${destinationChainLabel}. Waiting for finality...`)
          setTransactionStep('bridging')
          if (status.destinationTxHash) {
            setDestinationTransactionHash(status.destinationTxHash)
            setDestinationTransactionChainId(toChain)
          }
          updateTransaction(currentTransactionId, {
            status: 'pending',
            toTxHash: status.destinationTxHash,
            toTxChain: toChain,
          })
          scheduleNextPoll()
          return
        }

        if (status.status === 'INFLIGHT') {
          setBridgeStatus(`Waiting for LayerZero delivery to ${destinationChainLabel}...`)
          setTransactionStep('bridging')
          updateTransaction(currentTransactionId, {
            status: 'pending',
          })
          scheduleNextPoll()
          return
        }

        if (isLayerZeroTerminalStatus(status.status)) {
          if (status.destinationTxHash) {
            setDestinationTransactionHash(status.destinationTxHash)
            setDestinationTransactionChainId(toChain)
          }
          setBridgeStatus(null)
          setError(createError(
            'bridge_failed',
            'Destination delivery failed',
            status.statusMessage || `LayerZero reported ${status.status} for this message.`,
          ))
          updateTransaction(currentTransactionId, {
            status: 'failed',
            toTxHash: status.destinationTxHash,
            toTxChain: toChain,
          })
          return
        }

        scheduleNextPoll()
      } catch {
        scheduleNextPoll()
      }
    }

    pollDeliveryStatus()

    return () => {
      cancelled = true
      controller?.abort()
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [transactionHash, currentTransactionId, transactionStep, fromChain, toChain])

  useEffect(() => {
    if (!isZeroEvmToZeroRoute || !zeroRequestHash || !currentTransactionId || transactionStep !== 'bridging') {
      return
    }

    let cancelled = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const scheduleNextPoll = () => {
      if (!cancelled) {
        timeoutId = setTimeout(pollZeroStatus, 5000)
      }
    }

    const pollZeroStatus = async () => {
      try {
        const processedRequest = await getZeroBridgeProcessedRequest(zeroRequestHash)

        if (cancelled) return

        if (processedRequest) {
          setBridgeStatus(`${processedRequest.quantity} minted to ${processedRequest.receiver} on Telos Zero.`)
          setTransactionStep('completed')
          setShowSuccessCelebration(true)
          setEvmToZeroPending(null)
          updateTransaction(currentTransactionId, {
            status: 'completed',
          })
          return
        }
      } catch {
        // Keep polling. Temporary RPC or API failures should not strand the visible progress state.
      }

      scheduleNextPoll()
    }

    pollZeroStatus()

    return () => {
      cancelled = true
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [isZeroEvmToZeroRoute, zeroRequestHash, currentTransactionId, transactionStep])

  useEffect(() => {
    if (!isZeroNativeTlos || !zeroToEvmPublicClient || !zeroNativePending || !currentTransactionId) {
      return
    }
    if (transactionStep !== 'confirming' && transactionStep !== 'bridging') {
      return
    }

    let cancelled = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const scheduleNextPoll = () => {
      if (!cancelled) {
        timeoutId = setTimeout(pollEvmBalance, 5000)
      }
    }

    const pollEvmBalance = async () => {
      try {
        const balanceWei = await getEvmTlosBalanceWei(zeroToEvmPublicClient, zeroNativePending.receiver)
        if (cancelled) return

        if (balanceWei >= zeroNativePending.baselineWei + zeroNativePending.expectedWei) {
          setBridgeStatus(`${formatEvmTlosBalance(balanceWei)} TLOS available on Telos EVM.`)
          setTransactionStep('completed')
          setShowSuccessCelebration(true)
          updateTransaction(currentTransactionId, { status: 'completed' })
          return
        }

        setTransactionStep((current) => current === 'confirming' ? 'bridging' : current)
      } catch {
        // Keep polling through short-lived EVM RPC errors.
      }

      scheduleNextPoll()
    }

    pollEvmBalance()

    return () => {
      cancelled = true
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [isZeroNativeTlos, zeroToEvmPublicClient, zeroNativePending, currentTransactionId, transactionStep])

  useEffect(() => {
    if (!isZeroToEvmRoute || !zeroToEvmPublicClient || !zeroToEvmPending || !currentTransactionId) {
      return
    }
    if (transactionStep !== 'confirming' && transactionStep !== 'bridging') {
      return
    }

    let cancelled = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const scheduleNextPoll = () => {
      if (!cancelled) {
        timeoutId = setTimeout(pollEvmTokenBalance, 5000)
      }
    }

    const pollEvmTokenBalance = async () => {
      try {
        const balance = await zeroToEvmPublicClient.readContract({
          address: zeroToEvmPending.tokenAddress,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [zeroToEvmPending.receiver],
        }) as bigint
        if (cancelled) return

        if (balance >= zeroToEvmPending.baselineRaw + zeroToEvmPending.expectedRaw) {
          let releaseTxHash: `0x${string}` | undefined
          if (EVM_ESCROW_BRIDGE) {
            try {
              const releaseLogs = await zeroToEvmPublicClient.getLogs({
                address: EVM_ESCROW_BRIDGE,
                event: ZERO_TO_EVM_RELEASED_EVENT,
                args: {
                  zeroBurnId: normalizeBytes32(zeroToEvmPending.burnId),
                  receiver: zeroToEvmPending.receiver,
                },
                fromBlock: zeroToEvmPending.releaseSearchFromBlock,
                toBlock: 'latest',
              })
              releaseTxHash = releaseLogs[releaseLogs.length - 1]?.transactionHash
            } catch {
              // Balance confirmation is authoritative enough for completion; tx links can appear on a later history refresh.
            }
          }
          if (releaseTxHash) {
            setDestinationTransactionHash(releaseTxHash)
            setDestinationTransactionChainId(TELOS_EVM_TESTNET_CHAIN_ID)
          }
          setBridgeStatus(`${zeroToEvmPending.symbol} released on Telos EVM.`)
          setTransactionStep('completed')
          setShowSuccessCelebration(true)
          updateTransaction(currentTransactionId, {
            status: 'completed',
            toTxHash: releaseTxHash,
            toTxChain: releaseTxHash ? TELOS_EVM_TESTNET_CHAIN_ID : undefined,
          })
          return
        }

        setTransactionStep((current) => current === 'confirming' ? 'bridging' : current)
      } catch {
        // Keep polling through short-lived EVM RPC errors.
      }

      scheduleNextPoll()
    }

    pollEvmTokenBalance()

    return () => {
      cancelled = true
      if (timeoutId) clearTimeout(timeoutId)
    }
  }, [isZeroToEvmRoute, zeroToEvmPublicClient, zeroToEvmPending, currentTransactionId, transactionStep])

  const submitZeroToEvmReleaseRelay = useCallback(async (
    pending: ZeroToEvmPendingRelease,
    transactionId = currentTransactionId,
  ) => {
    setBridging(true)
    setError(null)
    setTransactionStep('bridging')
    setBridgeStatus(`${pending.quantity} burn recorded. Sign fallback release to retry.`)

    try {
      await relayZeroToEvmBridgeRequest({
        requestId: pending.requestId,
        zeroSender: pending.zeroSender,
        onStatus: (status) => {
          setBridgeStatus(status)
          if (transactionId) {
            updateTransaction(transactionId, {
              status: 'pending',
            })
          }
        },
      })

      setBridgeStatus(`${pending.quantity} fallback release submitted. Waiting for EVM funds.`)
    } catch (e: any) {
      const msg = e.message || 'Fallback release failed'
      if (msg.includes('rejected') || msg.includes('denied') || msg.includes('cancelled')) {
        setError(createError('transaction_rejected', 'Fallback release not signed',
          'The burn is recorded. Retry will only submit the fallback release.'))
      } else {
        setError(createError('bridge_failed', 'Fallback release failed', msg))
      }
      setBridgeStatus(`${pending.quantity} burn recorded. Automatic release is still pending.`)
      setTransactionStep('bridging')
    } finally {
      setBridging(false)
    }
  }, [currentTransactionId])

  const submitEvmToZeroMintProof = useCallback(async (
    pending: EvmToZeroProofRequest,
    transactionId = currentTransactionId,
  ) => {
    setBridging(true)
    setError(null)
    setTransactionStep('bridging')
    setBridgeStatus(`${pending.quantity} escrow recorded. Sign Zero mint proof to finish.`)

    try {
      await proveEvmToZeroBridgeRequest({
        proof: pending,
        onStatus: (status, txId) => {
          setBridgeStatus(status)
          if (txId) {
            setDestinationTransactionHash(txId)
            setDestinationTransactionChainId(toChain)
          }
          if (txId && transactionId) {
            updateTransaction(transactionId, { toTxHash: txId, toTxChain: toChain, status: 'pending' })
          }
        },
      })

      setBridgeStatus(`${pending.quantity} mint proof submitted. Waiting for Telos Zero mint.`)
    } catch (e: any) {
      const msg = e.message || 'Zero mint proof failed'
      if (msg.includes('rejected') || msg.includes('denied') || msg.includes('cancelled')) {
        setError(createError('transaction_rejected', 'Mint proof not signed',
          'The EVM escrow is recorded. Retry will only submit the Zero mint proof.'))
      } else {
        setError(createError('bridge_failed', 'Zero mint proof failed', msg))
      }
      setBridgeStatus(`${pending.quantity} escrow recorded. Zero mint proof still needs to be signed.`)
      setTransactionStep('bridging')
    } finally {
      setBridging(false)
    }
  }, [currentTransactionId, toChain])

  const handleRelayLatestZeroToEvmRequest = useCallback(async () => {
    if (!isZeroToEvmRoute || !zeroToEvmPublicClient) return
    if (!isValidZeroAccountName(zeroSender) || !isAddress(evmReceiver) || !amount || parseFloat(amount) <= 0) return

    const zeroTokenAddress = getZeroBridgeTokenAddress(token)
    const bridgeAddress = EVM_ESCROW_BRIDGE
    if (!zeroTokenAddress || !bridgeAddress) {
      setError(createError('quote_failed', 'Missing route config',
        'This route is missing a configured Telos EVM testnet address.'))
      return
    }

    setBridging(true)
    setError(null)
    setBridgeStatus('Finding pending release...')

    const transaction = addTransaction({
      fromChain,
      toChain,
      token,
      amount,
      status: 'pending',
    })
    setCurrentTransactionId(transaction.id)

    try {
      const receiver = evmReceiver as Address
      const [baselineRaw, request] = await Promise.all([
        zeroToEvmPublicClient.readContract({
          address: zeroTokenAddress,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [receiver],
        }) as Promise<bigint>,
        findLatestZeroToEvmBridgeRequest({
          token,
          amount,
          zeroSender,
          evmReceiver,
          isProcessed: async (request) => {
            const burnId = `0x${request.burn_id.replace(/^0x/, '')}` as `0x${string}`
            return Boolean(await zeroToEvmPublicClient.readContract({
              address: bridgeAddress,
              abi: EVM_ESCROW_BRIDGE_ABI,
              functionName: 'processedZeroBurns',
              args: [burnId],
            }))
          },
        }),
      ])

      if (!request) {
        throw new Error('No matching pending Zero-to-EVM release was found')
      }

      const quote = quoteZeroBridgeSend(token, amount, 'zero-to-evm')
      const releaseSearchFromBlock = await zeroToEvmPublicClient.getBlockNumber().catch(() => undefined)
      const pending: ZeroToEvmPendingRelease = {
        requestId: Number(request.request_id),
        burnId: request.burn_id,
        zeroSender,
        quantity: request.quantity,
        receiver,
        tokenAddress: zeroTokenAddress,
        baselineRaw,
        expectedRaw: quote.amountReceived,
        symbol: getZeroBridgeReceiveSymbol(token, fromChain, toChain) ?? token,
        releaseSearchFromBlock,
      }

      setZeroToEvmPending(pending)
      setTransactionStep('bridging')
      await submitZeroToEvmReleaseRelay(pending, transaction.id)
    } catch (e: any) {
      setError(createError('bridge_failed', 'Pending release not found', e.message || 'Unable to find a matching pending release'))
      setBridgeStatus(null)
      setTransactionStep('idle')
      updateTransaction(transaction.id, { status: 'failed' })
    } finally {
      setBridging(false)
    }
  }, [amount, evmReceiver, fromChain, isZeroToEvmRoute, submitZeroToEvmReleaseRelay, toChain, token, zeroSender, zeroToEvmPublicClient])

  const handleBridge = useCallback(async () => {
    if (isZeroNativeTlos) {
      if (!isValidZeroAccountName(zeroSender)) {
        setError(createError('quote_failed', 'Enter a Telos Zero sender',
          'This route starts from a Telos Zero account, so it needs the native account that will sign.'))
        return
      }
      if (!isAddress(evmReceiver)) {
        setError(createError('quote_failed', 'Enter a Telos EVM receiver',
          'This route credits native TLOS to a Telos EVM address.'))
        return
      }
      if (!zeroNativeQuote || !zeroToEvmPublicClient) {
        setError(createError('quote_failed', 'Get a quote first',
          'A TLOS transfer quote is required before preparing the Zero transaction.'))
        return
      }

      setBridging(true); setError(null); setBridgeStatus('Preparing Zero transaction...')
      setTransactionHash(undefined); setDestinationTransactionHash(undefined); setDestinationTransactionChainId(undefined); setZeroRequestHash(undefined); setZeroNativePending(null)
      setEvmToZeroPending(null); setZeroToEvmPending(null)

      const transaction = addTransaction({
        fromChain,
        toChain,
        token,
        amount,
        status: 'pending',
      })
      setCurrentTransactionId(transaction.id)

      try {
        const transfer = buildZeroNativeTlosTransfer({ zeroSender, evmReceiver, amount })
        const baselineWei = await getEvmTlosBalanceWei(zeroToEvmPublicClient, transfer.evmReceiver)

        setZeroNativePending({
          receiver: transfer.evmReceiver,
          baselineWei,
          expectedWei: parseEther(transfer.amountFormatted),
        })
        const result = await executeZeroNativeTlosTransfer({
          zeroSender,
          evmReceiver,
          amount,
          onStatus: (status, hash) => {
            setBridgeStatus(status)
            if (hash) {
              setTransactionHash(hash)
              updateTransaction(transaction.id, { txHash: hash })
            }
          },
        })
        setTransactionHash(result.transactionId)
        if (result.transactionId) {
          updateTransaction(transaction.id, { txHash: result.transactionId, status: 'pending' })
        }
        setTransactionStep('confirming')
      } catch (e: any) {
        const msg = e.message || 'Could not prepare Zero transfer'
        setError(createError('bridge_failed', 'Zero transfer preparation failed', msg))
        setBridgeStatus(null)
        setTransactionStep('idle')
        updateTransaction(transaction.id, { status: 'failed' })
      } finally {
        setBridging(false)
      }
      return
    }

    if (isZeroToEvmRoute) {
      if (!isValidZeroAccountName(zeroSender)) {
        setError(createError('quote_failed', 'Enter a Telos Zero sender',
          'This route starts from a Telos Zero account, so it needs the native account that will sign.'))
        return
      }
      if (!isAddress(evmReceiver)) {
        setError(createError('quote_failed', 'Enter a Telos EVM receiver',
          'This route releases the escrowed EVM asset to a Telos EVM address.'))
        return
      }
      const zeroTokenAddress = getZeroBridgeTokenAddress(token)
      if (!zeroQuote || !zeroToEvmPublicClient || !zeroTokenAddress) {
        setError(createError('quote_failed', 'Get a quote first',
          'A Zero-to-EVM bridge quote is required before sending the Zero transaction.'))
        return
      }
      if (displayBalance && parseFloat(amount) > parseFloat(displayBalance.formatted)) {
        setError(createError('insufficient_balance', `Insufficient ${sendTokenSymbol} balance`,
          `You need at least ${amount} ${sendTokenSymbol} but only have ${displayBalance.formatted} ${sendTokenSymbol}`))
        return
      }

      setBridging(true); setError(null); setBridgeStatus('Preparing Zero transaction...')
      setTransactionHash(undefined); setDestinationTransactionHash(undefined); setDestinationTransactionChainId(undefined); setZeroRequestHash(undefined); setZeroNativePending(null); setEvmToZeroPending(null); setZeroToEvmPending(null)

      const transaction = addTransaction({
        fromChain,
        toChain,
        token,
        amount,
        status: 'pending',
      })
      setCurrentTransactionId(transaction.id)

      try {
        const receiver = evmReceiver as Address
        const baselineRaw = await zeroToEvmPublicClient.readContract({
          address: zeroTokenAddress,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [receiver],
        }) as bigint
        const releaseSearchFromBlock = await zeroToEvmPublicClient.getBlockNumber().catch(() => undefined)

        const result = await executeZeroToEvmBridgeSend({
          token,
          amount,
          zeroSender,
          evmReceiver,
          onStatus: (status, hash) => {
            setBridgeStatus(status)
            if (hash) {
              setTransactionHash(hash)
              updateTransaction(transaction.id, { txHash: hash })
            }
          },
        })

        const pending: ZeroToEvmPendingRelease = {
          requestId: result.requestId,
          burnId: result.burnId,
          zeroSender: result.zeroSender,
          quantity: result.quantity,
          receiver: result.evmReceiver,
          tokenAddress: zeroTokenAddress,
          baselineRaw,
          expectedRaw: result.amountRaw,
          symbol: result.evmSymbol,
          releaseSearchFromBlock,
        }

        setZeroToEvmPending(pending)
        setZeroQuote(null)
        setTransactionHash(result.transactionId)
        if (result.transactionId) {
          updateTransaction(transaction.id, { txHash: result.transactionId, status: 'pending' })
        }
        setBridgeStatus(`${result.quantity} burn recorded. Waiting for automatic EVM release.`)
        setTransactionStep('bridging')
        setAmount('')
      } catch (e: any) {
        const msg = e.message || 'Zero-to-EVM bridge failed'
        if (msg.includes('rejected') || msg.includes('denied') || msg.includes('cancelled')) {
          setError(createError('transaction_rejected', 'Transaction rejected',
            'You declined the transaction in Anchor'))
        } else {
          setError(createError('bridge_failed', 'Bridge transaction failed', msg))
        }
        setBridgeStatus(null)
        setTransactionStep('idle')
        updateTransaction(transaction.id, { status: 'failed' })
      } finally {
        setBridging(false)
      }
      return
    }

    if (!address) {
      setError(createError('wallet_not_connected', 'Connect your wallet first', 
        'A wallet connection is required to bridge tokens'))
      return
    }
    if (isZeroEvmToZeroRoute && !zeroReceiver.trim()) {
      setError(createError('quote_failed', 'Enter a Telos Zero receiver', 
        'This route mints the fresh asset on Telos Zero, so it needs a native account name as the receiver.'))
      return
    }
    if (!hasQuote || !walletClient || !publicClient) {
      setError(createError('quote_failed', 'Get a quote first', 
        'A bridge quote is required before executing the transaction'))
      return
    }
    if (displayBalance && parseFloat(amount) > parseFloat(displayBalance.formatted)) {
      setError(createError('insufficient_balance', `Insufficient ${sendTokenSymbol} balance`, 
        `You need at least ${amount} ${sendTokenSymbol} but only have ${displayBalance.formatted} ${sendTokenSymbol}`))
      return
    }
    setBridging(true); setError(null); setBridgeStatus('Preparing…')
    setTransactionStep('submitted')
    setTransactionHash(undefined)
    setDestinationTransactionHash(undefined)
    setDestinationTransactionChainId(undefined)
    setZeroRequestHash(undefined)

    // Create transaction record in localStorage
    const transaction = addTransaction({
      fromChain,
      toChain,
      token,
      amount,
      status: 'pending',
    })
    setCurrentTransactionId(transaction.id)

    // Enhanced status callback that updates both status and stepper
    const updateProgress = (status: string, hash?: string) => {
      // Extract tx hash from status messages that include a LayerZero tracker URL
      const hashMatch = status.match(/0x[a-fA-F0-9]{60,66}/)
      const extractedHash = hash || (hashMatch ? hashMatch[0] : undefined)

      // Clean display status — strip the tracking URL part
      const displayStatus = status.replace(/Track at layerzeroscan\.com\/tx\/\S+/, '').trim()
      setBridgeStatus(displayStatus)
      
      if (extractedHash && !transactionHash) {
        setTransactionHash(extractedHash)
        if (transaction.id) {
          updateTransaction(transaction.id, { txHash: extractedHash })
        }
      }
      
      // Update stepper based on status keywords
      if (status.toLowerCase().includes('confirm')) {
        setTransactionStep('confirming')
      } else if (
        status.toLowerCase().includes('bridg') ||
        status.toLowerCase().includes('relay') ||
        status.toLowerCase().includes('layerzero delivery') ||
        status.toLowerCase().includes('track at layerzeroscan')
      ) {
        setTransactionStep('bridging')
      } else if (
        status.toLowerCase().includes('destination confirmed') ||
        status.toLowerCase().includes('received on destination')
      ) {
        setTransactionStep('completed')
        // Mark transaction as completed
        if (transaction.id) {
          updateTransaction(transaction.id, { status: 'completed' })
        }
        // Trigger success celebration
        setShowSuccessCelebration(true)
      }
    }

    try {
      if (sourceEvmChainId && walletChainId !== sourceEvmChainId) {
        setBridgeStatus('Switching network…')
        await switchChainAsync({ chainId: sourceEvmChainId })
      }
      if (zeroQuote && isZeroEvmToZeroRoute) {
        const result = await executeZeroBridgeSend({
          walletClient,
          publicClient,
          token,
          amount,
          fromAddress: address as Address,
          zeroReceiver,
          onStatus: updateProgress,
        })
        setZeroQuote(null)
        setTransactionHash(result.txHash)
        setZeroRequestHash(result.requestHash)
        setEvmToZeroPending(result.proof ?? null)
        if (transaction.id) {
          updateTransaction(transaction.id, { txHash: result.txHash, status: 'pending' })
        }
        const pendingProof = result.proof
        setBridgeStatus(pendingProof
          ? `${pendingProof.quantity} escrow recorded. Mint on Telos Zero to finish.`
          : (result.requestId
            ? `EVM request #${result.requestId} recorded. Zero mint proof data unavailable.`
            : 'EVM escrow request recorded. Zero mint proof data unavailable.')
        )
        setTransactionStep('bridging')
        setAmount('')
        return
      } else if (oftQuote && isMst) {
        await executeMstSend(walletClient, publicClient, fromChain, toChain, amount,
          address, address, updateProgress)
        setOftQuote(null)
      } else if (oftQuote) {
        await executeOftSend(walletClient, publicClient, fromChain, toChain, amount,
          address, address, slippage, updateProgress)
        setOftQuote(null)
      } else if (v2Quote) {
        await executeOftV2Send(walletClient, publicClient, token, fromChain, toChain, amount,
          address, address, updateProgress)
        setV2Quote(null)
      }
      setBridgeStatus('Source transaction confirmed. Waiting for destination delivery. Track progress on LZScan.')
      setTransactionStep('bridging')
      // Keep the transaction pending until destination delivery is confirmed
      if (transaction.id) {
        updateTransaction(transaction.id, { status: 'pending' })
      }
      setAmount('')
    } catch (e: any) {
      const msg = e.message || 'Bridge failed'
      if (msg.includes('rejected') || msg.includes('denied') || msg.includes('cancelled')) {
        setError(createError('transaction_rejected', 'Transaction rejected', 
          'You declined the transaction in your wallet'))
      } else if (msg.includes('network') || msg.includes('RPC')) {
        setError(createError('rpc_error', 'Network error', msg))
      } else {
        setError(createError('bridge_failed', 'Bridge transaction failed', msg))
      }
      setBridgeStatus(null)
      setTransactionStep('idle')
      // Mark transaction as failed
      if (transaction.id) {
        updateTransaction(transaction.id, { status: 'failed' })
      }
    } finally { setBridging(false) }
  }, [oftQuote, v2Quote, zeroQuote, zeroNativeQuote, address, walletClient, publicClient, zeroToEvmPublicClient, walletChainId, sourceEvmChainId, fromChain, toChain, switchChainAsync, amount, slippage, displayBalance, token, sendTokenSymbol, isMst, isZeroRoute, isZeroEvmToZeroRoute, isZeroToEvmRoute, isZeroSignedRoute, isZeroNativeTlos, zeroReceiver, zeroSender, evmReceiver, hasQuote, submitZeroToEvmReleaseRelay, submitEvmToZeroMintProof])

  const swap = () => {
    const fc = fromChain
    setFromChain(toChain); setToChain(fc)
    clearQuotes()
  }

  // Error recovery handlers
  const handleRetry = () => {
    setError(null)
    if (isZeroToEvmRoute && zeroToEvmPending && transactionStep === 'bridging') {
      submitZeroToEvmReleaseRelay(zeroToEvmPending)
      return
    }
    if (isZeroEvmToZeroRoute && evmToZeroPending && transactionStep === 'bridging') {
      submitEvmToZeroMintProof(evmToZeroPending)
      return
    }
    if (hasQuote) {
      handleBridge()
    } else {
      doQuote()
    }
  }

  const handleDismissError = () => setError(null)

  const handleConnectWallet = () => {
    setError(null)
    openConnectModal?.()
  }

  const handleConnectZeroSigner = async () => {
    setConnectingZeroSigner(true)
    setError(null)
    try {
      const signer = await connectZeroSigner()
      setZeroSigner(signer)
      if (isZeroSignedRoute) {
        setZeroSender(signer.actor)
      } else if (isZeroEvmToZeroRoute) {
        setZeroReceiver(signer.actor)
      }
      clearQuotes()
    } catch (e: any) {
      setError(createError('wallet_not_connected', 'Telos Zero wallet not connected', e.message || 'Anchor connection failed'))
    } finally {
      setConnectingZeroSigner(false)
    }
  }

  const handlePrimaryAction = () => {
    if (isEvmToZeroMintProofPending && evmToZeroPending) {
      submitEvmToZeroMintProof(evmToZeroPending)
      return
    }

    if (needsZeroSignerConnection) {
      handleConnectZeroSigner()
      return
    }

    if (hasQuote) {
      handleBridge()
    } else {
      doQuote()
    }
  }

  const handleSwitchNetwork = async (chainId: number) => {
    try {
      setError(null)
      await switchChainAsync({ chainId })
    } catch (e: any) {
      setError(createError('network_mismatch', 'Failed to switch network', e.message))
    }
  }

  const handleMax = () => { if (displayBalance) setAmount(displayBalance.formatted) }
  const handleHalf = () => { if (displayBalance) setAmount((parseFloat(displayBalance.formatted) / 2).toString()) }

  const handleMintTestToken = useCallback(async () => {
    if (!address) {
      openConnectModal?.()
      return
    }
    if (!walletClient || !publicClient) {
      setError(createError('wallet_not_connected', 'Wallet is not ready', 'Reconnect the wallet and try again.'))
      return
    }
    if (!isZeroEvmToZeroRoute || !getZeroBridgeTestMintAmount(token)) return

    setMintingTestToken(true)
    setTestMintStatus(null)
    setError(null)

    try {
      if (sourceEvmChainId && walletChainId !== sourceEvmChainId) {
        setTestMintStatus(`Switching to ${chainName(sourceEvmChainId)}...`)
        await switchChainAsync({ chainId: sourceEvmChainId })
      }

      const result = await mintZeroBridgeTestToken({
        walletClient,
        publicClient,
        token,
        toAddress: address as Address,
        onStatus: setTestMintStatus,
      })

      setTestMintStatus(`${result.amount} ${result.symbol} minted`)
      await refetchErc20Balance()
    } catch (e: any) {
      const msg = e.message || 'Test token mint failed'
      setTestMintStatus(null)
      if (msg.includes('rejected') || msg.includes('denied') || msg.includes('cancelled')) {
        setError(createError('transaction_rejected', 'Transaction rejected', 'You declined the mint transaction in your wallet.'))
      } else {
        setError(createError('bridge_failed', 'Test token mint failed', msg))
      }
    } finally {
      setMintingTestToken(false)
    }
  }, [address, openConnectModal, walletClient, publicClient, isZeroEvmToZeroRoute, token, sourceEvmChainId, walletChainId, switchChainAsync, refetchErc20Balance])

  const handleClaimEmpiresTestTokens = useCallback(async () => {
    if (!isZeroToEvmRoute || token !== 'EMPIRES') return
    if (!isValidZeroAccountName(zeroSender)) {
      setError(createError('quote_failed', 'Enter a Telos Zero sender',
        'The EMPIRES faucet needs the Telos Zero account that will receive the test tokens.'))
      return
    }

    setClaimingEmpires(true)
    setEmpiresFaucetStatus(null)
    setError(null)

    try {
      const result = await claimEmpiresTestTokens({
        zeroAccount: zeroSender,
        onStatus: setEmpiresFaucetStatus,
      })
      setEmpiresFaucetStatus(result.message || (result.quantity ? `${result.quantity} sent` : 'EMPIRES ready'))
      const balance = await getZeroBridgeBalance(token, zeroSender)
      setZeroBridgeBalance(balance)
    } catch (e: any) {
      setEmpiresFaucetStatus(null)
      setError(createError('bridge_failed', 'EMPIRES faucet failed', e.message || 'Could not claim test EMPIRES'))
    } finally {
      setClaimingEmpires(false)
    }
  }, [isZeroToEvmRoute, token, zeroSender])

  const handleFromChain = (id: number) => {
    if (id === toChain) setToChain(fromChain)
    setFromChain(id); clearQuotes()
  }
  const handleToChain = (id: number) => {
    if (id === fromChain) setFromChain(toChain)
    setToChain(id); clearQuotes()
  }

  // Fee display now handled in QuoteDisplay component

  return (
    <div className={`space-y-4 sm:space-y-6 ${
      reduceMotion ? '' : 'animate-in slide-in-from-bottom-4 fade-in duration-700 delay-300'
    }`}>
      {/* Toolbar icons above the bridge frame */}
      <div className={`flex justify-end gap-3 sm:gap-3 ${
        reduceMotion ? '' : 'animate-in slide-in-from-right-3 fade-in duration-500 delay-500'
      }`}>
        <button 
          onClick={() => setShowRecentTransactions(true)}
          className="w-11 h-11 sm:w-9 sm:h-9 rounded-full bg-[#1a1a28]/80 border border-gray-800/50 flex items-center justify-center text-gray-500 hover:text-gray-300 hover:border-gray-600 transition-all active:scale-95" 
          title="Transaction History"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        </button>
        <button onClick={() => setShowSettings(!showSettings)} className="w-11 h-11 sm:w-9 sm:h-9 rounded-full bg-[#1a1a28]/80 border border-gray-800/50 flex items-center justify-center text-gray-500 hover:text-gray-300 hover:border-gray-600 transition-all active:scale-95" title="Settings">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
        </button>
      </div>

      <div className={`bg-gradient-to-br from-gray-800/30 via-gray-700/10 to-gray-800/30 p-[1px] rounded-2xl ${
        reduceMotion ? '' : 'animate-in slide-in-from-bottom-5 fade-in duration-800 delay-400'
      }`}>
        <div className="bg-[#12121a]/80 backdrop-blur-xl rounded-2xl p-4 sm:p-6 md:p-8 space-y-4 sm:space-y-5 shadow-2xl shadow-black/40 transition-all duration-300 hover:shadow-3xl hover:shadow-telos-cyan/5">

        {/* Chain selector row */}
        <div className="relative flex flex-col sm:flex-row items-stretch sm:items-center gap-0 sm:gap-3">
          {/* From chain */}
          <div className="flex-1 min-w-0 bg-[#1a1a28] rounded-t-xl sm:rounded-xl overflow-hidden">
            <ChainSelectorModal
              label="From"
              selectedChainId={fromChain}
              chains={filteredChains}
              onChainChange={handleFromChain}
              className="rounded-none"
            />
          </div>

          {/* Swap button — between the two selectors */}
          <div className="relative z-20 flex items-center justify-center" style={{ marginTop: '-12px', marginBottom: '-12px' }}>
            <button 
              onClick={swap}
              className="w-10 h-10 rounded-full bg-[#1a1a28] border-2 sm:border border-gray-700/50 flex items-center justify-center hover:border-telos-cyan/50 hover:bg-telos-cyan/5 hover:rotate-180 duration-300 text-gray-400 hover:text-telos-cyan shrink-0 group active:scale-95 touch-manipulation shadow-lg shadow-black/50 sm:shadow-none"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="group-hover:scale-110 transition-transform rotate-90 sm:rotate-0">
                <path d="M7 10L12 5L17 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M7 14L12 19L17 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>

          {/* To chain */}
          <div className="flex-1 min-w-0 bg-[#1a1a28] rounded-b-xl sm:rounded-xl overflow-hidden">
            <ChainSelectorModal
              label="To"
              selectedChainId={toChain}
              chains={filteredChains}
              onChainChange={handleToChain}
              className="rounded-none"
            />
          </div>
        </div>

        {/* Subtle separator */}
        <div className="border-t border-white/[0.03]"></div>

        {/* Amount input */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4">
          <AmountInput
            amount={amount}
            onAmountChange={setAmount}
            token={sendTokenSymbol}
            balance={displayBalance}
            insufficientBalance={insufficientBalance}
            onMax={handleMax}
            onHalf={handleHalf}
            onQuarter={() => { if (displayBalance) setAmount((parseFloat(displayBalance.formatted) / 4).toString()) }}
            className="flex-1 min-w-0"
          />
          
          <TokenSelectorModal 
            selectedToken={token}
            tokens={tokenList}
            onTokenChange={(newToken) => { setToken(newToken); clearQuotes() }}
            getDisplayToken={(candidate) => (
              getZeroBridgeSendSymbol(candidate, fromChain, toChain) ?? candidate
            )}
          />
        </div>

        {isZeroEvmToZeroRoute && address && getZeroBridgeTestMintAmount(token) && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3">
            <button
              type="button"
              onClick={handleMintTestToken}
              disabled={mintingTestToken || !walletClient || !publicClient}
              className="inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-lg border border-telos-cyan/25 bg-telos-cyan/10 px-3 py-2 text-xs font-semibold text-telos-cyan transition hover:border-telos-cyan/50 hover:bg-telos-cyan/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {mintingTestToken ? (
                <LoadingSpinner size="sm" className="text-telos-cyan" />
              ) : (
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 5v14" />
                  <path d="M5 12h14" />
                </svg>
              )}
              <span>{mintingTestToken ? 'Minting...' : `Mint test ${token}`}</span>
            </button>
            {testMintStatus && (
              <span className="text-xs text-gray-400 truncate">{testMintStatus}</span>
            )}
          </div>
        )}

        {isZeroEvmToZeroRoute && (
          <label className="block bg-[#1a1a28] rounded-xl p-4 focus-within:ring-1 focus-within:ring-telos-cyan/30 transition-all duration-200">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="block text-xs text-gray-500 uppercase tracking-wider">Telos Zero receiver</span>
              <button
                type="button"
                onClick={handleConnectZeroSigner}
                disabled={connectingZeroSigner}
                className="text-xs font-semibold text-telos-cyan hover:text-telos-cyan/75 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {connectingZeroSigner ? 'Connecting...' : zeroSigner ? `${zeroSigner.actor}@${zeroSigner.permission}` : 'Use Zero wallet'}
              </button>
            </div>
            <input
              value={zeroReceiver}
              onChange={(event) => {
                setZeroReceiver(event.target.value)
                clearQuotes()
              }}
              placeholder="nativeaccount"
              className="h-12 w-full rounded-lg border border-white/[0.06] bg-black/20 px-3 text-base text-white outline-none transition placeholder:text-gray-600 focus:border-telos-cyan/50"
            />
          </label>
        )}

        {isZeroSignedRoute && (
          <div className="grid gap-3">
            <label className="block bg-[#1a1a28] rounded-xl p-4 focus-within:ring-1 focus-within:ring-telos-cyan/30 transition-all duration-200">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="block text-xs text-gray-500 uppercase tracking-wider">Telos Zero sender</span>
                <button
                  type="button"
                  onClick={handleConnectZeroSigner}
                  disabled={connectingZeroSigner}
                  className="text-xs font-semibold text-telos-cyan hover:text-telos-cyan/75 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {connectingZeroSigner ? 'Connecting...' : zeroSigner ? `${zeroSigner.actor}@${zeroSigner.permission}` : 'Connect Zero'}
                </button>
              </div>
              <input
                value={zeroSender}
                onChange={(event) => {
                  setZeroSender(event.target.value)
                  setEmpiresFaucetStatus(null)
                  clearQuotes()
                }}
                placeholder="nativeaccount"
                className="h-12 w-full rounded-lg border border-white/[0.06] bg-black/20 px-3 text-base text-white outline-none transition placeholder:text-gray-600 focus:border-telos-cyan/50"
              />
            </label>

            <label className="block bg-[#1a1a28] rounded-xl p-4 focus-within:ring-1 focus-within:ring-telos-cyan/30 transition-all duration-200">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="block text-xs text-gray-500 uppercase tracking-wider">Telos EVM receiver</span>
                {address && (
                  <button
                    type="button"
                    onClick={() => {
                      setEvmReceiver(address)
                      clearQuotes()
                    }}
                    className="text-xs font-semibold text-telos-cyan hover:text-telos-cyan/75"
                  >
                    Use connected
                  </button>
                )}
              </div>
              <input
                value={evmReceiver}
                onChange={(event) => {
                  setEvmReceiver(event.target.value)
                  clearQuotes()
                }}
                placeholder="0x..."
                className="h-12 w-full rounded-lg border border-white/[0.06] bg-black/20 px-3 text-base text-white outline-none transition placeholder:text-gray-600 focus:border-telos-cyan/50"
              />
            </label>
          </div>
        )}

        {isZeroToEvmRoute && token === 'EMPIRES' && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3">
            <button
              type="button"
              onClick={handleClaimEmpiresTestTokens}
              disabled={claimingEmpires || !isValidZeroAccountName(zeroSender)}
              className="inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-lg border border-telos-cyan/25 bg-telos-cyan/10 px-3 py-2 text-xs font-semibold text-telos-cyan transition hover:border-telos-cyan/50 hover:bg-telos-cyan/15 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {claimingEmpires ? (
                <LoadingSpinner size="sm" className="text-telos-cyan" />
              ) : (
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 5v14" />
                  <path d="M5 12h14" />
                </svg>
              )}
              <span>{claimingEmpires ? 'Getting EMPIRES...' : 'Get test EMPIRES'}</span>
            </button>
            <span className="text-xs text-gray-400 truncate">
              {empiresFaucetStatus || (isValidZeroAccountName(zeroSender) ? 'Tops up this Zero account' : 'Enter Zero sender first')}
            </span>
          </div>
        )}

        {/* Quote display */}
        {(hasQuote || quoting) && (
          <QuoteDisplay
            quoting={quoting}
            amount={amount}
            token={token}
            displayToken={receiveTokenSymbol}
            toChainName={chainName(toChain)}
            amountReceived={zeroNativeQuote ? zeroNativeQuote.amountReceivedFormatted : zeroQuote ? zeroQuote.amountReceivedFormatted : v2Quote ? v2Quote.amountReceivedFormatted : amount}
            isStargate={!isZeroRoute && OFT_V2_TOKENS[token]?.isStargate}
            nativeFee={oftQuote 
              ? `~${parseFloat(oftQuote.nativeFeeFormatted) >= 1 ? parseFloat(oftQuote.nativeFeeFormatted).toFixed(0) : parseFloat(oftQuote.nativeFeeFormatted).toFixed(4)}` 
              : v2Quote 
                ? `~${parseFloat(v2Quote.nativeFeeFormatted) >= 1 ? parseFloat(v2Quote.nativeFeeFormatted).toFixed(0) : parseFloat(v2Quote.nativeFeeFormatted).toFixed(4)}`
                : undefined
            }
            feeCurrency={CHAIN_MAP.get(fromChain)?.nativeCurrency || 'TLOS'}
            estimatedTime={isZeroNativeTlos ? '~5 sec' : isZeroRoute ? '~15 sec' : '~2 min'}
            provider={(isZeroRoute || isZeroNativeTlos) ? 'telos-zero' : undefined}
            routeLabel={isZeroNativeTlos ? 'Native TLOS' : isZeroToEvmRoute ? 'Zero bridge' : isZeroEvmToZeroRoute ? 'Zero bridge' : undefined}
            rateLabel={isZeroNativeTlos ? '1:1 native deposit' : isZeroToEvmRoute ? '1:1 burn/release' : isZeroEvmToZeroRoute ? '1:1 escrowed mint' : undefined}
          />
        )}

        {/* Low amount / fee warning */}
        {(() => {
          const nativeFeeStr = oftQuote?.nativeFeeFormatted || v2Quote?.nativeFeeFormatted
          const fCurrency = CHAIN_MAP.get(fromChain)?.nativeCurrency || 'TLOS'
          if (amount && (oftQuote || v2Quote) && nativeFeeStr && parseFloat(amount) < parseFloat(nativeFeeStr) * 3) {
            const feeDisplay = parseFloat(nativeFeeStr) >= 1 
              ? parseFloat(nativeFeeStr).toFixed(0) 
              : parseFloat(nativeFeeStr).toFixed(4)
            return (
              <div className="bg-amber-500/[0.06] border border-amber-500/10 rounded-xl px-4 py-3 text-xs text-amber-400/90 leading-relaxed">
                Amount is low relative to the network fee (~{feeDisplay} {fCurrency}). You may receive little or nothing.
              </div>
            )
          }
          return null
        })()}

        {isEvmToZeroMintProofPending && evmToZeroPending && (
          <button
            type="button"
            onClick={() => submitEvmToZeroMintProof(evmToZeroPending)}
            disabled={bridging}
            className="w-full py-4 sm:py-5 rounded-2xl font-semibold text-base sm:text-lg bg-gradient-to-r from-telos-cyan via-telos-blue to-telos-purple text-white disabled:opacity-30 disabled:cursor-not-allowed hover:opacity-90 hover:shadow-xl hover:shadow-telos-cyan/20 active:scale-98 transition-all duration-200 shadow-lg shadow-telos-cyan/10 touch-manipulation"
          >
            <span className="flex items-center justify-center gap-2">
              {bridging && <LoadingSpinner size="sm" className="text-white" />}
              {bridging ? 'Waiting for Zero signature...' : 'Mint on Telos Zero'}
            </span>
          </button>
        )}

        {/* Transaction Progress Stepper */}
        <TransactionStepper
          currentStep={transactionStep}
          txHash={transactionHash}
          destinationTxHash={destinationTransactionHash}
          fromChainId={fromChain}
          toChainId={toChain}
          destinationTxChainId={destinationTransactionChainId}
          estimatedTime={isZeroNativeTlos ? '~5 sec' : isZeroRoute ? '~15 sec' : '~2 min'}
          routeKind={isZeroNativeTlos ? 'native-tlos' : isZeroToEvmRoute ? 'zero-to-evm' : isZeroEvmToZeroRoute ? 'zero' : 'layerzero'}
        />

        {/* Enhanced settings panel */}
        {showSettings && (
          <BridgeSettings
            slippage={slippage}
            onSlippageChange={setSlippage}
            estimatedGas={oftQuote 
              ? `${oftQuote.nativeFeeFormatted} ${CHAIN_MAP.get(fromChain)?.nativeCurrency || 'TLOS'}` 
              : v2Quote 
                ? `${v2Quote.nativeFeeFormatted} ${CHAIN_MAP.get(fromChain)?.nativeCurrency || 'TLOS'}`
                : undefined
            }
            showGasOptimization={fromChain === 1 || fromChain === 137} // Only show on high-gas chains
          />
        )}

        {/* Route details now included in QuoteDisplay component */}

        {/* Enhanced Error Display */}
        <ErrorDisplay
          error={error}
          onRetry={handleRetry}
          onDismiss={handleDismissError}
          onConnectWallet={handleConnectWallet}
          onSwitchNetwork={handleSwitchNetwork}
          chainName={chainName}
        />

        {isZeroToEvmRoute && zeroToEvmPending && transactionStep === 'bridging' && (
          <button
            type="button"
            onClick={() => submitZeroToEvmReleaseRelay(zeroToEvmPending)}
            disabled={bridging}
            className="w-full rounded-xl border border-telos-cyan/25 bg-telos-cyan/10 px-4 py-3 text-sm font-semibold text-telos-cyan transition hover:border-telos-cyan/50 hover:bg-telos-cyan/15 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="flex items-center justify-center gap-2">
              {bridging && <LoadingSpinner size="sm" className="text-telos-cyan" />}
              Retry Release Manually
            </span>
          </button>
        )}

        {canRelayLatestZeroToEvm && transactionStep !== 'bridging' && (
          <button
            type="button"
            onClick={handleRelayLatestZeroToEvmRequest}
            disabled={bridging}
            className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-gray-200 transition hover:border-telos-cyan/30 hover:bg-telos-cyan/10 hover:text-telos-cyan disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="flex items-center justify-center gap-2">
              {bridging && <LoadingSpinner size="sm" className="text-telos-cyan" />}
              Relay Pending Release
            </span>
          </button>
        )}

        {/* Status */}
        {bridgeStatus && (
          <div className="bg-telos-cyan/5 border border-telos-cyan/15 rounded-xl px-4 py-3 text-sm text-center text-telos-cyan">{bridgeStatus}</div>
        )}

        {/* Network warning */}
        {wrongNetwork && !bridging && !bridgeStatus && (
          <div className="bg-amber-500/[0.06] border border-amber-500/10 rounded-xl px-4 py-2.5 text-xs text-amber-400/80 leading-relaxed">
            Will switch to {chainName(sourceEvmChainId || fromChain)} on bridge
          </div>
        )}

        {/* From non-Telos notice */}
        {fromChain !== 40 && tokenList.length === 1 && !isZeroRoute && (
          <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl px-4 py-2.5 text-xs text-gray-400 leading-relaxed">
            Only TLOS bridging available on this route
          </div>
        )}

        {/* CTA */}
        {!address && !isZeroSignedRoute ? (
          <button 
            onClick={openConnectModal}
            className="w-full py-4 sm:py-5 rounded-2xl font-semibold text-base sm:text-lg bg-gradient-to-r from-telos-cyan via-telos-blue to-telos-purple text-white hover:opacity-90 hover:shadow-xl hover:shadow-telos-cyan/20 active:scale-98 transition-all duration-200 shadow-lg shadow-telos-cyan/10 touch-manipulation"
          >
            Connect Wallet
          </button>
        ) : (
          <button onClick={handlePrimaryAction}
            disabled={connectingZeroSigner || (!needsZeroSignerConnection && !isEvmToZeroMintProofPending && (!amount || parseFloat(amount) <= 0 || quoting || bridging || (isZeroToEvmRoute && zeroToEvmPending && transactionStep === 'bridging') || fromChain === toChain || (!isOft && !isMst && !isV2 && !isZeroRoute && !isZeroNativeTlos) || (isZeroEvmToZeroRoute && (!zeroRouteConfigured || !zeroReceiver.trim())) || (isZeroSignedRoute && (!isValidZeroAccountName(zeroSender) || !isAddress(evmReceiver))) || insufficientBalance)) || (isEvmToZeroMintProofPending && bridging)}
            className="w-full py-4 sm:py-5 rounded-2xl font-semibold text-base sm:text-lg bg-gradient-to-r from-telos-cyan via-telos-blue to-telos-purple text-white disabled:opacity-30 disabled:cursor-not-allowed hover:opacity-90 hover:shadow-xl hover:shadow-telos-cyan/20 active:scale-98 transition-all duration-200 shadow-lg shadow-telos-cyan/10 relative overflow-hidden group touch-manipulation">
            <span className="relative z-10 flex items-center justify-center gap-2">
              {(quoting || bridging || connectingZeroSigner) && <LoadingSpinner size="sm" className="text-white" />}
              {needsZeroSignerConnection ? (connectingZeroSigner ? 'Connecting to Zero...' : 'Connect to Zero') :
               insufficientBalance ? 'Insufficient balance' : 
               quoting ? 'Getting quote...' : 
               isEvmToZeroMintProofPending ? (bridging ? 'Waiting for Zero signature...' : 'Mint on Telos Zero') :
               bridging ? 'Preparing...' : 
               isZeroToEvmRoute && zeroToEvmPending && transactionStep === 'bridging' ? 'Release pending' :
               hasQuote ? (isZeroSignedRoute ? `Bridge ${token}` : `Bridge ${token}`) : 
               isZeroEvmToZeroRoute && !zeroRouteConfigured ? 'Missing route config' :
               (!amount || parseFloat(amount) <= 0) ? 'Enter an amount' :
               isZeroEvmToZeroRoute && !zeroReceiver.trim() ? 'Enter Zero receiver' :
               isZeroSignedRoute && !isValidZeroAccountName(zeroSender) ? 'Enter Zero sender' :
               isZeroSignedRoute && !isAddress(evmReceiver) ? 'Enter EVM receiver' : 'Get Quote'}
            </span>
            <div className="absolute inset-0 bg-gradient-to-r from-telos-cyan/10 via-white/5 to-telos-cyan/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
          </button>
        )}
        </div>
      </div>

      {/* Footer */}
      <div className={`text-center ${
        reduceMotion ? '' : 'animate-in fade-in slide-in-from-bottom-2 duration-600 delay-700'
      }`}>
        <div>
          <a
            href={issueReportUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors"
          >
            <span>Report an issue</span>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h4m0 0v4m0-4L10 14" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h3m-3 0v10a1 1 0 001 1h10a1 1 0 001-1v-3" />
            </svg>
          </a>
        </div>
      </div>

      {/* Recent Transactions Modal */}
      <RecentTransactions
        isOpen={showRecentTransactions}
        onClose={() => setShowRecentTransactions(false)}
      />

      {/* Success Celebration Animation */}
      <SuccessCelebration
        isVisible={showSuccessCelebration}
        onComplete={() => setShowSuccessCelebration(false)}
      />
    </div>
  )
}
