# Building and distributing Keylocal

## Windows

On a Windows machine with Node.js 24 LTS:

```sh
npm ci
npm test
npm run build
npm run pack:win
```

The NSIS installer includes the Electron runtime and installs per user. User vault files are separate from program files and not removed on uninstall. The local alpha build is unsigned. For a public release, configure an appropriate Windows code-signing certificate/service in your secure build environment. Signing does not guarantee an immediate SmartScreen reputation.

## macOS

Build on a Mac (or use the included macOS GitHub runner):

```sh
npm ci
npm test
npm run build
npm run pack:mac
```

This generates Apple Silicon and Intel DMGs. Test both builds on supported real systems: installation, vault creation/opening, save/reopen, migration from Windows, suspend, screen lock, clipboard, backup/restore and upgrades. A CI build is not a substitute for hardware tests.

For public distribution use a Developer ID Application certificate and notarize with Apple. electron-builder accepts `CSC_LINK` and `CSC_KEY_PASSWORD` for a signing identity. Notarization requires Apple credentials stored in the CI secret store and the appropriate electron-builder notarization configuration. Do not put credentials/certificates in this repository. Test signing and notarization before claiming a verified publisher.

## GitHub workflow

The included `build.yml` runs tests, audits production dependencies, compiles the UI and creates platform-specific packages as workflow artifacts. It can be run manually or on a version tag. It does not publish a GitHub release automatically. Default CI artifacts are unsigned (`CSC_IDENTITY_AUTO_DISCOVERY=false`); publishers must add signing before public distribution.

Before publishing:

1. Review source and tests; enable private security reporting.
2. Review dependency licenses and audit results.
3. Check Windows and Mac installation with a non-developer user.
4. Review independent security findings and document unresolved risks.
5. Produce SHA-256 checksums and attach them with installer artifacts.
6. Publish honest platform verification notes; no untested biometric/autofill claims.

## Source archive

Publish source, lockfile, tests, original icon assets and docs. Exclude node_modules, dist, release directories, working profiles, logs, vaults, backups, exports and local certificate/signing material. The supplied source ZIP follows these exclusions.

## Touch ID release requirements

The optional `keychain-store` 1.0.0 package includes arm64/x64 Node-API binaries and is unpacked from ASAR by the builder. On a Mac, `npm ci --include=optional` must install it. Verify its native binaries are signed with the app. The unsigned default CI build intentionally cannot enable Touch ID.

For a Touch ID release, use a stable Apple Developer identity and provisioning profile allowing Keychain Sharing for `TEAMID.app.keylocal.desktop`. Supply a local entitlements plist containing `com.apple.application-identifier` = `TEAMID.app.keylocal.desktop`, `com.apple.developer.team-identifier` = `TEAMID`, `keychain-access-groups` = `[TEAMID.app.keylocal.desktop]`, and Electron's required JIT entitlements. Pass its absolute path with `--config.mac.entitlements=/path/to/main.entitlements.plist` and the profile with `--config.mac.provisioningProfile=/path/to/profile.provisionprofile`; sign/notarize using the builder's supported credential configuration. Never commit profiles, private keys or credentials.

Before enabling public claims, test a real signed build on Intel and Apple Silicon Macs: enrollment with correct/wrong master password; Touch ID success/cancel/lockout; no enrolled fingerprints; sleep/lock during a prompt; relaunch; switching vaults; password change revocation; disabling; app upgrade with the same identity; missing entitlements; and uninstall/reinstall. Verify in Keychain that the item is local, device-only and has biometric access control. Fingerprint enrollment changes do not revoke `biometryAny` items. A Mac hardware test remains required.
