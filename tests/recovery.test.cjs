"use strict";
const { test, after } = require("node:test");
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { VaultService, hash } = require("../electron/vault.cjs");
const { RecoverySession } = require("../electron/recovery.cjs");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "keylocal-recovery-"));
const password = "indigo-cloud-ferry-window-827";
let counter = 0;
after(() => fs.rmSync(root, { recursive: true, force: true }));
async function fixture() {
  const dir = path.join(root, String(++counter));
  fs.mkdirSync(dir);
  const vault = new VaultService(path.join(dir, "profile"));
  await vault.create(path.join(dir, "source.kdbx"), "Recovery test", password);
  const recovery = new RecoverySession(() => vault.generation);
  return { vault, recovery, dir };
}
test("a fresh locked profile recovers a verified encrypted snapshot without original device credentials", async () => {
  const f = await fixture();
  f.vault.lock();
  const chosen = f.recovery.choose(f.vault.path);
  assert.deepEqual(Object.keys(chosen).sort(), ["name", "size", "token"]);
  assert.equal(
    (await f.recovery.verify(chosen.token, password)).verified,
    true,
  );
  const target = path.join(f.dir, "recovered.kdbx");
  f.recovery.restore(chosen.token, target);
  const fresh = new VaultService(path.join(f.dir, "new-device"));
  fresh.select(target);
  try {
    await assert.rejects(() => fresh.unlock("wrong"));
    await fresh.unlock(password);
    assert.equal(fresh.name, "Recovery test");
  } finally {
    fresh.lock();
  }
  assert.equal(f.recovery.pending, null);
});
test("wrong password and unverified restore leave the current vault unchanged and unlocked", async () => {
  const f = await fixture();
  try {
    const before = hash(fs.readFileSync(f.vault.path)),
      chosen = f.recovery.choose(f.vault.path);
    await assert.rejects(
      () => f.recovery.verify(chosen.token, "wrong"),
      /Incorrect backup password/,
    );
    assert.throws(
      () => f.recovery.restore(chosen.token, path.join(f.dir, "blocked.kdbx")),
      /Verify/,
    );
    assert.equal(fs.existsSync(path.join(f.dir, "blocked.kdbx")), false);
    assert.equal(hash(fs.readFileSync(f.vault.path)), before);
    assert.ok(f.vault.db);
  } finally {
    f.vault.lock();
  }
});
test("restoring never overwrites an existing file and uses verified bytes even if source changes", async () => {
  const f = await fixture();
  f.vault.lock();
  const original = fs.readFileSync(f.vault.path),
    chosen = f.recovery.choose(f.vault.path);
  await f.recovery.verify(chosen.token, password);
  assert.throws(() => f.recovery.restore(chosen.token, f.vault.path), /EEXIST/);
  assert.deepEqual(fs.readFileSync(f.vault.path), original);
  fs.writeFileSync(f.vault.path, "source replaced after verification");
  const target = path.join(f.dir, "snapshot.kdbx");
  f.recovery.restore(chosen.token, target);
  assert.deepEqual(fs.readFileSync(target), original);
});
test("selection expiry, cancellation and vault generation changes revoke verified restore", async () => {
  const f = await fixture();
  f.vault.lock();
  let now = Date.now();
  const session = new RecoverySession(
    () => f.vault.generation,
    () => now,
  );
  let selected = session.choose(f.vault.path);
  await session.verify(selected.token, password);
  now += 5 * 60000;
  assert.throws(
    () => session.restore(selected.token, path.join(f.dir, "expired.kdbx")),
    /expired/,
  );
  selected = session.choose(f.vault.path);
  await session.verify(selected.token, password);
  session.clear();
  assert.throws(
    () => session.restore(selected.token, path.join(f.dir, "cancelled.kdbx")),
    /expired/,
  );
  selected = session.choose(f.vault.path);
  await session.verify(selected.token, password);
  f.vault.lock();
  assert.throws(
    () => session.restore(selected.token, path.join(f.dir, "stale.kdbx")),
    /expired/,
  );
});
test("locking during password verification cannot authorize a later restore", async () => {
  const f = await fixture();
  f.vault.lock();
  const selected = f.recovery.choose(f.vault.path);
  const work = f.recovery.verify(selected.token, password);
  f.vault.lock();
  await assert.rejects(() => work, /expired/);
  assert.throws(
    () => f.recovery.restore(selected.token, path.join(f.dir, "race.kdbx")),
    /expired/,
  );
});
test("corrupt files cannot become verified recovery copies", async () => {
  const f = await fixture();
  f.vault.lock();
  const bad = path.join(f.dir, "bad.kdbx");
  fs.writeFileSync(bad, "not a vault");
  const chosen = f.recovery.choose(bad);
  await assert.rejects(() => f.recovery.verify(chosen.token, password));
  assert.throws(
    () => f.recovery.restore(chosen.token, path.join(f.dir, "bad-copy.kdbx")),
    /Verify/,
  );
});
test("backup health distinguishes absent, reachable, disconnected and reconnected destinations", async () => {
  const f = await fixture();
  try {
    assert.equal(f.vault.backupHealth().destination, "not-configured");
    const external = path.join(f.dir, "external");
    fs.mkdirSync(external);
    f.vault.applySettings({ backupDirectory: external });
    assert.equal(f.vault.backupHealth().destination, "available");
    assert.equal(f.vault.backupHealth().externalCopies, 0);
    await f.vault.backupNow();
    assert.equal(f.vault.backupHealth().externalCopies, 1);
    fs.renameSync(external, external + "-offline");
    assert.equal(f.vault.backupHealth().destination, "unavailable");
    fs.renameSync(external + "-offline", external);
    assert.equal(f.vault.backupHealth().externalCopies, 1);
  } finally {
    f.vault.lock();
  }
});
