import { compareMoney } from "../money"
import type { SeriesPoint } from "../types"

export function chartGeometry(items: SeriesPoint[]) {
  const costs = items.map((item) => Number(item.costUsd))
  const renderable = costs.every(
    (cost, index) =>
      Number.isFinite(cost) &&
      cost >= 0 &&
      (cost !== 0 || compareMoney(items[index].costUsd, "0") === 0)
  )
  const maximum = Math.max(0, ...costs)
  const peak = items.reduce(
    (value, item) =>
      compareMoney(item.costUsd, value) > 0 ? item.costUsd : value,
    "0"
  )
  return {
    renderable,
    peak,
    rows: items.map((item, index) => ({
      ...item,
      spendHeight: renderable
        ? maximum > 0
          ? (costs[index] / maximum) * 100
          : 0
        : null,
    })),
  }
}
