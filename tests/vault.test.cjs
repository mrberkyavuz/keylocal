"use strict";
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { VaultService, atomicWrite, hash } = require("../electron/vault.cjs");
const { generate, strength, kdbx } = require("../electron/crypto.cjs");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "keylocal-tests-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));
const secret = "indigo-cloud-ferry-window-827";
let count = 0;
async function fixture() {
  const dir = path.join(root, String(++count));
  fs.mkdirSync(dir);
  const v = new VaultService(path.join(dir, "prefs"));
  await v.create(path.join(dir, "vault.kdbx"), "Test vault", secret);
  return v;
}
function draft(title = "Test account", password = "Correct-horse-river-839!") {
  return {
    title,
    type: "login",
    username: "person@example.test",
    password,
    urls: ["https://example.test"],
    notes: "a private note",
    tags: ["important"],
    group: "Personal",
    favorite: false,
    fields: [
      { key: "Token", value: "sensitive-token", secret: true },
      { key: "Label", value: "ordinary", secret: false },
    ],
  };
}
test("KDBX 4.1 + Argon2id create, lock, wrong-password rejection and reopen", async () => {
  const v = await fixture();
  try {
    const file = v.path,
      bytes = fs.readFileSync(file);
    assert.equal(bytes.readUInt32LE(8), 0x00040001);
    assert.equal(v.db.header.kdfParameters.get("M").value, 67108864);
    v.lock();
    await assert.rejects(() => v.unlock("wrong-password"));
    assert.equal(v.db, null);
    await v.unlock(secret);
    assert.equal(v.name, "Test vault");
  } finally {
    v.lock();
  }
});
test("all metadata and secrets remain encrypted on disk", async () => {
  const v = await fixture();
  try {
    await v.saveItem(draft("UNIQUE-PRIVATE-TITLE"));
    const data = fs.readFileSync(v.path);
    for (const s of [
      "UNIQUE-PRIVATE-TITLE",
      "sensitive-token",
      "person@example.test",
      "a private note",
    ])
      assert.equal(data.includes(Buffer.from(s)), false);
    const settings = fs.readFileSync(
      path.join(v.dataDir, "settings.json"),
      "utf8",
    );
    assert.equal(settings.includes(secret), false);
  } finally {
    v.lock();
  }
});
test("list redacts protected fields; reveal is explicit and blocked while locked", async () => {
  const v = await fixture();
  try {
    const i = await v.saveItem(draft());
    const row = v.list()[0];
    assert.equal(row.hasPassword, true);
    assert.equal("password" in row, false);
    assert.equal(row.fields.find((f) => f.key === "Token").value, "");
    assert.equal(v.reveal(i.id, "Token"), "sensitive-token");
    v.lock();
    assert.throws(() => v.list(), /locked/);
    assert.throws(() => v.reveal(i.id, "Password"), /locked/);
  } finally {
    v.lock();
  }
});
test("editing preserves omitted password and untouched secret fields across reopening", async () => {
  const v = await fixture();
  try {
    const i = await v.saveItem(draft());
    const d = draft("Updated title");
    d.id = i.id;
    delete d.password;
    d.fields[0].value = "";
    await v.saveItem(d);
    v.lock();
    await v.unlock(secret);
    assert.equal(v.reveal(i.id, "Password"), "Correct-horse-river-839!");
    assert.equal(v.reveal(i.id, "Token"), "sensitive-token");
    assert.equal(v.list()[0].historyCount, 1);
  } finally {
    v.lock();
  }
});
test("favorite, archive, trash, restore and permanent deletion persist", async () => {
  const v = await fixture();
  try {
    const i = await v.saveItem(draft());
    await v.action(i.id, "favorite");
    assert.equal(v.list()[0].favorite, true);
    await v.action(i.id, "archive");
    assert.equal(v.list()[0].archived, true);
    await v.action(i.id, "archive");
    await v.action(i.id, "trash");
    assert.equal(v.list()[0].deleted, true);
    await v.action(i.id, "restore");
    assert.equal(v.list()[0].deleted, false);
    await v.action(i.id, "trash");
    await v.action(i.id, "delete");
    assert.equal(v.list().length, 0);
  } finally {
    v.lock();
  }
});
test("external modification stops writes and preserves external bytes", async () => {
  const v = await fixture();
  try {
    const file = v.path;
    const external = Buffer.from("external replacement");
    fs.writeFileSync(file, external);
    await assert.rejects(() => v.saveItem(draft()), /changed outside/);
    assert.deepEqual(fs.readFileSync(file), external);
  } finally {
    v.lock();
  }
});
test("existing vault is never overwritten by create", async () => {
  const v = await fixture();
  const file = v.path;
  const before = hash(fs.readFileSync(file));
  await assert.rejects(() => v.create(file, "Oops", secret), /already exists/);
  assert.equal(hash(fs.readFileSync(file)), before);
  v.lock();
});
test("a second service cannot unlock a vault already open by another", async () => {
  const v = await fixture();
  const second = new VaultService(path.join(root, `second-${count}`));
  try {
    second.select(v.path);
    await assert.rejects(() => second.unlock(secret), /already open/);
  } finally {
    second.lock();
    v.lock();
  }
});
test("local backup is a valid prior encrypted state", async () => {
  const v = await fixture();
  try {
    await v.saveItem(draft("First"));
    await v.saveItem(draft("Second"));
    const backups = v.backups();
    assert.equal(backups.length, 2);
    const restore = new VaultService(path.join(root, `restore-${count}`));
    restore.select(backups[0].path);
    await restore.unlock(secret);
    assert.equal(restore.list().length, 1);
    restore.lock();
  } finally {
    v.lock();
  }
});
test("failed external backup does not discard successful local save", async () => {
  const v = await fixture();
  try {
    v.applySettings({ backupDirectory: path.join(root, "missing-external") });
    await v.saveItem(draft());
    assert.equal(v.list().length, 1);
    assert.match(v.backupWarning, /External backup failed/);
    v.lock();
    await v.unlock(secret);
    assert.equal(v.list().length, 1);
  } finally {
    v.lock();
  }
});
test("changing master password requires old password and old backups retain it", async () => {
  const v = await fixture();
  try {
    await v.saveItem(draft());
    await assert.rejects(() =>
      v.changePassword("incorrect", "new-magnolia-river-ferry-528"),
    );
    await v.changePassword(secret, "new-magnolia-river-ferry-528");
    const file = v.path;
    const backup = v.backups()[0];
    v.lock();
    await assert.rejects(() => v.unlock(secret));
    await v.unlock("new-magnolia-river-ferry-528");
    assert.equal(v.list().length, 1);
    v.lock();
    v.select(backup.path);
    await v.unlock(secret);
    assert.equal(v.list().length, 1);
    assert.notEqual(file, v.path);
  } finally {
    v.lock();
  }
});
test("CSV preview does not import until confirmed; duplicates skipped", async () => {
  const v = await fixture();
  try {
    const csv = path.join(root, `import-${count}.csv`);
    fs.writeFileSync(
      csv,
      "title,username,password,url,notes\nExample,me,secretvalue,https://example.test,hello\nExample,me,secretvalue,https://example.test,hello\n",
    );
    const p = await v.previewImport(csv);
    assert.equal(p.count, 1);
    assert.equal(p.duplicates, 1);
    assert.equal(v.list().length, 0);
    const r = await v.confirmImport(p.token);
    assert.equal(r.imported, 1);
    assert.equal(v.list().length, 1);
    assert.equal(v.reveal(v.list()[0].id, "Password"), "secretvalue");
    await assert.rejects(() => v.confirmImport(p.token), /expired/);
  } finally {
    v.lock();
  }
});
test("locking invalidates import token and pending saves cannot unlock the app", async () => {
  const v = await fixture();
  try {
    const csv = path.join(root, `lock-import-${count}.csv`);
    fs.writeFileSync(csv, "title,password\nHello,password\n");
    const p = await v.previewImport(csv);
    v.lock();
    await assert.rejects(() => v.confirmImport(p.token), /expired/);
    await v.unlock(secret);
    const pending = v.saveItem(draft());
    await new Promise((r) => setTimeout(r, 0));
    v.lock();
    await assert.rejects(() => pending, /locked/);
    assert.equal(v.db, null);
    await v.unlock(secret);
    assert.equal(v.list().length, 0);
  } finally {
    v.lock();
  }
});
test("read/write corrupt ciphertext is rejected without changing the file", async () => {
  const v = await fixture();
  try {
    const file = v.path;
    v.lock();
    const data = fs.readFileSync(file);
    data[data.length - 30] ^= 0xff;
    fs.writeFileSync(file, data);
    const before = hash(data);
    await assert.rejects(() => v.unlock(secret));
    assert.equal(hash(fs.readFileSync(file)), before);
  } finally {
    v.lock();
  }
});
test("weak and reused passwords are identified locally", async () => {
  const v = await fixture();
  try {
    await v.saveItem(draft("One", "password"));
    await v.saveItem(draft("Two", "password"));
    const rows = v.list();
    assert.ok(rows.every((r) => r.reused));
    assert.ok(rows.every((r) => r.strength <= 1));
    assert.equal(strength("password"), 0);
  } finally {
    v.lock();
  }
});
test("generator respects bounds, character classes and uniqueness", () => {
  const values = new Set();
  for (let i = 0; i < 100; i++) {
    const r = generate({
      mode: "random",
      length: 32,
      numbers: true,
      symbols: true,
      avoidAmbiguous: true,
    });
    assert.equal(r.value.length, 32);
    assert.match(r.value, /[a-z]/);
    assert.match(r.value, /[A-Z]/);
    assert.match(r.value, /[2-9]/);
    assert.match(r.value, /[!@#$%^&*()\-_=+\[\]{}:,.?]/);
    assert.doesNotMatch(r.value, /[loIO01]/);
    values.add(r.value);
  }
  assert.equal(values.size, 100);
  const p = generate({ mode: "passphrase", words: 6, numbers: false });
  assert.equal(p.value.split("-").length, 6);
});
test("settings validation blocks invalid ranges", async () => {
  const v = await fixture();
  try {
    assert.throws(() => v.applySettings({ autoLockMinutes: 0 }));
    assert.throws(() => v.applySettings({ clipboardSeconds: 999 }));
    assert.throws(() => v.applySettings({ theme: "evil" }));
  } finally {
    v.lock();
  }
});
test("atomic write never replaces an existing file in exclusive mode", () => {
  const file = path.join(root, "exclusive-test");
  atomicWrite(file, Buffer.from("original"), true);
  assert.throws(() => atomicWrite(file, Buffer.from("replacement"), true));
  assert.equal(fs.readFileSync(file, "utf8"), "original");
});
test("1PUX preview preserves custom secrets, groups, tags and favorite; reports omitted files", async () => {
  const v = await fixture();
  try {
    const { zipSync, strToU8 } = require("fflate");
    const file = path.join(root, `archive-fixture-${count}.1pux`);
    const data = {
      accounts: [
        {
          vaults: [
            {
              attrs: { name: "Migrated" },
              items: [
                {
                  categoryUuid: "001",
                  favIndex: 1,
                  state: "active",
                  overview: {
                    title: "Migrated login",
                    url: "https://example.test",
                    tags: ["moved"],
                  },
                  details: {
                    loginFields: [
                      {
                        designation: "username",
                        value: "migration@example.test",
                      },
                      { designation: "password", value: "migrated-secret" },
                    ],
                    notesPlain: "Imported note",
                    sections: [
                      {
                        fields: [
                          { title: "PIN", value: { concealed: "4928" } },
                        ],
                      },
                    ],
                    passwordHistory: [{ value: "old-secret", time: 1 }],
                  },
                },
              ],
            },
          ],
        },
      ],
    };
    fs.writeFileSync(
      file,
      zipSync({
        "export.data": strToU8(JSON.stringify(data)),
        "files/unused.txt": strToU8("attachment"),
      }),
    );
    const preview = await v.previewImport(file);
    assert.equal(preview.count, 1);
    assert.equal(v.list().length, 0);
    assert.ok(preview.warnings.some((w) => w.includes("attached files")));
    await v.confirmImport(preview.token);
    const row = v.list()[0];
    assert.equal(row.group, "Migrated");
    assert.equal(row.favorite, true);
    assert.deepEqual(row.tags, ["moved"]);
    assert.equal(v.reveal(row.id, "Password"), "migrated-secret");
    assert.equal(v.reveal(row.id, "PIN"), "4928");
  } finally {
    v.lock();
  }
});
test("terminal block tampering and trailing data are rejected", async () => {
  const v = await fixture();
  try {
    const file = v.path;
    v.lock();
    const original = fs.readFileSync(file);
    fs.writeFileSync(file, Buffer.concat([original, Buffer.from("trailing")]));
    await assert.rejects(() => v.unlock(secret), /trailing/);
    const modified = Buffer.from(original);
    modified[modified.length - 36] ^= 0xff;
    fs.writeFileSync(file, modified);
    await assert.rejects(() => v.unlock(secret), /terminator/);
  } finally {
    v.lock();
  }
});
test("failed atomic replacement leaves the original file intact", () => {
  const file = path.join(root, "replace-failure");
  atomicWrite(file, Buffer.from("valid"), true);
  const rename = fs.renameSync;
  fs.renameSync = () => {
    const e = new Error("simulated full disk");
    e.code = "ENOSPC";
    throw e;
  };
  try {
    assert.throws(
      () => atomicWrite(file, Buffer.from("new")),
      /simulated full disk/,
    );
    assert.equal(fs.readFileSync(file, "utf8"), "valid");
  } finally {
    fs.renameSync = rename;
  }
});
test("external backup status belongs to the selected vault and destination", async () => {
  const v = await fixture();
  try {
    const external = path.join(root, `external-${count}`);
    fs.mkdirSync(external);
    v.applySettings({ backupDirectory: external });
    await v.backupNow();
    assert.ok(v.status().lastBackup);
    const first = v.path;
    await v.create(
      path.join(path.dirname(first), "second.kdbx"),
      "Second vault",
      secret,
    );
    assert.equal(v.status().lastBackup, null);
    v.select(first);
    await v.unlock(secret);
    assert.ok(v.status().lastBackup);
    const other = path.join(root, `external-other-${count}`);
    fs.mkdirSync(other);
    v.applySettings({ backupDirectory: other });
    assert.equal(v.status().lastBackup, null);
  } finally {
    v.lock();
  }
});

test("biometric password-equivalent key requires password verification and opens existing KDBX", async () => {
  const v = await fixture();
  try {
    await assert.rejects(() => v.biometricKey("wrong-password"));
    const key = await v.biometricKey(secret);
    assert.equal(key.length, 32);
    v.lock();
    await v.unlockWithBiometricKey(key, v.generation);
    key.fill(0);
    assert.equal(v.name, "Test vault");
    await v.saveItem(draft("After biometric unlock"));
    v.lock();
    await v.unlock(secret);
    assert.equal(v.list()[0].title, "After biometric unlock");
  } finally {
    v.lock();
  }
});
test("stale biometric prompt cannot unlock a session after a newer lock event", async () => {
  const v = await fixture();
  try {
    const key = await v.biometricKey(secret);
    v.lock();
    const generation = v.generation;
    v.lock();
    await assert.rejects(
      () => v.unlockWithBiometricKey(key, generation),
      /changed/,
    );
    key.fill(0);
    assert.equal(v.db, null);
  } finally {
    v.lock();
  }
});

test("remembered vaults survive restart, migrate legacy settings and validate selection", async () => {
  const dir = path.join(root, String(++count));
  fs.mkdirSync(dir);
  const prefs = path.join(dir, "prefs"),
    file = path.join(dir, "Remembered vault.kdbx");
  fs.mkdirSync(prefs);
  fs.writeFileSync(file, "synthetic file - never decrypted");
  fs.writeFileSync(
    path.join(prefs, "settings.json"),
    JSON.stringify({ lastVault: file, settings: { autoLockMinutes: 999 } }),
  );
  let v = new VaultService(prefs);
  assert.equal(v.status().vaultPath, file);
  assert.equal(v.status().locked, true);
  assert.equal(v.status().recentVaults[0].name, "Remembered vault");
  v.selectRecent(file);
  v.lock();
  v = new VaultService(prefs);
  assert.equal(v.status().vaultPath, file);
  assert.equal(v.status().recentVaults.length, 1);
  assert.throws(
    () => v.selectRecent(path.join(dir, "unregistered.kdbx")),
    /remembered/,
  );
  fs.unlinkSync(file);
  assert.equal(v.status().recentVaults[0].available, false);
  assert.throws(() => v.selectRecent(file), /unavailable/);
  assert.equal(new VaultService(prefs).status().recentVaults.length, 1);
});

test("queued password unlock and writes cannot survive a later lock", async () => {
  const v = await fixture();
  let release;
  v.tail = new Promise((resolve) => {
    release = resolve;
  });
  const write = v.saveItem(draft("Must never appear"));
  v.lock();
  release();
  await assert.rejects(() => write, /session changed/);
  await v.unlock(secret);
  assert.equal(v.list().length, 0);
  v.lock();
  v.tail = new Promise((resolve) => {
    release = resolve;
  });
  const unlock = v.unlock(secret);
  v.lock();
  release();
  await assert.rejects(() => unlock, /session changed/);
  assert.equal(v.db, null);
});

test("off-device recovery needs the master password and no original device profile", async () => {
  const v = await fixture();
  let recovered;
  try {
    await v.saveItem(draft("Recovery specimen"));
    const copy = await v.backupNow();
    const destination = path.join(root, `other-device-${count}`);
    fs.mkdirSync(destination);
    const file = path.join(destination, "recovery.kdbx");
    fs.copyFileSync(copy.path, file);
    recovered = new VaultService(path.join(destination, "fresh-profile"));
    recovered.select(file);
    for (const wrong of ["", "wrong-password"])
      await assert.rejects(() => recovered.unlock(wrong), /Incorrect/);
    assert.equal(recovered.db, null);
    await recovered.unlock(secret);
    assert.equal(
      recovered.reveal(recovered.list()[0].id, "Password"),
      "Correct-horse-river-839!",
    );
    const bytes = fs.readFileSync(file);
    assert.equal(
      bytes.includes(Buffer.from("Correct-horse-river-839!")),
      false,
    );
    assert.equal(bytes.includes(Buffer.from("Recovery specimen")), false);
  } finally {
    recovered?.lock();
    v.lock();
  }
});

test("malicious KDBX3 AES rounds are rejected before expensive derivation", async () => {
  const db = kdbx.Kdbx.create(
    new kdbx.Credentials(kdbx.ProtectedValue.fromString(secret)),
    "Legacy fixture",
  );
  db.setVersion(3);
  const bytes = Buffer.from(await db.save());
  let offset = 12,
    found = false;
  while (offset + 3 <= bytes.length) {
    const id = bytes[offset],
      size = bytes.readUInt16LE(offset + 1);
    offset += 3;
    if (id === 6) {
      bytes.writeBigUInt64LE(10000001n, offset);
      found = true;
      break;
    }
    if (id === 0) break;
    offset += size;
  }
  assert.equal(found, true);
  await assert.rejects(
    () =>
      kdbx.Kdbx.load(
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
        new kdbx.Credentials(kdbx.ProtectedValue.fromString(secret)),
      ),
    /excessive AES-KDF/,
  );
});

test("compressed vault expansion is bounded before XML allocation", () => {
  const { boundedGunzip } = require("../electron/crypto.cjs");
  const { gzipSync } = require("node:zlib");
  const compressed = gzipSync(Buffer.alloc(64 * 1024 * 1024 + 1, 65));
  assert.throws(() => boundedGunzip(compressed), /larger than|too large|size/i);
});

test("bounded decompression preserves legacy and current KDBX compression on resave", async () => {
  for (const version of [3, 4]) {
    const db = kdbx.Kdbx.create(
      new kdbx.Credentials(kdbx.ProtectedValue.fromString(secret)),
      "Compressed fixture",
    );
    db.setVersion(version);
    const bytes = await db.save();
    const restored = await kdbx.Kdbx.load(
      bytes,
      new kdbx.Credentials(kdbx.ProtectedValue.fromString(secret)),
    );
    assert.equal(restored.header.compression, 1);
    const reopened = await kdbx.Kdbx.load(
      await restored.save(),
      new kdbx.Credentials(kdbx.ProtectedValue.fromString(secret)),
    );
    assert.equal(reopened.meta.name, "Compressed fixture");
    assert.equal(reopened.header.compression, 1);
  }
});

test("length alone cannot approve a predictable new master password", async () => {
  const v = await fixture();
  try {
    await assert.rejects(
      () => v.changePassword(secret, "aaaaaaaaaaaa"),
      /less predictable/,
    );
    const file = path.join(root, `weak-master-${count}.kdbx`);
    await assert.rejects(
      () => v.create(file, "Weak fixture", "aaaaaaaaaaaa"),
      /less predictable/,
    );
    assert.equal(fs.existsSync(file), false);
    assert.equal(v.name, "Test vault");
  } finally {
    v.lock();
  }
});
