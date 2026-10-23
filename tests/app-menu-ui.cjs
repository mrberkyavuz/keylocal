"use strict";
const { _electron: electron } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "keylocal-menu-"));
  const app = await electron.launch({
    executablePath: require("electron"),
    args: [path.resolve(__dirname, "..")],
    env: { ...process.env, KEYLOCAL_TEST_DATA_DIR: profile },
  });
  try {
    const page = await app.firstWindow();
    await page
      .getByRole("button", { name: "Application menu", exact: true })
      .waitFor();
    // Electron Menu.popup returns a native object which cannot cross IPC.
    // Keep this test deterministic without leaving an OS popup open.
    await app.evaluate(({ Menu, BrowserWindow }) => {
      const menu = Menu.getApplicationMenu();
      globalThis.__menuCalls = 0;
      menu.popup = ({ window }) => {
        if (window !== BrowserWindow.getAllWindows()[0])
          throw new Error("Wrong parent window");
        globalThis.__menuCalls++;
        return menu;
      };
    });
    assert.equal(
      await page.evaluate(() => window.vault.showAppMenu()),
      undefined,
    );
    await page
      .getByRole("button", { name: "Application menu", exact: true })
      .click();
    await page.waitForFunction(() => !document.querySelector('[role="alert"]'));
    assert.equal(await app.evaluate(() => globalThis.__menuCalls), 2);
    assert.equal(
      await page.getByText(/An object could not be cloned/).count(),
      0,
    );
    console.log(
      "Application menu: native popup invoked with correct window; IPC returns no native object; titlebar button succeeds.",
    );
  } finally {
    await app.close();
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch {}
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
