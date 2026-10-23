"use strict";
const { createHash } = require("node:crypto");

// Only the main process can instantiate this adapter. No secret crosses IPC.
class BiometricStore {
  constructor({ platform, packaged, canPrompt, openStore, windows }) {
    this.platform = platform;
    this.windows = windows;
    this.packaged = packaged;
    this.canPrompt = canPrompt;
    this.openStore = openStore;
  }
  account(file) {
    return `vault-v1-${createHash("sha256").update(file).digest("hex")}`;
  }
  store(file, requirePrompt = true) {
    if (
      this.platform !== "darwin" ||
      !this.packaged ||
      (requirePrompt && !this.canPrompt())
    )
      throw new Error(
        "Touch ID requires a signed Mac app and enrolled fingerprints.",
      );
    const account = this.account(file);
    return {
      account,
      store: this.openStore({
        authentication: { accessControl: "biometrics-only" },
        iCloudSync: false,
        mutableAccounts: [account],
      }),
    };
  }
  async status(file) {
    if (this.platform === "win32" && this.windows)
      return this.windows.status(file);
    const base = {
      available: false,
      enabled: false,
      label: this.platform === "darwin" ? "Touch ID" : "Windows Hello",
      reason: "Windows Hello unlock is not supported in this release.",
    };
    if (this.platform !== "darwin") return base;
    base.reason =
      "Touch ID requires a signed Mac app, Keychain access and enrolled fingerprints.";
    if (!file) return base;
    try {
      const { account, store } = this.store(file);
      const result = await store.status(account);
      if (
        !["missing", "available", "requires-authentication"].includes(
          result.status,
        )
      )
        return base;
      return {
        ...base,
        available: true,
        enabled: result.status !== "missing",
        reason:
          "Unlock with Touch ID on this Mac. Your master password remains available.",
      };
    } catch {
      return base;
    }
  }
  async set(file, secret) {
    if (this.platform === "win32" && this.windows)
      return this.windows.set(file, secret);
    if (!(secret instanceof Uint8Array) || secret.length !== 32)
      throw new Error("Invalid unlock key.");
    const { account, store } = this.store(file);
    await store.set(account, secret);
    // Confirm a protected read succeeds before reporting enrollment complete.
    let check;
    try {
      check = await store.get(account, "Uint8Array");
      if (!check || !Buffer.from(check).equals(Buffer.from(secret)))
        throw new Error("Touch ID enrollment failed.");
    } catch (error) {
      await store.remove(account).catch(() => {});
      throw error;
    } finally {
      check?.fill(0);
    }
  }
  async get(file) {
    if (this.platform === "win32" && this.windows)
      return this.windows.get(file);
    const { account, store } = this.store(file);
    const key = await store.get(account, "Uint8Array");
    if (!key || key.length !== 32) {
      key?.fill(0);
      throw new Error(
        "Touch ID key is unavailable. Unlock with your master password.",
      );
    }
    return key;
  }
  async remove(file) {
    if (this.platform === "win32" && this.windows)
      return this.windows.remove(file);
    if (!file || this.platform !== "darwin") return;
    const { account, store } = this.store(file, false);
    await store.remove(account);
  }
}
module.exports = { BiometricStore };
