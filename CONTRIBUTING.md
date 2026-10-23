# Contributing

Start with an issue for changes to encryption, authentication, the vault format or recovery. For UI fixes and small bugs, a focused pull request is fine.

## Working on a change

1. Fork the repository, or create a branch if you have write access.
2. Install Node.js 24 and run `npm ci`.
3. Make a small change, then run `npm test` and `npm run build`.
4. For desktop behavior, run `npm run test:ui` on Windows. Use a temporary vault with fictional records.
5. Open a pull request explaining the problem, the change and what you tested. Mention anything you could not test.

Never commit vaults, exports, real passwords, private keys, signing credentials or personal screenshots. Report security issues privately; see SECURITY.md.

## Windows Hello

Use Windows 11 with WebAuthn API 8 or newer and configured Hello. Test only a temporary vault: enrollment, both native prompts, cancellation, incorrect master password, restart, unlocking, disabling, password changes and locking during a prompt. Fingerprint, face and PIN availability are controlled by Windows. `node tests/hello-ui-smoke.cjs` exercises the interface with a mocked provider and never authenticates a real user.

## Testing on a Mac

Build with `npm run pack:mac`. Check startup, vault creation and reopening, edits, backups, imports, clipboard clearing, window controls, sleep and screen-lock behavior. Test Apple Silicon and Intel where available and report the macOS version and architecture.

Touch ID needs a properly signed and provisioned app with Keychain access. Follow docs/RELEASING.md. An unsigned build must keep password unlock available and must not pretend Touch ID is enabled. Test success, cancellation, lockout, missing fingerprints, locking during a prompt, password changes and upgrades. Mock tests do not prove native enforcement.

## Collaborator access

The owner can invite a contributor from **Settings → Collaborators → Add people** using their GitHub username. Write access is enough for branches and pull requests; admin access is unnecessary. Use pull requests for changes to main. Being listed as a contributor happens automatically once a commit is merged; it does not require access to signing keys or production vaults.
