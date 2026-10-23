"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { diagnostics } = require("../electron/diagnostics.cjs");
test("diagnostics positively allow only runtime versions, excluding personal state and secrets", () => {
  const result = diagnostics({
    version: "0.4.0",
    platform: "win32",
    arch: "x64",
    osRelease: "10.0.26100",
    electron: "45.0.0",
    node: "24.0.0",
    password: "PRIVATE-PASSWORD",
    vaultPath: "C:\\Users\\PRIVATE-NAME\\Secret.kdbx",
    logs: "PRIVATE-LOG",
    hostname: "PRIVATE-HOST",
    items: [{ title: "PRIVATE-TITLE" }],
  });
  assert.deepEqual(Object.keys(result).sort(), [
    "application",
    "architecture",
    "electron",
    "node",
    "osRelease",
    "platform",
    "schema",
    "version",
  ]);
  assert.equal(JSON.stringify(result).includes("PRIVATE"), false);
});
