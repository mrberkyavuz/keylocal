"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { BiometricStore } = require("../electron/biometric.cjs");
function fixture(overrides = {}) {
  const saved = new Map();
  let options,
    reads = 0,
    cancel = false;
  const adapter = new BiometricStore({
    platform: "darwin",
    packaged: true,
    canPrompt: () => true,
    openStore: (config) => {
      options = config;
      return {
        status: async (account) => ({
          status: saved.has(account) ? "requires-authentication" : "missing",
        }),
        set: async (account, bytes) =>
          saved.set(account, Uint8Array.from(bytes)),
        get: async (account) => {
          reads++;
          if (cancel) throw new Error("User cancelled Touch ID");
          return saved.has(account)
            ? Uint8Array.from(saved.get(account))
            : null;
        },
        remove: async (account) => saved.delete(account),
      };
    },
    ...overrides,
  });
  return {
    adapter,
    saved,
    get options() {
      return options;
    },
    get reads() {
      return reads;
    },
    cancel: () => {
      cancel = true;
    },
  };
}
test("Windows and unsigned Mac builds never offer biometric unlock", async () => {
  for (const override of [
    { platform: "win32" },
    { packaged: false },
    { canPrompt: () => false },
  ]) {
    const f = fixture(override);
    assert.equal((await f.adapter.status("/vault.kdbx")).available, false);
    await assert.rejects(() => f.adapter.get("/vault.kdbx"));
    assert.equal(f.reads, 0);
  }
});
test("enrollment stores only a device-only biometric-ACL key and confirms a protected read", async () => {
  const f = fixture();
  const key = new Uint8Array(32).fill(9);
  await f.adapter.set("/vault.kdbx", key);
  assert.deepEqual(f.options.authentication, {
    accessControl: "biometrics-only",
  });
  assert.equal(f.options.iCloudSync, false);
  assert.equal(f.reads, 1);
  const status = await f.adapter.status("/vault.kdbx");
  assert.equal(status.enabled, true);
  assert.equal(f.reads, 1);
  const read = await f.adapter.get("/vault.kdbx");
  assert.deepEqual(read, key);
  read.fill(0);
  await f.adapter.remove("/vault.kdbx");
  assert.equal((await f.adapter.status("/vault.kdbx")).enabled, false);
});
test("cancelled enrollment removes a partially created key", async () => {
  const f = fixture();
  f.cancel();
  await assert.rejects(
    () => f.adapter.set("/vault.kdbx", new Uint8Array(32)),
    /cancelled/,
  );
  assert.equal(f.saved.size, 0);
});
test("vault credentials are isolated by path and never exposed through status", async () => {
  const f = fixture();
  await f.adapter.set("/a.kdbx", new Uint8Array(32).fill(7));
  assert.equal((await f.adapter.status("/b.kdbx")).enabled, false);
  await assert.rejects(() => f.adapter.get("/b.kdbx"), /unavailable/);
  assert.equal("key" in (await f.adapter.status("/a.kdbx")), false);
});
test("missing native binary or signing entitlement fails closed", async () => {
  const f = fixture({
    openStore: () => {
      throw new Error("Missing entitlement");
    },
  });
  assert.equal((await f.adapter.status("/vault.kdbx")).available, false);
  await assert.rejects(() => f.adapter.set("/vault.kdbx", new Uint8Array(32)));
});
