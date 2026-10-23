export type ItemType = "login" | "note" | "card" | "identity" | "api" | "wifi";
export interface Field {
  key: string;
  value: string;
  secret: boolean;
}
export interface VaultItem {
  id: string;
  title: string;
  type: ItemType;
  username: string;
  urls: string[];
  notes: string;
  tags: string[];
  group: string;
  favorite: boolean;
  archived: boolean;
  deleted: boolean;
  updatedAt: string;
  fields: Field[];
  hasPassword: boolean;
  strength: number;
  reused: boolean;
  historyCount: number;
}
export interface ItemDraft {
  id?: string;
  title: string;
  type: ItemType;
  username: string;
  urls: string[];
  notes: string;
  tags: string[];
  group: string;
  favorite: boolean;
  fields: Field[];
  password?: string;
}
export interface Settings {
  autoLockMinutes: number;
  clipboardSeconds: number;
  theme: "dark" | "light" | "system";
  language: "en" | "tr";
  backupDirectory: string | null;
}
export interface AppStatus {
  appName: string;
  version: string;
  platform: string;
  locked: boolean;
  vaultPath: string | null;
  vaultName: string | null;
  unlockTiming?: { authenticationMs: number; decryptionMs: number };
  recentVaults: { path: string; name: string; available: boolean }[];
  settings: Settings;
  backupWarning: string | null;
  lastBackup: string | null;
  biometric: {
    available: boolean;
    enabled: boolean;
    label: string;
    reason: string;
  };
}
export interface BackupInfo {
  name: string;
  path: string;
  createdAt: string;
  size: number;
}
export interface RecoveryBackup {
  token: string;
  name: string;
  size: number;
}
export interface BackupHealth {
  localCopies: number;
  externalCopies: number;
  destination: "not-configured" | "available" | "unavailable";
}
export interface ImportPreview {
  token: string;
  count: number;
  skipped: number;
  duplicates: number;
  warnings: string[];
  titles: string[];
}
export interface GeneratorOptions {
  mode: "random" | "passphrase";
  length: number;
  words: number;
  numbers: boolean;
  symbols: boolean;
  avoidAmbiguous: boolean;
}
export interface VaultAPI {
  status(): Promise<AppStatus>;
  showAppMenu(): Promise<void>;
  setWindowTheme(theme: "dark" | "light"): Promise<void>;
  enableBiometric(password: string): Promise<AppStatus>;
  disableBiometric(): Promise<AppStatus>;
  unlockBiometric(): Promise<AppStatus>;
  createVault(input: {
    name: string;
    password: string;
  }): Promise<AppStatus | null>;
  openVault(): Promise<AppStatus | null>;
  selectRecentVault(path: string): Promise<AppStatus>;
  unlock(password: string): Promise<AppStatus>;
  lock(): Promise<AppStatus>;
  listItems(): Promise<VaultItem[]>;
  saveItem(draft: ItemDraft): Promise<VaultItem>;
  itemAction(
    id: string,
    action: "favorite" | "archive" | "trash" | "restore" | "delete",
  ): Promise<void>;
  revealField(id: string, key: string): Promise<string>;
  copyField(id: string, key: string): Promise<void>;
  generate(
    options: GeneratorOptions,
  ): Promise<{ value: string; strength: number }>;
  copyGenerated(value: string): Promise<void>;
  addGroup(name: string): Promise<string[]>;
  groups(): Promise<string[]>;
  saveSettings(settings: Partial<Settings>): Promise<AppStatus>;
  chooseBackupDirectory(): Promise<AppStatus>;
  backupNow(): Promise<BackupInfo | null>;
  listBackups(): Promise<BackupInfo[]>;
  backupHealth(): Promise<BackupHealth>;
  chooseRecoveryBackup(): Promise<RecoveryBackup | null>;
  verifyRecoveryBackup(input: {
    token: string;
    password: string;
  }): Promise<{ verified: boolean; checkedAt: string }>;
  restoreRecoveryBackup(token: string): Promise<AppStatus | null>;
  cancelRecovery(): Promise<void>;
  prepareDiagnostics(): Promise<Record<string, string | number>>;
  exportDiagnostics(): Promise<boolean>;
  importPreview(): Promise<ImportPreview | null>;
  importConfirm(token: string): Promise<{ imported: number; skipped: number }>;
  exportVault(): Promise<boolean>;
  changePassword(input: {
    currentPassword: string;
    newPassword: string;
  }): Promise<void>;
  openUrl(url: string): Promise<void>;
  activity(): void;
  onLocked(callback: () => void): () => void;
  onUnlockProgress(callback: (phase: "opening") => void): () => void;
}
declare global {
  interface Window {
    vault?: VaultAPI;
  }
}
export const api = window.vault as VaultAPI;
