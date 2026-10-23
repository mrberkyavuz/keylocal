"use strict";
const fs = require("node:fs");
const path = require("node:path");
const {
  randomBytes,
  createHash,
  createCipheriv,
  createDecipheriv,
} = require("node:crypto");
const { atomicWrite } = require("./vault.cjs");
const { RP } = require("./windows-webauthn.cjs");
class WindowsHelloStore {
  constructor(root, native) {
    this.root = path.join(root, "hello");
    this.native = native;
  }
  id(file) {
    return createHash("sha256").update(file).digest("hex");
  }
  location(file) {
    return path.join(this.root, this.id(file) + ".json");
  }
  read(file) {
    const target = this.location(file);
    if (!fs.existsSync(target)) return null;
    if (fs.statSync(target).size > 16384)
      throw new Error("Invalid Windows Hello record.");
    const b = JSON.parse(fs.readFileSync(target, "utf8"));
    if (b.version !== 1 || b.rp !== RP || b.account !== this.id(file))
      throw new Error("Invalid Windows Hello record.");
    for (const [key, min, max] of [
      ["id", 1, 4096],
      ["salt", 32, 32],
      ["nonce", 12, 12],
      ["ciphertext", 32, 32],
      ["tag", 16, 16],
    ]) {
      if (typeof b[key] !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(b[key]))
        throw new Error("Invalid Windows Hello record.");
      const bytes = Buffer.from(b[key], "base64");
      if (
        bytes.length < min ||
        bytes.length > max ||
        bytes.toString("base64") !== b[key]
      )
        throw new Error("Invalid Windows Hello record.");
    }
    return b;
  }
  aad(b) {
    return Buffer.from(
      JSON.stringify([
        "Keylocal Hello",
        b.version,
        b.rp,
        b.account,
        b.id,
        b.salt,
      ]),
    );
  }
  async status(file) {
    let available = false,
      enabled = false;
    try {
      available = await this.native.available();
      enabled = !!(file && this.read(file));
    } catch {
      return {
        available: false,
        enabled: false,
        label: "Windows Hello",
        reason: "Windows Hello is unavailable. Use your master password.",
      };
    }
    return {
      available,
      enabled,
      label: "Windows Hello",
      reason: available
        ? "Use Windows Hello (fingerprint, face or PIN) on this computer. Your master password remains available."
        : "Set up Windows Hello in Windows Settings. WebAuthn API 8 or newer and PRF support are required.",
    };
  }
  async set(file, secret) {
    if (!(secret instanceof Uint8Array) || secret.length !== 32)
      throw new Error("Invalid unlock key.");
    if (this.read(file))
      throw new Error("Disable Windows Hello before enrolling again.");
    const salt = randomBytes(32);
    const result = await this.native.enroll(
      salt,
      "Keylocal vault " + this.id(file).slice(0, 8),
    );
    let saved = false;
    try {
      if (!Buffer.isBuffer(result.key) || result.key.length !== 32)
        throw new Error("Invalid Windows Hello protection key.");
      // Confirm a separate user-verified assertion can reproduce the protection key.
      const check = await this.native.derive(result.credentialId, salt);
      try {
        if (!Buffer.from(check).equals(result.key))
          throw new Error(
            "Windows Hello could not confirm the protection key.",
          );
      } finally {
        check.fill(0);
      }
      const b = {
        version: 1,
        rp: RP,
        account: this.id(file),
        id: result.credentialId.toString("base64"),
        salt: salt.toString("base64"),
        nonce: randomBytes(12).toString("base64"),
      };
      const cipher = createCipheriv(
        "aes-256-gcm",
        result.key,
        Buffer.from(b.nonce, "base64"),
      );
      cipher.setAAD(this.aad(b));
      b.ciphertext = Buffer.concat([
        cipher.update(secret),
        cipher.final(),
      ]).toString("base64");
      b.tag = cipher.getAuthTag().toString("base64");
      fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
      atomicWrite(this.location(file), Buffer.from(JSON.stringify(b)), true);
      saved = true;
    } finally {
      result.key?.fill(0);
      if (!saved) await this.native.remove(result.credentialId).catch(() => {});
    }
  }
  async get(file) {
    const b = this.read(file);
    if (!b) throw new Error("Windows Hello is not enabled for this vault.");
    const key = await this.native.derive(
      Buffer.from(b.id, "base64"),
      Buffer.from(b.salt, "base64"),
    );
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        Buffer.from(b.nonce, "base64"),
      );
      decipher.setAAD(this.aad(b));
      decipher.setAuthTag(Buffer.from(b.tag, "base64"));
      const value = Buffer.concat([
        decipher.update(Buffer.from(b.ciphertext, "base64")),
        decipher.final(),
      ]);
      if (value.length !== 32) {
        value.fill(0);
        throw new Error("Invalid Windows Hello unlock credential.");
      }
      return value;
    } finally {
      key.fill(0);
    }
  }
  async remove(file) {
    const b = this.read(file);
    if (!b) return;
    fs.unlinkSync(this.location(file));
    // Destroying the encrypted wrapper revokes app access even if the OS key
    // cannot be removed while Hello is unavailable. No wrapper backup is kept.
    await this.native.remove(Buffer.from(b.id, "base64")).catch(() => {});
  }
}
module.exports = { WindowsHelloStore };
