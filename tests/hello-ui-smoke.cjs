"use strict";
// Real Electron UI, isolated vault, mocked native authenticator. No real prompts.
const { _electron: electron } = require("playwright");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  assert = require("node:assert/strict");
(async () => {
  const root = path.resolve(__dirname, ".."),
    temp = fs.mkdtempSync(path.join(os.tmpdir(), "keylocal-hello-ui-"));
  const app = await electron.launch({
    executablePath: require("electron"),
    args: [root],
    env: { ...process.env, KEYLOCAL_TEST_DATA_DIR: path.join(temp, "profile") },
  });
  try {
    console.log("Hello UI: launched");
    await app.evaluate(
      ({ dialog, powerMonitor }, input) => {
        powerMonitor.getSystemIdleTime = () => 0;
        dialog.showSaveDialog = async () => ({
          canceled: false,
          filePath: input.file,
        });
        const testRequire = process
          .getBuiltinModule("module")
          .createRequire(input.root + "/package.json");
        const { WindowsWebAuthn } = testRequire(
          input.root + "/electron/windows-webauthn.cjs",
        );
        const records = new Map();
        WindowsWebAuthn.prototype.available = async () => true;
        WindowsWebAuthn.prototype.enroll = async () => {
          const credentialId = Buffer.alloc(32, 3),
            key = Buffer.alloc(32, 7);
          records.set(credentialId.toString("hex"), key);
          return { credentialId, key: Buffer.from(key) };
        };
        WindowsWebAuthn.prototype.derive = async function (id) {
          if (globalThis.__keylocalPauseHello) {
            await new Promise((resolve) => {
              globalThis.__keylocalResumeHello = resolve;
            });
          } else {
            await new Promise((resolve) => setTimeout(resolve, 350));
          }
          const key = records.get(id.toString("hex"));
          if (!key) throw new Error("Unavailable");
          return Buffer.from(key);
        };
        WindowsWebAuthn.prototype.remove = async (id) =>
          records.delete(id.toString("hex"));
      },
      { root, file: path.join(temp, "Test.kdbx") },
    );
    console.log("Hello UI: native provider mocked");
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    console.log("Hello UI: first window");
    await page
      .getByRole("button", { name: "Create a vault", exact: true })
      .click();
    await page
      .getByLabel("Master password", { exact: true })
      .fill("test-vault-river-cloud-987");
    await page
      .getByLabel("Confirm password", { exact: true })
      .fill("test-vault-river-cloud-987");
    await page
      .getByRole("button", { name: "Create encrypted vault", exact: true })
      .click();
    await page.getByRole("button", { name: "Settings", exact: true }).waitFor();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const settings = page.getByRole("dialog", {
      name: "Settings",
      exact: true,
    });
    await settings
      .getByRole("button", { name: "Security", exact: true })
      .click();
    await settings
      .getByLabel("Master password", { exact: true })
      .fill("test-vault-river-cloud-987");
    await settings
      .getByRole("button", { name: "Enable Windows Hello", exact: true })
      .click();
    await settings
      .getByRole("button", { name: "Disable Windows Hello", exact: true })
      .waitFor();
    await settings.getByRole("button", { name: "Close", exact: true }).click();
    await page.evaluate(() => window.vault.lock());
    const hello = page.getByRole("button", {
      name: "Unlock with Windows Hello",
      exact: true,
    });
    await hello.waitFor();
    assert.match(await hello.getAttribute("class"), /primary/);
    assert.equal(
      await page.getByLabel("Master password", { exact: true }).count(),
      0,
    );
    await page
      .getByRole("button", { name: "Use master password", exact: true })
      .click();
    await page.getByLabel("Master password", { exact: true }).waitFor();
    await page
      .getByRole("button", { name: "Unlock with Windows Hello", exact: true })
      .click();
    await page.getByRole("button", { name: "Settings", exact: true }).waitFor();
    await page.evaluate(() => window.vault.lock());
    await page
      .getByRole("button", { name: "Unlock with Windows Hello", exact: true })
      .waitFor();
    assert.equal(
      await page.getByLabel("Master password", { exact: true }).count(),
      0,
    );
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await app.evaluate(() => {
      globalThis.__keylocalPauseHello = true;
    });
    await hello.click();
    await page
      .getByRole("button", { name: "Waiting for verification…", exact: true })
      .waitFor();
    assert.equal(await page.locator(".busy-indicator").count(), 0);
    const spinner = page.locator(".hello-first .spinner");
    const motion = await spinner.evaluate(
      (el) => getComputedStyle(el).animationDuration,
    );
    assert.equal(
      parseFloat(motion),
      1,
      "Loading ring should complete one smooth turn per second",
    );
    if (process.env.KEYLOCAL_ARTIFACTS_DIR) {
      fs.mkdirSync(process.env.KEYLOCAL_ARTIFACTS_DIR, { recursive: true });
      await page.screenshot({
        path: path.join(
          process.env.KEYLOCAL_ARTIFACTS_DIR,
          "Keylocal-loading.png",
        ),
      });
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(
      await spinner.evaluate((el) => getComputedStyle(el).animationName),
      "none",
    );
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await app.evaluate(() => {
      globalThis.__keylocalPauseHello = false;
      globalThis.__keylocalResumeHello();
      delete globalThis.__keylocalResumeHello;
    });
    await page.getByRole("button", { name: "Settings", exact: true }).waitFor();
    console.log(
      "Hello UI: enrollment, preferred unlock, password fallback, inline progress, reduced-motion preference and fresh lock view passed with a mocked provider.",
    );
  } finally {
    const child = app.process();
    let timer;
    try {
      await Promise.race([
        app.close(),
        new Promise((resolve) => {
          timer = setTimeout(() => {
            child.kill();
            resolve();
          }, 5000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    try {
      fs.rmSync(temp, { recursive: true, force: true });
    } catch {}
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
