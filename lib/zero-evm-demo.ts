import { isAddress, type Address } from 'viem'

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? ''
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

function publicAddress(value: string | undefined): Address | undefined {
  if (!value || value === ZERO_ADDRESS || !isAddress(value)) return undefined
  return value as Address
}

export const TELOS_TESTNET_CHAIN_ID = 41
export const TELOS_TESTNET_RPC = process.env.NEXT_PUBLIC_TELOS_TESTNET_RPC || 'https://rpc.testnet.telos.net'
export const TELOS_TESTNET_EXPLORER = 'https://testnet.teloscan.io'
export const ZERO_API = normalizeNativeApiUrl(process.env.NEXT_PUBLIC_ZERO_API || 'https://testnet.telos.net')
export const ZERO_PUSH_API = normalizeNativeApiUrl(process.env.NEXT_PUBLIC_ZERO_PUSH_API || 'https://telostestnet.greymass.com')
export const ZERO_BRIDGE_ACCOUNT = process.env.NEXT_PUBLIC_ZERO_BRIDGE_ACCOUNT || 'zerobridge'
export const EMPIRES_FAUCET_URL = process.env.NEXT_PUBLIC_EMPIRES_FAUCET_URL?.trim() || ''
export const EVM_ESCROW_BRIDGE = publicAddress(process.env.NEXT_PUBLIC_EVM_ESCROW_BRIDGE)
export const ZERO_BRIDGE_EVM_ADDRESS = publicAddress(process.env.NEXT_PUBLIC_ZERO_BRIDGE_EVM_ADDRESS)

function normalizeNativeApiUrl(value: string) {
  return value.trim().replace(/\/+$/, '')
}

export interface DemoAsset {
  key: 'USDC' | 'USDT' | 'WBTC' | 'EMPIRES'
  label: string
  pairId: bigint
  evmSymbol: string
  zeroSymbol: string
  decimals: number
  tokenAddress?: Address
  zeroContract: string
  icon: string
  origin: 'evm' | 'zero'
}

export const DEMO_ASSETS: DemoAsset[] = [
  {
    key: 'USDC',
    label: 'USDC',
    pairId: 1n,
    evmSymbol: 'USDC.e',
    zeroSymbol: 'ZUSDC',
    decimals: 6,
    tokenAddress: publicAddress(process.env.NEXT_PUBLIC_USDC_TOKEN),
    zeroContract: process.env.NEXT_PUBLIC_USDC_ZERO_CONTRACT || 'usdc.bridge',
    icon: `${BASE_PATH}/tokens/USDC.png`,
    origin: 'evm',
  },
  {
    key: 'USDT',
    label: 'USDT',
    pairId: 2n,
    evmSymbol: 'USDT',
    zeroSymbol: 'ZUSDT',
    decimals: 6,
    tokenAddress: publicAddress(process.env.NEXT_PUBLIC_USDT_TOKEN),
    zeroContract: process.env.NEXT_PUBLIC_USDT_ZERO_CONTRACT || 'usdt.bridge',
    icon: `${BASE_PATH}/tokens/USDT.png`,
    origin: 'evm',
  },
  {
    key: 'WBTC',
    label: 'WBTC',
    pairId: 3n,
    evmSymbol: 'WBTC',
    zeroSymbol: 'ZWBTC',
    decimals: 8,
    tokenAddress: publicAddress(process.env.NEXT_PUBLIC_WBTC_TOKEN),
    zeroContract: process.env.NEXT_PUBLIC_WBTC_ZERO_CONTRACT || 'wbtc.bridge',
    icon: `${BASE_PATH}/tokens/WBTC.png`,
    origin: 'evm',
  },
  {
    key: 'EMPIRES',
    label: 'EMPIRES',
    pairId: 4n,
    evmSymbol: 'wEMPIRES',
    zeroSymbol: 'EMPIRES',
    decimals: 4,
    tokenAddress: publicAddress(process.env.NEXT_PUBLIC_EMPIRES_TOKEN),
    zeroContract: process.env.NEXT_PUBLIC_EMPIRES_ZERO_CONTRACT || 'empirestkn11',
    icon: `${BASE_PATH}/tokens/EMPIRES.svg`,
    origin: 'zero',
  },
]

export const ERC20_ABI = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'mint',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
] as const

export const EVM_ESCROW_BRIDGE_ABI = [
  {
    type: 'function',
    name: 'depositToZero',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'pairId', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
      { name: 'zeroReceiver', type: 'string' },
    ],
    outputs: [{ name: 'requestId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'processedZeroBurns',
    stateMutability: 'view',
    inputs: [{ name: 'burnId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'releaseToEvm',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'pairId', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
      { name: 'receiver', type: 'address' },
      { name: 'zeroBurnId', type: 'bytes32' },
      { name: 'zeroSender', type: 'string' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'zeroBridge',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'event',
    name: 'EvmToZeroRequested',
    anonymous: false,
    inputs: [
      { indexed: true, name: 'requestId', type: 'uint256' },
      { indexed: true, name: 'pairId', type: 'uint256' },
      { indexed: true, name: 'sender', type: 'address' },
      { indexed: false, name: 'zeroReceiver', type: 'string' },
      { indexed: false, name: 'amount', type: 'uint256' },
      { indexed: false, name: 'requestHash', type: 'bytes32' },
    ],
  },
  {
    type: 'event',
    name: 'ZeroToEvmReleased',
    anonymous: false,
    inputs: [
      { indexed: true, name: 'zeroBurnId', type: 'bytes32' },
      { indexed: true, name: 'pairId', type: 'uint256' },
      { indexed: true, name: 'receiver', type: 'address' },
      { indexed: false, name: 'amount', type: 'uint256' },
      { indexed: false, name: 'zeroSender', type: 'string' },
    ],
  },
] as const
