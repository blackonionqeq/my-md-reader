export interface SlotRect {
  index: number;
  top: number;
  bottom: number;
}
export interface ArticleProgress {
  scrollPosition: number;
  progressRatio: number;
}

export function getRenderWindow(activeIndex: number, articleCount: number): number[] {
  if (articleCount <= 0 || activeIndex < 0 || activeIndex >= articleCount) {
    return [];
  }

  const start = Math.max(0, activeIndex - 1);
  const end = Math.min(articleCount - 1, activeIndex + 1);
  return Array.from({ length: end - start + 1 }, (_, offset) => start + offset);
}

export function estimateSlotHeight(
  measuredHeights: Iterable<number>,
  viewportHeight: number
): number {
  const samples = Array.from(measuredHeights)
    .filter((height) => Number.isFinite(height) && height > 0)
    .sort((left, right) => left - right);

  if (samples.length === 0) {
    return Math.max(480, Math.round(viewportHeight || 0));
  }

  const middle = Math.floor(samples.length / 2);
  if (samples.length % 2 === 1) {
    return samples[middle]!;
  }

  return (samples[middle - 1]! + samples[middle]!) / 2;
}

export function selectActiveSlot(rects: SlotRect[], anchorY: number): number | null {
  if (rects.length === 0) {
    return null;
  }

  const ordered = [...rects].sort((left, right) => left.top - right.top);
  const containing = ordered.find((rect) => rect.top <= anchorY && anchorY < rect.bottom);
  if (containing) {
    return containing.index;
  }

  const before = ordered.filter((rect) => rect.top <= anchorY).at(-1);
  return (before ?? ordered[0])!.index;
}

export function calculateArticleProgress({
  slotTop,
  slotHeight,
  viewportTop,
  viewportHeight
}: {
  slotTop: number;
  slotHeight: number;
  viewportTop: number;
  viewportHeight: number;
}): ArticleProgress {
  const scrollPosition = Math.max(0, viewportTop - slotTop);
  const usableExtent = Math.max(1, slotHeight - viewportHeight);

  return {
    scrollPosition,
    progressRatio: Math.max(0, Math.min(1, scrollPosition / usableExtent))
  };
}

export function calculateHeightCompensation({
  slotTop,
  previousHeight,
  nextHeight,
  anchorY
}: {
  slotTop: number;
  previousHeight: number;
  nextHeight: number;
  anchorY: number;
}): number {
  const wasAboveAnchor = slotTop + previousHeight <= anchorY;
  const remainsAboveAnchor = slotTop + nextHeight <= anchorY;
  return wasAboveAnchor && remainsAboveAnchor ? nextHeight - previousHeight : 0;
}
