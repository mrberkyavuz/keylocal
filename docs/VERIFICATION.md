# Verification — Keylocal 0.2.0 alpha

Checked on Windows 11 x64, 21 October 2026. These are actual local results, not assumed CI results.

| Check                                                                | Result                                                                                                                                                          |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript strict type check                                         | Passed                                                                                                                                                          |
| Vite production build                                                | Passed                                                                                                                                                          |
| Node vault/biometric tests                                           | 29 passed, 0 failed                                                                                                                                             |
| Electron UI smoke test                                               | 13 flows passed, no page errors                                                                                                                                 |
| Independent KDBX implementation (0.1.0 engine, unchanged cipher/KDF) | PyKeePass 4.2.0 opened a Keylocal file, verified passwords/custom fields/tags/groups/favorites, rewrote it, and Keylocal reopened it with the changes preserved |
| npm dependency audit                                                 | 0 reported vulnerabilities, including development dependencies, after the final dependency changes                                                              |
| Windows NSIS package                                                 | Produced successfully, x64; per-user installation completed with exit code 0; installed EXE version 0.2.0.0                                                     |
| Packaged Windows EXE launch                                          | Passed; actual `win-unpacked/Keylocal.exe` launched                                                                                                             |
| Packaged source consistency                                          | `electron/main.cjs` extracted from app.asar matches final source                                                                                                |
| Packaged isolation                                                   | Preload status works; renderer `require` is undefined; renderer network fetch rejected                                                                          |
| Fuse inspection                                                      | RunAsNode/NODE_OPTIONS/Node inspect/file privileges disabled; embedded ASAR integrity and ASAR-only loading enabled                                             |
| Publisher signature                                                  | NotSigned (expected for this alpha)                                                                                                                             |
| macOS                                                                | Source/configuration/GitHub Actions workflow prepared; not built, signed, notarized or run on Mac locally                                                       |

## Vault tests

The original 22 vault tests cover KDBX 4.1 + Argon2id, wrong password, encrypted metadata on disk, redacted list responses, locked read rejection, preserving omitted secrets during edits, item state changes, external modification detection, refusing overwrite on create, a second writer, valid prior-state backups, failed external backup, password changes and old backups, CSV preview/duplicates, invalidating imports/in-flight saves on lock, ciphertext corruption, weak/reused passwords, generator constraints/uniqueness, settings bounds, exclusive writes, 1PUX secret/group/tag/favorite migration and warnings, terminal-block authentication/trailing data, simulated failed atomic replacement, and per-vault/destination backup status.

## UI flows

Create vault, create/save login, protected-data redaction, actual OS clipboard copy, generator, backup, Turkish preference, lock clearing renderer state and owned clipboard, wrong-password rejection, reopen, generated-password copy, preserving unrelated clipboard text, and rejecting locked IPC.

The UI test uses an isolated profile and fictional test records. It stubs native file dialogs to deterministic test paths. It does not prove every physical OS event or native installer dialog works on every machine.

## Not verified or not implemented

- No independent security audit or penetration test.
- No real Mac hardware test, Apple signing or notarization.
- Per-user installation on this Windows computer succeeded; clean-machine testing and uninstall have not been exercised.
- Physical Windows lock/suspend events have not been manually exercised on every supported machine.
- Touch ID native integration is implemented but physical Mac behavior, signing and Keychain enforcement are NOT verified here. Windows Hello, browser autofill, attachments, TOTP, synchronization and automatic updates are not implemented.
- No guarantee against a compromised OS, clipboard-history applications, all malicious-file denial-of-service inputs or forensic memory recovery.

Build/run instructions are in the README and release guide. Run the suite again after changes to the cryptography adapter, persistence, IPC, Electron version or dependencies.

## 0.2.0 validation

29 Node tests passed on Windows, including five mocked Keychain adapter tests and two actual KDBX tests for password-equivalent biometric credentials and stale-prompt rejection. The 13 existing real Electron UI flows passed. TypeScript and Vite production compilation passed. Mock adapter tests do not prove macOS native enforcement.

Desktop chrome checks passed: native menu hidden, native overlay configured, drag/no-drag regions, 900×640 layout, theme IPC validation, unavailable biometric rejection. The UI test stubs the physical OS idle counter because automated clicks do not reset it. The real application retains OS-idle locking. Packaged EXE startup passed; packaged main source matches the reviewed source.

## 0.3.0 Windows Hello

- 35 Node tests passed, including encrypted PRF wrapper round trips, cancellation cleanup, revocation, tampering, vault binding and corrupt-provider fallback.
- The local Windows native probe reported WebAuthn API 9 and a user-verifying platform authenticator available. Native struct layout and pointer marshaling tests passed.
- Existing 13 real Electron flows passed. A separate real Electron UI test with a mocked native authenticator passed enrollment, preferred unlock, master-password fallback, unlock and reset after locking.
- TypeScript and Vite builds passed. Dependency installation reported no known vulnerabilities.
- Mocked authentication does not establish physical fingerprint/PIN success. Real native enrollment and a later unlock must be completed by the device owner before claiming hardware validation.

Windows Hello crash regression (0.3.1): the synthetic native response test aborted Electron with exit code 134 before the fix and exits 0 after it. Secret bytes are copied correctly and native memory is zeroed. This test makes no authentication prompts. Run `npm run test:native` on Windows. Physical enrollment and unlock still require manual verification.

## 0.3.3 review

42 Node tests and 14 real Electron UI flows passed on Windows. Added stale queued-operation rejection, a legacy AES-KDF work limit, bounded KDBX3/4 decompression, clipboard copy confirmation and predictable-master-password rejection for new credentials. Backup recovery was exercised using a fresh profile: incorrect passwords failed and the original password succeeded. Native memory and recent-vault restart tests passed. The mocked biometric UI test also covers inline progress. Runtime dependency audit reported zero known vulnerabilities. Physical Mac enforcement remains unverified.

A 40-entry synthetic list benchmark (three measurements, median) changed from 1795 ms to 900 ms. This excludes actual Windows authentication and KDF work. Encryption cost was not reduced.

## 0.3.4 item picker

TypeScript/Vite builds and 14 existing real Electron flows passed. A focused UI check exercised all six type choices, template defaults and hidden card-number inputs, cancellation without creating records, keyboard focus/Escape, 900×640 layout, light/dark screenshots and removal on lock. Backend and cryptography were unchanged.

## 0.3.5 color and loading refinements

Navigation icons and selection states use semantic color accents in both themes. The loading ring uses a 1.6-second rotation rather than 0.7 seconds. Reduced-motion preferences now disable animation; the earlier 0.01ms duration could accelerate an infinite animation. The mocked biometric UI test verifies normal motion and a static indicator under reduced motion. All 14 desktop smoke flows and the type-picker checks passed. Changes are confined to presentation; vault and biometric enforcement were unchanged.

## 0.3.6 desktop layout and menus

The search field and primary actions share one 48px desktop command bar. Navigation and list density were adjusted without changing the window zoom. All eight native select controls were replaced by a shared themed combobox with keyboard navigation, typeahead, selected state and viewport-aware placement. A focused real Electron test covers filtering, sorting, Escape within an editor, settings persistence, 900×640 layout, light theme and popup removal on lock. The existing 14 desktop flows and six item-type checks passed.

The loading ring now completes one turn per second following user feedback. Windows authentication requests supply a single extended credential allow-list with the INTERNAL transport. Native marshaling, credential ID, required user verification, secret copying and zeroization are tested in Electron without invoking a real biometric prompt. This routing change does not establish a measured improvement in physical Windows Hello prompt latency; that requires testing the installed build on the device. The Argon2 cost and protected-key handling are unchanged.
All 42 Node tests passed after the routing change. The native Electron regression and mocked Hello UI tests passed; the latter checks the one-second animation and reduced-motion behavior.

## 0.3.7 application menu

A real Electron IPC regression test reproduced the structured-clone error before the fix. The application-menu handler now discards the native Menu.popup return value instead of sending the native object to the renderer. The focused regression passes and checks both direct IPC and the titlebar button with an isolated profile. No vault or authentication behavior changed.

## 0.4.0 recovery, backup status and privacy

50 Node tests passed, including fresh-profile recovery, wrong password, corrupt files, exclusive no-overwrite creation, verified snapshot copying after source replacement, expiry/cancellation, lock races, disconnected/reconnected backup destinations and positive-list diagnostics. The existing 14 Electron desktop flows passed.

A focused Electron UI test passed fresh-install recovery into a new file, wrong-password feedback and password-field clearing, verification before any output file, byte-identical restored/source files, non-mutating checks while another vault is open, backup status, a 900×640 recovery modal, English/Turkish privacy guidance, lock cleanup and exported diagnostics matching the visible preview. The diagnostics JSON contains only application/runtime/OS versions and platform/architecture, not vault contents, passwords, file paths, device identifiers or logs. Synthetic screenshots were reviewed. TypeScript and Vite checks passed.

The local Windows installer remains an unsigned alpha. Real Mac hardware/signing validation and independently reviewed public distribution remain outstanding. No public-release, Mac hardware or improved physical Hello latency claim is made by these tests.

## 0.4.1 remembered vault visibility

Remembered vault cards now appear on both the home and unlock screens, with the current file highlighted. The remembered list has its own bounded scroll area; the unlock form scrolls safely at smaller window sizes. Preference paths and vault contents are unchanged. The focused Electron test checks a visible card on the 900×640 unlock screen, direct selection with native file dialogs disabled, home-screen selection and persistence after restart.

## 0.4.2 complete remembered-vault list

The remembered list no longer truncates history to 20 files. A focused Electron check exercises 26 remembered paths, scrolling to select the last available vault without a file dialog, a disabled missing-file card, home/unlock visibility at 900×640 and full retention after restarting. This remembers explicitly opened or created files; it does not scan the computer for other vaults.

TypeScript and the Vite production build passed. All 50 Node tests and the focused remembered-vault Electron test passed on Windows. The Node tests required running outside the restricted sandbox because its temporary filesystem rejects the hard links used for atomic no-overwrite writes.
