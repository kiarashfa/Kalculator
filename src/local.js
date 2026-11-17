// ═══════════════════════════════════════════════════════════════════════════
// What every part of the app needs to know about the visitor without opening
// the database: a copy of the profile (so the header paints at once, with no
// flash of "signed out"), when this browser last changed anything, and the
// cloud connection. All of it lives in this browser's localStorage only; the
// profile itself and the documents are in IndexedDB (docStore.js).
// ═══════════════════════════════════════════════════════════════════════════
import { cleanProfile } from "./workspace.js";

export const PROFILE_KEY = "kalculator.profile";
export const CHANGED_KEY = "kalculator.changed";
export const CLOUD_KEY = "kalculator.cloud";
/** Fired on window in this tab; other tabs see the localStorage write as a `storage` event. */
export const CHANGED_EVENT = "kalculator:changed";
export const CLOUD_EVENT = "kalculator:cloud";

export const PROVIDERS = { google: "Google Drive", dropbox: "Dropbox" };

export function readJson(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeJson(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be blocked; the header then simply shows the signed out button.
  }
}

const fire = (name) => { try { dispatchEvent(new CustomEvent(name)); } catch { /* not in a browser */ } };

export const profileMirror = () => cleanProfile(readJson(PROFILE_KEY));
export function writeProfileMirror(profile) {
  writeJson(PROFILE_KEY, profile);
  fire(CHANGED_EVENT);
}

/** Records that this browser now holds changes the cloud copy may not have. */
export function markChanged() {
  writeJson(CHANGED_KEY, Date.now());
  fire(CHANGED_EVENT);
}
export function forgetChanges() {
  writeJson(CHANGED_KEY, null);
  fire(CHANGED_EVENT);
}
export const changedAt = () => Number(readJson(CHANGED_KEY)) || 0;

/*
 * cloudState: {
 *   provider: "google" | "dropbox",
 *   account: { name, email } | null,
 *   savedAt: ms when the data last uploaded was gathered, or null before the first save,
 *   rev: the cloud file's version as last seen here,
 *   file: Google Drive file id,
 *   token: { access, expires } | null,
 *   refresh: Dropbox refresh token,
 *   problem: "auth" (needs a click to sign in again) | "error" (will be retried) | null
 * }
 */
export function cloudState() {
  const s = readJson(CLOUD_KEY);
  return s && typeof s === "object" && s.provider in PROVIDERS ? s : null;
}

/** True when this browser holds changes that are not in the cloud save yet. */
export const unsaved = (s = cloudState()) => !!s && changedAt() > (s.savedAt || 0);

/** "saved", "pending" (changes waiting), "auth" (needs a click), or null without a cloud. */
export function cloudDot(s = cloudState()) {
  if (!s) return null;
  if (s.problem === "auth") return "auth";
  return unsaved(s) || s.problem === "error" ? "pending" : "saved";
}

/** Calls `fn` whenever the profile, the documents or the cloud state change, here or in another tab. */
export function onLocalChange(fn) {
  const onStorage = (e) => { if (e.key === null || [PROFILE_KEY, CHANGED_KEY, CLOUD_KEY].includes(e.key)) fn(); };
  addEventListener(CHANGED_EVENT, fn);
  addEventListener(CLOUD_EVENT, fn);
  addEventListener("storage", onStorage);
  return () => {
    removeEventListener(CHANGED_EVENT, fn);
    removeEventListener(CLOUD_EVENT, fn);
    removeEventListener("storage", onStorage);
  };
}
