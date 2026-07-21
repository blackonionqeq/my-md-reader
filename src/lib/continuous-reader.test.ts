import { describe, expect, it } from 'vitest';
import {
  calculateArticleProgress,
  calculateHeightCompensation,
  estimateSlotHeight,
  getRenderWindow,
  selectActiveSlot
} from './continuous-reader';

describe('getRenderWindow', () => {
  it('keeps the active article and its available neighbors', () => {
    expect(getRenderWindow(0, 5)).toEqual([0, 1]);
    expect(getRenderWindow(2, 5)).toEqual([1, 2, 3]);
    expect(getRenderWindow(4, 5)).toEqual([3, 4]);
  });

  it('replaces the whole window for a distant target', () => {
    expect(getRenderWindow(8, 12)).toEqual([7, 8, 9]);
  });
});
describe('estimateSlotHeight', () => {
  it('falls back to the viewport before measurements exist', () => {
    expect(estimateSlotHeight([], 720)).toBe(720);
    expect(estimateSlotHeight([], 320)).toBe(480);
  });

  it('uses the median of valid measurements', () => {
    expect(estimateSlotHeight([900], 720)).toBe(900);
    expect(estimateSlotHeight([300, 900, 600], 720)).toBe(600);
    expect(estimateSlotHeight([300, 900, 600, 1200], 720)).toBe(750);
    expect(estimateSlotHeight([0, Number.NaN, 500], 720)).toBe(500);
  });
});

describe('selectActiveSlot', () => {
  const rects = [
    { index: 0, top: 0, bottom: 500 },
    { index: 1, top: 500, bottom: 1000 },
    { index: 2, top: 1000, bottom: 1500 }
  ];

  it('selects the slot containing the reading anchor', () => {
    expect(selectActiveSlot(rects, 499)).toBe(0);
    expect(selectActiveSlot(rects, 500)).toBe(1);
    expect(selectActiveSlot(rects, 1499)).toBe(2);
  });

  it('selects the nearest edge slot outside the surface', () => {
    expect(selectActiveSlot(rects, -20)).toBe(0);
    expect(selectActiveSlot(rects, 1600)).toBe(2);
    expect(selectActiveSlot([], 100)).toBeNull();
  });
});

describe('calculateArticleProgress', () => {
  it('returns an article-local position and clamped progress', () => {
    expect(calculateArticleProgress({
      slotTop: 1000,
      slotHeight: 2000,
      viewportTop: 1500,
      viewportHeight: 800
    })).toEqual({ scrollPosition: 500, progressRatio: 5 / 12 });

    expect(calculateArticleProgress({
      slotTop: 1000,
      slotHeight: 1200,
      viewportTop: 3000,
      viewportHeight: 800
    }).progressRatio).toBe(1);
  });
});

describe('calculateHeightCompensation', () => {
  it('compensates positive and negative changes wholly above the anchor', () => {
    expect(calculateHeightCompensation({
      slotTop: 0,
      previousHeight: 400,
      nextHeight: 460,
      anchorY: 700
    })).toBe(60);
    expect(calculateHeightCompensation({
      slotTop: 0,
      previousHeight: 460,
      nextHeight: 400,
      anchorY: 700
    })).toBe(-60);
  });

  it('does not compensate a slot at or below the anchor', () => {
    expect(calculateHeightCompensation({
      slotTop: 500,
      previousHeight: 400,
      nextHeight: 500,
      anchorY: 700
    })).toBe(0);
  });
});
