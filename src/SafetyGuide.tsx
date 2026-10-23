import { useState } from "react";
import { api } from "./api";
export function SafetyGuide({ t }: { t: (text: string) => string }) {
  const [report, setReport] = useState<Record<string, string | number> | null>(
    null,
  );
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="safety-guide">
      <h3>{t("Local and private")}</h3>
      <p className="helper">
        {t(
          "Your records stay inside an encrypted KDBX file on your device. Keylocal has no accounts, telemetry or runtime network requests.",
        )}
      </p>
      <h3>{t("Keep your master password safe")}</h3>
      <p className="helper">
        {t(
          "There is no password reset. Keep a separate safe record of your master password. A backup cannot recover a forgotten password.",
        )}
      </p>
      <h3>{t("Biometrics belong to this device")}</h3>
      <p className="helper">
        {t(
          "Windows Hello and Touch ID make unlocking easier on an enrolled device. On a new computer, use the backup's master password and enroll biometrics again.",
        )}
      </p>
      <h3>{t("Prepare for a lost computer")}</h3>
      <p className="helper">
        {t(
          "Keep an encrypted backup on a separate drive and test that you can open it. A second folder on the same disk does not protect against disk failure. Older backups may use an older password.",
        )}
      </p>
      <h3>{t("Know the limits")}</h3>
      <p className="helper">
        {t(
          "Malware or a compromised operating system can capture unlocked secrets. Clipboard history and other apps may retain copied information.",
        )}
      </p>
      <p className="notice">
        {t(
          "Keylocal is an alpha and has not had an independent security audit. Open source does not mean independently audited.",
        )}
      </p>
      <h3>{t("Safe diagnostics")}</h3>
      <p className="helper">
        {t(
          "Preview a report containing only application, operating system and runtime versions. It contains no vault contents, file paths, device identifiers or logs. Nothing is sent automatically.",
        )}
      </p>
      <button
        type="button"
        className="secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMessage("");
          try {
            setReport(await api.prepareDiagnostics());
          } catch (e) {
            setMessage((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {t("Preview diagnostics")}
      </button>
      {report && (
        <>
          <pre
            className="diagnostic-preview"
            aria-label={t("Diagnostics preview")}
          >
            {JSON.stringify(report, null, 2)}
          </pre>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setMessage("");
              try {
                if (await api.exportDiagnostics())
                  setMessage("Diagnostics saved");
              } catch (e) {
                setMessage((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("Save diagnostics")}
          </button>
        </>
      )}
      {message && (
        <p className="helper" role="status">
          {t(message)}
        </p>
      )}
    </div>
  );
}
