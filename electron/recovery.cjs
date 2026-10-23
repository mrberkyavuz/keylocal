"use strict";
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { kdbx } = require("./crypto.cjs");
const { readFile, atomicWrite } = require("./vault.cjs");

// Only an encrypted snapshot survives verification. Passwords and decrypted
// database objects are never retained in the recovery session or sent to the UI.
class RecoverySession {
  constructor(generation, now = Date.now) {
    this.generation = generation;
    this.now = now;
    this.pending = null;
    this.busy = false;
  }
  clear() {
    this.pending = null;
  }
  choose(file) {
    this.clear();
    const bytes = readFile(file);
    this.pending = {
      token: randomUUID(),
      name: path.basename(file),
      bytes,
      generation: this.generation(),
      expires: this.now() + 5 * 60000,
      verified: false,
    };
    const { token, name } = this.pending;
    return { token, name, size: bytes.length };
  }
  require(token, verified = false) {
    const record = this.pending;
    if (
      typeof token !== "string" ||
      !record ||
      token !== record.token ||
      record.generation !== this.generation() ||
      record.expires <= this.now()
    ) {
      throw new Error("Backup selection expired. Choose the backup again.");
    }
    if (verified && !record.verified)
      throw new Error("Verify the backup with its master password first.");
    return record;
  }
  async verify(token, password) {
    const record = this.require(token);
    if (this.busy) throw new Error("Backup verification is already running.");
    if (typeof password !== "string" || password.length > 1024)
      throw new Error("Invalid master password.");
    record.verified = false;
    this.busy = true;
    try {
      const credentials = new kdbx.Credentials(
        kdbx.ProtectedValue.fromString(password),
      );
      const bytes = record.bytes;
      await kdbx.Kdbx.load(
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
        credentials,
      );
      if (this.require(token) !== record)
        throw new Error("Backup selection changed during verification.");
      record.verified = true;
      return { verified: true, checkedAt: new Date(this.now()).toISOString() };
    } catch (error) {
      if (error.code === "InvalidKey")
        throw new Error(
          "Incorrect backup password. Older backups may use an older master password.",
        );
      throw error;
    } finally {
      this.busy = false;
    }
  }
  restore(token, target) {
    const record = this.require(token, true);
    // Exclusive creation also refuses to overwrite the source or an active vault.
    atomicWrite(target, record.bytes, true);
    this.clear();
  }
}
module.exports = { RecoverySession };
