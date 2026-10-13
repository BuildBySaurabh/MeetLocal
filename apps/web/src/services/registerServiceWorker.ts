/**
 * Registers the app-shell service worker (public/sw.js) in production builds only, so development
 * is never served stale files. Failure is harmless: the app works without a service worker.
 */
export function registerServiceWorker(
  env: { PROD: boolean } = import.meta.env,
  nav: Pick<Navigator, 'serviceWorker'> | undefined = typeof navigator === 'undefined' ? undefined : navigator,
): boolean {
  if (!env.PROD || !nav || !('serviceWorker' in nav)) return false;
  window.addEventListener('load', () => {
    nav.serviceWorker.register('/sw.js').catch((error: unknown) => {
      console.warn('Service worker registration failed', error);
    });
  });
  return true;
}
