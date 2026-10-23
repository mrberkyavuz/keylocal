"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { createHash, randomUUID } = require("node:crypto");
const { kdbx, strength } = require("./crypto.cjs");
const Papa = require("papaparse");
const MAX_FILE = 64 * 1024 * 1024;
const TYPES = new Set(["login", "note", "card", "identity", "api", "wifi"]);
const RESERVED = new Set([
  "Title",
  "UserName",
  "Password",
  "URL",
  "Notes",
  "Keylocal.Type",
  "Keylocal.Group",
  "Keylocal.Favorite",
  "Keylocal.Archived",
  "Keylocal.Deleted",
]);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const arrayBuffer = (value) =>
  value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
const get = (entry, key) => {
  const v = entry.fields.get(key);
  return v instanceof kdbx.ProtectedValue ? v.getText() : String(v || "");
};
function text(value, max = 65536) {
  if (typeof value !== "string" || value.length > max)
    throw new Error("Invalid or oversized text field.");
  return value;
}
function readFile(file) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > MAX_FILE)
    throw new Error("Vault or import file exceeds the 64 MiB limit.");
  return fs.readFileSync(file);
}
function syncDirectory(dir) {
  if (process.platform !== "win32") {
    const fd = fs.openSync(dir, "r");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  }
}
function atomicWrite(file, buffer, exclusive = false) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const temp = path.join(dir, `.${path.basename(file)}.${randomUUID()}.tmp`);
  let fd;
  try {
    fd = fs.openSync(temp, "wx", 0o600);
    fs.writeFileSync(fd, buffer);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    if (exclusive) {
      fs.linkSync(temp, file);
      fs.unlinkSync(temp);
    } else {
      // Antivirus/indexer handles can briefly block atomic replacement on Windows.
      // Retry replacement only; never unlink the previous valid vault as a fallback.
      for (let attempt = 0; ; attempt++) {
        try {
          fs.renameSync(temp, file);
          break;
        } catch (error) {
          if (
            process.platform !== "win32" ||
            !["EPERM", "EBUSY", "EACCES"].includes(error.code) ||
            attempt >= 12
          )
            throw error;
          Atomics.wait(
            new Int32Array(new SharedArrayBuffer(4)),
            0,
            0,
            Math.min(20 * 2 ** attempt, 200),
          );
        }
      }
    }
    syncDirectory(dir);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
}
class VaultService {
  constructor(dataDir, onLock = () => {}) {
    this.dataDir = dataDir;
    this.onLock = onLock;
    this.db = null;
    this.path = null;
    this.name = null;
    this.bytesHash = null;
    this.generation = 0;
    this.tail = Promise.resolve();
    this.pendingImport = null;
    this.fileLock = null;
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.settings = {
      autoLockMinutes: 5,
      clipboardSeconds: 30,
      theme: "dark",
      language: "en",
      backupDirectory: null,
    };
    this.lastBackup = null;
    this.backupWarning = null;
    this.backupTimes = {};
    this.recentVaults = [];
    const config = path.join(dataDir, "settings.json");
    try {
      const v = JSON.parse(fs.readFileSync(config, "utf8"));
      this.path = typeof v.lastVault === "string" ? v.lastVault : null;
      this.recentVaults = [
        ...new Set([
          this.path,
          ...(Array.isArray(v.recentVaults) ? v.recentVaults : []),
        ]),
      ].filter(
        (file) =>
          typeof file === "string" &&
          file.length <= 4096 &&
          path.isAbsolute(file),
      );
      try {
        this.applySettings(v.settings || {});
      } catch {
        /* Preserve remembered vaults if a preference is invalid. */
      }
      this.backupTimes =
        v.backupTimes && typeof v.backupTimes === "object" ? v.backupTimes : {};
      this.lastBackup = this.path
        ? this.backupTimes[hash(this.path)] || null
        : null;
    } catch {
      /* Missing preferences never prevent vault access. */
    }
  }
  config() {
    if (this.path)
      this.recentVaults = [
        this.path,
        ...this.recentVaults.filter((file) => file !== this.path),
      ];
    atomicWrite(
      path.join(this.dataDir, "settings.json"),
      Buffer.from(
        JSON.stringify({
          settings: this.settings,
          lastVault: this.path,
          recentVaults: this.recentVaults,
          backupTimes: this.backupTimes,
        }),
      ),
    );
  }
  applySettings(input) {
    if (input.autoLockMinutes !== undefined) {
      if (![1, 5, 10, 15, 30].includes(input.autoLockMinutes))
        throw new Error("Invalid lock timeout.");
      this.settings.autoLockMinutes = input.autoLockMinutes;
    }
    if (input.clipboardSeconds !== undefined) {
      if (![10, 30, 60, 90].includes(input.clipboardSeconds))
        throw new Error("Invalid clipboard timeout.");
      this.settings.clipboardSeconds = input.clipboardSeconds;
    }
    if (input.theme !== undefined) {
      if (!["dark", "light", "system"].includes(input.theme))
        throw new Error("Invalid theme.");
      this.settings.theme = input.theme;
    }
    if (input.language !== undefined) {
      if (!["en", "tr"].includes(input.language))
        throw new Error("Invalid language.");
      this.settings.language = input.language;
    }
    if (input.backupDirectory !== undefined) {
      const dir =
        input.backupDirectory === null
          ? null
          : text(input.backupDirectory, 4096);
      if (dir !== this.settings.backupDirectory) {
        this.lastBackup = null;
        this.backupTimes = {};
      }
      this.settings.backupDirectory = dir;
    }
  }
  status() {
    return {
      appName: "Keylocal",
      version: require("../package.json").version,
      platform: process.platform,
      locked: !this.db,
      vaultPath: this.path,
      vaultName: this.name,
      recentVaults: this.recentVaults.map((file) => ({
        path: file,
        name: path.basename(file, path.extname(file)),
        available: (() => {
          try {
            return fs.statSync(file).isFile();
          } catch {
            return false;
          }
        })(),
      })),
      settings: { ...this.settings },
      lastBackup: this.lastBackup,
      backupWarning: this.backupWarning,
      biometric: {
        available: false,
        enabled: false,
        label: process.platform === "darwin" ? "Touch ID" : "Windows Hello",
        reason:
          "Hardware-backed biometric key storage is not yet implemented. Use your master password.",
      },
    };
  }
  requireUnlocked() {
    if (!this.db) throw new Error("Vault is locked. Unlock it first.");
    return this.db;
  }
  enqueue(fn) {
    const generation = this.generation;
    const result = this.tail.then(() => {
      if (generation !== this.generation)
        throw new Error("Vault session changed; retry the operation.");
      return fn();
    });
    this.tail = result.catch(() => {});
    return result;
  }
  acquire(file) {
    const lockFile = `${file}.keylocal-lock`;
    const token = randomUUID();
    const payload = JSON.stringify({
      pid: process.pid,
      host: os.hostname(),
      token,
    });
    try {
      fs.writeFileSync(lockFile, payload, { flag: "wx", mode: 0o600 });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let old;
      try {
        old = JSON.parse(fs.readFileSync(lockFile, "utf8"));
      } catch {
        throw new Error(
          "Vault has a lock file. Close other vault applications before removing its .keylocal-lock file.",
        );
      }
      if (old.host !== os.hostname())
        throw new Error(
          "This vault may be open on another computer. Use a local copy.",
        );
      let alive = true;
      try {
        process.kill(old.pid, 0);
      } catch (e) {
        if (e.code === "ESRCH") alive = false;
      }
      if (alive)
        throw new Error(
          "This vault is already open in another Keylocal process.",
        );
      fs.unlinkSync(lockFile);
      fs.writeFileSync(lockFile, payload, { flag: "wx", mode: 0o600 });
    }
    this.fileLock = { file: lockFile, token };
  }
  release() {
    if (this.fileLock) {
      try {
        const old = JSON.parse(fs.readFileSync(this.fileLock.file, "utf8"));
        if (old.token === this.fileLock.token)
          fs.unlinkSync(this.fileLock.file);
      } catch {
        /* Another process must not lose its lock. */
      }
      this.fileLock = null;
    }
  }
  lock() {
    this.generation++;
    this.db = null;
    this.name = null;
    this.bytesHash = null;
    this.pendingImport = null;
    this.release();
    this.onLock();
    return this.status();
  }
  select(file) {
    this.lock();
    this.path = fs.realpathSync(file);
    this.lastBackup = this.backupTimes[hash(this.path)] || null;
    this.backupWarning = null;
    this.config();
    return this.status();
  }
  selectRecent(file) {
    if (typeof file !== "string" || !this.recentVaults.includes(file))
      throw new Error("Choose a remembered vault or browse for a vault file.");
    if (!fs.existsSync(file))
      throw new Error(
        "This vault was moved or is unavailable. Browse to locate it.",
      );
    return this.select(file);
  }
  credentials(password) {
    return new kdbx.Credentials(
      kdbx.ProtectedValue.fromString(text(password, 1024)),
    );
  }
  async create(file, name, password) {
    return this.enqueue(async () => {
      if (password.length < 12)
        throw new Error("Use a master password of at least 12 characters.");
      if (strength(password) < 3)
        throw new Error(
          "Use a less predictable master password, such as several random words.",
        );
      this.lock();
      const epoch = this.generation;
      name = text(name, 120).trim();
      if (!name) throw new Error("Name your vault.");
      file = path.resolve(file);
      if (fs.existsSync(file))
        throw new Error(
          "A file already exists at that location. Choose a new name.",
        );
      this.acquire(file);
      try {
        const db = kdbx.Kdbx.create(this.credentials(password), name);
        db.setVersion(4);
        db.header.versionMinor = 1;
        db.setKdf(kdbx.Consts.KdfId.Argon2id);
        db.header.kdfParameters.set(
          "M",
          kdbx.VarDictionary.ValueType.UInt64,
          kdbx.Int64.from(64 * 1024 * 1024),
        );
        db.header.kdfParameters.set(
          "I",
          kdbx.VarDictionary.ValueType.UInt64,
          kdbx.Int64.from(3),
        );
        db.header.kdfParameters.set(
          "P",
          kdbx.VarDictionary.ValueType.UInt32,
          1,
        );
        db.createGroup(db.getDefaultGroup(), "Personal");
        db.createGroup(db.getDefaultGroup(), "Work");
        const bytes = Buffer.from(await db.save());
        if (epoch !== this.generation)
          throw new Error("Vault was locked during creation.");
        atomicWrite(file, bytes, true);
        this.path = file;
        this.db = db;
        this.name = name;
        this.lastBackup = null;
        this.backupWarning = null;
        this.bytesHash = hash(bytes);
        this.config();
        return this.status();
      } catch (e) {
        this.lock();
        throw e;
      }
    });
  }
  async biometricKey(password) {
    return this.enqueue(async () => {
      const db = this.requireUnlocked();
      const epoch = this.generation;
      const bytes = readFile(this.path);
      if (hash(bytes) !== this.bytesHash)
        throw new Error(
          "Vault changed on disk. Reopen it before enabling Touch ID.",
        );
      const verified = await kdbx.Kdbx.load(
        arrayBuffer(bytes),
        this.credentials(password),
      );
      if (epoch !== this.generation || this.db !== db)
        throw new Error("Vault changed during enrollment.");
      if (db.credentials.keyFileHash || !verified.credentials.passwordHash)
        throw new Error("Touch ID requires a password-only vault.");
      return verified.credentials.passwordHash.getBinary();
    });
  }
  async unlock(password) {
    return this.unlockCredentials(this.credentials(password));
  }
  async unlockWithBiometricKey(key, expectedGeneration) {
    if (!(key instanceof Uint8Array) || key.length !== 32)
      throw new Error("Invalid unlock key.");
    const credentials = new kdbx.Credentials(null);
    await credentials.ready;
    credentials.passwordHash = kdbx.ProtectedValue.fromBinary(key);
    return this.unlockCredentials(credentials, expectedGeneration);
  }
  async unlockCredentials(credentials, expectedGeneration) {
    return this.enqueue(async () => {
      if (
        expectedGeneration !== undefined &&
        expectedGeneration !== this.generation
      )
        throw new Error("Vault changed during biometric unlock.");
      if (!this.path) throw new Error("Choose a vault file first.");
      if (this.db) return this.status();
      const epoch = this.generation;
      this.acquire(this.path);
      try {
        const bytes = readFile(this.path);
        const db = await kdbx.Kdbx.load(arrayBuffer(bytes), credentials);
        if (epoch !== this.generation)
          throw new Error("Vault was locked during unlock.");
        this.db = db;
        this.name = db.meta.name || path.basename(this.path);
        this.bytesHash = hash(bytes);
        return this.status();
      } catch (e) {
        this.release();
        if (e.code === "InvalidKey")
          throw new Error(
            "Incorrect master password, or this vault requires an unsupported key file.",
          );
        throw e;
      }
    });
  }
  allEntries() {
    return [...this.requireUnlocked().getDefaultGroup().allEntries()];
  }
  find(id) {
    const found = this.allEntries().find((e) => e.uuid.id === id);
    if (!found) throw new Error("Item not found.");
    return found;
  }
  groupName(entry) {
    return (
      get(entry, "Keylocal.Group") ||
      (entry.parentGroup === this.db.getDefaultGroup()
        ? "Personal"
        : entry.parentGroup.name) ||
      "Personal"
    );
  }
  item(entry, reused = false) {
    const pass = get(entry, "Password");
    const fields = [];
    for (const [key, value] of entry.fields)
      if (!RESERVED.has(key) && !key.startsWith("Keylocal."))
        fields.push({
          key,
          value: value instanceof kdbx.ProtectedValue ? "" : String(value),
          secret: value instanceof kdbx.ProtectedValue,
        });
    const inRecycle = (() => {
      let g = entry.parentGroup;
      while (g) {
        if (this.db.meta.recycleBinUuid?.equals(g.uuid)) return true;
        g = g.parentGroup;
      }
      return false;
    })();
    return {
      id: entry.uuid.id,
      title: get(entry, "Title"),
      type: TYPES.has(get(entry, "Keylocal.Type"))
        ? get(entry, "Keylocal.Type")
        : "login",
      username: get(entry, "UserName"),
      urls: get(entry, "URL").split("\n").filter(Boolean),
      notes: get(entry, "Notes"),
      tags: entry.tags || [],
      group: this.groupName(entry),
      favorite: get(entry, "Keylocal.Favorite") === "true",
      archived: get(entry, "Keylocal.Archived") === "true",
      deleted: get(entry, "Keylocal.Deleted") === "true" || inRecycle,
      updatedAt: (entry.times.lastModTime || new Date()).toISOString(),
      fields,
      hasPassword: Boolean(pass),
      strength: strength(pass),
      reused,
      historyCount: entry.history.length,
    };
  }
  list() {
    const entries = this.allEntries();
    const counts = new Map();
    const summaries = entries.map((entry) => {
      const item = this.item(entry);
      const password = get(entry, "Password");
      const fingerprint = password ? hash(password) : null;
      if (fingerprint && !item.deleted && !item.archived)
        counts.set(fingerprint, (counts.get(fingerprint) || 0) + 1);
      return { item, fingerprint };
    });
    return summaries.map(({ item, fingerprint }) => ({
      ...item,
      reused: !!fingerprint && (counts.get(fingerprint) || 0) > 1,
    }));
  }
  groups() {
    const db = this.requireUnlocked(),
      root = db.getDefaultGroup();
    return [
      ...new Set([
        "Personal",
        "Work",
        ...[...root.allGroups()]
          .filter((g) => g !== root && !db.meta.recycleBinUuid?.equals(g.uuid))
          .map((g) => g.name)
          .filter(Boolean),
        ...this.allEntries().map((e) => this.groupName(e)),
      ]),
    ];
  }
  backupFolder() {
    if (!this.path) throw new Error("Choose a vault first.");
    const id = hash(this.path).slice(0, 16);
    return path.join(this.dataDir, "backups", id);
  }
  writeBackup(bytes, directory) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const file = path.join(
      directory,
      `keylocal-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.kdbx`,
    );
    atomicWrite(file, bytes, true);
    return {
      name: path.basename(file),
      path: file,
      createdAt: new Date().toISOString(),
      size: bytes.length,
    };
  }
  prune(directory, keep = 20) {
    const files = fs
      .readdirSync(directory)
      .filter((f) => /^keylocal-.*\.kdbx$/.test(f))
      .sort()
      .reverse();
    for (const f of files.slice(keep)) fs.unlinkSync(path.join(directory, f));
  }
  async persist(epoch, previous) {
    const bytes = Buffer.from(await this.requireUnlocked().save());
    if (epoch !== this.generation || !this.db)
      throw new Error("Vault locked; changes were not saved.");
    if (hash(readFile(this.path)) !== this.bytesHash)
      throw new Error(
        "Vault file changed outside Keylocal. Reopen it before editing.",
      );
    this.writeBackup(previous, this.backupFolder());
    atomicWrite(this.path, bytes);
    this.bytesHash = hash(bytes);
    try {
      this.prune(this.backupFolder());
    } catch {
      this.backupWarning =
        "The vault was saved, but old local backups could not be cleaned up.";
    }
    if (this.settings.backupDirectory) {
      try {
        this.writeBackup(bytes, this.externalFolder());
        this.lastBackup = new Date().toISOString();
        this.backupTimes[hash(this.path)] = this.lastBackup;
        this.backupWarning = null;
        this.config();
        this.prune(this.externalFolder(), 30);
      } catch {
        this.backupWarning =
          "Vault saved locally. External backup failed; reconnect your backup location and try again.";
      }
    }
  }
  mutate(fn) {
    return this.enqueue(async () => {
      this.requireUnlocked();
      const epoch = this.generation;
      const previous = readFile(this.path);
      if (hash(previous) !== this.bytesHash)
        throw new Error("Vault changed outside Keylocal. Lock and reopen it.");
      try {
        const result = fn();
        await this.persist(epoch, previous);
        return result;
      } catch (e) {
        this.lock();
        throw e;
      }
    });
  }
  async saveItem(draft) {
    return this.mutate(() => {
      if (!draft || !TYPES.has(draft.type))
        throw new Error("Choose a valid item type.");
      const title = text(draft.title, 256).trim();
      if (!title) throw new Error("An item title is required.");
      const db = this.db;
      const root = db.getDefaultGroup();
      const group = text(draft.group || "Personal", 120).trim() || "Personal";
      let target = [...root.allGroups()].find((g) => g.name === group);
      if (!target) target = db.createGroup(root, group);
      const e = draft.id
        ? this.find(text(draft.id, 128))
        : db.createEntry(target);
      if (draft.id) {
        if (this.item(e).deleted)
          throw new Error("Restore this item before editing.");
        e.pushHistory();
        db.move(e, target);
      }
      const oldSecrets = new Map(
        [...e.fields].filter(([, v]) => v instanceof kdbx.ProtectedValue),
      );
      e.fields.set("Title", title);
      e.fields.set("UserName", text(draft.username || "", 4096));
      if (draft.password !== undefined)
        e.fields.set(
          "Password",
          kdbx.ProtectedValue.fromString(text(draft.password, 4096)),
        );
      if (!Array.isArray(draft.urls) || draft.urls.length > 20)
        throw new Error("At most 20 URLs are supported.");
      e.fields.set("URL", draft.urls.map((u) => text(u, 4096)).join("\n"));
      e.fields.set("Notes", text(draft.notes || ""));
      e.fields.set("Keylocal.Type", draft.type);
      e.fields.set("Keylocal.Group", group);
      e.fields.set("Keylocal.Favorite", String(Boolean(draft.favorite)));
      if (!Array.isArray(draft.tags) || draft.tags.length > 30)
        throw new Error("At most 30 tags are supported.");
      e.tags = [
        ...new Set(draft.tags.map((t) => text(t, 100).trim()).filter(Boolean)),
      ];
      if (!Array.isArray(draft.fields) || draft.fields.length > 50)
        throw new Error("At most 50 custom fields are supported.");
      for (const key of e.fields.keys())
        if (!RESERVED.has(key) && !key.startsWith("Keylocal."))
          e.fields.delete(key);
      const seen = new Set();
      for (const field of draft.fields) {
        const key = text(field.key, 100).trim();
        if (
          !key ||
          RESERVED.has(key) ||
          key.startsWith("Keylocal.") ||
          seen.has(key)
        )
          throw new Error("Custom fields need unique names.");
        seen.add(key);
        const v = text(field.value, 65536);
        e.fields.set(
          key,
          field.secret
            ? v === "" && oldSecrets.has(key)
              ? oldSecrets.get(key)
              : kdbx.ProtectedValue.fromString(v)
            : v,
        );
      }
      e.times.update();
      if (e.history.length > 20) e.history.splice(0, e.history.length - 20);
      return this.item(e);
    });
  }
  async action(id, action) {
    return this.mutate(() => {
      const e = this.find(id);
      const info = this.item(e);
      if (action === "favorite")
        e.fields.set("Keylocal.Favorite", String(!info.favorite));
      else if (action === "archive")
        e.fields.set("Keylocal.Archived", String(!info.archived));
      else if (action === "trash") {
        e.pushHistory();
        e.fields.set("Keylocal.Deleted", "true");
      } else if (action === "restore") {
        e.fields.set("Keylocal.Deleted", "false");
        if (this.db.meta.recycleBinUuid?.equals(e.parentGroup.uuid))
          this.db.move(e, this.db.getDefaultGroup());
      } else if (action === "delete" && info.deleted) {
        this.db.move(e, null);
      } else throw new Error("Invalid item action.");
      e.times.update();
    });
  }
  async addGroup(name) {
    await this.mutate(() => {
      name = text(name, 120).trim();
      if (!name) throw new Error("Name your group.");
      if (this.groups().includes(name))
        throw new Error("A group with that name already exists.");
      this.db.createGroup(this.db.getDefaultGroup(), name);
    });
    return this.groups();
  }
  reveal(id, key) {
    const e = this.find(text(id, 128));
    key = text(key, 100);
    if (key.startsWith("Keylocal.")) throw new Error("Not a user field.");
    return get(e, key);
  }
  externalFolder() {
    if (!this.settings.backupDirectory)
      throw new Error("Choose a backup folder first.");
    if (!fs.existsSync(this.settings.backupDirectory))
      throw new Error("Backup folder is unavailable.");
    return path.join(
      this.settings.backupDirectory,
      `Keylocal-${hash(this.path).slice(0, 16)}`,
    );
  }
  backupNow() {
    return this.enqueue(async () => {
      this.requireUnlocked();
      const bytes = readFile(this.path);
      if (hash(bytes) !== this.bytesHash)
        throw new Error("Vault changed outside Keylocal. Reopen it.");
      const directory = this.settings.backupDirectory
        ? this.externalFolder()
        : this.backupFolder();
      const backup = this.writeBackup(bytes, directory);
      if (this.settings.backupDirectory) {
        this.lastBackup = new Date().toISOString();
        this.backupTimes[hash(this.path)] = this.lastBackup;
      }
      this.prune(directory, this.settings.backupDirectory ? 30 : 20);
      this.backupWarning = null;
      this.config();
      return backup;
    });
  }
  backups() {
    if (!this.path) return [];
    const folder = this.backupFolder();
    if (!fs.existsSync(folder)) return [];
    return fs
      .readdirSync(folder)
      .filter((f) => /^keylocal-.*\.kdbx$/.test(f))
      .sort()
      .reverse()
      .map((name) => {
        const file = path.join(folder, name),
          stat = fs.statSync(file);
        return {
          name,
          path: file,
          createdAt: stat.mtime.toISOString(),
          size: stat.size,
        };
      });
  }
  backupHealth() {
    this.requireUnlocked();
    const health = {
      localCopies: this.backups().length,
      externalCopies: 0,
      destination: "not-configured",
    };
    if (!this.settings.backupDirectory) return health;
    try {
      const root = this.settings.backupDirectory;
      if (!fs.statSync(root).isDirectory()) throw new Error("Not a directory");
      fs.accessSync(root, fs.constants.R_OK);
      const folder = this.externalFolder();
      health.externalCopies = fs.existsSync(folder)
        ? fs
            .readdirSync(folder, { withFileTypes: true })
            .filter(
              (entry) =>
                entry.isFile() && /^keylocal-.*\.kdbx$/.test(entry.name),
            ).length
        : 0;
      health.destination = "available";
    } catch {
      health.destination = "unavailable";
    }
    return health;
  }
  async changePassword(currentPassword, newPassword) {
    return this.enqueue(async () => {
      this.requireUnlocked();
      if (newPassword.length < 12)
        throw new Error("Use at least 12 characters.");
      if (strength(newPassword) < 3)
        throw new Error(
          "Use a less predictable master password, such as several random words.",
        );
      const epoch = this.generation;
      const previous = readFile(this.path);
      const verified = await kdbx.Kdbx.load(
        arrayBuffer(previous),
        this.credentials(currentPassword),
      );
      if (epoch !== this.generation || !this.db)
        throw new Error("Vault was locked.");
      try {
        await verified.credentials.setPassword(
          kdbx.ProtectedValue.fromString(text(newPassword, 1024)),
        );
        this.db = verified;
        await this.persist(epoch, previous);
      } catch (e) {
        this.lock();
        throw e;
      }
    });
  }
  async previewImport(file) {
    this.requireUnlocked();
    const epoch = this.generation;
    const data = readFile(file);
    let rows = [],
      skipped = 0,
      warnings = [];
    const ext = path.extname(file).toLowerCase();
    if (ext === ".csv") {
      const parsed = Papa.parse(data.toString("utf8").replace(/^\uFEFF/, ""), {
        header: true,
        skipEmptyLines: "greedy",
        transformHeader: (h) => h.trim().toLowerCase(),
      });
      if (parsed.errors.length)
        throw new Error(
          "CSV could not be parsed cleanly. Check the header and quoting.",
        );
      const headers = parsed.meta.fields || [];
      if (
        !headers.some((k) => ["title", "name", "website"].includes(k)) ||
        !headers.some((k) =>
          ["password", "username", "url", "login_uri", "notes"].includes(k),
        )
      )
        throw new Error(
          "CSV needs title/name/website and username/password/url/notes columns.",
        );
      for (const r of parsed.data) {
        const title = r.title || r.name || r.website || r.url;
        if (!title) {
          skipped++;
          continue;
        }
        rows.push({
          title,
          type: "login",
          username: r.username || r.login_username || "",
          password: r.password || r.login_password || "",
          urls: [r.url || r.login_uri || r.website || ""].filter(Boolean),
          notes: r.notes || r.note || "",
          fields: [],
          tags: [],
          group: "Imported",
          favorite: false,
        });
      }
      const unknown = headers.filter(
        (h) =>
          ![
            "title",
            "name",
            "website",
            "username",
            "login_username",
            "password",
            "login_password",
            "url",
            "login_uri",
            "notes",
            "note",
          ].includes(h),
      );
      if (unknown.length)
        warnings.push(
          `Unmapped CSV columns: ${unknown.join(", ")}. They will not be imported.`,
        );
    } else if (ext === ".1pux") {
      ({ rows, skipped, warnings } =
        await require("./import-1pux.cjs").import1pux(file));
    } else throw new Error("Choose a CSV or 1PUX export.");
    if (epoch !== this.generation || !this.db)
      throw new Error("Vault locked during import preview.");
    if (rows.length > 10000)
      throw new Error("Import at most 10,000 records at a time.");
    const existing = new Set(
      this.allEntries().map(
        (e) =>
          `${get(e, "Title")}\u0000${get(e, "UserName")}\u0000${get(e, "URL")}`,
      ),
    );
    let duplicates = 0;
    rows = rows.filter((r) => {
      const key = `${r.title}\u0000${r.username}\u0000${r.urls.join("\n")}`;
      if (existing.has(key)) {
        duplicates++;
        return false;
      }
      existing.add(key);
      return true;
    });
    const token = randomUUID();
    this.pendingImport = {
      token,
      rows,
      skipped: skipped + duplicates,
      generation: this.generation,
      expires: Date.now() + 5 * 60000,
    };
    return {
      token,
      count: rows.length,
      skipped,
      duplicates,
      warnings,
      titles: rows.slice(0, 20).map((r) => r.title),
    };
  }
  async confirmImport(token) {
    const pending = this.pendingImport;
    this.pendingImport = null;
    if (
      !pending ||
      token !== pending.token ||
      pending.generation !== this.generation ||
      pending.expires < Date.now()
    )
      throw new Error("Import preview expired. Choose the file again.");
    return this.mutate(() => {
      for (const r of pending.rows) {
        const groupName = text(r.group || "Imported", 120);
        let group = [...this.db.getDefaultGroup().allGroups()].find(
          (g) => g.name === groupName,
        );
        if (!group)
          group = this.db.createGroup(this.db.getDefaultGroup(), groupName);
        const e = this.db.createEntry(group);
        e.fields.set("Title", text(r.title, 256));
        e.fields.set("UserName", text(r.username, 4096));
        e.fields.set(
          "Password",
          kdbx.ProtectedValue.fromString(text(r.password, 4096)),
        );
        e.fields.set("URL", r.urls.map((u) => text(u, 4096)).join("\n"));
        e.fields.set("Notes", text(r.notes));
        e.fields.set("Keylocal.Type", r.type || "login");
        e.fields.set("Keylocal.Group", groupName);
        e.fields.set("Keylocal.Favorite", String(Boolean(r.favorite)));
        e.fields.set("Keylocal.Archived", String(Boolean(r.archived)));
        e.tags = (r.tags || []).map((t) => text(t, 100));
        for (const f of r.fields || [])
          e.fields.set(
            text(f.key, 100),
            f.secret
              ? kdbx.ProtectedValue.fromString(text(f.value))
              : text(f.value),
          );
      }
      return { imported: pending.rows.length, skipped: pending.skipped };
    });
  }
}
module.exports = {
  VaultService,
  atomicWrite,
  readFile,
  hash,
  MAX_FILE,
  arrayBuffer,
};
