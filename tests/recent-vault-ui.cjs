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
  const others = Array.from({ length: 24 }, (_, i) =>
    path.join(temp, `Other vault ${i + 1}.kdbx`),
  );
  for (const other of others)
    fs.writeFileSync(other, "Synthetic file; never unlocked");
  const missing = path.join(temp, "Moved vault.kdbx");
  fs.writeFileSync(
    path.join(profile, "settings.json"),
    JSON.stringify({
      lastVault: file,
      recentVaults: [file, ...others, missing],
    }),
  );
  const launch = () =>
    electron.launch({
      executablePath: require("electron"),
      args: [path.resolve(__dirname, "..")],
      env: { ...process.env, KEYLOCAL_TEST_DATA_DIR: profile },
    });
  let app;
  try {
    app = await launch();
    let page = await app.firstWindow();
    await page.getByRole("heading", { name: "Unlock to continue" }).waitFor();
    await app.evaluate(({ dialog, BrowserWindow }) => {
      dialog.showOpenDialog = async () => {
        throw new Error("No file dialog should be needed");
      };
      BrowserWindow.getAllWindows()[0].setSize(900, 640);
    });
    const remembered = page.getByRole("button", { name: /Sample vault/ });
    assert.equal(await remembered.isVisible(), true);
    assert.equal(await remembered.getAttribute("aria-current"), "true");
    assert.equal(
      await remembered.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.top >= 48 && r.bottom <= innerHeight;
      }),
      true,
    );
    assert.equal(await page.locator(".recent-vault").count(), 26);
    assert.equal(
      await page.getByRole("button", { name: /Moved vault/ }).isDisabled(),
      true,
    );
    const last = page.getByRole("button", { name: /Other vault 24/ });
    await last.scrollIntoViewIfNeeded();
    await last.click();
    await page.waitForFunction(
      (p) => document.querySelector(".vault-file")?.textContent === p,
      "Other vault 24.kdbx",
    );
    await remembered.scrollIntoViewIfNeeded();
    await remembered.click();
    await page.getByRole("heading", { name: "Unlock to continue" }).waitFor();
    await page.getByRole("button", { name: "Choose another vault" }).click();
    await page.getByRole("heading", { name: "Your vaults" }).waitFor();
    await page.getByRole("button", { name: /Sample vault/ }).click();
    await page.getByRole("heading", { name: "Unlock to continue" }).waitFor();
    assert.equal(
      (await page.evaluate(() => window.vault.status())).vaultPath,
      file,
    );
    await app.close();
    app = null;
    app = await launch();
    page = await app.firstWindow();
    await page.getByRole("heading", { name: "Unlock to continue" }).waitFor();
    const status = await page.evaluate(() => window.vault.status());
    assert.equal(status.vaultPath, file);
    assert.equal(status.locked, true);
    assert.equal(status.recentVaults[0].path, file);
    assert.equal(status.recentVaults.length, 26);
    console.log(
      "All 26 remembered vaults retained; scrollable unlock/home selection at 900x640, missing-file indicator, no file dialog and restart retention passed.",
    );
  } finally {
    if (app) await app.close();
    try {
      fs.rmSync(temp, { recursive: true, force: true });
    } catch {
      /* OS may retain a cache handle briefly. */
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
