"use strict";
const { _electron: electron } = require("playwright");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "keylocal-recent-ui-"));
  const profile = path.join(temp, "profile");
  fs.mkdirSync(profile);
  const file = path.join(temp, "Sample vault.kdbx");
  fs.writeFileSync(file, "Synthetic file; this test never unlocks it.");
  fs.writeFileSync(path.join(profile, "settings.json"), JSON.stringify({ lastVault: file }));
  const launch = () => electron.launch({
    executablePath: require("electron"), args: [path.resolve(__dirname, "..")],
    env: { ...process.env, KEYLOCAL_TEST_DATA_DIR: profile },
  });
  let app;
  try {
    app = await launch();
    let page = await app.firstWindow();
    await page.getByRole("heading", { name: "Unlock to continue" }).waitFor();
    await page.getByRole("button", { name: "Choose another vault" }).click();
    await page.getByRole("heading", { name: "Your vaults" }).waitFor();
    await page.getByRole("button", { name: /Sample vault/ }).click();
    await page.getByRole("heading", { name: "Unlock to continue" }).waitFor();
    assert.equal((await page.evaluate(() => window.vault.status())).vaultPath, file);
    await app.close(); app = null;
    app = await launch();
    page = await app.firstWindow();
    await page.getByRole("heading", { name: "Unlock to continue" }).waitFor();
    const status = await page.evaluate(() => window.vault.status());
    assert.equal(status.vaultPath, file);
    assert.equal(status.locked, true);
    assert.equal(status.recentVaults[0].path, file);
    console.log("Recent vault selection and restart retention passed without a file dialog.");
  } finally {
    if (app) await app.close();
    try { fs.rmSync(temp, { recursive: true, force: true }); } catch { /* OS may retain a cache handle briefly. */ }
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
