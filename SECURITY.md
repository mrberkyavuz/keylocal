# Security model

Keylocal 0.4.2 is an unaudited alpha. Report a suspected issue privately to the repository maintainer using GitHub private vulnerability reporting when enabled. Do not include real passwords, vault files or recovery information in a public issue.

## What is protected

- User content, including titles, usernames, URLs, notes, tags and custom fields, is inside an encrypted KDBX file. Non-secret preferences include the recently opened file paths, theme, language, lock timeout and backup folder.
- New files use KDBX 4.1 with Argon2id, 64 MiB, 3 iterations and one lane. Random salts/IVs and KDBX's encryption/authentication are supplied by kdbxweb and hash-wasm, not a home-grown cipher.
- KDBX terminal-block authentication and exact end-of-stream validation are additionally enforced. The bundled kdbxweb version omits this check for its terminating zero-length block; `electron/crypto.cjs` wraps that specific path and tests both tampering and trailing data.
- The XML parser is pinned to patched xmldom 0.9.12 via an override. A strict adapter uses the library's DOM hooks, rejects parsing warnings, disallows DTD/entity declarations, and limits XML text size. Node and UI tests exercise this adapter.
- Renderer Node access is disabled, context isolation and process sandboxing are enabled, and the preload exposes an explicit method allowlist. IPC verifies the exact main frame and custom application URL. External scripts, frames, network fetches and window creation are denied. URLs may be opened only as HTTP/HTTPS links without embedded credentials in the user's external browser.
- Packaged Electron fuses disable RunAsNode, NODE_OPTIONS, CLI inspect, and extra file:// privileges; ASAR-only loading and integrity validation are enabled.
- KDF work is bounded (Argon2 v1.3, at most 256 MiB, 20 iterations, 8 lanes; legacy AES-KDF at most 10,000,000 rounds) and selected files/import payloads are limited to 64 MiB. Some legitimate vaults with larger parameters require adjustment in another client. Authenticated compressed KDBX3/4 payloads are expanded with Node zlib and capped at 64 MiB before XML allocation. This adapter preserves the original compression setting for later saves. These limits do not constitute a proof against every malicious-file denial of service.

## Persistence and recovery

Writes use a fresh same-directory temporary file, flush it, and replace the current file without first deleting the old file. Directory flush is attempted on Unix. Windows replacement retries transient antivirus/indexer locks. A failed operation locks the session; reopening restores the last committed state. Tests inject a replacement failure and verify the previous bytes remain intact.

A per-file owner lock prevents simultaneous Keylocal writers. A hash of the last committed bytes detects outside edits before saving. This does not coordinate with every other KeePass client; a simultaneous write in the narrow check/replace interval is outside the supported single-writer usage. Network drives, cloud-synced active files and concurrent edits are not supported.

Local previous versions and optional external copies are encrypted. Restoring on a new computer requires the master password used for that backup; the backup does not include device biometric credentials. A stolen file permits offline password guessing, so a strong master password is essential. Physical file size and timestamps remain visible. Same-disk backups do not protect against disk failure/ransomware. Older backups may contain removed entries and use older master passwords. Deletion is not guaranteed physical secure erasure on SSDs, snapshots or providers' backups.

## Session and memory limits

New and changed master passwords require at least 12 characters and an offline zxcvbn score of 3; existing vault unlock is not restricted by this policy. Strength estimates are not a guarantee against guessing. The master password is not persisted. Lock drops the active database/credentials, clears pending import data, clears renderer lists/forms/reveals/generator state and conditionally clears the clipboard. In-flight encrypted saves cannot recreate an unlocked session after a lock event. JavaScript garbage collection and Chromium mean comprehensive memory zeroization cannot be guaranteed. Revealing/editing a secret necessarily exposes it transiently in renderer memory. Swap, crash dumps, process inspection, administrator/root access, a compromised OS, keyloggers and malicious same-user software are not fully prevented.

Clipboard clearing removes only the value Keylocal most recently wrote, if it is still there. Clipboard managers, clipboard history and other processes may retain copies. The app does not claim to erase those histories.

## Imports and interoperability

CSV/1PUX imports are unencrypted source files and remain on disk after import. Import uses a preview, expires after five minutes, invalidates on lock and commits the selected records in one vault save. Duplicate detection compares title, username and URLs; it does not prove that similarly named items are identical. Review the report. 1PUX attachments, custom icons and previous password history are not imported; warnings are displayed.

Opening an existing KDBX is different from importing it: the library keeps its native database object, including history and unknown/custom data. Compatibility has been exercised against independent PyKeePass read/write. No blanket guarantee is made for every third-party extension. Key-file, hardware challenge-response and KDBX1 `.kdb` workflows are not supported by the UI.

## Biometrics and updates

Touch ID support uses the optional pinned `keychain-store` 1.0.0 native module in a signed Mac build with the appropriate private Keychain entitlement/provisioning profile. The device-only Data Protection Keychain item requires biometric item access control (`biometryAny`, not an app-only prompt); iCloud sync is explicitly disabled. It stores the 32-byte KDBX password hash (a password-equivalent unlock credential), never the original master password. This credential still passes through the vault's existing Argon2id KDF. Enrollment verifies the current password against the disk file and confirms a protected read. Unlock material stays in the main process, temporary byte arrays are wiped, concurrent biometric/password operations are serialized, and lock-generation checks reject stale prompts. Password changes revoke the device credential first. Cancelling Touch ID leaves password unlock available.

The Keychain module uses `biometryAny`: fingerprints added later to this macOS account can also authorize access. Signing keys and matching Keychain entitlements define the allowed applications. Administrators, a compromised host or authorized same-team code remain outside the protection boundary. Native Touch ID behavior and signing have NOT been tested on a physical Mac; adapter tests use a mock Keychain and do not validate Apple's enforcement. Unsigned/unentitled builds fail closed and display password unlock. Windows Hello uses the Windows WebAuthn API with required platform user verification and PRF. Its 32-byte PRF output encrypts the KDBX password-equivalent hash with AES-256-GCM; only the authenticated ciphertext and public credential metadata are stored locally. Enrollment confirms a second assertion reproduces the same protection key. RP hash, user-presence/user-verification flags and credential ID are checked. AAD binds the wrapper to its vault path and credential. Cancellation and unsupported PRF fail closed. No DPAPI fallback is used. Windows may permit fingerprint, face or PIN; the app does not force a specific modality. Native availability has been probed locally; physical enrollment and unlock must also be checked before release.

Updates are manual in this alpha. Runtime networking is blocked. Publishers must sign/notarize installers and protect build credentials before public distribution. A GitHub source repository alone is not an independent security audit.

## Backup verification and diagnostics

Recovery is available without an existing unlocked vault. A native file picker selects an encrypted snapshot, a bounded KDBX load verifies its password/authentication, and only then can a native save dialog create a new file. Exclusive creation refuses existing targets, including the source and active vault. The verified encrypted snapshot is copied even if the original source changes later. Tokens expire after five minutes and are invalidated on cancellation, vault lock or selection change. Verification does not unlock or alter the current vault and retains no password or decrypted database in the recovery session. JavaScript memory cleanup remains subject to the limits described above.

Diagnostics are opt-in local exports, previewed before saving. The positive allow-list contains only schema, application/version, platform/architecture, OS release and Electron/Node versions. It excludes vault paths, titles, credentials, device identifiers and logs. No report is sent automatically.
