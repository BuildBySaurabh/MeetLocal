import { describe, expect, it, vi } from 'vitest';
import { registerServiceWorker } from './registerServiceWorker';

describe('registerServiceWorker', () => {
  it('does nothing outside production', () => {
    const register = vi.fn();
    expect(registerServiceWorker({ PROD: false }, { serviceWorker: { register } } as unknown as Navigator)).toBe(false);
    expect(register).not.toHaveBeenCalled();
  });

  it('does nothing when the browser has no service workers', () => {
    expect(registerServiceWorker({ PROD: true }, {} as Navigator)).toBe(false);
  });

  it('registers /sw.js on load in production and swallows failures', async () => {
    const register = vi.fn().mockRejectedValue(new Error('nope'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(registerServiceWorker({ PROD: true }, { serviceWorker: { register } } as unknown as Navigator)).toBe(true);
    window.dispatchEvent(new Event('load'));
    await Promise.resolve();
    expect(register).toHaveBeenCalledWith('/sw.js');
    await Promise.resolve();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
