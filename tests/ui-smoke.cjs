"use strict";
const { _electron: electron } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "..");
const os = require("node:os");
const artifacts =
  process.env.KEYLOCAL_ARTIFACTS_DIR ||
  path.join(os.tmpdir(), "keylocal-ui-artifacts");
fs.mkdirSync(artifacts, { recursive: true });
const work = fs.mkdtempSync(path.join(os.tmpdir(), "keylocal-ui-"));
(async () => {
  const electronApp = await electron.launch({
    executablePath: require("electron"),
    args: [path.resolve(__dirname, "..")],
    env: { ...process.env, KEYLOCAL_TEST_DATA_DIR: path.join(work, "profile") },
    timeout: 45000,
  });
  const page = await electronApp.firstWindow();
  // Automated clicks do not reset the physical OS idle counter. Exercise UI
  // behavior independently of how long the real computer has been unattended.
  await electronApp.evaluate(({ powerMonitor }) => {
    powerMonitor.getSystemIdleTime = () => 0;
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.waitForSelector("text=Create a vault");
    await electronApp.evaluate(
      ({ dialog }, target) => {
        dialog.showSaveDialog = async () => ({
          canceled: false,
          filePath: target,
        });
      },
      path.join(work, "Smoke.kdbx"),
    );
    await page
      .getByRole("button", { name: "Create a vault", exact: true })
      .click();
    await page
      .getByLabel("Vault name", { exact: true })
      .fill("My private vault");
    await page
      .getByLabel("Master password", { exact: true })
      .fill("aster-river-forest-cloud-839");
    await page
      .getByLabel("Confirm password", { exact: true })
      .fill("aster-river-forest-cloud-839");
    await page
      .getByRole("button", { name: "Create encrypted vault", exact: true })
      .click();
    await page
      .getByRole("button", { name: "All items", exact: false })
      .waitFor({ timeout: 30000 });
    await page
      .getByRole("button", { name: "New item", exact: true })
      .first()
      .click();
    await page
      .getByRole("dialog", { name: "Choose item type" })
      .getByRole("button", { name: "Login", exact: true })
      .click();
    const editor = page.getByRole("dialog", { name: "New item" });
    await editor.getByLabel("Title", { exact: true }).fill("GitHub");
    await editor
      .getByLabel("Username", { exact: true })
      .fill("demo@example.test");
    await editor
      .getByLabel("Password", { exact: true })
      .fill("blue-moon-cedar-fox-318!");
    await editor
      .getByLabel("Websites", { exact: true })
      .fill("https://github.com");
    await editor
      .getByLabel("Notes", { exact: true })
      .fill("Fictional test record.");
    await editor.getByLabel("Tags", { exact: true }).fill("development");
    await editor
      .getByRole("button", { name: "Save item", exact: true })
      .click();
    await editor.waitFor({ state: "hidden", timeout: 30000 });
    await page.getByRole("heading", { name: "GitHub", exact: true }).waitFor();
    const list = await page.evaluate(() => window.vault.listItems());
    assert.equal(list.length, 1);
    assert.equal(list[0].hasPassword, true);
    assert.equal("password" in list[0], false);
    await electronApp.evaluate(({ clipboard }) => {
      globalThis.__keylocalClipboardTest = {
        read: clipboard.readText,
        write: clipboard.writeText,
      };
      clipboard.readText = async () => "";
      clipboard.writeText = async () => {};
    });
    try {
      await assert.rejects(
        () =>
          page.evaluate(
            (id) => window.vault.copyField(id, "Password"),
            list[0].id,
          ),
        /Clipboard did not confirm/,
      );
    } finally {
      await electronApp.evaluate(({ clipboard }) => {
        clipboard.readText = globalThis.__keylocalClipboardTest.read;
        clipboard.writeText = globalThis.__keylocalClipboardTest.write;
        delete globalThis.__keylocalClipboardTest;
      });
    }
    await page
      .getByRole("button", { name: "Copy Password", exact: true })
      .click();
    await page.getByText("Copied", { exact: true }).waitFor();
    assert.equal(
      await electronApp.evaluate(({ clipboard }) => clipboard.readText()),
      "blue-moon-cedar-fox-318!",
    );
    if (process.env.KEYLOCAL_CAPTURE_SCREENSHOT !== "0") {
      await page.locator(".toast").waitFor({ state: "hidden" });
      await page.screenshot({
        path: path.join(artifacts, "Keylocal-vault.png"),
      });
    }
    await page
      .getByRole("button", { name: "Password generator", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Password generator" })
      .getByText("Memorable passphrase", { exact: true })
      .count();
    const generator = page.getByRole("dialog", { name: "Password generator" });
    await generator
      .getByRole("combobox", { name: "Type", exact: true })
      .click();
    await page
      .getByRole("option", { name: "Memorable passphrase", exact: true })
      .click();
    await page.waitForFunction(() =>
      document.querySelector(".generated-value")?.textContent?.includes("-"),
    );
    await generator.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "Backups", exact: true }).click();
    await page
      .getByRole("button", { name: "Back up now", exact: true })
      .click();
    await page
      .getByText("Backup created", { exact: true })
      .waitFor({ timeout: 30000 });
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "Settings" });
    await settings.getByLabel("Language", { exact: true }).click();
    await page.getByRole("option", { name: "Türkçe", exact: true }).click();
    await page.getByRole("dialog", { name: "Ayarlar" }).waitFor();
    await page
      .getByRole("dialog", { name: "Ayarlar" })
      .getByRole("button", { name: "Kapat", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Kasayı kilitle", exact: false })
      .click();
    await page
      .getByRole("button", { name: "Kasanın kilidini aç", exact: true })
      .waitFor();
    for (let attempt = 0; attempt < 30; attempt++) {
      if (
        (await electronApp.evaluate(({ clipboard }) =>
          clipboard.readText(),
        )) === ""
      )
        break;
      await page.waitForTimeout(50);
    }
    assert.equal(
      await electronApp.evaluate(({ clipboard }) => clipboard.readText()),
      "",
    );
    assert.equal(await page.locator(".item-row").count(), 0);
    await page.getByLabel("Ana parola", { exact: true }).fill("wrong-password");
    await page
      .getByRole("button", { name: "Kasanın kilidini aç", exact: true })
      .click();
    await page.getByRole("alert").waitFor();
    await page
      .getByLabel("Ana parola", { exact: true })
      .fill("aster-river-forest-cloud-839");
    await page
      .getByRole("button", { name: "Kasanın kilidini aç", exact: true })
      .click();
    await page.locator(".item-row").waitFor({ timeout: 30000 });
    assert.equal(
      (await page.evaluate(() => window.vault.listItems())).length,
      1,
    );
    await page.evaluate(async () => {
      const generated = await window.vault.generate({
        mode: "random",
        length: 24,
        words: 6,
        numbers: true,
        symbols: true,
        avoidAmbiguous: true,
      });
      await window.vault.copyGenerated(generated.value);
    });
    assert.equal(
      (await electronApp.evaluate(({ clipboard }) => clipboard.readText()))
        .length,
      24,
    );
    await electronApp.evaluate(async ({ clipboard }) => {
      await clipboard.writeText("Unrelated clipboard text from another app");
    });
    await page.evaluate(() => window.vault.lock());
    await page
      .getByRole("button", { name: "Kasanın kilidini aç", exact: true })
      .waitFor();
    await page.waitForTimeout(100);
    assert.equal(
      await electronApp.evaluate(({ clipboard }) => clipboard.readText()),
      "Unrelated clipboard text from another app",
    );
    assert.equal(
      await page.evaluate(async () => {
        try {
          await window.vault.listItems();
          return false;
        } catch {
          return true;
        }
      }),
      true,
    );
    await electronApp.evaluate(async ({ clipboard }) => {
      if (
        (await clipboard.readText()) ===
        "Unrelated clipboard text from another app"
      )
        await clipboard.writeText("");
    });
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(work, "result.json"),
      JSON.stringify(
        {
          passed: true,
          checks: [
            "create",
            "save",
            "redaction",
            "clipboard",
            "generator",
            "backup",
            "Turkish",
            "lock-clears-UI-and-clipboard",
            "wrong-password",
            "reopen",
            "generated-password-copy",
            "preserves-unrelated-clipboard",
            "locked-IPC-rejected",
            "failed-clipboard-copy-rejected",
          ],
          pageErrors: errors,
        },
        null,
        2,
      ),
    );
    console.log(
      `Electron UI smoke: 14 flows passed; screenshot ${process.env.KEYLOCAL_CAPTURE_SCREENSHOT === "0" ? "disabled" : "captured"}`,
    );
  } finally {
    await electronApp.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
