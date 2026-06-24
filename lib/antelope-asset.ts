export function formatAntelopeQuantityRaw(value: bigint, decimals: number, symbol: string) {
  const sign = value < 0n ? '-' : ''
  const absolute = value < 0n ? -value : value
  const scale = 10n ** BigInt(decimals)
  const whole = absolute / scale

  if (decimals === 0) {
    return `${sign}${whole.toString()} ${symbol}`
  }

  const fraction = (absolute % scale).toString().padStart(decimals, '0')
  return `${sign}${whole.toString()}.${fraction} ${symbol}`
}
