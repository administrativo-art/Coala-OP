export function nextSegmentedIndex(key: string, currentIndex: number, optionCount: number): number | null {
  if (optionCount <= 0) return null
  if (key === "ArrowRight" || key === "ArrowDown") return (currentIndex + 1) % optionCount
  if (key === "ArrowLeft" || key === "ArrowUp") return (currentIndex - 1 + optionCount) % optionCount
  if (key === "Home") return 0
  if (key === "End") return optionCount - 1
  return null
}
