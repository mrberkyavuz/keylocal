"use strict";
// A positive allow-list, never a dump of status, settings, paths or logs.
function diagnostics({ version, platform, arch, osRelease, electron, node }) {
  return {
    schema: 1,
    application: "Keylocal",
    version,
    platform,
    architecture: arch,
    osRelease,
    electron,
    node,
  };
}
module.exports = { diagnostics };
