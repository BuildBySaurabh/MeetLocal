import { describe, expect, it } from 'vitest';
import { looksInverted, maskFromConfidence } from './personMask';

function centreMask(w: number, h: number, inside: number, outside: number) {
  const values = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1) values[y * w + x] = x > w * 0.25 && x < w * 0.75 && y > h * 0.2 ? inside : outside;
  return values;
}

describe('maskFromConfidence', () => {
  it('scales to 0..255, clamps and can invert', () => {
    const m = maskFromConfidence([0, 0.5, 1, 2, -1], 5, 1, false);
    expect([...m.alpha]).toEqual([0, 128, 255, 255, 0]);
    expect([...maskFromConfidence([0, 1], 2, 1, true).alpha]).toEqual([255, 0]);
  });
});

describe('looksInverted', () => {
  it('accepts a mask with the person in the middle', () => {
    expect(looksInverted(maskFromConfidence(centreMask(32, 32, 1, 0), 32, 32, false))).toBe(false);
  });
  it('flags a mask that is bright at the edges and dark in the middle', () => {
    expect(looksInverted(maskFromConfidence(centreMask(32, 32, 0, 1), 32, 32, false))).toBe(true);
  });
  it('leaves flat or tiny masks alone', () => {
    expect(looksInverted(maskFromConfidence(new Float32Array(1024).fill(0.5), 32, 32, false))).toBe(false);
    expect(looksInverted(maskFromConfidence([1, 0, 0, 1], 2, 2, false))).toBe(false);
  });
});
