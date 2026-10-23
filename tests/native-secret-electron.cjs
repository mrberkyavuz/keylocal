"use strict";
// Synthetic native memory only. Never opens a vault or prompts Windows Hello.
const { app } = require("electron");
const assert = require("node:assert/strict");
app
  .whenReady()
  .then(async () => {
    const { WindowsWebAuthn } = require("../electron/windows-webauthn.cjs");
    const native = new WindowsWebAuthn(() => Buffer.alloc(8));
    const data = native.k.alloc("uint8_t", 32);
    const response = native.k.alloc(native.Hmac, 1);
    try {
      native.k.encode(data, native.k.array("uint8_t", 32), Buffer.alloc(32, 7));
      native.k.encode(response, native.Hmac, {
        cbFirst: 32,
        pbFirst: data,
        cbSecond: 0,
        pbSecond: null,
      });
      const secret = native.secret(response);
      assert.deepEqual(secret, Buffer.alloc(32, 7));
      assert.deepEqual(native.bytes(data, 32), Buffer.alloc(32));
      secret.fill(0);
      console.log("Electron native secret copy and zeroization passed.");
    } finally {
      native.k.free(data);
      native.k.free(response);
    }
    // Inspect the marshaled request without opening a system authentication prompt.
    native.call = async (fn, hwnd, rp, client, options) => {
      assert.equal(fn, native.getFn);
      assert.equal(options.attachment, 1);
      assert.equal(options.verification, 1);
      assert.equal(options.credentials.count, 0);
      const allow = native.k.decode(options.allow, native.CredentialList);
      assert.equal(allow.count, 1);
      const pointer = native.k.decode(allow.items, "void *");
      const credential = native.k.decode(pointer, native.CredentialEx);
      assert.equal(credential.version, 1);
      assert.equal(credential.transports, 0x10);
      assert.equal(credential.size, 32);
      assert.deepEqual(
        native.bytes(credential.id, credential.size),
        Buffer.alloc(32, 9),
      );
      throw new Error("Synthetic request inspected");
    };
    await assert.rejects(
      () => native.derive(Buffer.alloc(32, 9), Buffer.alloc(32, 2)),
      /Synthetic request inspected/,
    );
    console.log(
      "Electron native allow-list, internal transport and required user verification passed.",
    );
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
