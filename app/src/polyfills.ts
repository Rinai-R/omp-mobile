import * as ExpoCrypto from "expo-crypto";

// Hermes has no Web Crypto. Noble (DSH Remote's Noise channel and pairing keys)
// resolves `crypto.getRandomValues` while its modules load, so this must run
// before App is imported: index.ts imports it first.
const current = globalThis.crypto as Crypto | undefined;
if (current?.getRandomValues === undefined) {
  Object.defineProperty(globalThis, "crypto", {
    value: { ...current, getRandomValues: ExpoCrypto.getRandomValues, randomUUID: ExpoCrypto.randomUUID },
    configurable: true,
  });
}
