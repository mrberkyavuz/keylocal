"use strict";
const { contextBridge, ipcRenderer } = require("electron");
const methods = [
  "status",
  "showAppMenu",
  "setWindowTheme",
  "enableBiometric",
  "disableBiometric",
  "unlockBiometric",
  "createVault",
  "openVault",
  "selectRecentVault",
  "unlock",
  "lock",
  "listItems",
  "saveItem",
  "itemAction",
  "revealField",
  "copyField",
  "generate",
  "copyGenerated",
  "addGroup",
  "groups",
  "saveSettings",
  "chooseBackupDirectory",
  "backupNow",
  "listBackups",
  "backupHealth",
  "chooseRecoveryBackup",
  "verifyRecoveryBackup",
  "restoreRecoveryBackup",
  "cancelRecovery",
  "prepareDiagnostics",
  "exportDiagnostics",
  "importPreview",
  "importConfirm",
  "exportVault",
  "changePassword",
  "openUrl",
];
const bridge = {};
for (const method of methods)
  bridge[method] = async (...args) => {
    const result = await ipcRenderer.invoke(`vault:${method}`, ...args);
    if (!result.ok) throw new Error(result.error);
    return result.value;
  };
bridge.activity = () => ipcRenderer.send("vault:activity");
bridge.onLocked = (callback) => {
  const listener = () => callback();
  ipcRenderer.on("vault:locked", listener);
  return () => ipcRenderer.removeListener("vault:locked", listener);
};
bridge.onUnlockProgress = (callback) => {
  const listener = (_event, phase) => {
    if (phase === "opening") callback(phase);
  };
  ipcRenderer.on("vault:unlock-progress", listener);
  return () => ipcRenderer.removeListener("vault:unlock-progress", listener);
};
contextBridge.exposeInMainWorld("vault", Object.freeze(bridge));
