"use strict";
const {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  dialog,
  clipboard,
  powerMonitor,
  shell,
  session,
  Menu,
  systemPreferences,
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { VaultService, readFile, atomicWrite } = require("./vault.cjs");
const { generate } = require("./crypto.cjs");
const { BiometricStore } = require("./biometric.cjs");
const { RecoverySession } = require("./recovery.cjs");
const { diagnostics } = require("./diagnostics.cjs");
app.setPath("userData", path.join(app.getPath("appData"), "Keylocal"));
if (!app.isPackaged && process.env.KEYLOCAL_TEST_DATA_DIR)
  app.setPath("userData", path.resolve(process.env.KEYLOCAL_TEST_DATA_DIR));
protocol.registerSchemesAsPrivileged([
  {
    scheme: "keylocal",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
const START = "keylocal://app/index.html";
const NATIVE_STATUS = Symbol("native-status");
let window,
  vault,
  biometrics,
  recovery,
  diagnosticPreview = null,
  clipboardTimer,
  copiedValue = null,
  clipboardQueue = Promise.resolve(),
  lastActivity = Date.now();
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });
  app
    .whenReady()
    .then(start)
    .catch((error) => {
      // Startup runs before any vault is unlocked. Keep diagnostics local.
      try {
        fs.writeFileSync(
          path.join(app.getPath("userData"), "startup-error.log"),
          `${new Date().toISOString()}\n${String(error?.stack || error)}\n`,
          { mode: 0o600 },
        );
      } catch {
        /* A read-only profile must still show the error dialog. */
      }
      dialog.showErrorBox(
        "Keylocal",
        "Keylocal could not start. Your vault files have not been removed.",
      );
      app.quit();
    });
}
function queueClipboard(fn) {
  const result = clipboardQueue.then(fn);
  clipboardQueue = result.catch(() => {});
  return result;
}
function clearClipboard() {
  clearTimeout(clipboardTimer);
  return queueClipboard(async () => {
    const expected = copiedValue;
    copiedValue = null;
    if (expected !== null && (await clipboard.readText()) === expected)
      await clipboard.writeText("");
  });
}
function copySecret(value) {
  if (typeof value !== "string" || value.length > 65536)
    throw new Error("Invalid clipboard value.");
  const epoch = vault.generation;
  return queueClipboard(async () => {
    if (!vault.db || epoch !== vault.generation)
      throw new Error("Vault locked before copying.");
    clearTimeout(clipboardTimer);
    await clipboard.writeText(value);
    copiedValue = value;
    clipboardTimer = setTimeout(() => {
      clearClipboard().catch(() => {});
    }, vault.settings.clipboardSeconds * 1000);
    // Windows may temporarily fail to publish clipboard data. Do not report a
    // successful copy until confirmed, and never overwrite a newer foreign copy.
    for (let attempt = 0; attempt < 3; attempt++) {
      const actual = await clipboard.readText();
      if (epoch !== vault.generation || !vault.db)
        throw new Error("Vault locked while copying.");
      if (actual === value) return;
      if (actual !== "") break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error("Clipboard did not confirm the copy. Please try again.");
  });
}
function trusted(event) {
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame ||
    event.senderFrame.url !== START
  )
    throw new Error("Untrusted application frame.");
}
function handle(name, fn) {
  ipcMain.handle(`vault:${name}`, async (event, ...args) => {
    trusted(event);
    try {
      let value = await fn(...args);
      // Every status-returning operation includes the native capability state,
      // including selecting a different vault and saving preferences.
      if (
        value?.appName === "Keylocal" &&
        typeof value.locked === "boolean" &&
        !value[NATIVE_STATUS]
      )
        value = {
          ...(await appStatus()),
          ...(value.unlockTiming ? { unlockTiming: value.unlockTiming } : {}),
        };
      lastActivity = Date.now();
      return { ok: true, value };
    } catch (e) {
      return {
        ok: false,
        error: String(e.message || "Operation failed.").slice(0, 1200),
      };
    }
  });
}
function isUnlocked() {
  vault.requireUnlocked();
}
const filters = [{ name: "KeePass encrypted vault", extensions: ["kdbx"] }];
async function start() {
  app.setName("Keylocal");
  vault = new VaultService(app.getPath("userData"), () => {
    recovery?.clear();
    clearClipboard().catch(() => {});
    if (window && !window.isDestroyed())
      window.webContents.send("vault:locked");
  });
  recovery = new RecoverySession(() => vault.generation);
  let windows;
  if (process.platform === "win32") {
    try {
      const { WindowsWebAuthn } = require("./windows-webauthn.cjs");
      const { WindowsHelloStore } = require("./windows-hello.cjs");
      const native = new WindowsWebAuthn(() => {
        if (!window || window.isDestroyed())
          throw new Error("The application window is unavailable.");
        if (
          [
            "remote-debugging-port",
            "remote-debugging-pipe",
            "inspect",
            "inspect-brk",
          ].some((s) => app.commandLine.hasSwitch(s))
        )
          throw new Error("Windows Hello is unavailable while debugging.");
        window.show();
        window.focus();
        return window.getNativeWindowHandle();
      });
      windows = new WindowsHelloStore(app.getPath("userData"), native);
    } catch {
      /* Missing native support leaves password unlock available. */
    }
  }
  biometrics = new BiometricStore({
    windows,
    platform: process.platform,
    packaged: app.isPackaged,
    canPrompt: () =>
      ![
        "remote-debugging-port",
        "remote-debugging-pipe",
        "inspect",
        "inspect-brk",
      ].some((s) => app.commandLine.hasSwitch(s)) &&
      systemPreferences.canPromptTouchID(),
    openStore: (options) =>
      require("keychain-store").openKeychainStore(options),
  });
  protocol.handle("keylocal", (request) => {
    const url = new URL(request.url);
    if (url.host !== "app") return new Response("Forbidden", { status: 403 });
    let decoded;
    try {
      decoded = decodeURIComponent(url.pathname);
    } catch {
      return new Response("Invalid path", { status: 400 });
    }
    const root = path.resolve(__dirname, "../dist");
    const file = path.resolve(root, `.${decoded}`);
    if (!file.startsWith(root + path.sep))
      return new Response("Forbidden", { status: 403 });
    const mime =
      {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".woff2": "font/woff2",
      }[path.extname(file)] || "application/octet-stream";
    try {
      return new Response(fs.readFileSync(file), {
        headers: {
          "Content-Type": mime,
          "Content-Security-Policy":
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
  session.defaultSession.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] },
    (_details, callback) => callback({ cancel: true }),
  );
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      process.platform === "darwin"
        ? [
            {
              label: "Keylocal",
              submenu: [
                { role: "about" },
                { type: "separator" },
                {
                  label: "Lock vault",
                  accelerator: "Cmd+Shift+L",
                  click: () => vault.lock(),
                },
                { role: "quit" },
              ],
            },
            { role: "editMenu" },
            { role: "windowMenu" },
          ]
        : [
            { role: "editMenu" },
            {
              label: "Vault",
              submenu: [
                {
                  label: "Lock vault",
                  accelerator: "Ctrl+Shift+L",
                  click: () => vault.lock(),
                },
                { role: "quit" },
              ],
            },
          ],
    ),
  );
  window = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: "#212121",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    ...(process.platform === "win32"
      ? {
          titleBarOverlay: {
            color: "#2f2f2f",
            symbolColor: "#ececec",
            height: 48,
          },
        }
      : {}),
    autoHideMenuBar: true,
    title: "Keylocal",
    icon: path.join(__dirname, "../assets/icon.png"),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      devTools: !app.isPackaged,
      spellcheck: false,
    },
  });
  if (process.platform !== "darwin") window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  window.webContents.on("render-process-gone", () => vault.lock());
  window.on("close", () => vault.lock());
  registerHandlers();
  ipcMain.on("vault:activity", (event) => {
    try {
      trusted(event);
      lastActivity = Date.now();
    } catch {
      /* Ignore untrusted input. */
    }
  });
  powerMonitor.on("suspend", () => vault.lock());
  powerMonitor.on("lock-screen", () => vault.lock());
  setInterval(() => {
    if (
      vault.db &&
      (Date.now() - lastActivity >= vault.settings.autoLockMinutes * 60000 ||
        powerMonitor.getSystemIdleTime() >= vault.settings.autoLockMinutes * 60)
    )
      vault.lock();
  }, 1000).unref();
  window.once("ready-to-show", () => window.show());
  await window.loadURL(START);
}
async function appStatus() {
  const result = vault.status();
  const generation = vault.generation;
  result.biometric = await biometrics.status(result.vaultPath);
  if (generation !== vault.generation || result.vaultPath !== vault.path)
    return appStatus();
  Object.defineProperty(result, NATIVE_STATUS, { value: true });
  return result;
}
let biometricTail = Promise.resolve();
function biometricHandle(name, fn) {
  handle(name, (...args) => {
    const generation = vault.generation;
    const result = biometricTail.then(() => {
      if (generation !== vault.generation)
        throw new Error("Vault session changed; retry authentication.");
      return fn(...args);
    });
    biometricTail = result.catch(() => {});
    return result;
  });
}
function registerHandlers() {
  handle("status", appStatus);
  handle("prepareDiagnostics", () => {
    diagnosticPreview = diagnostics({
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      osRelease: require("node:os").release(),
      electron: process.versions.electron,
      node: process.versions.node,
    });
    return diagnosticPreview;
  });
  handle("exportDiagnostics", async () => {
    if (!diagnosticPreview)
      throw new Error("Preview diagnostics before saving.");
    const bytes = Buffer.from(
      JSON.stringify(diagnosticPreview, null, 2) + "\n",
    );
    const result = await dialog.showSaveDialog(window, {
      title: "Save diagnostics",
      defaultPath: "Keylocal-diagnostics.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return false;
    atomicWrite(result.filePath, bytes, true);
    return true;
  });
  handle("showAppMenu", () => {
    // Native Menu objects cannot be serialized into an IPC response.
    Menu.getApplicationMenu()?.popup({ window });
  });
  handle("setWindowTheme", (theme) => {
    if (!["dark", "light"].includes(theme)) throw new Error("Invalid theme.");
    if (process.platform === "win32")
      window.setTitleBarOverlay({
        color: theme === "dark" ? "#2f2f2f" : "#eaf0f7",
        symbolColor: theme === "dark" ? "#ececec" : "#182c43",
        height: 48,
      });
  });
  biometricHandle("enableBiometric", async (password) => {
    isUnlocked();
    const file = vault.path,
      generation = vault.generation;
    const key = await vault.biometricKey(password);
    try {
      if (generation !== vault.generation)
        throw new Error("Vault changed during enrollment.");
      await biometrics.set(file, key);
      if (generation !== vault.generation || file !== vault.path) {
        await biometrics.remove(file);
        throw new Error("Vault changed during enrollment.");
      }
      return await appStatus();
    } finally {
      key.fill(0);
    }
  });
  biometricHandle("disableBiometric", async () => {
    isUnlocked();
    await biometrics.remove(vault.path);
    return appStatus();
  });
  biometricHandle("unlockBiometric", async () => {
    if (vault.db) throw new Error("Vault is already unlocked.");
    const file = vault.path,
      generation = vault.generation;
    if (!file) throw new Error("Choose a vault first.");
    const started = performance.now();
    const key = await biometrics.get(file);
    const authenticated = performance.now();
    try {
      if (file !== vault.path || generation !== vault.generation)
        throw new Error("Vault changed during biometric unlock.");
      window.webContents.send("vault:unlock-progress", "opening");
      await vault.unlockWithBiometricKey(key, generation);
      // Timing contains durations only; no paths, identifiers or unlock material.
      const result = await appStatus();
      result.unlockTiming = {
        authenticationMs: Math.round(authenticated - started),
        decryptionMs: Math.round(performance.now() - authenticated),
      };
      return result;
    } finally {
      key.fill(0);
    }
  });
  handle("createVault", async (input) => {
    if (
      !input ||
      typeof input.name !== "string" ||
      typeof input.password !== "string"
    )
      throw new Error("Name and master password are required.");
    const name =
      input.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "").slice(0, 80) ||
      "My vault";
    const result = await dialog.showSaveDialog(window, {
      title: "Create encrypted vault",
      defaultPath: path.join(app.getPath("documents"), `${name}.kdbx`),
      filters,
    });
    if (result.canceled || !result.filePath) return null;
    return vault.create(
      result.filePath.endsWith(".kdbx")
        ? result.filePath
        : `${result.filePath}.kdbx`,
      input.name,
      input.password,
    );
  });
  handle("openVault", async () => {
    const result = await dialog.showOpenDialog(window, {
      title: "Open encrypted vault",
      filters,
      properties: ["openFile"],
    });
    return result.canceled ? null : vault.select(result.filePaths[0]);
  });
  handle("selectRecentVault", (file) => vault.selectRecent(file));
  handle("unlock", (password) => vault.unlock(password));
  handle("lock", () => vault.lock());
  handle("listItems", () => vault.list());
  handle("groups", () => vault.groups());
  handle("saveItem", (input) => vault.saveItem(input));
  handle("itemAction", (id, action) => vault.action(id, action));
  handle("revealField", (id, key) => vault.reveal(id, key));
  handle("copyField", (id, key) => copySecret(vault.reveal(id, key)));
  handle("generate", (options) => {
    isUnlocked();
    return generate(options);
  });
  handle("copyGenerated", (value) => {
    isUnlocked();
    return copySecret(value);
  });
  handle("addGroup", (name) => vault.addGroup(name));
  handle("saveSettings", (input) => {
    if (!input || typeof input !== "object" || "backupDirectory" in input)
      throw new Error("Use the folder picker to change backup location.");
    vault.applySettings(input);
    vault.config();
    return vault.status();
  });
  handle("chooseBackupDirectory", async () => {
    isUnlocked();
    const epoch = vault.generation;
    const result = await dialog.showOpenDialog(window, {
      title: "Choose external backup folder",
      properties: ["openDirectory", "createDirectory"],
    });
    isUnlocked();
    if (epoch !== vault.generation)
      throw new Error("Vault changed while choosing a folder.");
    if (!result.canceled) {
      vault.applySettings({
        backupDirectory: fs.realpathSync(result.filePaths[0]),
      });
      vault.config();
    }
    return vault.status();
  });
  handle("backupNow", () => vault.backupNow());
  handle("listBackups", () => {
    isUnlocked();
    return vault.backups();
  });
  handle("backupHealth", () => {
    isUnlocked();
    return vault.backupHealth();
  });
  handle("chooseRecoveryBackup", async () => {
    const generation = vault.generation;
    recovery.clear();
    const result = await dialog.showOpenDialog(window, {
      title: "Choose encrypted backup",
      filters,
      properties: ["openFile"],
    });
    if (result.canceled) return null;
    if (generation !== vault.generation)
      throw new Error("Vault session changed; choose the backup again.");
    return recovery.choose(result.filePaths[0]);
  });
  handle("verifyRecoveryBackup", (input) => {
    if (!input || typeof input !== "object")
      throw new Error("Choose a backup first.");
    return recovery.verify(input.token, input.password);
  });
  handle("cancelRecovery", () => {
    recovery.clear();
  });
  handle("restoreRecoveryBackup", async (token) => {
    recovery.require(token, true);
    const result = await dialog.showSaveDialog(window, {
      title: "Save recovered vault as a new file",
      defaultPath: path.join(
        app.getPath("documents"),
        `Recovered-${Date.now()}.kdbx`,
      ),
      filters,
    });
    if (result.canceled || !result.filePath) return null;
    const target = result.filePath.endsWith(".kdbx")
      ? result.filePath
      : `${result.filePath}.kdbx`;
    recovery.restore(token, target);
    return vault.select(target);
  });
  handle("importPreview", async () => {
    isUnlocked();
    const epoch = vault.generation;
    const result = await dialog.showOpenDialog(window, {
      title: "Import 1PUX or CSV export",
      filters: [{ name: "1PUX or CSV export", extensions: ["csv", "1pux"] }],
      properties: ["openFile"],
    });
    if (result.canceled) return null;
    if (epoch !== vault.generation) throw new Error("Vault changed.");
    return vault.previewImport(result.filePaths[0]);
  });
  handle("importConfirm", (token) => vault.confirmImport(token));
  handle("exportVault", async () => {
    isUnlocked();
    const epoch = vault.generation;
    const selected = await dialog.showSaveDialog(window, {
      title: "Export encrypted copy",
      defaultPath: "Keylocal-export.kdbx",
      filters,
    });
    if (selected.canceled || !selected.filePath) return false;
    isUnlocked();
    if (epoch !== vault.generation) throw new Error("Vault changed.");
    if (path.resolve(selected.filePath) === vault.path)
      throw new Error("Choose a different file from the active vault.");
    if (fs.existsSync(selected.filePath))
      throw new Error("Choose a new file name to keep existing files safe.");
    atomicWrite(selected.filePath, readFile(vault.path), true);
    return true;
  });
  biometricHandle("changePassword", async (input) => {
    if (
      !input ||
      typeof input.currentPassword !== "string" ||
      typeof input.newPassword !== "string"
    )
      throw new Error("Both passwords are required.");
    // Revoke the old device credential before changing the vault password.
    const biometric = await biometrics.status(vault.path);
    if (biometric.enabled) await biometrics.remove(vault.path);
    await vault.changePassword(input.currentPassword, input.newPassword);
  });
  handle("openUrl", async (value) => {
    isUnlocked();
    if (typeof value !== "string" || value.length > 4096)
      throw new Error("Invalid website address.");
    const url = new URL(value);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error(
        "Only HTTP/HTTPS website addresses without embedded passwords can be opened.",
      );
    await shell.openExternal(url.href);
  });
}
let quitting = false;
app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  if (vault) vault.lock();
  clearClipboard()
    .catch(() => {})
    .finally(() => app.quit());
});
app.on("window-all-closed", () => app.quit());
