"use strict";
const yauzl = require("yauzl");
const MAX = 64 * 1024 * 1024;
async function readExport(file) {
  const zip = await yauzl.openPromise(file, {
    lazyEntries: true,
    validateEntrySizes: true,
  });
  let found = null,
    visited = 0,
    attachments = 0;
  try {
    for await (const entry of zip.eachEntry()) {
      if (++visited > 100000)
        throw new Error("Too many files in 1PUX archive.");
      if (entry.fileName.startsWith("files/") && !entry.fileName.endsWith("/"))
        attachments++;
      if (entry.fileName !== "export.data") continue;
      if (found || entry.uncompressedSize > MAX || entry.isEncrypted())
        throw new Error("Invalid or oversized 1PUX export.data.");
      const stream = await zip.openReadStreamPromise(entry);
      const chunks = [];
      let size = 0;
      for await (const chunk of stream) {
        size += chunk.length;
        if (size > MAX) {
          stream.destroy();
          throw new Error("1PUX data exceeds 64 MiB.");
        }
        chunks.push(chunk);
      }
      found = Buffer.concat(chunks).toString("utf8");
    }
  } finally {
    zip.close();
  }
  if (!found) throw new Error("1PUX archive has no export.data.");
  return { data: JSON.parse(found), attachments };
}
async function import1pux(file) {
  const { data, attachments } = await readExport(file);
  if (!Array.isArray(data.accounts))
    throw new Error("Invalid 1PUX account structure.");
  const rows = [],
    warnings = [];
  let skipped = 0,
    unknown = 0,
    history = 0;
  for (const account of data.accounts)
    for (const vault of account.vaults || [])
      for (const item of vault.items || []) {
        if (rows.length > 10000)
          throw new Error("Import at most 10,000 items at a time.");
        if (item.details?.documentAttributes || item.categoryUuid === "006") {
          skipped++;
          continue;
        }
        const title = item.overview?.title;
        if (typeof title !== "string" || !title.trim()) {
          skipped++;
          continue;
        }
        const details = item.details || {},
          overview = item.overview || {},
          category = String(item.categoryUuid || "");
        const type =
          {
            "001": "login",
            "002": "card",
            "003": "note",
            "004": "identity",
            "005": "login",
            109: "wifi",
          }[category] || "note";
        if (!["001", "002", "003", "004", "005", "109"].includes(category))
          unknown++;
        let username = "",
          password = "";
        const fields = [];
        const used = new Set(["Title", "UserName", "Password", "URL", "Notes"]);
        const add = (name, value, secret) => {
          name = String(name || "Field").slice(0, 80);
          if (name.startsWith("Keylocal.")) name = `Imported ${name}`;
          let key = name,
            n = 2;
          while (used.has(key)) key = `${name} ${n++}`;
          used.add(key);
          fields.push({ key, value: String(value), secret });
        };
        for (const field of details.loginFields || []) {
          if (field.designation === "username")
            username = String(field.value || "");
          else if (field.designation === "password")
            password = String(field.value || "");
          else if (field.value)
            add(
              field.name || field.id,
              field.value,
              (field.fieldType || field.type) === "P",
            );
        }
        for (const section of details.sections || [])
          for (const field of section.fields || []) {
            if (!field.value || typeof field.value !== "object") continue;
            const entries = Object.entries(field.value);
            if (!entries.length) continue;
            const [kind, v] = entries[0],
              concealed =
                ["concealed", "creditCardNumber", "totp"].includes(kind) ||
                Boolean(field.guarded);
            const value =
              typeof v === "object" ? JSON.stringify(v) : String(v ?? "");
            if (
              !password &&
              String(field.id || field.title).toLowerCase() === "password"
            )
              password = value;
            else if (
              !username &&
              ["username", "email"].includes(
                String(field.id || field.title).toLowerCase(),
              )
            )
              username = value;
            else add(field.title || field.id, value, concealed);
          }
        history += (details.passwordHistory || []).length;
        if (fields.length > 50)
          throw new Error(
            "An imported item has more than 50 custom fields. Nothing has been imported.",
          );
        rows.push({
          title,
          type,
          username,
          password,
          urls: [
            ...new Set(
              [overview.url, ...(overview.urls || []).map((u) => u.url)].filter(
                (u) => typeof u === "string" && u,
              ),
            ),
          ],
          notes: String(details.notesPlain || ""),
          fields,
          tags: Array.isArray(overview.tags) ? overview.tags : [],
          group: String(vault.attrs?.name || "Imported"),
          favorite: Number(item.favIndex) > 0,
          archived: item.state === "archived",
        });
      }
  if (attachments)
    warnings.push(
      `${attachments} attached files/custom icons are not imported. Keep your original 1PUX export until migration is verified.`,
    );
  if (history)
    warnings.push(
      `${history} previous password-history values are not imported. Current passwords are imported.`,
    );
  if (unknown)
    warnings.push(
      `${unknown} items use unsupported templates. They will be stored as secure notes with custom fields.`,
    );
  warnings.push(
    "1PUX/CSV exports are unencrypted files. Keylocal does not delete the source export.",
  );
  return { rows, skipped, warnings };
}
module.exports = { import1pux };
