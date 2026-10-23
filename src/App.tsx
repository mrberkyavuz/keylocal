import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Archive,
  ArrowDownWideNarrow,
  LayoutGrid,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Copy,
  CreditCard,
  DatabaseBackup,
  Download,
  Eye,
  EyeOff,
  FileKey,
  FileText,
  Fingerprint,
  Folder,
  Globe,
  HardDrive,
  KeyRound,
  Laptop,
  LockKeyhole,
  MoreHorizontal,
  MoreVertical,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  ShieldAlert,
  Sparkles,
  Star,
  Trash2,
  Upload,
  UserRound,
  Wifi,
  X,
} from "lucide-react";
import {
  api,
  type AppStatus,
  type BackupInfo,
  type BackupHealth,
  type RecoveryBackup,
  type Field,
  type GeneratorOptions,
  type ImportPreview,
  type ItemDraft,
  type ItemType,
  type Settings,
  type VaultItem,
} from "./api";
import { translate } from "./i18n";
import { Select } from "./Select";
import { SafetyGuide } from "./SafetyGuide";

type Translate = (text: string) => string;
const names: Record<ItemType, string> = {
  login: "Login",
  note: "Secure note",
  card: "Payment card",
  identity: "Identity",
  api: "API credential",
  wifi: "Wi-Fi",
};
const typeDescriptions: Record<ItemType, string> = {
  login: "Usernames, passwords and websites",
  note: "Private notes and important details",
  card: "Card numbers and payment details",
  identity: "Names, addresses and personal details",
  api: "Tokens and service credentials",
  wifi: "Network names and Wi-Fi passwords",
};
const icons = {
  login: KeyRound,
  note: FileText,
  card: CreditCard,
  identity: UserRound,
  api: FileKey,
  wifi: Wifi,
};
const typeKeys = Object.keys(names) as ItemType[];
const defaults: Record<ItemType, Field[]> = {
  login: [],
  note: [],
  card: [
    { key: "Cardholder", value: "", secret: false },
    { key: "Card number", value: "", secret: true },
    { key: "Expiry", value: "", secret: false },
    { key: "CVV", value: "", secret: true },
  ],
  identity: [
    { key: "Full name", value: "", secret: false },
    { key: "Address", value: "", secret: false },
    { key: "Phone", value: "", secret: false },
    { key: "Email", value: "", secret: false },
  ],
  api: [
    { key: "API key", value: "", secret: true },
    { key: "Secret", value: "", secret: true },
  ],
  wifi: [
    { key: "Network", value: "", secret: false },
    { key: "Security", value: "WPA2/WPA3", secret: false },
  ],
};
function Mark({ small = false }: { small?: boolean }) {
  return (
    <svg
      className={small ? "brand-mark small" : "brand-mark"}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
    >
      <rect x="1" y="1" width="62" height="62" rx="18" fill="#354b73" />
      <path
        d="M21 17v30M22 33l20-16M24 32l19 15"
        stroke="white"
        strokeWidth="5.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="43" cy="18" r="6" fill="#b8c9e7" />
      <circle cx="43" cy="18" r="2" fill="#263956" />
    </svg>
  );
}
function TypeIcon({ type }: { type: ItemType }) {
  const Icon = icons[type];
  return (
    <span className={`type-icon ${type}`}>
      <Icon size={22} />
    </span>
  );
}
function Modal({
  title,
  children,
  onClose,
  wide = false,
  t,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  t: Translate;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current
      ?.querySelector<HTMLElement>("input,button,select,textarea")
      ?.focus();
    const key = (e: KeyboardEvent) => {
      const layers = document.querySelectorAll(".modal-backdrop");
      if (root.current?.parentElement !== layers[layers.length - 1]) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
      if (e.key === "Tab") {
        const list = [
          ...root.current!.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
          ),
        ];
        if (!list.length) return;
        const first = list[0],
          last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop">
      <div
        ref={root}
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header>
          <h2>{title}</h2>
          <button
            className="icon-button"
            aria-label={t("Close")}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
function RecoveryDialog({
  mode,
  t,
  onClose,
  onRestored,
}: {
  mode: "restore" | "verify";
  t: Translate;
  onClose: () => void;
  onRestored: (status: AppStatus) => void;
}) {
  const [backup, setBackup] = useState<RecoveryBackup | null>(null);
  const [password, setPassword] = useState("");
  const [checked, setChecked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      api.cancelRecovery().catch(() => {});
    };
  }, []);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  return (
    <Modal
      title={t(
        mode === "restore" ? "Recover from a backup" : "Verify a backup",
      )}
      t={t}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className="modal-content recovery-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!backup || busy) return;
          const supplied = password;
          setPassword("");
          setChecked(null);
          run(async () => {
            const result = await api.verifyRecoveryBackup({
              token: backup.token,
              password: supplied,
            });
            if (alive.current && result.verified) setChecked(result.checkedAt);
          });
        }}
      >
        <p className="helper">
          {t(
            "Choose an encrypted KDBX backup and enter the master password used when it was created. Biometrics from your old device cannot unlock it here.",
          )}
        </p>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() =>
            run(async () => {
              setChecked(null);
              setBackup(null);
              setPassword("");
              const selected = await api.chooseRecoveryBackup();
              if (alive.current) setBackup(selected);
            })
          }
        >
          <Folder size={17} />
          {t("Choose backup file")}
        </button>
        {backup && (
          <>
            <p className="recovery-file">
              <DatabaseBackup size={20} />
              <span>
                <strong>{backup.name}</strong>
                <small>{(backup.size / 1024).toFixed(1)} KB</small>
              </span>
            </p>
            {!checked && (
              <label>
                {t("Backup master password")}
                <input
                  aria-label={t("Backup master password")}
                  type="password"
                  autoComplete="off"
                  maxLength={1024}
                  required
                  disabled={busy}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
            )}
            {checked ? (
              <div className="verification-success" role="status">
                <ShieldCheck size={21} />
                <div>
                  <strong>{t("Backup verified")}</strong>
                  <p>
                    {t(
                      "This encrypted copy opened successfully with the supplied password. Your current vault has not changed.",
                    )}
                  </p>
                  <small>{new Date(checked).toLocaleString()}</small>
                </div>
              </div>
            ) : (
              <button
                type="submit"
                className="primary"
                disabled={busy}
                aria-busy={busy}
              >
                {busy ? (
                  <span className="spinner" aria-hidden="true" />
                ) : (
                  <ShieldCheck size={17} />
                )}{" "}
                {t(busy ? "Verifying backup…" : "Verify backup password")}
              </button>
            )}
          </>
        )}
        {error && (
          <div className="error-box" role="alert">
            {t(error)}
          </div>
        )}
        <p className="helper">
          {t(
            "Verification applies only to the selected copy. Repeat it after creating a new backup. The selection expires after five minutes.",
          )}
        </p>
        <footer>
          <button
            className="secondary"
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            {t("Close")}
          </button>
          {mode === "restore" && checked && backup && (
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const status = await api.restoreRecoveryBackup(backup.token);
                  if (status && alive.current) onRestored(status);
                })
              }
            >
              <Download size={17} />
              {t("Save recovered vault")}
            </button>
          )}
        </footer>
      </form>
    </Modal>
  );
}
function Strength({ score, t }: { score: number; t: Translate }) {
  return (
    <span className={`strength score-${score}`}>
      <span className="strength-bars">
        {[0, 1, 2, 3].map((i) => (
          <i key={i} className={i < score ? "filled" : ""} />
        ))}
      </span>
      {t(["Weak", "Weak", "Fair", "Good", "Strong"][score] || "Weak")}
    </span>
  );
}

export default function App() {
  const [status, setStatus] = useState<AppStatus | null>(null),
    [items, setItems] = useState<VaultItem[]>([]),
    [groups, setGroups] = useState<string[]>([]),
    [selected, setSelected] = useState<string | null>(null),
    [view, setView] = useState("all"),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [sort, setSort] = useState("updated");
  const [screen, setScreen] = useState<"welcome" | "create" | "unlock">(
      "welcome",
    ),
    [master, setMaster] = useState(""),
    [confirm, setConfirm] = useState(""),
    [vaultName, setVaultName] = useState("My vault"),
    [showMaster, setShowMaster] = useState(false),
    [useMaster, setUseMaster] = useState(false);
  const [unlockPhase, setUnlockPhase] = useState<
    "" | "authenticating" | "opening"
  >("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [editor, setEditor] = useState<ItemDraft | null>(null),
    [typePicker, setTypePicker] = useState(false),
    [generator, setGenerator] = useState(false),
    [settings, setSettings] = useState(false),
    [groupModal, setGroupModal] = useState(false),
    [groupName, setGroupName] = useState(""),
    [deleteId, setDeleteId] = useState<string | null>(null),
    [preview, setPreview] = useState<ImportPreview | null>(null),
    [revealed, setRevealed] = useState<Record<string, string>>({}),
    [backups, setBackups] = useState<BackupInfo[]>([]);
  const [backupHealth, setBackupHealth] = useState<BackupHealth | null>(null);
  const [recoveryMode, setRecoveryMode] = useState<"restore" | "verify" | null>(
    null,
  );
  const search = useRef<HTMLInputElement>(null),
    epoch = useRef(0);
  const t: Translate = useCallback(
    (s) => translate(status?.settings.language || "en", s),
    [status?.settings.language],
  );
  const clear = useCallback(() => {
    epoch.current++;
    setItems([]);
    setGroups([]);
    setSelected(null);
    setEditor(null);
    setTypePicker(false);
    setGenerator(false);
    setSettings(false);
    setGroupModal(false);
    setPreview(null);
    setRevealed({});
    setQuery("");
    setMaster("");
    setUseMaster(false);
    setUnlockPhase("");
    setConfirm("");
    setDeleteId(null);
    setBackups([]);
    setBackupHealth(null);
    setRecoveryMode(null);
    setView("all");
    setToast("");
  }, []);
  const refresh = useCallback(async (provided?: AppStatus) => {
    if (!api) return;
    const e = epoch.current;
    const s = provided || (await api.status());
    if (e !== epoch.current) return;
    if (!s.locked) {
      const [all, gs] = await Promise.all([api.listItems(), api.groups()]);
      if (e !== epoch.current) return;
      setItems(all);
      setGroups(gs);
    } else setScreen(s.vaultPath ? "unlock" : "welcome");
    setStatus(s);
  }, []);
  useEffect(() => {
    if (!api) return;
    refresh().catch((e) => setError(e.message));
    return api.onLocked(() => {
      clear();
      api
        .status()
        .then((s) => {
          setStatus(s);
          setScreen(s.vaultPath ? "unlock" : "welcome");
        })
        .catch(() => {});
    });
  }, [refresh, clear]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 2600);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const theme = status?.settings.theme || "dark";
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved =
        theme === "system" ? (media.matches ? "dark" : "light") : theme;
      document.documentElement.dataset.theme = resolved;
      api?.setWindowTheme(resolved).catch(() => {});
    };
    apply();
    media.addEventListener("change", apply);
    document.documentElement.lang = status?.settings.language || "en";
    return () => media.removeEventListener("change", apply);
  }, [status?.settings.theme, status?.settings.language]);
  useEffect(() => api?.onUnlockProgress(() => setUnlockPhase("opening")), []);
  const unlockBiometric = async () => {
    const generation = epoch.current;
    setUnlockPhase("authenticating");
    try {
      const result = await api.unlockBiometric();
      if (generation !== epoch.current) return;
      setMaster("");
      await refresh(result);
    } finally {
      setUnlockPhase("");
    }
  };
  const perform = async (fn: () => Promise<unknown>, message?: string) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      if (message) setToast(t(message));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const newItem = useCallback(() => {
    if (document.querySelector(".modal-backdrop")) return;
    setRevealed({});
    setTypePicker(true);
  }, []);
  const createItem = (type: ItemType) => {
    setTypePicker(false);
    setEditor({
      title: "",
      type,
      username: "",
      urls: [],
      notes: "",
      tags: [],
      group: view.startsWith("group:") ? view.slice(6) : "Personal",
      favorite: false,
      fields: defaults[type].map((field) => ({ ...field })),
    });
  };
  const lock = useCallback(() => {
    api?.lock().catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    let last = 0;
    const activity = () => {
      if (Date.now() - last > 5000) {
        last = Date.now();
        api?.activity();
      }
    };
    const key = (e: KeyboardEvent) => {
      activity();
      if (!status || status.locked) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        search.current?.focus();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        newItem();
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "l"
      ) {
        e.preventDefault();
        lock();
      }
    };
    window.addEventListener("keydown", key);
    window.addEventListener("pointerdown", activity);
    window.addEventListener("pointermove", activity);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("pointerdown", activity);
      window.removeEventListener("pointermove", activity);
    };
  }, [status?.locked, newItem, lock]);
  useEffect(() => {
    setRevealed({});
  }, [selected, view]);
  useEffect(() => {
    if (view !== "backups" || status?.locked) return;
    let active = true;
    Promise.all([api.listBackups(), api.backupHealth()])
      .then(([copies, health]) => {
        if (active) {
          setBackups(copies);
          setBackupHealth(health);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [
    view,
    status?.locked,
    status?.settings.backupDirectory,
    status?.lastBackup,
    toast,
  ]);
  const titleBar = (
    <header
      className={`desktop-titlebar ${status?.platform === "darwin" ? "mac" : ""}`}
    >
      <div className="titlebar-brand">
        <Mark small />
        <strong>Keylocal</strong>
        <button
          className="icon-button"
          aria-label={t("Application menu")}
          onClick={() => api?.showAppMenu().catch((e) => setError(e.message))}
        >
          <MoreVertical size={18} />
        </button>
      </div>
      {status && !status.locked && (
        <div className="toolbar desktop-toolbar">
          <div className="search-box">
            <Search size={18} />
            <input
              ref={search}
              placeholder={t("Search your vault")}
              value={query}
              onChange={(e) => {
                if (["security", "backups"].includes(view)) setView("all");
                setQuery(e.target.value);
              }}
              aria-label={t("Search your vault")}
            />
            <kbd>{status?.platform === "darwin" ? "⌘" : "Ctrl"} K</kbd>
          </div>
          <button
            className="icon-button generator-button"
            title={t("Password generator")}
            aria-label={t("Password generator")}
            onClick={() => setGenerator(true)}
          >
            <Sparkles size={20} />
          </button>
          <button className="primary" onClick={newItem}>
            <Plus size={18} />
            {t("New item")}
          </button>
        </div>
      )}
    </header>
  );
  if (!api)
    return (
      <div className="welcome">
        <Mark />
        <h1>{t("Open Keylocal as a desktop app")}</h1>
        <p>
          {t(
            "This page needs the desktop application to securely access your vault.",
          )}
        </p>
      </div>
    );
  if (!status)
    return (
      <>
        {titleBar}
        <div className="welcome">
          <Mark />
          <p>{error || t("Working…")}</p>
        </div>
      </>
    );
  const current = items.find((i) => i.id === selected);
  const active = items.filter((i) => !i.deleted && !i.archived);
  const tags = [...new Set(active.flatMap((i) => i.tags))].sort();
  const visible = items
    .filter((i) =>
      view === "trash"
        ? i.deleted
        : view === "archive"
          ? i.archived && !i.deleted
          : !i.deleted && !i.archived,
    )
    .filter((i) =>
      view === "favorites"
        ? i.favorite
        : view.startsWith("group:")
          ? i.group === view.slice(6)
          : view.startsWith("tag:")
            ? i.tags.includes(view.slice(4))
            : true,
    )
    .filter((i) => filter === "all" || i.type === filter)
    .filter((i) =>
      `${i.title} ${i.username} ${i.urls.join(" ")} ${i.notes} ${i.tags.join(" ")}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
    )
    .sort((a, b) =>
      sort === "title"
        ? a.title.localeCompare(b.title)
        : b.updatedAt.localeCompare(a.updatedAt),
    );
  const select = (id: string) => {
    setSelected(id);
    if (view === "security") setView("all");
  };
  const action = (
    id: string,
    a: "favorite" | "archive" | "trash" | "restore" | "delete",
  ) =>
    perform(async () => {
      await api.itemAction(id, a);
      await refresh();
      if (a === "delete" || a === "trash" || a === "archive") setSelected(null);
    }, "Item updated");
  const copy = (id: string, key: string) =>
    perform(() => api.copyField(id, key), "Copied");
  const reveal = (id: string, key: string) => {
    const k = `${id}:${key}`;
    if (k in revealed)
      setRevealed((old) => {
        const v = { ...old };
        delete v[k];
        return v;
      });
    else
      perform(async () => {
        const e = epoch.current;
        const value = await api.revealField(id, key);
        if (e === epoch.current) setRevealed((old) => ({ ...old, [k]: value }));
      });
  };
  const importData = () =>
    perform(async () => {
      const e = epoch.current;
      const result = await api.importPreview();
      if (e === epoch.current) setPreview(result);
    });
  const nav = (v: string) => {
    setView(v);
    setSelected(null);
    setQuery("");
    setFilter("all");
  };
  const edit = (item: VaultItem) => {
    setEditor({
      id: item.id,
      title: item.title,
      type: item.type,
      username: item.username,
      urls: [...item.urls],
      notes: item.notes,
      tags: [...item.tags],
      group: item.group,
      favorite: item.favorite,
      fields: item.fields.map((f) => ({ ...f })),
    });
  };
  const mainLabel =
    view === "all"
      ? "All items"
      : view === "favorites"
        ? "Favorites"
        : view === "archive"
          ? "Archive"
          : view === "trash"
            ? "Trash"
            : view.startsWith("group:")
              ? view.slice(6)
              : view.startsWith("tag:")
                ? view.slice(4)
                : view;
  return (
    <>
      {titleBar}
      {status.locked ? (
        <div className="onboarding">
          <div className="onboarding-art">
            <div className="brand">
              <Mark small />
              <span>Keylocal</span>
            </div>
            <div className="onboarding-message">
              <div className="vault-illustration">
                <Mark />
                <span className="orbit one" />
                <span className="orbit two" />
                <LockKeyhole className="orbit-key" size={30} />
              </div>
              <h1>{t("Your keys. Your computer.")}</h1>
              <p>
                {t(
                  "A private place for everything you need to keep safe. No account. No cloud.",
                )}
              </p>
              <div className="offline-note">
                <HardDrive size={17} />
                {t("Stored locally")}
                <span />
                <ShieldCheck size={17} />
                KDBX 4.1
              </div>
            </div>
            <span className="version-mark">Keylocal {status.version}</span>
          </div>
          <main className="onboarding-form">
            <div className="setup-box">
              {screen === "welcome" ? (
                <>
                  <span className="setup-symbol">
                    <KeyRound size={30} />
                  </span>
                  {status.recentVaults?.length > 0 && (
                    <section
                      className="recent-vaults"
                      aria-label={t("Recent vaults")}
                    >
                      <h2>{t("Your vaults")}</h2>
                      <p>
                        {t(
                          "Choose a vault to unlock. Your files stay on this device.",
                        )}
                      </p>
                      {status.recentVaults.map((recent) => (
                        <button
                          key={recent.path}
                          className="secondary full recent-vault"
                          disabled={busy || !recent.available}
                          title={recent.path}
                          onClick={() =>
                            perform(async () => {
                              const s = await api.selectRecentVault(
                                recent.path,
                              );
                              setStatus(s);
                              setMaster("");
                              setUseMaster(false);
                              setScreen("unlock");
                            })
                          }
                        >
                          <LockKeyhole size={20} />
                          <span>
                            <strong>{recent.name}</strong>
                            <small>
                              {recent.available
                                ? t("Stored locally")
                                : t("File unavailable")}
                            </small>
                          </span>
                          <ArrowRight size={17} />
                        </button>
                      ))}
                    </section>
                  )}
                  <h2>{t("Your vault stays on your device.")}</h2>
                  <p>
                    {t(
                      "Add your first item or import your logins from a CSV file.",
                    )}
                  </p>
                  <button
                    className="primary full"
                    onClick={() => {
                      setError("");
                      setScreen("create");
                    }}
                  >
                    {t("Create a vault")}
                    <ArrowRight size={18} />
                  </button>
                  <button
                    className="secondary full"
                    onClick={() =>
                      perform(async () => {
                        const s = await api.openVault();
                        if (s) {
                          setStatus(s);
                          setScreen("unlock");
                        }
                      })
                    }
                  >
                    <Folder size={18} />
                    {t("Open a vault")}
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="text-button back-button"
                    onClick={() => {
                      setScreen("welcome");
                      setMaster("");
                      setConfirm("");
                      setError("");
                    }}
                  >
                    <ArrowLeft size={16} />
                    {t("Back")}
                  </button>
                  <span className="setup-symbol">
                    <LockKeyhole size={29} />
                  </span>
                  <h2>
                    {t(
                      screen === "create"
                        ? "Create a vault"
                        : "Unlock to continue",
                    )}
                  </h2>
                  {screen === "unlock" && (
                    <p className="vault-file" title={status.vaultPath || ""}>
                      {status.vaultPath?.split(/[\\/]/).pop()}
                    </p>
                  )}
                  {screen === "unlock" &&
                    status.biometric.enabled &&
                    !useMaster && (
                      <div className="hello-first">
                        <button
                          className="primary full"
                          disabled={busy || !status.biometric.available}
                          aria-busy={Boolean(unlockPhase)}
                          onClick={() => perform(unlockBiometric)}
                        >
                          {unlockPhase ? (
                            <span className="spinner" aria-hidden="true" />
                          ) : (
                            <Fingerprint size={21} />
                          )}
                          {unlockPhase
                            ? t(
                                unlockPhase === "opening"
                                  ? "Opening your vault…"
                                  : "Waiting for verification…",
                              )
                            : t(
                                status.biometric.label === "Windows Hello"
                                  ? "Unlock with Windows Hello"
                                  : "Unlock with Touch ID",
                              )}
                        </button>
                        <button
                          className="text-button full"
                          disabled={busy}
                          onClick={() => setUseMaster(true)}
                        >
                          {t("Use master password")}
                        </button>
                      </div>
                    )}
                  {(screen === "create" ||
                    !status.biometric.enabled ||
                    useMaster) && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (
                          screen === "create" &&
                          (master.length < 12 || master !== confirm)
                        ) {
                          setError(
                            t(
                              master.length < 12
                                ? "Use at least 12 characters."
                                : "Passwords do not match.",
                            ),
                          );
                          return;
                        }
                        perform(async () => {
                          const s =
                            screen === "create"
                              ? await api.createVault({
                                  name: vaultName,
                                  password: master,
                                })
                              : await api.unlock(master);
                          if (s) {
                            setMaster("");
                            setConfirm("");
                            await refresh(s);
                          }
                        });
                      }}
                    >
                      {screen === "create" && (
                        <label>
                          {t("Vault name")}
                          <input
                            autoFocus
                            value={vaultName}
                            onChange={(e) => setVaultName(e.target.value)}
                            maxLength={120}
                            required
                          />
                        </label>
                      )}
                      <label>
                        {t("Master password")}
                        <div className="password-input">
                          <input
                            autoFocus={screen === "unlock"}
                            type={showMaster ? "text" : "password"}
                            autoComplete={
                              screen === "create"
                                ? "new-password"
                                : "current-password"
                            }
                            value={master}
                            onChange={(e) => setMaster(e.target.value)}
                            maxLength={1024}
                            required
                          />
                          <button
                            type="button"
                            className="icon-button"
                            aria-label={t(
                              showMaster ? "Hide password" : "Show password",
                            )}
                            onClick={() => setShowMaster(!showMaster)}
                          >
                            {showMaster ? (
                              <EyeOff size={18} />
                            ) : (
                              <Eye size={18} />
                            )}
                          </button>
                        </div>
                      </label>
                      {screen === "create" && (
                        <>
                          <p className="helper">
                            {t(
                              "At least 12 characters. A long, unique passphrase is best.",
                            )}
                          </p>
                          <label>
                            {t("Confirm password")}
                            <input
                              type="password"
                              autoComplete="new-password"
                              value={confirm}
                              onChange={(e) => setConfirm(e.target.value)}
                              required
                              maxLength={1024}
                            />
                          </label>
                          <div className="notice">
                            <ShieldAlert size={18} />
                            {t(
                              "There is no password reset. Keep your master password somewhere safe.",
                            )}
                          </div>
                        </>
                      )}
                      <button className="primary full" disabled={busy}>
                        {t(
                          screen === "create"
                            ? "Create encrypted vault"
                            : "Unlock vault",
                        )}
                        <ArrowRight size={18} />
                      </button>
                    </form>
                  )}
                  {screen === "unlock" &&
                    useMaster &&
                    status.biometric.available &&
                    status.biometric.enabled && (
                      <button
                        className="secondary full biometric-unlock"
                        disabled={busy}
                        aria-busy={Boolean(unlockPhase)}
                        onClick={() => perform(unlockBiometric)}
                      >
                        {unlockPhase ? (
                          <span className="spinner" aria-hidden="true" />
                        ) : (
                          <Fingerprint size={20} />
                        )}
                        {unlockPhase
                          ? t(
                              unlockPhase === "opening"
                                ? "Opening your vault…"
                                : "Waiting for verification…",
                            )
                          : t(
                              status.biometric.label === "Windows Hello"
                                ? "Unlock with Windows Hello"
                                : "Unlock with Touch ID",
                            )}
                      </button>
                    )}
                  {screen === "unlock" && (
                    <button
                      className="text-button full"
                      onClick={() => {
                        setMaster("");
                        setError("");
                        setUseMaster(false);
                        setScreen("welcome");
                      }}
                    >
                      {t("Choose another vault")}
                    </button>
                  )}
                </>
              )}
              <button
                className="text-button full recovery-entry"
                disabled={busy}
                onClick={() => setRecoveryMode("restore")}
              >
                <DatabaseBackup size={16} />
                {t("Recover from a backup")}
              </button>
              {error && (
                <div className="error-box" role="alert">
                  {error}
                </div>
              )}
            </div>
          </main>
        </div>
      ) : (
        <div className="desktop-shell">
          <aside className="sidebar">
            <div className="sidebar-main">
              <div className="brand">
                <Mark small />
                <span>Keylocal</span>
              </div>
              <div className="vault-selector">
                <span className="vault-avatar">
                  {(status.vaultName || "K").slice(0, 1).toUpperCase()}
                </span>
                <div>
                  <strong>{status.vaultName}</strong>
                  <span>
                    <HardDrive size={11} />
                    {t("Stored locally")}
                  </span>
                </div>
                <button
                  aria-label={t("Open a vault")}
                  title={t("Open a vault")}
                  className="icon-button"
                  onClick={() =>
                    perform(async () => {
                      const s = await api.openVault();
                      if (s) {
                        clear();
                        setStatus(s);
                        setScreen("unlock");
                      }
                    })
                  }
                >
                  <ChevronDown size={17} />
                </button>
              </div>
              <nav aria-label="Vault">
                <Nav
                  icon={<KeyRound size={18} />}
                  tone="blue"
                  label={t("All items")}
                  active={view === "all"}
                  count={active.length}
                  onClick={() => nav("all")}
                />
                <Nav
                  icon={<Star size={18} />}
                  tone="amber"
                  label={t("Favorites")}
                  active={view === "favorites"}
                  onClick={() => nav("favorites")}
                />
                <Nav
                  icon={<ShieldCheck size={18} />}
                  tone="mint"
                  label={t("Security")}
                  active={view === "security"}
                  onClick={() => nav("security")}
                />
              </nav>
              <div className="nav-heading">
                <span>{t("Groups")}</span>
                <button
                  className="icon-button"
                  aria-label={t("New group")}
                  onClick={() => {
                    setGroupName("");
                    setGroupModal(true);
                  }}
                >
                  <Plus size={15} />
                </button>
              </div>
              <nav>
                {groups.map((g) => (
                  <Nav
                    key={g}
                    tone="amber"
                    icon={<Folder size={17} />}
                    label={t(g)}
                    active={view === `group:${g}`}
                    onClick={() => nav(`group:${g}`)}
                  />
                ))}
              </nav>
              {tags.length > 0 && (
                <>
                  <div className="nav-heading">
                    <span>{t("Tags")}</span>
                  </div>
                  <nav>
                    {tags.map((tag) => (
                      <Nav
                        key={tag}
                        tone="purple"
                        icon={<span className="tag-dot" />}
                        label={tag}
                        active={view === `tag:${tag}`}
                        onClick={() => nav(`tag:${tag}`)}
                      />
                    ))}
                  </nav>
                </>
              )}
            </div>
            <div className="sidebar-lower">
              <Nav
                icon={<Archive size={17} />}
                tone="purple"
                label={t("Archive")}
                active={view === "archive"}
                onClick={() => nav("archive")}
              />
              <Nav
                icon={<Trash2 size={17} />}
                tone="rose"
                label={t("Trash")}
                active={view === "trash"}
                onClick={() => nav("trash")}
              />
              <div className="sidebar-divider" />
              <Nav
                icon={<DatabaseBackup size={17} />}
                tone="mint"
                label={t("Backups")}
                active={view === "backups"}
                onClick={() => nav("backups")}
              />
              <Nav
                icon={<Settings2 size={17} />}
                tone="slate"
                label={t("Settings")}
                onClick={() => setSettings(true)}
              />
              <button className="lock-button" onClick={lock}>
                <LockKeyhole size={16} />
                {t("Lock vault")}
                <kbd>{status.platform === "darwin" ? "⌘" : "Ctrl"} ⇧ L</kbd>
              </button>
            </div>
          </aside>
          <div className="workspace">
            {error && (
              <div className="inline-alert" role="alert">
                <ShieldAlert size={17} />
                <span>{error}</span>
                <button
                  className="icon-button"
                  aria-label={t("Close")}
                  onClick={() => setError("")}
                >
                  <X size={16} />
                </button>
              </div>
            )}
            {status.backupWarning && (
              <div className="inline-alert warning">
                <DatabaseBackup size={17} />
                {status.backupWarning}
              </div>
            )}
            {view === "security" ? (
              <div className="page security-page">
                <div className="page-title">
                  <span className="page-symbol">
                    <ShieldCheck size={28} />
                  </span>
                  <div>
                    <h1>{t("Password health")}</h1>
                    <p>
                      {t(
                        "Checks run on this computer. No passwords are sent anywhere.",
                      )}
                    </p>
                  </div>
                </div>
                <div className="health-summary">
                  <div>
                    <ShieldAlert size={23} />
                    <strong>
                      {
                        active.filter((i) => i.hasPassword && i.strength <= 1)
                          .length
                      }
                    </strong>
                    <span>{t("Weak passwords")}</span>
                  </div>
                  <div>
                    <Copy size={23} />
                    <strong>{active.filter((i) => i.reused).length}</strong>
                    <span>{t("Reused passwords")}</span>
                  </div>
                </div>
                {active.filter(
                  (i) => (i.hasPassword && i.strength <= 1) || i.reused,
                ).length === 0 ? (
                  <div className="empty">
                    <ShieldCheck size={44} />
                    <h2>{t("No issues found")}</h2>
                    <p>
                      {t(
                        "No weak or reused passwords were found in active items. This is not a breach check.",
                      )}
                    </p>
                  </div>
                ) : (
                  <div className="health-list">
                    {active
                      .filter(
                        (i) => (i.hasPassword && i.strength <= 1) || i.reused,
                      )
                      .map((i) => (
                        <button key={i.id} onClick={() => select(i.id)}>
                          <TypeIcon type={i.type} />
                          <span>
                            <strong>{i.title}</strong>
                            <small>
                              {i.reused ? t("Reused password") : t("Weak")}
                            </small>
                          </span>
                          <ArrowRight size={18} />
                        </button>
                      ))}
                  </div>
                )}
              </div>
            ) : view === "backups" ? (
              <div className="page backup-page">
                <div className="page-title">
                  <span className="page-symbol">
                    <DatabaseBackup size={28} />
                  </span>
                  <div>
                    <h1>{t("Encrypted backups")}</h1>
                    <p>
                      {t("A backup is only useful when you can restore it.")}
                    </p>
                  </div>
                </div>
                <section className="settings-panel">
                  <div className="section-label">
                    <h2>{t("External backup")}</h2>
                    <HardDrive size={22} />
                  </div>
                  <p className="file-location">
                    {status.settings.backupDirectory || t("Not configured")}
                  </p>
                  <p className="helper" role="status">
                    {backupHealth
                      ? t(
                          backupHealth.destination === "available"
                            ? "Backup folder reachable"
                            : backupHealth.destination === "unavailable"
                              ? "Backup folder unavailable — reconnect it and try again"
                              : "Choose a separate drive for your backups",
                        )
                      : t("Checking backup location…")}
                  </p>
                  {backupHealth && (
                    <p className="helper">
                      {t("External copies")}: {backupHealth.externalCopies} ·{" "}
                      {t("Local versions")}: {backupHealth.localCopies}
                    </p>
                  )}
                  <p className="helper">
                    {t(
                      "Folder availability does not confirm that a backup can be opened. Use Verify a backup to test it with its master password.",
                    )}
                  </p>

                  <p className="muted">
                    {t("Last successful external backup")}:{" "}
                    {status.lastBackup
                      ? new Date(status.lastBackup).toLocaleString()
                      : t("Never")}
                  </p>
                  <div className="button-row">
                    <button
                      className="secondary"
                      onClick={() =>
                        perform(async () => {
                          setStatus(await api.chooseBackupDirectory());
                        })
                      }
                    >
                      <Folder size={16} />
                      {t("Choose a folder")}
                    </button>
                    <button
                      className="primary"
                      onClick={() =>
                        perform(async () => {
                          await api.backupNow();
                          await refresh();
                        }, "Backup created")
                      }
                    >
                      <DatabaseBackup size={16} />
                      {t("Back up now")}
                    </button>
                  </div>
                </section>
                <p className="explanation">
                  {t(
                    "Previous encrypted versions are saved before changes. A copy on another drive protects against disk failure.",
                  )}
                </p>
                <p className="explanation">
                  {t(
                    "The backup file alone cannot unlock your vault. Restore it on a new computer using your master password; device biometrics do not transfer. Keep your master password somewhere safe and separate from backups.",
                  )}
                </p>
                <div className="button-row">
                  <button
                    className="secondary"
                    onClick={() => setRecoveryMode("restore")}
                  >
                    <RefreshCw size={16} />
                    {t("Open a backup")}
                  </button>
                  <button
                    className="secondary"
                    onClick={() => setRecoveryMode("verify")}
                  >
                    <ShieldCheck size={16} />
                    {t("Verify a backup")}
                  </button>
                  <button
                    className="secondary"
                    onClick={() =>
                      perform(async () => {
                        if (await api.exportVault())
                          setToast(t("Encrypted copy exported"));
                      })
                    }
                  >
                    <Download size={16} />
                    {t("Export encrypted copy")}
                  </button>
                </div>
                <p className="helper">
                  {t(
                    "Restoring creates a separate vault file. Your current vault is not overwritten.",
                  )}
                </p>
                <div className="notice">
                  <ShieldAlert size={18} />
                  {t(
                    "Backups keep the master password used when they were made. A backup cannot recover a forgotten password.",
                  )}
                </div>
                <p className="helper">
                  {t(
                    "Keylocal keeps up to 20 local versions and 30 external copies. External copies are made after changes while the backup folder is connected. Reconnect it and choose Back up now to retry.",
                  )}
                </p>
                <h2 className="section-title">
                  {t("Local versions")}{" "}
                  <span className="count-pill">{backups.length}</span>
                </h2>
                {backups.length === 0 ? (
                  <p className="muted">{t("No local versions yet")}</p>
                ) : (
                  <div className="backup-list">
                    {backups.slice(0, 20).map((b) => (
                      <div key={b.path}>
                        <DatabaseBackup size={18} />
                        <span>
                          <strong>
                            {new Date(b.createdAt).toLocaleString()}
                          </strong>
                          <small>{b.name}</small>
                        </span>
                        <small>{(b.size / 1024).toFixed(1)} KB</small>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="vault-panes">
                <section className="item-list">
                  <div className="list-title">
                    <h2>{t(mainLabel)}</h2>
                    <span className="count-pill">{visible.length}</span>
                  </div>
                  <div className="list-filters">
                    <Select
                      label={t("Type")}
                      value={filter}
                      onChange={setFilter}
                      options={[
                        {
                          value: "all",
                          label: t("All types"),
                          icon: <LayoutGrid size={16} />,
                        },
                        ...typeKeys.map((k) => ({
                          value: k,
                          label: t(names[k]),
                          icon: <TypeIcon type={k} />,
                        })),
                      ]}
                    />
                    <Select
                      label={t("Sort")}
                      value={sort}
                      onChange={setSort}
                      compact
                      icon={<ArrowDownWideNarrow size={17} />}
                      options={[
                        { value: "updated", label: t("Recently updated") },
                        { value: "title", label: t("Title A–Z") },
                      ]}
                    />
                  </div>
                  <div className="item-scroll">
                    {visible.map((item) => (
                      <button
                        key={item.id}
                        className={`item-row ${selected === item.id ? "selected" : ""}`}
                        onClick={() => setSelected(item.id)}
                      >
                        <TypeIcon type={item.type} />
                        <span className="item-summary">
                          <strong>{item.title}</strong>
                          <small>{item.username || t(names[item.type])}</small>
                        </span>
                        {item.favorite && (
                          <Star
                            size={12}
                            className="star"
                            fill="currentColor"
                          />
                        )}
                      </button>
                    ))}
                    {visible.length === 0 && (
                      <div className="list-empty">
                        <Search size={28} />
                        <h3>
                          {t(query ? "No matching items" : "Nothing here yet")}
                        </h3>
                        <p>
                          {t(
                            query
                              ? "Try another search or filter."
                              : "Add your first item or import your logins from a CSV file.",
                          )}
                        </p>
                        {!query && (
                          <>
                            <button className="primary" onClick={newItem}>
                              <Plus size={16} />
                              {t("New item")}
                            </button>
                            <button
                              className="text-button"
                              onClick={importData}
                            >
                              {t("Import logins")}
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="list-footer">
                    {visible.length} {t("items")}
                    <span>
                      <LockKeyhole size={11} />
                      KDBX
                    </span>
                  </div>
                </section>
                <section className="details">
                  {current ? (
                    <>
                      <header className="detail-toolbar">
                        <span>
                          <Folder size={14} />
                          {t(current.group)}
                        </span>
                        <div className="button-row">
                          {!current.deleted && (
                            <>
                              <button
                                className="icon-button"
                                title={t(
                                  current.favorite
                                    ? "Remove favorite"
                                    : "Add favorite",
                                )}
                                aria-label={t(
                                  current.favorite
                                    ? "Remove favorite"
                                    : "Add favorite",
                                )}
                                onClick={() => action(current.id, "favorite")}
                              >
                                <Star
                                  size={18}
                                  fill={
                                    current.favorite ? "currentColor" : "none"
                                  }
                                  className={current.favorite ? "star" : ""}
                                />
                              </button>
                              <button
                                className="secondary compact"
                                onClick={() => edit(current)}
                              >
                                <FileText size={15} />
                                {t("Edit")}
                              </button>
                            </>
                          )}
                        </div>
                      </header>
                      <div className="detail-body">
                        <div className="detail-heading">
                          <TypeIcon type={current.type} />
                          <div>
                            <span className="muted">
                              {t(names[current.type])}
                            </span>
                            <h1>{current.title}</h1>
                          </div>
                        </div>
                        <div className="field-stack">
                          {current.username && (
                            <DetailField
                              label={t("Username")}
                              value={current.username}
                              onCopy={() => copy(current.id, "UserName")}
                              t={t}
                            />
                          )}
                          {current.hasPassword && (
                            <DetailField
                              label={t("Password")}
                              value={
                                revealed[`${current.id}:Password`] ||
                                "••••••••••••••"
                              }
                              secret
                              revealed={`${current.id}:Password` in revealed}
                              onReveal={() => reveal(current.id, "Password")}
                              onCopy={() => copy(current.id, "Password")}
                              t={t}
                            >
                              <Strength score={current.strength} t={t} />
                            </DetailField>
                          )}
                          {current.fields.map((f) => (
                            <DetailField
                              key={f.key}
                              label={f.key}
                              value={
                                f.secret
                                  ? revealed[`${current.id}:${f.key}`] ||
                                    "••••••••••••"
                                  : f.value || "—"
                              }
                              secret={f.secret}
                              revealed={`${current.id}:${f.key}` in revealed}
                              onReveal={() => reveal(current.id, f.key)}
                              onCopy={() => copy(current.id, f.key)}
                              t={t}
                            />
                          ))}
                          {current.urls.length > 0 && (
                            <div className="detail-field">
                              <span className="field-label">
                                {t("Websites")}
                              </span>
                              {current.urls.map((url, i) => (
                                <div key={i} className="url-row">
                                  <Globe size={15} />
                                  <button
                                    className="text-link"
                                    onClick={() =>
                                      perform(() => api.openUrl(url))
                                    }
                                  >
                                    {url}
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                          {current.notes && (
                            <div className="detail-field">
                              <span className="field-label">{t("Notes")}</span>
                              <p className="notes-text">{current.notes}</p>
                              <button
                                className="icon-button corner"
                                aria-label={t("Copy")}
                                onClick={() => copy(current.id, "Notes")}
                              >
                                <Copy size={15} />
                              </button>
                            </div>
                          )}
                        </div>
                        {current.reused && (
                          <div className="notice">
                            <ShieldAlert size={17} />
                            {t("Reused password")}
                          </div>
                        )}
                        {current.tags.length > 0 && (
                          <div className="detail-tags">
                            {current.tags.map((tag) => (
                              <button
                                key={tag}
                                onClick={() => nav(`tag:${tag}`)}
                              >
                                #{tag}
                              </button>
                            ))}
                          </div>
                        )}
                        <div className="item-meta">
                          {t("Updated")}{" "}
                          {new Date(current.updatedAt).toLocaleString()}
                          <br />
                          {current.historyCount > 0 &&
                            `${current.historyCount} saved revisions`}
                        </div>
                        <div className="detail-actions">
                          {current.deleted ? (
                            <>
                              <button
                                className="secondary"
                                onClick={() => action(current.id, "restore")}
                              >
                                <RefreshCw size={16} />
                                {t("Restore")}
                              </button>
                              <button
                                className="danger-button"
                                onClick={() => setDeleteId(current.id)}
                              >
                                <Trash2 size={16} />
                                {t("Delete permanently")}
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                className="text-button"
                                onClick={() => action(current.id, "archive")}
                              >
                                <Archive size={16} />
                                {t(current.archived ? "Unarchive" : "Archive")}
                              </button>
                              <button
                                className="text-button danger-text"
                                onClick={() => action(current.id, "trash")}
                              >
                                <Trash2 size={16} />
                                {t("Move to trash")}
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="empty detail-empty">
                      <div className="empty-key">
                        <KeyRound size={40} />
                      </div>
                      <h2>{t("Select an item")}</h2>
                      <p>{t("Your vault stays on your device.")}</p>
                      <button className="text-button" onClick={importData}>
                        <Upload size={16} />
                        {t("Import logins")}
                      </button>
                    </div>
                  )}
                </section>
              </div>
            )}
          </div>
        </div>
      )}
      {!status.locked && typePicker && (
        <Modal
          title={t("Choose item type")}
          wide
          t={t}
          onClose={() => setTypePicker(false)}
        >
          <div className="modal-content type-picker">
            <p>{t("What would you like to keep safe?")}</p>
            <div className="type-picker-grid">
              {typeKeys.map((type) => (
                <button
                  key={type}
                  className={`item-type-card ${type}`}
                  aria-label={t(names[type])}
                  onClick={() => createItem(type)}
                >
                  <TypeIcon type={type} />
                  <span className="type-card-copy">
                    <strong>{t(names[type])}</strong>
                    <small>{t(typeDescriptions[type])}</small>
                  </span>
                  <Plus
                    className="type-card-plus"
                    size={18}
                    aria-hidden="true"
                  />
                </button>
              ))}
            </div>
          </div>
        </Modal>
      )}
      {!status.locked && editor && (
        <Editor
          draft={editor}
          groups={groups}
          t={t}
          onClose={() => setEditor(null)}
          onGenerate={() => setGenerator(true)}
          onSave={(draft) =>
            perform(async () => {
              const e = epoch.current;
              const saved = await api.saveItem(draft);
              if (e !== epoch.current) return;
              await refresh();
              setSelected(saved.id);
              setView("all");
              setEditor(null);
            }, "Saved")
          }
        />
      )}
      {!status.locked && generator && (
        <Generator
          t={t}
          useInItem={Boolean(editor)}
          onClose={() => setGenerator(false)}
          onUse={(value) => {
            setEditor((old) => (old ? { ...old, password: value } : old));
            setGenerator(false);
          }}
          onError={setError}
          onCopied={() => setToast(t("Copied"))}
        />
      )}
      {!status.locked && settings && (
        <SettingsDialog
          status={status}
          t={t}
          onClose={() => setSettings(false)}
          onSave={(input) =>
            perform(
              async () => setStatus(await api.saveSettings(input)),
              "Saved",
            )
          }
          onBackup={() => {
            setSettings(false);
            nav("backups");
          }}
          onImport={() => {
            setSettings(false);
            importData();
          }}
          onExport={() =>
            perform(async () => {
              if (await api.exportVault())
                setToast(t("Encrypted copy exported"));
            })
          }
          onBiometric={async (password) => {
            const s =
              password === null
                ? await api.disableBiometric()
                : await api.enableBiometric(password);
            setStatus(s);
          }}
          onPassword={(input) =>
            perform(async () => {
              await api.changePassword(input);
              await refresh();
            }, "Password changed")
          }
        />
      )}
      {recoveryMode && (
        <RecoveryDialog
          mode={recoveryMode}
          t={t}
          onClose={() => setRecoveryMode(null)}
          onRestored={(s) => {
            clear();
            setStatus(s);
            setScreen("unlock");
          }}
        />
      )}
      {!status.locked && groupModal && (
        <Modal
          title={t("New group")}
          t={t}
          onClose={() => setGroupModal(false)}
        >
          <form
            className="modal-content"
            onSubmit={(e) => {
              e.preventDefault();
              perform(async () => {
                setGroups(await api.addGroup(groupName));
                setGroupModal(false);
              }, "Saved");
            }}
          >
            <label>
              {t("Group name")}
              <input
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                required
                maxLength={120}
              />
            </label>
            <footer>
              <button
                type="button"
                className="secondary"
                onClick={() => setGroupModal(false)}
              >
                {t("Cancel")}
              </button>
              <button className="primary" disabled={busy}>
                {t("Create group")}
              </button>
            </footer>
          </form>
        </Modal>
      )}
      {!status.locked && deleteId && (
        <Modal
          title={t("Delete this item forever?")}
          t={t}
          onClose={() => setDeleteId(null)}
        >
          <div className="modal-content">
            <p>
              {t(
                "This removes the item from this vault. Older encrypted backups may still contain it.",
              )}
            </p>
            <footer>
              <button className="secondary" onClick={() => setDeleteId(null)}>
                {t("Cancel")}
              </button>
              <button
                className="danger-button"
                onClick={() => {
                  action(deleteId, "delete");
                  setDeleteId(null);
                }}
              >
                {t("Delete permanently")}
              </button>
            </footer>
          </div>
        </Modal>
      )}
      {!status.locked && preview && (
        <Modal
          title={t("Preview import")}
          t={t}
          onClose={() => setPreview(null)}
        >
          <div className="modal-content">
            <div className="import-stats">
              <strong>{preview.count}</strong> {t("items to import")}
            </div>
            <p className="muted">
              {preview.duplicates} {t("duplicates skipped")} / {preview.skipped}{" "}
              {t("records skipped")}
            </p>
            {preview.warnings.map((w, i) => (
              <p key={i} className="notice">
                {w}
              </p>
            ))}
            <ul className="preview-titles">
              {preview.titles.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
            <footer>
              <button className="secondary" onClick={() => setPreview(null)}>
                {t("Cancel")}
              </button>
              <button
                className="primary"
                disabled={!preview.count || busy}
                onClick={() =>
                  perform(async () => {
                    await api.importConfirm(preview.token);
                    setPreview(null);
                    await refresh();
                  }, "Import complete")
                }
              >
                {t("Import")} {preview.count}
              </button>
            </footer>
          </div>
        </Modal>
      )}
      {busy && !unlockPhase && (
        <div className="busy-indicator" role="status">
          <span className="spinner" />
          {t("Working…")}
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
      {error &&
        !status.locked &&
        (editor || generator || settings || preview || groupModal) && (
          <div className="toast error-toast" role="alert">
            {error}
            <button
              className="icon-button"
              aria-label={t("Close")}
              onClick={() => setError("")}
            >
              <X size={16} />
            </button>
          </div>
        )}
    </>
  );
}
function Nav({
  icon,
  label,
  active = false,
  tone = "slate",
  count,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  tone?: "blue" | "amber" | "mint" | "purple" | "rose" | "slate";
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      className={`nav-item nav-tone-${tone} ${active ? "active" : ""}`}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
    >
      <span className="nav-icon" aria-hidden="true">
        {icon}
      </span>
      <span>{label}</span>
      {count !== undefined && <small>{count}</small>}
    </button>
  );
}
function DetailField({
  label,
  value,
  secret = false,
  revealed = false,
  onReveal,
  onCopy,
  children,
  t,
}: {
  label: string;
  value: string;
  secret?: boolean;
  revealed?: boolean;
  onReveal?: () => void;
  onCopy: () => void;
  children?: ReactNode;
  t: Translate;
}) {
  return (
    <div className="detail-field">
      <span className="field-label">{label}</span>
      <div className="field-value-row">
        <span className={secret ? "secret-value" : ""}>{value}</span>
        <div className="field-tools">
          {children}
          {secret && (
            <button
              className="icon-button"
              aria-label={t(revealed ? "Hide" : "Show")}
              onClick={onReveal}
            >
              {revealed ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          )}
          <button
            className="icon-button"
            aria-label={`${t("Copy")} ${label}`}
            onClick={onCopy}
          >
            <Copy size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

function Editor({
  draft,
  groups,
  t,
  onClose,
  onSave,
  onGenerate,
}: {
  draft: ItemDraft;
  groups: string[];
  t: Translate;
  onClose: () => void;
  onSave: (draft: ItemDraft) => void;
  onGenerate: () => void;
}) {
  const [value, setValue] = useState<ItemDraft>(() => ({
    ...draft,
    fields: draft.fields.map((f) => ({ ...f })),
  }));
  const [error, setError] = useState(""),
    [showPass, setShowPass] = useState(false),
    [passwordTouched, setPasswordTouched] = useState(
      draft.password !== undefined,
    );
  useEffect(() => {
    if (draft.password !== undefined) {
      setValue((v) => ({ ...v, password: draft.password }));
      setPasswordTouched(true);
    }
  }, [draft.password]);
  const change = <K extends keyof ItemDraft>(key: K, v: ItemDraft[K]) =>
    setValue((old) => ({ ...old, [key]: v }));
  const setField = (i: number, patch: Partial<Field>) =>
    change(
      "fields",
      value.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)),
    );
  return (
    <Modal
      title={t(draft.id ? "Edit" : "New item")}
      wide
      t={t}
      onClose={onClose}
    >
      <form
        className="modal-content editor-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!value.title.trim()) {
            setError(t("Enter a title."));
            return;
          }
          const next = { ...value };
          if (!passwordTouched) delete next.password;
          onSave(next);
        }}
      >
        <div className="editor-heading">
          <TypeIcon type={value.type} />
          <label>
            {t("Title")}
            <input
              autoFocus
              value={value.title}
              onChange={(e) => change("title", e.target.value)}
              maxLength={256}
              required
              placeholder={t("Name")}
            />
          </label>
        </div>
        <div className="form-columns">
          <label>
            {t("Type")}
            <Select
              label={t("Type")}
              value={value.type}
              onChange={(next) => {
                const type = next as ItemType;
                change("type", type);
                if (!draft.id)
                  change(
                    "fields",
                    defaults[type].map((f) => ({ ...f })),
                  );
              }}
              options={typeKeys.map((k) => ({
                value: k,
                label: t(names[k]),
                icon: <TypeIcon type={k} />,
              }))}
            />
          </label>
          <label>
            {t("Group")}
            <Select
              label={t("Group")}
              value={value.group}
              onChange={(next) => change("group", next)}
              options={[...new Set([...groups, value.group])].map((g) => ({
                value: g,
                label: t(g),
                icon: <Folder size={16} />,
              }))}
            />
          </label>
        </div>
        {value.type !== "note" && (
          <>
            <label>
              {t("Username")}
              <input
                value={value.username}
                onChange={(e) => change("username", e.target.value)}
                maxLength={4096}
                autoComplete="off"
              />
            </label>
            <label>
              {t("Password")}
              <div className="password-input">
                <input
                  aria-label={t("Password")}
                  type={showPass ? "text" : "password"}
                  value={value.password || ""}
                  placeholder={
                    draft.id
                      ? t("Leave empty to keep the current password")
                      : ""
                  }
                  onChange={(e) => {
                    change("password", e.target.value);
                    setPasswordTouched(Boolean(e.target.value) || !draft.id);
                  }}
                  maxLength={4096}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t(showPass ? "Hide" : "Show")}
                  onClick={() => setShowPass(!showPass)}
                >
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
                <button
                  className="text-button generator-trigger"
                  type="button"
                  onClick={onGenerate}
                >
                  <Sparkles size={16} />
                  {t("Generate")}
                </button>
              </div>
            </label>
            {draft.id && (
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={passwordTouched && value.password === ""}
                  onChange={(e) => {
                    setPasswordTouched(e.target.checked);
                    change("password", e.target.checked ? "" : undefined);
                  }}
                />
                {t("Clear current password")}
              </label>
            )}
          </>
        )}
        {value.type !== "note" && (
          <label>
            {t("Websites")}
            <textarea
              rows={2}
              value={value.urls.join("\n")}
              onChange={(e) => change("urls", e.target.value.split("\n"))}
              placeholder={t("One website per line")}
            />
          </label>
        )}
        {value.fields.length > 0 && (
          <div className="custom-fields">
            {value.fields.map((f, i) => (
              <div className="custom-field" key={i}>
                <input
                  aria-label={t("Field name")}
                  value={f.key}
                  onChange={(e) => setField(i, { key: e.target.value })}
                  placeholder={t("Field name")}
                  maxLength={100}
                />
                <input
                  aria-label={f.key || t("Value")}
                  type={f.secret ? "password" : "text"}
                  value={f.value}
                  onChange={(e) => setField(i, { value: e.target.value })}
                  placeholder={
                    f.secret && draft.id
                      ? t("Leave empty to keep the saved secret")
                      : t("Value")
                  }
                  autoComplete="off"
                />
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={f.secret}
                    onChange={(e) => setField(i, { secret: e.target.checked })}
                  />
                  {t("Secret")}
                </label>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t("Remove")}
                  onClick={() =>
                    change(
                      "fields",
                      value.fields.filter((_, j) => i !== j),
                    )
                  }
                >
                  <X size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
        <button
          className="text-button"
          type="button"
          onClick={() =>
            change("fields", [
              ...value.fields,
              { key: "", value: "", secret: false },
            ])
          }
        >
          <Plus size={15} />
          {t("Add field")}
        </button>
        <label>
          {t("Notes")}
          <textarea
            rows={value.type === "note" ? 7 : 3}
            value={value.notes}
            onChange={(e) => change("notes", e.target.value)}
            maxLength={65536}
          />
        </label>
        <label>
          {t("Tags")}
          <input
            value={value.tags.join(", ")}
            onChange={(e) =>
              change(
                "tags",
                e.target.value.split(",").map((s) => s.trimStart()),
              )
            }
            placeholder={t("Comma-separated tags")}
          />
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={value.favorite}
            onChange={(e) => change("favorite", e.target.checked)}
          />
          {t("Favorite")}
        </label>
        {error && (
          <div className="error-box" role="alert">
            {error}
          </div>
        )}
        <footer>
          <button className="secondary" type="button" onClick={onClose}>
            {t("Cancel")}
          </button>
          <button className="primary">{t("Save item")}</button>
        </footer>
      </form>
    </Modal>
  );
}
function Generator({
  t,
  onClose,
  onUse,
  useInItem,
  onError,
  onCopied,
}: {
  t: Translate;
  onClose: () => void;
  onUse: (value: string) => void;
  useInItem: boolean;
  onError: (s: string) => void;
  onCopied: () => void;
}) {
  const [options, setOptions] = useState<GeneratorOptions>({
      mode: "random",
      length: 24,
      words: 6,
      numbers: true,
      symbols: true,
      avoidAmbiguous: true,
    }),
    [result, setResult] = useState({ value: "", strength: 0 }),
    [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const regenerate = useCallback(async () => {
    const n = ++seq.current;
    setLoading(true);
    try {
      const r = await api!.generate(options);
      if (seq.current === n) setResult(r);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      if (seq.current === n) setLoading(false);
    }
  }, [options]);
  useEffect(() => {
    regenerate();
    return () => {
      seq.current++;
    };
  }, [regenerate]);
  return (
    <Modal title={t("Password generator")} t={t} onClose={onClose}>
      <div className="modal-content generator">
        <p className="muted">{t("A strong password starts here.")}</p>
        <div className="generated-value">{result.value || "…"}</div>
        <Strength score={result.strength} t={t} />
        <label>
          {t("Type")}
          <Select
            label={t("Type")}
            value={options.mode}
            onChange={(next) =>
              setOptions((o) => ({
                ...o,
                mode: next as "random" | "passphrase",
              }))
            }
            options={[
              { value: "random", label: t("Random password") },
              { value: "passphrase", label: t("Memorable passphrase") },
            ]}
          />
        </label>
        {options.mode === "random" ? (
          <label>
            {t("Length")} <span>{options.length}</span>
            <input
              type="range"
              min="12"
              max="128"
              value={options.length}
              onChange={(e) =>
                setOptions((o) => ({ ...o, length: Number(e.target.value) }))
              }
            />
          </label>
        ) : (
          <label>
            {t("Words")} <span>{options.words}</span>
            <input
              type="range"
              min="4"
              max="10"
              value={options.words}
              onChange={(e) =>
                setOptions((o) => ({ ...o, words: Number(e.target.value) }))
              }
            />
          </label>
        )}
        {(
          [
            "numbers",
            ...(options.mode === "random" ? ["symbols", "avoidAmbiguous"] : []),
          ] as ("numbers" | "symbols" | "avoidAmbiguous")[]
        ).map((key) => (
          <label className="switch-row" key={key}>
            {t(
              {
                numbers: "Numbers",
                symbols: "Symbols",
                avoidAmbiguous: "Avoid ambiguous characters",
              }[key],
            )}
            <input
              type="checkbox"
              role="switch"
              checked={options[key]}
              onChange={(e) =>
                setOptions((o) => ({ ...o, [key]: e.target.checked }))
              }
            />
          </label>
        ))}
        <footer>
          <button className="secondary" disabled={loading} onClick={regenerate}>
            <RefreshCw size={16} />
            {t("Regenerate")}
          </button>
          <button
            className="secondary"
            disabled={loading || !result.value}
            onClick={async () => {
              try {
                await api!.copyGenerated(result.value);
                onCopied();
              } catch (e) {
                onError((e as Error).message);
              }
            }}
          >
            <Copy size={16} />
            {t("Copy")}
          </button>
          {useInItem && (
            <button
              className="primary"
              disabled={loading || !result.value}
              onClick={() => onUse(result.value)}
            >
              {t("Use password")}
            </button>
          )}
        </footer>
      </div>
    </Modal>
  );
}
function SettingsDialog({
  status,
  t,
  onClose,
  onSave,
  onBackup,
  onImport,
  onExport,
  onPassword,
  onBiometric,
}: {
  status: AppStatus;
  t: Translate;
  onClose: () => void;
  onSave: (s: Partial<Settings>) => void;
  onBackup: () => void;
  onImport: () => void;
  onExport: () => void;
  onPassword: (input: { currentPassword: string; newPassword: string }) => void;
  onBiometric: (password: string | null) => Promise<void>;
}) {
  const [bioPassword, setBioPassword] = useState(""),
    [bioBusy, setBioBusy] = useState(false);
  const [tab, setTab] = useState("General"),
    [current, setCurrent] = useState(""),
    [next, setNext] = useState(""),
    [confirm, setConfirm] = useState(""),
    [error, setError] = useState("");
  return (
    <Modal title={t("Settings")} wide t={t} onClose={onClose}>
      <div className="settings-layout">
        <nav>
          {["General", "Security", "Backups", "Data", "Privacy", "About"].map(
            (s) => (
              <button
                key={s}
                className={tab === s ? "active" : ""}
                onClick={() => {
                  setTab(s);
                  setCurrent("");
                  setNext("");
                  setConfirm("");
                  setError("");
                }}
              >
                {t(s)}
              </button>
            ),
          )}
        </nav>
        <div className="settings-content">
          {tab === "General" ? (
            <>
              <h3>{t("Appearance")}</h3>
              <div className="segmented">
                {(["dark", "light", "system"] as const).map((theme) => (
                  <button
                    key={theme}
                    className={status.settings.theme === theme ? "active" : ""}
                    onClick={() => onSave({ theme })}
                  >
                    {t(theme[0].toUpperCase() + theme.slice(1))}
                  </button>
                ))}
              </div>
              <label>
                {t("Language")}
                <Select
                  label={t("Language")}
                  value={status.settings.language}
                  onChange={(next) => onSave({ language: next as "en" | "tr" })}
                  options={[
                    { value: "en", label: "English" },
                    { value: "tr", label: "Türkçe" },
                  ]}
                />
              </label>
            </>
          ) : tab === "Security" ? (
            <>
              <label>
                {t("Auto-lock after")}
                <Select
                  label={t("Auto-lock after")}
                  value={String(status.settings.autoLockMinutes)}
                  onChange={(next) => onSave({ autoLockMinutes: Number(next) })}
                  options={[1, 5, 10, 15, 30].map((n) => ({
                    value: String(n),
                    label: `${n} ${t("minutes")}`,
                  }))}
                />
              </label>
              <p className="helper">
                {t("Locks on sleep and when your computer locks.")}
              </p>
              <label>
                {t("Clear clipboard after")}
                <Select
                  label={t("Clear clipboard after")}
                  value={String(status.settings.clipboardSeconds)}
                  onChange={(next) =>
                    onSave({ clipboardSeconds: Number(next) })
                  }
                  options={[10, 30, 60, 90].map((n) => ({
                    value: String(n),
                    label: `${n} ${t("seconds")}`,
                  }))}
                />
              </label>
              <p className="helper">
                {t(
                  "Clipboard clears only if it still contains the copied value. Clipboard-history apps may retain copies.",
                )}
              </p>
              <div className="biometric">
                <Fingerprint size={24} />
                <div>
                  <strong>{status.biometric.label}</strong>
                  <small>{t(status.biometric.reason)}</small>
                </div>
                <LockKeyhole size={16} />
              </div>
              {status.biometric.available && (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setBioBusy(true);
                    setError("");
                    const password = bioPassword;
                    setBioPassword("");
                    try {
                      await onBiometric(
                        status.biometric.enabled ? null : password,
                      );
                    } catch (error) {
                      setError((error as Error).message);
                    } finally {
                      setBioBusy(false);
                    }
                  }}
                >
                  {!status.biometric.enabled && (
                    <label>
                      {t("Master password")}
                      <input
                        type="password"
                        autoComplete="current-password"
                        required
                        maxLength={1024}
                        value={bioPassword}
                        onChange={(e) => setBioPassword(e.target.value)}
                      />
                    </label>
                  )}
                  <button className="secondary" disabled={bioBusy}>
                    {t(
                      status.biometric.label === "Windows Hello"
                        ? status.biometric.enabled
                          ? "Disable Windows Hello"
                          : "Enable Windows Hello"
                        : status.biometric.enabled
                          ? "Disable Touch ID"
                          : "Enable Touch ID",
                    )}
                  </button>
                  <p className="helper">
                    {t(
                      "Protected by this device. Enable again after changing your master password.",
                    )}
                  </p>
                </form>
              )}
              <h3>{t("Change master password")}</h3>
              <p className="helper">
                {t("Old backups will still require your old password.")}
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (next.length < 12 || next !== confirm) {
                    setError(
                      t(
                        next.length < 12
                          ? "Use at least 12 characters."
                          : "Passwords do not match.",
                      ),
                    );
                    return;
                  }
                  onPassword({ currentPassword: current, newPassword: next });
                  setCurrent("");
                  setNext("");
                  setConfirm("");
                }}
              >
                <label>
                  {t("Current password")}
                  <input
                    type="password"
                    value={current}
                    onChange={(e) => setCurrent(e.target.value)}
                    required
                    autoComplete="current-password"
                  />
                </label>
                <label>
                  {t("New password")}
                  <input
                    type="password"
                    value={next}
                    onChange={(e) => setNext(e.target.value)}
                    required
                    autoComplete="new-password"
                  />
                </label>
                <label>
                  {t("Confirm password")}
                  <input
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    autoComplete="new-password"
                  />
                </label>
                {error && <div className="error-box">{error}</div>}
                <button className="secondary">{t("Change password")}</button>
              </form>
            </>
          ) : tab === "Backups" ? (
            <>
              <h3>{t("Encrypted backups")}</h3>
              <p>
                {t(
                  "Previous encrypted versions are saved before changes. A copy on another drive protects against disk failure.",
                )}
              </p>
              <button className="primary" onClick={onBackup}>
                <DatabaseBackup size={17} />
                {t("Backups")}
              </button>
            </>
          ) : tab === "Data" ? (
            <>
              <h3>{t("Import logins")}</h3>
              <p>
                {t(
                  "Import CSV logins or a 1PUX export. Review skipped records and attachments before importing.",
                )}
              </p>
              <button className="secondary" onClick={onImport}>
                <Upload size={17} />
                {t("Import logins")}
              </button>
              <h3>{t("Export encrypted copy")}</h3>
              <p>KDBX 4.1</p>
              <button className="secondary" onClick={onExport}>
                <Download size={17} />
                {t("Export encrypted copy")}
              </button>
            </>
          ) : tab === "Privacy" ? (
            <SafetyGuide t={t} />
          ) : (
            <div className="about">
              <Mark />
              <h2>Keylocal</h2>
              <p>
                {t("Version")} {status.version}
              </p>
              <p>
                {t(
                  "Portable KDBX vaults. No account, telemetry, or network requests.",
                )}
              </p>
              <span className="platform-pill">
                <Laptop size={16} />
                {status.platform === "win32"
                  ? "Windows"
                  : status.platform === "darwin"
                    ? "macOS"
                    : status.platform}
              </span>
              <p className="helper">MIT License</p>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
