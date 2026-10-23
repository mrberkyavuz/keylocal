"use strict";
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomBytes, createHash } = require("node:crypto");
const { WindowsHelloStore } = require("../electron/windows-hello.cjs");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "keylocal-hello-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));
let counter = 0;
function fixture() {
  const keys = new Map();
  let cancel = false;
  const native = {
    available: async () => true,
    enroll: async () => {
      const id = randomBytes(32),
        key = randomBytes(32);
      keys.set(id.toString("hex"), key);
      return { credentialId: id, key: Buffer.from(key) };
    },
    derive: async (id) => {
      if (cancel) throw new Error("Cancelled");
      const key = keys.get(id.toString("hex"));
      if (!key) throw new Error("Revoked");
      return Buffer.from(key);
    },
    remove: async (id) => keys.delete(id.toString("hex")),
  };
  const store = new WindowsHelloStore(
    path.join(root, String(++counter)),
    native,
  );
  return {
    store,
    keys,
    native,
    cancel: () => {
      cancel = true;
    },
  };
}
test("Hello wrapper contains no plaintext unlock key and needs a matching native PRF", async () => {
  const f = fixture(),
    secret = randomBytes(32),
    file = "C:\\vault.kdbx";
  await f.store.set(file, secret);
  const bytes = fs.readFileSync(f.store.location(file));
  assert.equal(bytes.includes(secret), false);
  assert.equal(bytes.includes(secret.toString("base64")), false);
  assert.equal((await f.store.status(file)).enabled, true);
  assert.deepEqual(await f.store.get(file), secret);
  f.cancel();
  await assert.rejects(() => f.store.get(file), /Cancelled/);
  assert.equal(fs.existsSync(f.store.location(file)), true);
});
test("AES-GCM rejects changes to ciphertext, credential metadata, tag and vault path", async () => {
  const f = fixture(),
    file = "C:\\vault.kdbx";
  await f.store.set(file, randomBytes(32));
  const original = fs.readFileSync(f.store.location(file), "utf8");
  for (const field of ["ciphertext", "tag", "salt"]) {
    const b = JSON.parse(original);
    const data = Buffer.from(b[field], "base64");
    data[0] ^= 1;
    b[field] = data.toString("base64");
    fs.writeFileSync(f.store.location(file), JSON.stringify(b));
    await assert.rejects(() => f.store.get(file));
  }
  fs.writeFileSync(f.store.location(file), original);
  const other = "C:\\other.kdbx";
  fs.copyFileSync(f.store.location(file), f.store.location(other));
  await assert.rejects(() => f.store.get(other), /Invalid/);
});
test("cancelled confirmation leaves neither a usable wrapper nor an orphan credential", async () => {
  const f = fixture(),
    file = "C:\\vault.kdbx";
  f.cancel();
  await assert.rejects(() => f.store.set(file, randomBytes(32)), /Cancelled/);
  assert.equal(fs.existsSync(f.store.location(file)), false);
  assert.equal(f.keys.size, 0);
});
test("disabling Hello revokes the local wrapper and native credential", async () => {
  const f = fixture(),
    file = "C:\\vault.kdbx";
  await f.store.set(file, randomBytes(32));
  await f.store.remove(file);
  assert.equal(f.keys.size, 0);
  assert.equal((await f.store.status(file)).enabled, false);
  await assert.rejects(() => f.store.get(file), /not enabled/);
});
test("corrupt Hello settings and a failing provider preserve master-password access", async () => {
  const f = fixture(),
    file = "C:\\vault.kdbx";
  await f.store.set(file, randomBytes(32));
  fs.writeFileSync(f.store.location(file), "corrupt");
  assert.equal((await f.store.status(file)).available, false);
  f.native.available = async () => {
    throw new Error("Provider unavailable");
  };
  assert.equal((await f.store.status(file)).enabled, false);
});
test(
  "Windows native availability, credential pointer marshalling and user-verification checks",
  { skip: process.platform !== "win32" },
  async () => {
    const { WindowsWebAuthn, RP } = require("../electron/windows-webauthn.cjs");
    const n = new WindowsWebAuthn(() => Buffer.alloc(8));
    assert.equal(typeof (await n.available()), "boolean");
    assert.ok(n.version >= 1);
    assert.equal(n.k.sizeof(n.Make), 160);
    assert.equal(n.k.sizeof(n.Get), 120);
    const id = randomBytes(32),
      nativeId = n.k.alloc("uint8_t", 32),
      nativeType = n.k.alloc("char16_t", 11),
      cred = n.k.alloc(n.Credential, 1);
    try {
      n.k.encode(nativeId, n.k.array("uint8_t", 32), id);
      n.k.encode(
        nativeType,
        n.k.array("uint8_t", 22),
        Buffer.from("public-key\0", "utf16le"),
      );
      n.k.encode(cred, n.Credential, {
        version: 1,
        size: 32,
        id: nativeId,
        type: nativeType,
      });
      const decoded = n.k.decode(cred, n.Credential);
      assert.equal(decoded.type, "public-key");
      assert.deepEqual(n.bytes(decoded.id, decoded.size), id);
      const auth = Buffer.concat([
        createHash("sha256").update(RP).digest(),
        Buffer.from([5, 0, 0, 0, 0]),
      ]);
      n.verifyAuth(auth, auth.length);
      auth[32] = 1;
      assert.throws(() => n.verifyAuth(auth, auth.length), /verify/);
    } finally {
      n.k.free(nativeId);
      n.k.free(nativeType);
      n.k.free(cred);
    }
  },
);
