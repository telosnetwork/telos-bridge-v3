export type LayerZeroMessageLifecycleStatus =
  | 'INFLIGHT'
  | 'CONFIRMING'
  | 'DELIVERED'
  | 'FAILED'
  | 'BLOCKED'
  | 'PAYLOAD_STORED'
  | 'APPLICATION_BURNED'
  | 'APPLICATION_SKIPPED'
  | 'UNRESOLVABLE_COMMAND'
  | 'MALFORMED_COMMAND'

export interface LayerZeroTxStatus {
  status: LayerZeroMessageLifecycleStatus
  statusMessage: string
  sourceStatus?: string
  destinationStatus?: string
  sourceTxHash?: string
  destinationTxHash?: string
}

interface LayerZeroMessageApiResponse {
  data?: Array<{
    source?: {
      status?: string
      tx?: {
        txHash?: string
      }
    }
    destination?: {
      status?: string
      tx?: {
        txHash?: string
      }
    }
    status?: {
      name?: LayerZeroMessageLifecycleStatus
      message?: string
    }
  }>
}

const LAYERZERO_SCAN_API_BASE = 'https://scan.layerzero-api.com/v1'

export async function fetchLayerZeroTxStatus(
  txHash: string,
  signal?: AbortSignal,
): Promise<LayerZeroTxStatus | null> {
  const response = await fetch(`${LAYERZERO_SCAN_API_BASE}/messages/tx/${txHash}`, {
    headers: {
      accept: 'application/json',
    },
    cache: 'no-store',
    signal,
  })

  if (!response.ok) {
    throw new Error(`LayerZero Scan status request failed: ${response.status}`)
  }

  const payload = await response.json() as LayerZeroMessageApiResponse
  const message = payload.data?.find((entry) => (
    entry.source?.tx?.txHash?.toLowerCase() === txHash.toLowerCase()
  )) ?? payload.data?.[0]

  if (!message?.status?.name) {
    return null
  }

  return {
    status: message.status.name,
    statusMessage: message.status.message || '',
    sourceStatus: message.source?.status,
    destinationStatus: message.destination?.status,
    sourceTxHash: message.source?.tx?.txHash,
    destinationTxHash: message.destination?.tx?.txHash,
  }
}

export function isLayerZeroTerminalStatus(status: LayerZeroMessageLifecycleStatus) {
  return (
    status === 'DELIVERED' ||
    status === 'FAILED' ||
    status === 'BLOCKED' ||
    status === 'PAYLOAD_STORED' ||
    status === 'APPLICATION_BURNED' ||
    status === 'APPLICATION_SKIPPED' ||
    status === 'UNRESOLVABLE_COMMAND' ||
    status === 'MALFORMED_COMMAND'
  )
}
