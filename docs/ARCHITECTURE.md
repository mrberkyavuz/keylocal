# Architecture decisions

## Desktop shell

Keylocal uses Electron, React and TypeScript. The trusted main process owns vault access, encryption, native authentication and filesystem operations. The renderer handles the interface through a restricted preload bridge. Vaults use the portable KDBX format through kdbxweb and hash-wasm. Electron and JavaScript do not provide guaranteed memory zeroization.

No local HTTP server, Node integration in the renderer, database service, or mandatory online account is used. The application registers a restricted `keylocal://app/` protocol for bundled assets. `preload.cjs` maps named operations to IPC; the renderer cannot supply arbitrary filesystem paths. Native dialogs select paths in the trusted process.

## Data model

One open KDBX file per application instance. KDBX groups are organizational, not separate security boundaries. New files start with Personal/Work groups. Standard fields are Title, UserName, Password, URL and Notes. Additional secret fields use KDBX ProtectedValue. Tags/history use standard KDBX structures. Type/favorite/archive/trash state uses `Keylocal.*` encrypted fields.

`listItems()` returns metadata and strength/reuse indicators. Passwords and protected custom values are retrieved only by explicit reveal/copy operations. KDBX content is fully encrypted at rest, including the metadata. Unlocked search occurs in renderer memory; no disk search index is written.

## Concurrency

Mutations queue in the main process. Each async mutation captures a session generation and refuses to commit after lock/switch. File hashes and exclusive Keylocal lock files provide single-writer checks. Synchronous replacement keeps the final check and local write in one main-process turn. Failed mutations discard the live state by locking; success is shown only after the file is saved.

## Backup policy

Each committed edit stores the prior encrypted state under userData/backups/<hash-of-path>. The application keeps 20 local versions during saves and 30 automatic external versions. External directory is user-selected; failed external copies yield a warning after the local save succeeds. Restore copies a selected backup to a new destination instead of replacing the live file.

## Dependency safety

Lockfile pins the full tree. Patched xmldom is selected explicitly, with the strict DOM-hook adapter tested on real KDBX files. The build-time roarr override removes a vulnerable transitive sprintf dependency without downgrading electron-builder to a release with known archive-tool vulnerabilities. Run `npm audit` whenever changing dependencies.

## Scope not implemented

Browser integration, TOTP generation, attachments, automatic updates, shared vaults, device synchronization and a forgotten-password recovery key. Each needs its own design and platform validation. This release must not show fake success states for them.

## Touch ID integration

`electron/biometric.cjs` owns the device-only Data Protection Keychain adapter. The main process verifies the master password before enrolling the KDBX password-equivalent hash, which never crosses renderer IPC. Item ACL enforces biometrics. Native support is loaded only on a packaged Mac and errors fail closed. Authentication and password changes are serialized, stale prompts cannot cross lock generations, and temporary key bytes are wiped. See SECURITY.md for biometryAny behavior and docs/RELEASING.md for signing requirements. Physical Mac verification is outstanding.

## Windows Hello

`windows-webauthn.cjs` binds the system WebAuthn DLL through pinned Koffi. It requests a platform authenticator with required user verification and PRF, checks the returned RP hash and presence/verification flags, and verifies the credential identifier during unlock. `windows-hello.cjs` uses that PRF output as an AES-256-GCM wrapping key for the existing KDBX password-equivalent credential. The device record contains public credential metadata and authenticated ciphertext; vault data stays in KDBX and still passes through Argon2id.

Enrollment requires the current master password and confirms a separate assertion reproduces the same key. Native callbacks are asynchronous. Existing generation checks reject late callbacks after locking or switching vaults. Removing the local wrapper revokes application access, and the native credential is deleted where possible. Password changes revoke enrollment first. The renderer receives only capability state, never PRF output or the wrapped unlock credential. A device already enrolled shows Hello first with an explicit password fallback; no background authentication prompts are triggered automatically.
