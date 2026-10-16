export interface ModelPricing {
  costInPerMtok: number
  costOutPerMtok: number
}

/** Empty input is not a free model; require explicit non-negative decimal prices. */
export function parseModelPricing(input: string, output: string): ModelPricing | null {
  const parse = (text: string): number | null => {
    const value = text.trim()
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) return null
    const number = Number(value)
    return Number.isFinite(number) && number >= 0 ? number : null
  }
  const costInPerMtok = parse(input)
  const costOutPerMtok = parse(output)
  return costInPerMtok === null || costOutPerMtok === null ? null : { costInPerMtok, costOutPerMtok }
}
