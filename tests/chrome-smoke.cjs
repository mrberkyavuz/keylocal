"use strict";
const { _electron: electron } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "keylocal-chrome-"));
  const app = await electron.launch({
    executablePath: require("electron"),
    args: [path.resolve(__dirname, "..")],
    env: { ...process.env, KEYLOCAL_TEST_DATA_DIR: profile },
  });
  try {
    const page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Create a vault", exact: true })
      .waitFor();
    assert.equal(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isMenuBarVisible(),
      ),
      false,
    );
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(900, 640),
    );
    await page.waitForTimeout(100);
    const layout = await page.evaluate(() => ({
      header: document
        .querySelector(".desktop-titlebar")
        .getBoundingClientRect().height,
      width: window.innerWidth,
      scrollWidth: document.body.scrollWidth,
      appBottom: document.querySelector(".onboarding").getBoundingClientRect()
        .bottom,
      height: window.innerHeight,
      drag: getComputedStyle(
        document.querySelector(".desktop-titlebar"),
      ).getPropertyValue("-webkit-app-region"),
      buttonDrag: getComputedStyle(
        document.querySelector(".titlebar-brand button"),
      ).getPropertyValue("-webkit-app-region"),
    }));
    assert.equal(layout.header, 48);
    assert.equal(layout.drag, "drag");
    assert.equal(layout.buttonDrag, "no-drag");
    assert.ok(layout.scrollWidth <= layout.width);
    assert.ok(layout.appBottom <= layout.height + 1);
    await page
      .getByRole("button", { name: "Create a vault", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Create encrypted vault", exact: true })
      .scrollIntoViewIfNeeded();
    assert.equal(await page.locator(".desktop-titlebar").isVisible(), true);
    assert.equal(
      typeof (await page.evaluate(() => window.vault.status())).biometric.available,
      "boolean",
    );
    assert.equal((await page.evaluate(() => window.vault.status())).biometric.enabled, false);
    await assert.rejects(() =>
      page.evaluate(() => window.vault.unlockBiometric()),
    );
    await assert.rejects(() =>
      page.evaluate(() => window.vault.setWindowTheme("arbitrary")),
    );
    await page.evaluate(() => window.vault.setWindowTheme("light"));
    await page.evaluate(() => window.vault.setWindowTheme("dark"));
    console.log(
      "Desktop chrome: native menu hidden, drag regions, minimum-size layout, theme IPC validation and unavailable biometric unlock checked.",
    );
  } finally {
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
