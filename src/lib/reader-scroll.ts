// Pure decision for where the reader scrolls after rendering an article.
// Kept out of the component so the scroll intent is predictable and unit-testable
// without depending on jsdom/DOM scroll quirks.
export function resolveScrollTarget({
  restoreScrollPosition,
  savedPosition
}: {
  restoreScrollPosition: boolean;
  savedPosition?: number;
}): number {
  if (restoreScrollPosition && typeof savedPosition === 'number' && savedPosition > 0) {
    return savedPosition;
  }
  return 0;
}
