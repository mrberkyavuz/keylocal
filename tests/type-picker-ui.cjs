"use strict";
const { _electron: electron } = require("playwright");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { VaultService } = require("../electron/vault.cjs");
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "keylocal-picker-"));
  const profile = path.join(temp, "profile");
  const fixture = new VaultService(profile);
  await fixture.create(
    path.join(temp, "Design.kdbx"),
    "Design review",
    "aster-river-forest-cloud-839",
  );
  fixture.lock();
  const app = await electron.launch({
    executablePath: require("electron"),
    args: [path.resolve(__dirname, "..")],
    env: { ...process.env, KEYLOCAL_TEST_DATA_DIR: profile },
  });
  try {
    await app.evaluate(({ powerMonitor }) => {
      powerMonitor.getSystemIdleTime = () => 0;
    });
    const page = await app.firstWindow();
    await page
      .getByLabel("Master password", { exact: true })
      .fill("aster-river-forest-cloud-839");
    await page
      .getByRole("button", { name: "Unlock vault", exact: true })
      .click();
    const open = async () => {
      await page
        .getByRole("button", { name: "New item", exact: true })
        .first()
        .click();
      return page.getByRole("dialog", {
        name: "Choose item type",
        exact: true,
      });
    };
    const cases = [
      ["Login", "login"],
      ["Secure note", "note"],
      ["Payment card", "card"],
      ["Identity", "identity"],
      ["API credential", "api"],
      ["Wi-Fi", "wifi"],
    ];
    for (const [name, type] of cases) {
      const picker = await open();
      await picker.getByRole("button", { name, exact: true }).click();
      const editor = page.getByRole("dialog", {
        name: "New item",
        exact: true,
      });
      assert.equal(
        await editor
          .getByLabel("Type", { exact: true })
          .getAttribute("data-value"),
        type,
      );
      if (type === "login") {
        await editor
          .getByLabel("Title", { exact: true })
          .fill("Unsaved example");
        await page.keyboard.press("Control+n");
        assert.equal(await page.getByRole("dialog").count(), 1);
        assert.equal(
          await editor.getByLabel("Title", { exact: true }).inputValue(),
          "Unsaved example",
        );
      }
      const expectedFields = {
        login: [],
        note: [],
        card: ["Cardholder", "Card number", "Expiry", "CVV"],
        identity: ["Full name", "Address", "Phone", "Email"],
        api: ["API key", "Secret"],
        wifi: ["Network", "Security"],
      };
      assert.deepEqual(
        await editor
          .getByLabel("Field name", { exact: true })
          .evaluateAll((inputs) => inputs.map((input) => input.value)),
        expectedFields[type],
      );
      if (type === "card")
        assert.equal(
          await editor
            .getByLabel("Card number", { exact: true })
            .getAttribute("type"),
          "password",
        );
      await editor.getByRole("button", { name: "Close", exact: true }).click();
    }
    assert.equal(
      (await page.evaluate(() => window.vault.listItems())).length,
      0,
    );
    let picker = await open();
    await page.keyboard.press("Tab");
    assert.equal(
      await page.evaluate(() =>
        document.activeElement.getAttribute("aria-label"),
      ),
      "Login",
    );
    await page.keyboard.press("Escape");
    await picker.waitFor({ state: "hidden" });
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1320, 860),
    );
    picker = await open();
    const artifacts = process.env.KEYLOCAL_ARTIFACTS_DIR;
    if (artifacts) {
      fs.mkdirSync(artifacts, { recursive: true });
      await page.screenshot({
        path: path.join(artifacts, "Keylocal-new-item.png"),
      });
    }
    await page.keyboard.press("Escape");
    await page.evaluate(() => window.vault.saveSettings({ theme: "light" }));
    await page.reload();
    await page.waitForFunction(
      () => document.documentElement.dataset.theme === "light",
    );
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(900, 640),
    );
    picker = await open();
    const fits = await picker.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return (
        r.left >= 0 &&
        r.top >= 0 &&
        r.right <= innerWidth &&
        r.bottom <= innerHeight
      );
    });
    assert.equal(fits, true);
    await picker
      .getByRole("button", { name: "Wi-Fi", exact: true })
      .scrollIntoViewIfNeeded();
    if (artifacts)
      await page.screenshot({
        path: path.join(artifacts, "Keylocal-new-item-light.png"),
      });
    await page.evaluate(() => window.vault.lock());
    await picker.waitFor({ state: "hidden" });
    assert.equal(await page.locator(".item-type-card").count(), 0);
    console.log(
      "Type picker: six types, cancellation, keyboard, minimum size and lock cleanup passed.",
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
