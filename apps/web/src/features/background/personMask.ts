/** A per-pixel "this is the person" mask, alpha 0..255, row by row. */
export interface PersonMask {
  width: number;
  height: number;
  alpha: Uint8ClampedArray;
}

/** Converts model confidences (0..1) to an alpha mask, optionally flipping it. */
export function maskFromConfidence(values: ArrayLike<number>, width: number, height: number, invert: boolean): PersonMask {
  const alpha = new Uint8ClampedArray(width * height);
  for (let i = 0; i < alpha.length; i += 1) {
    const v = Math.min(1, Math.max(0, values[i] ?? 0));
    alpha[i] = Math.round((invert ? 1 - v : v) * 255);
  }
  return { width, height, alpha };
}

/**
 * Decides whether a mask is the wrong way round. In a webcam picture the person is normally near the
 * centre and the picture edges are background, so the centre should be brighter than the border. This
 * is a safeguard because the model's output convention could not be checked on a real person here.
 * Returns true when the mask looks inverted. Uncertain masks (little difference) are left alone.
 */
export function looksInverted(mask: PersonMask): boolean {
  const { width, height, alpha } = mask;
  if (width < 8 || height < 8) return false;
  let centre = 0;
  let centreN = 0;
  let edge = 0;
  let edgeN = 0;
  const x0 = Math.floor(width * 0.3);
  const x1 = Math.ceil(width * 0.7);
  const y0 = Math.floor(height * 0.3);
  const y1 = Math.ceil(height * 0.7);
  const margin = Math.max(1, Math.floor(Math.min(width, height) * 0.1));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const v = alpha[y * width + x]!;
      if (x >= x0 && x < x1 && y >= y0 && y < y1) {
        centre += v;
        centreN += 1;
      } else if (x < margin || x >= width - margin || y < margin || y >= height - margin) {
        edge += v;
        edgeN += 1;
      }
    }
  }
  if (!centreN || !edgeN) return false;
  return edge / edgeN - centre / centreN > 40;
}
