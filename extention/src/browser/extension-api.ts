// Firefox's browser namespace exposes the promise APIs used by the extension.
export const extensionApi =
  (globalThis as typeof globalThis & { browser?: typeof chrome }).browser ??
  globalThis.chrome;
