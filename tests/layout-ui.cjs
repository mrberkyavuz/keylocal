"use strict";
const { _electron: electron } = require("playwright");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { VaultService } = require("../electron/vault.cjs");
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "keylocal-layout-"));
  const fixture = new VaultService(path.join(temp, "profile"));
  await fixture.create(
    path.join(temp, "Design.kdbx"),
    "My private vault",
    "aster-river-forest-cloud-839",
  );
  for (const [type, title, username] of [
    ["login", "GitHub", "alex@example.test"],
    ["login", "Cloud console", "alex"],
    ["api", "Development API", "sandbox"],
    ["note", "Recovery notes", ""],
    ["card", "Travel card", ""],
    ["wifi", "Home Wi-Fi", ""],
  ])
    await fixture.saveItem({
      type,
      title,
      username,
      password: `fictional-${title}-872!`,
      urls: [],
      notes: "Fictional example record.",
      tags: ["personal"],
      group: "Personal",
      fields: [],
      favorite: false,
    });
  fixture.lock();
  const app = await electron.launch({
    executablePath: require("electron"),
    args: [path.resolve(__dirname, "..")],
    env: { ...process.env, KEYLOCAL_TEST_DATA_DIR: path.join(temp, "profile") },
  });
  try {
    await app.evaluate(({ powerMonitor, BrowserWindow }) => {
      powerMonitor.getSystemIdleTime = () => 0;
      BrowserWindow.getAllWindows()[0].setSize(1320, 860);
    });
    const page = await app.firstWindow();
    await page
      .getByLabel("Master password", { exact: true })
      .fill("aster-river-forest-cloud-839");
    await page
      .getByRole("button", { name: "Unlock vault", exact: true })
      .click();
    await page.locator(".item-row").first().waitFor();
    assert.equal(await page.locator("select").count(), 0);
    assert.equal(await page.locator(".workspace > .toolbar").count(), 0);
    assert.equal(
      await page.locator(".desktop-titlebar").evaluate((el) => el.offsetHeight),
      48,
    );
    assert.equal(
      await page
        .locator(".desktop-toolbar .search-box")
        .evaluate((el) => getComputedStyle(el).webkitAppRegion),
      "no-drag",
    );
    const type = page.getByRole("combobox", { name: "Type", exact: true });
    await type.click();
    assert.equal(await page.getByRole("option").count(), 7);
    assert.equal(
      await page
        .getByRole("option", { name: "All types", exact: true })
        .getAttribute("aria-selected"),
      "true",
    );
    const artifacts = process.env.KEYLOCAL_ARTIFACTS_DIR;
    if (artifacts)
      await page.screenshot({
        path: path.join(artifacts, "Keylocal-filters.png"),
        timeout: 15000,
      });
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    assert.equal(await type.getAttribute("data-value"), "login");
    assert.equal(await page.locator(".item-row").count(), 2);
    await type.click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Enter");
    await page.getByRole("combobox", { name: "Sort", exact: true }).click();
    await page.getByRole("option", { name: "Title A–Z", exact: true }).click();
    assert.equal(
      await page.locator(".item-row strong").first().textContent(),
      "Cloud console",
    );
    await page.locator(".item-row").filter({ hasText: "GitHub" }).click();
    if (artifacts)
      await page.screenshot({
        path: path.join(artifacts, "Keylocal-vault.png"),
        timeout: 15000,
      });
    await page.getByRole("button", { name: "New item", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Login", exact: true })
      .click();
    const editor = page.getByRole("dialog", { name: "New item", exact: true });
    await editor.getByRole("combobox", { name: "Type", exact: true }).click();
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("listbox").count(), 0);
    assert.equal(await editor.count(), 1);
    await editor.getByRole("combobox", { name: "Type", exact: true }).click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    assert.equal(
      await editor
        .getByRole("combobox", { name: "Type", exact: true })
        .getAttribute("data-value"),
      "wifi",
    );
    await page.keyboard.press("Escape");
    await editor.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    let settings = page.getByRole("dialog", { name: "Settings", exact: true });
    await settings
      .getByRole("button", { name: "Security", exact: true })
      .click();
    await settings
      .getByRole("combobox", { name: "Auto-lock after", exact: true })
      .click();
    await page.getByRole("option", { name: "10 minutes", exact: true }).click();
    await page.waitForFunction(
      async () => (await window.vault.status()).settings.autoLockMinutes === 10,
    );
    await settings
      .getByRole("combobox", { name: "Clear clipboard after", exact: true })
      .click();
    await page.getByRole("option", { name: "60 seconds", exact: true }).click();
    await page.waitForFunction(
      async () =>
        (await window.vault.status()).settings.clipboardSeconds === 60,
    );
    await page.keyboard.press("Escape");
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(900, 640),
    );
    await page.locator(".toast").waitFor({ state: "hidden" });
    await type.click();
    assert.equal(
      await page.getByRole("listbox").evaluate((el) => {
        const r = el.getBoundingClientRect();
        return (
          r.left >= 0 &&
          r.top >= 0 &&
          r.right <= innerWidth &&
          r.bottom <= innerHeight
        );
      }),
      true,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    if (artifacts)
      await page.screenshot({
        path: path.join(artifacts, "Keylocal-compact.png"),
        timeout: 15000,
      });
    await page.keyboard.press("Tab");
    assert.equal(await page.getByRole("listbox").count(), 0);
    await page.evaluate(() => window.vault.saveSettings({ theme: "light" }));
    await page.reload();
    await page.waitForFunction(
      () => document.documentElement.dataset.theme === "light",
    );
    await page.getByRole("combobox", { name: "Type", exact: true }).click();
    if (artifacts)
      await page.screenshot({
        path: path.join(artifacts, "Keylocal-filters-light.png"),
        timeout: 15000,
      });
    await page.evaluate(() => window.vault.lock());
    await page.getByRole("listbox").waitFor({ state: "hidden" });
    console.log(
      "Layout: unified chrome, themed menus, filtering, sorting, keyboard, Escape, settings persistence, 900px layout, light theme and lock cleanup passed.",
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
