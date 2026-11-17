// ═══════════════════════════════════════════════════════════════════════════
// "Accounts" without a server: the profile, signing in by opening a save file
// (or connecting a cloud), the save file download, and signing out. The data
// itself lives in docStore.js; cloud.js keeps it in sync with Drive / Dropbox.
// ═══════════════════════════════════════════════════════════════════════════
import * as Store from "./docStore.js";
import { recomputeDoc } from "./compute.js";
import { cleanProfile, serializeWorkspace, parseWorkspace, describeMerge, saveFileName } from "./workspace.js";
import { disconnect, sync } from "./cloud.js";
import { cloudState, unsaved, PROVIDERS } from "./local.js";

/** Creates or changes the profile (name and picture). Resolves to what is stored. */
export async function updateProfile(patch) {
  const before = await Store.readProfile();
  const now = Date.now();
  const profile = cleanProfile({ name: "", picture: null, ...before, ...patch, createdAt: before?.createdAt ?? now, updatedAt: now });
  await Store.saveProfile(profile);
  return profile;
}

/**
 * Signs in with a save file: its documents and profile are joined with what this browser has
 * (workspace.js decides what wins), so nothing here is lost. Resolves to
 * { ok: true, summary, plan } or { ok: false, error }.
 */
export async function openSaveText(text) {
  const parsed = parseWorkspace(text);
  if (!parsed.ok) return parsed;
  const plan = await Store.mergeWorkspace(parsed.workspace, { prepare: recomputeDoc });
  return { ok: true, summary: describeMerge(plan), plan, notes: parsed.workspace.notes, count: parsed.workspace.docs.length };
}

/** The save file for this browser: { text, name }. */
export async function buildSaveFile() {
  return { text: serializeWorkspace(await Store.readWorkspace()), name: saveFileName() };
}

/** Hands a text file to the browser's download. */
export function downloadText(text, name, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/**
 * Brings the cloud save up to date (if one is connected), disconnects it and removes the
 * documents, profile and picture from this browser. Throws, removing nothing, when the
 * cloud could not be saved.
 */
export async function signOut() {
  const cloud = cloudState();
  if (cloud) {
    if (unsaved(cloud)) {
      try {
        await sync({ interactive: true });
      } catch (error) {
        const reason = error instanceof Error ? ` ${error.message}` : "";
        throw new Error(`Could not save to ${PROVIDERS[cloud.provider]} first, so nothing was removed.${reason}`, { cause: error });
      }
    }
    await disconnect();
  }
  await Store.clearAll();
}
