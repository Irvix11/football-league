import { describe, expect, it } from 'vitest';
import { getBidStep, getMinNextBid } from './auction';

describe('auction bid helpers', () => {
  it('uses the shared bid increment thresholds', () => {
    expect(getBidStep(0)).toBe(2);
    expect(getBidStep(99)).toBe(2);
    expect(getBidStep(100)).toBe(5);
    expect(getBidStep(249)).toBe(5);
    expect(getBidStep(250)).toBe(10);
  });

  it('calculates the minimum next bid consistently', () => {
    expect(getMinNextBid(0, false)).toBe(0);
    expect(getMinNextBid(99, true)).toBe(101);
    expect(getMinNextBid(100, true)).toBe(105);
    expect(getMinNextBid(250, true)).toBe(260);
  });
});
