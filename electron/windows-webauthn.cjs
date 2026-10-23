"use strict";
// Native layouts and API contracts: microsoft/webauthn, webauthn.h.
// PRF output, not a consent result, protects the device unlock credential.
const { randomBytes, createHash, timingSafeEqual } = require("node:crypto");
const path = require("node:path");
const RP = "keylocal.app";
class WindowsWebAuthn {
  constructor(getWindowHandle) {
    if (process.platform !== "win32") throw new Error("Windows only.");
    const k = (this.k = require("koffi"));
    this.hwnd = getWindowHandle;
    const struct = (name, fields) => k.struct("KL_" + name, fields);
    const ptr = "void *",
      u = "uint32_t",
      b = "int32_t",
      w = "char16_t *";
    const List = struct("List", { count: u, items: ptr });
    const Credential = (this.Credential = struct("Credential", {
      version: u,
      size: u,
      id: ptr,
      type: w,
    }));
    this.CredentialEx = struct("CredentialEx", {
      version: u,
      size: u,
      id: ptr,
      type: w,
      transports: u,
    });
    this.CredentialList = struct("CredentialList", { count: u, items: ptr });
    const Hmac = (this.Hmac = struct("Hmac", {
      cbFirst: u,
      pbFirst: ptr,
      cbSecond: u,
      pbSecond: ptr,
    }));
    this.Salts = struct("Salts", {
      global: k.pointer(Hmac),
      count: u,
      items: ptr,
    });
    this.Rp = struct("Rp", { version: u, id: w, name: w, icon: w });
    this.User = struct("User", {
      version: u,
      size: u,
      id: ptr,
      name: w,
      icon: w,
      display: w,
    });
    this.Client = struct("Client", { version: u, size: u, json: ptr, hash: w });
    this.Param = struct("Param", { version: u, type: w, algorithm: b });
    this.Params = struct("Params", { count: u, items: k.pointer(this.Param) });
    this.Make = struct("Make", {
      version: u,
      timeout: u,
      credentials: List,
      extensions: List,
      attachment: u,
      resident: b,
      verification: u,
      attestation: u,
      flags: u,
      cancellation: ptr,
      excludes: ptr,
      enterprise: u,
      largeBlob: u,
      preferResident: b,
      private: b,
      prf: b,
      linked: ptr,
      jsonSize: u,
      json: ptr,
      eval: k.pointer(Hmac),
      hintsCount: u,
      hints: ptr,
      payment: b,
    });
    this.Get = struct("Get", {
      version: u,
      timeout: u,
      credentials: List,
      extensions: List,
      attachment: u,
      verification: u,
      flags: u,
      appId: ptr,
      usedAppId: ptr,
      cancellation: ptr,
      allow: ptr,
      blobOperation: u,
      blobSize: u,
      blob: ptr,
      salts: k.pointer(this.Salts),
      private: b,
    });
    this.Att = struct("Att", {
      version: u,
      format: ptr,
      authSize: u,
      auth: ptr,
      attSize: u,
      att: ptr,
      decodeType: u,
      decode: ptr,
      objectSize: u,
      object: ptr,
      idSize: u,
      id: ptr,
      extensions: List,
      transport: u,
      enterprise: b,
      largeBlob: b,
      resident: b,
      prf: b,
      unsignedSize: u,
      unsigned: ptr,
      hmac: ptr,
      payment: b,
    });
    this.Assertion = struct("Assertion", {
      version: u,
      authSize: u,
      auth: ptr,
      signatureSize: u,
      signature: ptr,
      credential: Credential,
      userSize: u,
      user: ptr,
      extensions: List,
      blobSize: u,
      blob: ptr,
      blobStatus: u,
      hmac: ptr,
    });
    const lib = (this.lib = k.load(
      path.join(
        process.env.SystemRoot || "C:\\Windows",
        "System32",
        "webauthn.dll",
      ),
    ));
    this.version = lib.func(
      "uint32_t __stdcall WebAuthNGetApiVersionNumber()",
    )();
    this.availableFn = lib.func(
      "int32_t __stdcall WebAuthNIsUserVerifyingPlatformAuthenticatorAvailable(_Out_ int32_t *available)",
    );
    this.makeFn = lib.func(
      "int32_t __stdcall WebAuthNAuthenticatorMakeCredential(uintptr_t hwnd, KL_Rp *rp, KL_User *user, KL_Params *params, KL_Client *client, KL_Make *options, _Out_ void **result)",
    );
    this.getFn = lib.func(
      "int32_t __stdcall WebAuthNAuthenticatorGetAssertion(uintptr_t hwnd, const char16_t *rp, KL_Client *client, KL_Get *options, _Out_ void **result)",
    );
    this.freeAtt = lib.func(
      "void __stdcall WebAuthNFreeCredentialAttestation(void *result)",
    );
    this.freeGet = lib.func(
      "void __stdcall WebAuthNFreeAssertion(void *result)",
    );
    this.deleteFn = lib.func(
      "int32_t __stdcall WebAuthNDeletePlatformCredential(uint32_t length, const uint8_t *id)",
    );
  }
  async call(fn, ...args) {
    return new Promise((resolve, reject) =>
      fn.async(...args, (error, hr) => {
        if (error) return reject(error);
        if (hr !== 0)
          return reject(
            new Error(
              `Windows Hello did not complete (0x${(hr >>> 0).toString(16)}). Use your master password or try again.`,
            ),
          );
        resolve();
      }),
    );
  }
  async available() {
    if (this.version < 8) return false;
    const result = [0];
    await this.call(this.availableFn, result);
    return result[0] !== 0;
  }
  client(type) {
    const json = Buffer.from(
      JSON.stringify({
        type: "webauthn." + type,
        challenge: randomBytes(32).toString("base64url"),
        origin: "https://" + RP,
        crossOrigin: false,
      }),
    );
    return { version: 1, size: json.length, json, hash: "SHA-256" };
  }
  window() {
    const handle = this.hwnd();
    if (!Buffer.isBuffer(handle) || handle.length !== 8)
      throw new Error("Windows Hello requires a live x64 desktop window.");
    return handle.readBigUInt64LE();
  }
  bytes(pointer, length, maximum = 4096) {
    if (!pointer || !Number.isInteger(length) || length < 1 || length > maximum)
      throw new Error("Invalid Windows Hello response.");
    return Buffer.from(this.k.decode(pointer, "uint8_t", length));
  }
  verifyAuth(pointer, length) {
    const data = this.bytes(pointer, length, 65536);
    const hash = createHash("sha256").update(RP).digest();
    if (
      data.length < 37 ||
      !timingSafeEqual(data.subarray(0, 32), hash) ||
      (data[32] & 5) !== 5
    )
      throw new Error("Windows Hello did not verify the user for this vault.");
  }
  secret(pointer) {
    if (!pointer)
      throw new Error(
        "This Windows Hello authenticator does not support PRF key protection.",
      );
    const hmac = this.k.decode(pointer, this.Hmac);
    if (hmac.cbFirst !== 32)
      throw new Error("Windows Hello returned an invalid protection key.");
    const secret = this.bytes(hmac.pbFirst, 32);
    // Copy into native memory; external ArrayBuffer views abort Electron's V8
    // sandbox. Keep zeroization without creating a view outside its memory cage.
    this.k.encode(hmac.pbFirst, this.k.array("uint8_t", 32), Buffer.alloc(32));
    return secret;
  }
  async enroll(salt, label) {
    if (!(await this.available()))
      throw new Error(
        "Set up Windows Hello in Windows Settings first. WebAuthn API 8 or newer is required.",
      );
    const output = [null];
    let id,
      complete = false;
    try {
      await this.call(
        this.makeFn,
        this.window(),
        { version: 1, id: RP, name: "Keylocal", icon: null },
        {
          version: 1,
          size: 16,
          id: randomBytes(16),
          name: label,
          icon: null,
          display: label,
        },
        {
          count: 1,
          items: [{ version: 1, type: "public-key", algorithm: -7 }],
        },
        this.client("create"),
        {
          version: 8,
          timeout: 60000,
          credentials: { count: 0, items: null },
          extensions: { count: 0, items: null },
          attachment: 1,
          resident: 0,
          verification: 1,
          attestation: 1,
          flags: 0,
          prf: 1,
          eval: { cbFirst: 32, pbFirst: salt, cbSecond: 0, pbSecond: null },
        },
        output,
      );
      if (!output[0]) throw new Error("No Windows Hello credential returned.");
      // Read the version before decoding fields introduced in newer layouts.
      if (this.k.decode(output[0], "uint32_t") < 7)
        throw new Error("Windows Hello PRF is unavailable on this system.");
      const result = this.k.decode(output[0], this.Att);
      id = this.bytes(result.id, result.idSize);
      this.verifyAuth(result.auth, result.authSize);
      if (!result.prf)
        throw new Error("Windows Hello PRF key protection is unavailable.");
      const key = this.secret(result.hmac);
      complete = true;
      return { credentialId: id, key };
    } finally {
      if (output[0]) this.freeAtt(output[0]);
      if (!complete && id) await this.remove(id).catch(() => {});
    }
  }
  async derive(credentialId, salt) {
    const output = [null];
    try {
      // The extended allow-list supplies the known credential's INTERNAL transport
      // so Windows can route directly to this computer's platform authenticator.
      const nativeCredential = this.k.alloc(this.CredentialEx, 1);
      const nativePointers = this.k.alloc("void *", 1);
      const nativeAllow = this.k.alloc(this.CredentialList, 1);
      const nativeId = this.k.alloc("uint8_t", credentialId.length);
      const nativeType = this.k.alloc("char16_t", 11);
      try {
        this.k.encode(
          nativeId,
          this.k.array("uint8_t", credentialId.length),
          credentialId,
        );
        this.k.encode(
          nativeType,
          this.k.array("uint8_t", 22),
          Buffer.from("public-key\0", "utf16le"),
        );
        this.k.encode(nativeCredential, this.CredentialEx, {
          version: 1,
          size: credentialId.length,
          id: nativeId,
          type: nativeType,
          transports: 0x10, // WEBAUTHN_CTAP_TRANSPORT_INTERNAL
        });
        this.k.encode(nativePointers, this.k.array("void *", 1), [
          nativeCredential,
        ]);
        this.k.encode(nativeAllow, this.CredentialList, {
          count: 1,
          items: nativePointers,
        });
        await this.call(
          this.getFn,
          this.window(),
          RP,
          this.client("get"),
          {
            version: 6,
            timeout: 60000,
            credentials: { count: 0, items: null },
            extensions: { count: 0, items: null },
            attachment: 1,
            verification: 1,
            flags: 0,
            allow: nativeAllow,
            salts: {
              global: {
                cbFirst: 32,
                pbFirst: salt,
                cbSecond: 0,
                pbSecond: null,
              },
              count: 0,
              items: null,
            },
          },
          output,
        );
      } finally {
        this.k.free(nativeCredential);
        this.k.free(nativePointers);
        this.k.free(nativeAllow);
        this.k.free(nativeId);
        this.k.free(nativeType);
      }
      if (!output[0] || this.k.decode(output[0], "uint32_t") < 3)
        throw new Error("Windows Hello PRF response is unavailable.");
      const result = this.k.decode(output[0], this.Assertion);
      this.verifyAuth(result.auth, result.authSize);
      const returnedId = this.bytes(
        result.credential.id,
        result.credential.size,
      );
      if (!returnedId.equals(credentialId))
        throw new Error("Windows Hello credential mismatch.");
      return this.secret(result.hmac);
    } finally {
      if (output[0]) this.freeGet(output[0]);
    }
  }
  async remove(id) {
    await this.call(this.deleteFn, id.length, id);
  }
}
module.exports = { WindowsWebAuthn, RP };
