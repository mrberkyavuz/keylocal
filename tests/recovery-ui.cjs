"use strict";
const { _electron: electron } = require("playwright");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { VaultService, hash } = require("../electron/vault.cjs");
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "keylocal-recovery-ui-"));
  const password = "aster-river-forest-cloud-839";
  const source = path.join(temp, "Travel-backup.kdbx"),
    target = path.join(temp, "Recovered.kdbx");
  const fixture = new VaultService(path.join(temp, "fixture"));
  await fixture.create(source, "Recovered example", password);
  fixture.lock();
  const before = hash(fs.readFileSync(source));
  const app = await electron.launch({
    executablePath: require("electron"),
    args: [path.resolve(__dirname, "..")],
    env: {
      ...process.env,
      KEYLOCAL_TEST_DATA_DIR: path.join(temp, "fresh-profile"),
    },
  });
  try {
    await app.evaluate(
      ({ dialog, powerMonitor, BrowserWindow }, input) => {
        powerMonitor.getSystemIdleTime = () => 0;
        BrowserWindow.getAllWindows()[0].setSize(1000, 800);
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [input.source],
        });
        dialog.showSaveDialog = async () => ({
          canceled: false,
          filePath: input.target,
        });
      },
      { source, target },
    );
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page
      .getByRole("button", { name: "Recover from a backup", exact: true })
      .click();
    let recovery = page.getByRole("dialog", {
      name: "Recover from a backup",
      exact: true,
    });
    await recovery
      .getByRole("button", { name: "Choose backup file", exact: true })
      .click();
    await recovery
      .getByLabel("Backup master password", { exact: true })
      .fill("wrong-password");
    await recovery
      .getByRole("button", { name: "Verify backup password", exact: true })
      .click();
    await recovery
      .getByRole("alert")
      .filter({ hasText: "Incorrect backup password" })
      .waitFor();
    assert.equal(fs.existsSync(target), false);
    assert.equal(
      await recovery
        .getByLabel("Backup master password", { exact: true })
        .inputValue(),
      "",
    );
    await recovery
      .getByLabel("Backup master password", { exact: true })
      .fill(password);
    await recovery
      .getByRole("button", { name: "Verify backup password", exact: true })
      .click();
    await recovery.getByText("Backup verified", { exact: true }).waitFor();
    assert.equal(fs.existsSync(target), false);
    const artifacts = process.env.KEYLOCAL_ARTIFACTS_DIR;
    if (artifacts)
      await page.screenshot({
        path: path.join(artifacts, "Keylocal-recovery.png"),
        timeout: 15000,
      });
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(900, 640),
    );
    assert.equal(
      await recovery.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return (
          r.top >= 0 &&
          r.bottom <= innerHeight &&
          r.left >= 0 &&
          r.right <= innerWidth
        );
      }),
      true,
    );
    await recovery
      .getByRole("button", { name: "Save recovered vault", exact: true })
      .click();
    await recovery.waitFor({ state: "hidden" });
    await page.getByLabel("Master password", { exact: true }).fill(password);
    await page
      .getByRole("button", { name: "Unlock vault", exact: true })
      .click();
    await page.getByRole("button", { name: "Settings", exact: true }).waitFor();
    assert.equal(hash(fs.readFileSync(source)), before);
    assert.equal(hash(fs.readFileSync(target)), before);
    await page.getByRole("button", { name: "Backups", exact: true }).click();
    await page
      .getByText("Choose a separate drive for your backups", { exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Verify a backup", exact: true })
      .click();
    recovery = page.getByRole("dialog", {
      name: "Verify a backup",
      exact: true,
    });
    await recovery
      .getByRole("button", { name: "Choose backup file", exact: true })
      .click();
    await recovery
      .getByLabel("Backup master password", { exact: true })
      .fill(password);
    await recovery
      .getByRole("button", { name: "Verify backup password", exact: true })
      .click();
    await recovery.getByText("Backup verified", { exact: true }).waitFor();
    assert.equal(
      await recovery
        .getByRole("button", { name: "Save recovered vault", exact: true })
        .count(),
      0,
    );
    assert.equal(
      (await page.evaluate(() => window.vault.status())).locked,
      false,
    );
    await recovery
      .getByRole("button", { name: "Close", exact: true })
      .last()
      .click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    let settings = page.getByRole("dialog", { name: "Settings", exact: true });
    await settings
      .getByRole("button", { name: "Privacy", exact: true })
      .click();
    await settings.getByText("Know the limits", { exact: true }).waitFor();
    if (artifacts)
      await page.screenshot({
        path: path.join(artifacts, "Keylocal-privacy.png"),
        timeout: 15000,
      });
    const reportFile = path.join(temp, "diagnostics.json");
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, reportFile);
    await settings
      .getByRole("button", { name: "Preview diagnostics", exact: true })
      .click();
    const preview = JSON.parse(
      await settings
        .getByLabel("Diagnostics preview", { exact: true })
        .textContent(),
    );
    await settings
      .getByRole("button", { name: "Save diagnostics", exact: true })
      .click();
    await settings.getByText("Diagnostics saved", { exact: true }).waitFor();
    const exported = JSON.parse(fs.readFileSync(reportFile, "utf8"));
    assert.deepEqual(exported, preview);
    assert.deepEqual(Object.keys(exported).sort(), [
      "application",
      "architecture",
      "electron",
      "node",
      "osRelease",
      "platform",
      "schema",
      "version",
    ]);
    assert.equal(JSON.stringify(exported).includes(temp), false);
    assert.equal(JSON.stringify(exported).includes(password), false);
    await settings
      .getByRole("button", { name: "General", exact: true })
      .click();
    await settings
      .getByRole("combobox", { name: "Language", exact: true })
      .click();
    await page.getByRole("option", { name: "Türkçe", exact: true }).click();
    settings = page.getByRole("dialog", { name: "Ayarlar", exact: true });
    await settings
      .getByRole("button", { name: "Gizlilik", exact: true })
      .click();
    await settings.getByText("Korumanın sınırları", { exact: true }).waitFor();
    await settings.getByRole("button", { name: "Kapat", exact: true }).click();
    await page
      .getByRole("button", { name: "Yedeği doğrula", exact: true })
      .click();
    await page.evaluate(() => window.vault.lock());
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    assert.deepEqual(errors, []);
    console.log(
      "Recovery UI: fresh-install restore, wrong password, explicit verification before saving, separate-copy integrity, non-mutating verification, backup status, English/Turkish privacy, previewed diagnostics export and lock cleanup passed.",
    );
  } finally {
    await app.close();
    try {
      fs.rmSync(temp, { recursive: true, force: true });
    } catch {}
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
