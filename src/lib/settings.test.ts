import { describe, expect, it } from 'vitest';
import { normalizeFontSize } from './settings';

describe('normalizeFontSize', () => {
  it('clamps the configured font size', () => {
    expect(normalizeFontSize(9)).toBe(14);
    expect(normalizeFontSize(30)).toBe(24);
    expect(normalizeFontSize(18)).toBe(18);
  });
});
