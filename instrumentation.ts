// Load the vision models as the server boots, so the first scan in front of an audience is a warm one.
// Deliberately not awaited: the server must answer its healthcheck while the models load.
export function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  void import('./lib/grounded.mjs')
    .then(m => Promise.resolve(m.warmupVision()))
    .catch(e => console.warn('[sellout] vision warmup failed, first scan will load models:', e));
}
