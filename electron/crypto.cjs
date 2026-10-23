"use strict";
// kdbxweb 2.x's built-in adapter targets xmldom 0.7. Use the patched
// parser's current API through its documented global DOM hooks instead.
const { DOMParser, XMLSerializer } = require("@xmldom/xmldom");
global.DOMParser = class StrictVaultParser extends DOMParser {
  constructor() {
    super({
      onError: (_level, message) => {
        throw new Error(message);
      },
    });
  }
  parseFromString(xml, type) {
    if (xml.length > 64 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml))
      throw new Error("Unsupported XML declarations or oversized vault.");
    return super.parseFromString(xml, type);
  }
};
global.XMLSerializer = XMLSerializer;
const kdbx = require("kdbxweb");
const { timingSafeEqual } = require("node:crypto");
const { AsyncLocalStorage } = require("node:async_hooks");
const { gunzipSync } = require("node:zlib");
const MAX_EXPANDED_VAULT = 64 * 1024 * 1024;
function boundedGunzip(data) {
  const result = gunzipSync(Buffer.from(data), {
    maxOutputLength: MAX_EXPANDED_VAULT,
  });
  return result.buffer.slice(
    result.byteOffset,
    result.byteOffset + result.byteLength,
  );
}
// kdbxweb's bundled inflater allocates before XML length validation. Substitute
// bounded decompression at the authenticated plaintext boundaries, preserving
// the original compression setting for subsequent saves. No cipher is replaced.
const loading = new AsyncLocalStorage();
const loadFormat = kdbx.KdbxFormat.prototype.load;
const decryptData = kdbx.KdbxFormat.prototype.decryptData;
const decryptLegacyBlocks = kdbx.HashedBlockTransform.decrypt;
function expandForLoad(context, data) {
  if (context.format.kdbx.header.compression !== 1) return data;
  const result = boundedGunzip(data);
  context.compression = 1;
  context.format.kdbx.header.compression = 0;
  return result;
}
kdbx.KdbxFormat.prototype.load = function (data) {
  const context = { format: this, compression: null };
  return loading.run(context, async () => {
    try {
      return await loadFormat.call(this, data);
    } finally {
      if (context.compression !== null)
        this.kdbx.header.compression = context.compression;
    }
  });
};
kdbx.KdbxFormat.prototype.decryptData = async function (...args) {
  const data = await decryptData.apply(this, args);
  const context = loading.getStore();
  return context?.format === this && this.kdbx.header.versionMajor === 4
    ? expandForLoad(context, data)
    : data;
};
kdbx.HashedBlockTransform.decrypt = async function (...args) {
  const data = await decryptLegacyBlocks(...args);
  const context = loading.getStore();
  return context?.format.kdbx.header.versionMajor === 3
    ? expandForLoad(context, data)
    : data;
};
// Bound legacy AES-KDF before the library constructs its round promises.
const aesKdf = kdbx.KeyEncryptorAes.encrypt;
kdbx.KeyEncryptorAes.encrypt = (credentials, key, rounds) => {
  if (!Number.isSafeInteger(rounds) || rounds < 1 || rounds > 10000000)
    return Promise.reject(
      new Error(
        "Unsupported or excessive AES-KDF rounds (maximum 10,000,000).",
      ),
    );
  return aesKdf(credentials, key, rounds);
};
// kdbxweb validates nonempty blocks but skips the terminating block HMAC.
// Verify the terminator and exact end of stream before its normal payload checks.
const decryptBlocks = kdbx.HmacBlockTransform.decrypt;
kdbx.HmacBlockTransform.decrypt = async (data, key) => {
  const bytes = Buffer.from(data);
  let offset = 0,
    index = 0;
  for (;;) {
    if (offset + 36 > bytes.length)
      throw new Error("Truncated authenticated vault stream.");
    const signature = bytes.subarray(offset, offset + 32),
      length = bytes.readUInt32LE(offset + 32);
    offset += 36;
    if (length === 0) {
      if (offset !== bytes.length)
        throw new Error("Unexpected trailing data in vault.");
      const blockKey = await kdbx.HmacBlockTransform.getHmacKey(
        key,
        new kdbx.Int64(index),
      );
      const terminal = Buffer.alloc(12);
      terminal.writeBigUInt64LE(BigInt(index));
      const expected = Buffer.from(
        await kdbx.CryptoEngine.hmacSha256(blockKey, terminal.buffer),
      );
      if (!timingSafeEqual(signature, expected))
        throw new Error("Corrupt vault terminator.");
      break;
    }
    if (length > 64 * 1024 * 1024 || offset + length > bytes.length)
      throw new Error("Invalid vault block size.");
    offset += length;
    index++;
  }
  return decryptBlocks(data, key);
};
const { argon2id, argon2d } = require("hash-wasm");
const { randomInt } = require("node:crypto");
const { ZxcvbnFactory } = require("@zxcvbn-ts/core");
const common = require("@zxcvbn-ts/language-common");
const en = require("@zxcvbn-ts/language-en");
const estimator = new ZxcvbnFactory({
  dictionary: { ...common.dictionary, ...en.dictionary },
  graphs: common.adjacencyGraphs,
  translations: en.translations,
});
const passphraseWords = [
  ...new Set(
    en.dictionary["commonWords-en"].filter((w) => /^[a-z]{4,9}$/.test(w)),
  ),
];
kdbx.CryptoEngine.setArgon2Impl(
  async (
    password,
    salt,
    memory,
    iterations,
    length,
    parallelism,
    type,
    version,
  ) => {
    if (
      memory > 262144 ||
      iterations > 20 ||
      parallelism > 8 ||
      memory < 8 ||
      iterations < 1 ||
      length !== 32 ||
      version !== 0x13 ||
      ![0, 2].includes(type)
    ) {
      throw new Error(
        "Unsupported or excessive Argon2 parameters. Open this vault in KeePassXC and use Argon2id with at most 256 MiB, 20 iterations and 8 lanes.",
      );
    }
    const fn = type === 2 ? argon2id : argon2d;
    const out = await fn({
      password: new Uint8Array(password),
      salt: new Uint8Array(salt),
      memorySize: memory,
      iterations,
      parallelism,
      hashLength: length,
      outputType: "binary",
    });
    return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
  },
);
function strength(value) {
  return value ? estimator.check(value.slice(0, 256)).score : 0;
}
function generate(options = {}) {
  if (options.mode === "passphrase") {
    // 1,000+ words from the bundled English dictionary; no remote word list.
    const unique = passphraseWords;
    if (unique.length < 1024)
      throw new Error("Passphrase dictionary unavailable.");
    const count = Math.max(4, Math.min(10, Number(options.words) || 6));
    let result = Array.from(
      { length: count },
      () => unique[randomInt(unique.length)],
    ).join("-");
    if (options.numbers) result += `-${randomInt(100, 1000)}`;
    const bits = count * Math.log2(unique.length);
    return { value: result, strength: bits >= 60 ? 4 : 3 };
  }
  let lower = "abcdefghijklmnopqrstuvwxyz",
    upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    digits = "0123456789",
    symbols = "!@#$%^&*()-_=+[]{}:,.?";
  if (options.avoidAmbiguous !== false) {
    lower = lower.replace(/[lo]/g, "");
    upper = upper.replace(/[IO]/g, "");
    digits = digits.replace(/[01]/g, "");
  }
  const sets = [
    lower,
    upper,
    ...(options.numbers !== false ? [digits] : []),
    ...(options.symbols ? [symbols] : []),
  ];
  const alphabet = sets.join("");
  const length = Math.max(12, Math.min(128, Number(options.length) || 24));
  // Rejection sampling ensures uniform choices conditioned on the selected character classes.
  for (let i = 0; i < 10000; i++) {
    const value = Array.from(
      { length },
      () => alphabet[randomInt(alphabet.length)],
    ).join("");
    if (sets.every((set) => [...value].some((c) => set.includes(c))))
      return { value, strength: 4 };
  }
  throw new Error("Could not generate a password. Try different options.");
}
module.exports = { kdbx, strength, generate, boundedGunzip };
