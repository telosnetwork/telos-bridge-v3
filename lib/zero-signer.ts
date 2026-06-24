import { TELOS_ZERO_TESTNET_CHAIN_ID_HEX } from '@/lib/chains'
import { ZERO_PUSH_API } from '@/lib/zero-evm-demo'

const ZERO_PUSH_SESSION_KEY = ZERO_PUSH_API.replace(/[^a-z0-9]/gi, '-').toLowerCase()
const ANCHOR_APP_IDENTIFIER = `telosbridge-${ZERO_PUSH_SESSION_KEY}`

export interface ZeroSignerAccount {
  actor: string
  permission: string
}

export interface ZeroAction {
  account: string
  name: string
  data: Record<string, unknown>
}

export interface ZeroSignedTransaction {
  transactionId?: string
  signer: ZeroSignerAccount
}

async function createAnchorLink() {
  if (typeof window === 'undefined') {
    throw new Error('Telos Zero signing is only available in the browser')
  }

  const [{ default: AnchorLink }, { default: AnchorLinkBrowserTransport }] = await Promise.all([
    import('anchor-link'),
    import('anchor-link-browser-transport'),
  ])

  const transport = new AnchorLinkBrowserTransport({
    requestStatus: false,
    storagePrefix: `telos-zero-bridge-${ZERO_PUSH_SESSION_KEY}`,
  })

  return new AnchorLink({
    transport,
    chains: [{
      chainId: TELOS_ZERO_TESTNET_CHAIN_ID_HEX,
      nodeUrl: ZERO_PUSH_API,
    }],
  })
}

async function getAnchorSession() {
  const link = await createAnchorLink()
  const restored = await link.restoreSession(ANCHOR_APP_IDENTIFIER)
  if (restored) return restored

  const identity = await link.login(ANCHOR_APP_IDENTIFIER)
  return identity.session
}

function authFromSession(session: any): ZeroSignerAccount {
  return {
    actor: session.auth.actor.toString(),
    permission: session.auth.permission.toString(),
  }
}

function getProcessedTransactionId(processed: unknown): string | undefined {
  if (!processed || typeof processed !== 'object') return undefined
  const payload = processed as { transaction_id?: unknown; id?: unknown }
  if (typeof payload.transaction_id === 'string') return payload.transaction_id
  if (typeof payload.id === 'string') return payload.id
  return undefined
}

export async function connectZeroSigner(): Promise<ZeroSignerAccount> {
  const session = await getAnchorSession()
  return authFromSession(session)
}

export async function signAndBroadcastZeroActions({
  actions,
  expectedActor,
}: {
  actions: ZeroAction[]
  expectedActor?: string
}): Promise<ZeroSignedTransaction> {
  const session = await getAnchorSession()
  const signer = authFromSession(session)

  if (expectedActor && signer.actor !== expectedActor.trim()) {
    throw new Error(`Anchor is connected as ${signer.actor}, but this transfer is from ${expectedActor.trim()}`)
  }

  const authorization = [{
    actor: signer.actor,
    permission: signer.permission,
  }]

  const result = await session.transact({
    actions: actions.map(action => ({
      ...action,
      authorization,
    })),
  }, { broadcast: true })

  return {
    signer,
    transactionId: getProcessedTransactionId(result.processed),
  }
}
