import { useEffect, useRef, useState } from "react";
import Sheet from "./Sheet.jsx";
import Icon from "./Icon.jsx";
import Avatar from "./Avatar.jsx";
import ProfileEditor from "./ProfileEditor.jsx";
import { ago } from "./DocsSheet.jsx";
import useAccount from "../useAccount.js";
import { AVAILABLE, connectDropbox, connectGoogle, disconnect, loadGoogle, sync } from "../cloud.js";
import { updateProfile, buildSaveFile, downloadText } from "../account.js";
import { PROVIDERS } from "../local.js";
import { SAVE_EXT } from "../docs.js";

// Profile and sign in. There are no passwords and no server: you "sign in" by
// opening your save file or by connecting your own Google Drive / Dropbox, and
// everything stays in this browser until you sign out.

function Logo({ provider }) {
  return provider === "google" ? (
    <svg className="k-logo-svg" viewBox="0 0 87.3 78" aria-hidden="true">
      <path fill="#0066da" d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3L27.5 53H0c0 1.55.4 3.1 1.2 4.5z" />
      <path fill="#00ac47" d="M43.65 25 29.9 1.2c-1.35.8-2.5 1.9-3.3 3.3L1.2 48.5A9 9 0 0 0 0 53h27.5z" />
      <path fill="#ea4335" d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.8l5.85 11.5z" />
      <path fill="#00832d" d="M43.65 25 57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z" />
      <path fill="#2684fc" d="M59.8 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" />
      <path fill="#ffba00" d="M73.4 26.5 60.7 4.5c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25 59.8 53h27.45c0-1.55-.4-3.1-1.2-4.5z" />
    </svg>
  ) : (
    <svg className="k-logo-svg" viewBox="0 0 43 40" aria-hidden="true">
      <path fill="#0061fe" d="M12.5 0 0 8.1l8.7 6.9 12.6-7.8zM0 21.9l12.5 8.2 8.8-7.4-12.6-7.7zm21.3.8 8.8 7.4 12.4-8.2-8.6-6.9zm21.2-14.6L30.1 0l-8.8 7.2 12.6 7.8zM21.4 24.3l-8.9 7.3-3.8-2.4v2.7l12.7 7.6 12.6-7.6v-2.7l-3.8 2.4z" />
    </svg>
  );
}

const HOME = {
  google: "A hidden app folder in your Drive. Kalculator sees only its own file.",
  dropbox: "Kalculator's own app folder in your Dropbox.",
};
const ORDER = ["google", "dropbox"].filter((p) => AVAILABLE[p]);

export default function ProfileSheet({ onClose, onFile, onSignOut, onPrivacy, toast }) {
  const { profile, cloud, dot, syncing } = useAccount();
  const [view, setView] = useState("main"); // "main" | "edit" | "out"
  const [busy, setBusy] = useState(null);   // provider being connected | "profile" | "signout"
  const [, tick] = useState(0);
  const fileRef = useRef(null);

  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30000); return () => clearInterval(t); }, []);
  // Google's window must open straight from the click, so its script loads when the pointer approaches.
  const warm = () => { if (AVAILABLE.google) loadGoogle().catch(() => {}); };

  async function run(provider, task) {
    setBusy(provider);
    try {
      const result = await task();
      const label = PROVIDERS[provider];
      toast(result?.imported ? `Brought in ${result.imported} from ${label}` : `Saved to ${label}`, { ms: 3500 });
    } catch (e) {
      toast(e instanceof Error ? e.message : "That didn't work. Try again.", { tone: "error", ms: 6000 });
    } finally {
      setBusy(null);
    }
  }
  function connect(provider) {
    if (provider === "google") { run("google", connectGoogle); return; }
    setBusy("dropbox");
    toast("Opening Dropbox…");
    connectDropbox().catch((e) => { setBusy(null); toast(e instanceof Error ? e.message : "Dropbox couldn't be opened.", { tone: "error", ms: 6000 }); });
  }
  async function unlink() {
    const label = PROVIDERS[cloud.provider];
    await disconnect();
    toast(`Disconnected from ${label}. Your save there stays until you delete it.`, { ms: 5000 });
  }
  async function saveProfile(patch) {
    setBusy("profile");
    try {
      await updateProfile(patch);
      setView("main");
      toast(profile ? "Profile saved" : "Profile created");
    } catch {
      toast("The profile couldn't be saved in this browser.", { tone: "error" });
    } finally { setBusy(null); }
  }
  async function download() {
    try {
      const { text, name } = await buildSaveFile();
      downloadText(text, name);
      toast(`Downloaded ${name}`, { ms: 3500 });
    } catch { toast("The save file couldn't be made.", { tone: "error" }); }
  }
  async function signOut() {
    setBusy("signout");
    try {
      await onSignOut();
      onClose();
      toast("Signed out. This browser no longer holds your documents.", { ms: 4500 });
    } catch (e) {
      toast(e instanceof Error ? e.message : "Signing out failed.", { tone: "error", ms: 7000 });
      setView("main");
    } finally { setBusy(null); }
  }

  const where = cloud ? PROVIDERS[cloud.provider] : "";
  const status = !cloud ? "" : syncing || busy === cloud.provider ? `Saving to ${where}…`
    : dot === "auth" ? `${where} needs you to sign in again.`
    : dot === "pending" ? "Changes are waiting to be saved."
    : cloud.savedAt ? `Saved to ${where} · ${ago(cloud.savedAt)}` : `Connected to ${where}.`;

  const filePicker = (
    <input ref={fileRef} type="file" accept={`${SAVE_EXT},.kalc,.json,application/json`} hidden
      onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onFile(f); }} />
  );

  // ── Editing ──
  if (view === "edit") {
    return (
      <Sheet title={profile ? "Edit profile" : "Create profile"} subtitle="Shown only on this device, and in your own save" onClose={onClose} className="k-profile">
        <ProfileEditor profile={profile} busy={busy === "profile"} onSave={saveProfile} onCancel={() => setView("main")} />
      </Sheet>
    );
  }

  // ── Signed out: the sign in panel ──
  if (!profile) {
    return (
      <Sheet title="Sign in" subtitle="No password and no account to make" onClose={onClose} className="k-profile">
        <div className="k-acct-hero">
          <Avatar profile={null} size={64} />
          <p>Your save file is your key. Open it to bring back your profile and documents on this device, or connect your own cloud storage.</p>
        </div>
        <div className="k-acct-stack">
          <button className="k-btn primary" onClick={() => fileRef.current?.click()}><Icon name="key" size={16} />Open a save file</button>
          {ORDER.length > 0 && <div className="k-or"><span>or connect</span></div>}
          {ORDER.map((p) => (
            <button key={p} className="k-btn provider" disabled={busy !== null} onPointerEnter={warm} onFocus={warm} onClick={() => connect(p)}>
              <Logo provider={p} />{busy === p ? "Connecting…" : PROVIDERS[p]}
            </button>
          ))}
          <div className="k-or"><span>or</span></div>
          <button className="k-btn ghost" onClick={() => setView("edit")}><Icon name="user" size={16} />Create a profile on this device</button>
        </div>
        <p className="k-hint center">A profile adds your name and picture. You can save it to a file or to the cloud later. <button className="k-link" onClick={onPrivacy}>Privacy</button></p>
        {filePicker}
      </Sheet>
    );
  }

  // ── Confirm sign out ──
  if (view === "out") {
    return (
      <Sheet title="Sign out?" onClose={onClose} className="k-profile">
        <div className="k-confirm">
          <p>This removes your documents, profile and picture from this browser.</p>
          {cloud
            ? <p className="k-confirm-ok"><Icon name="check" size={15} />Your documents stay safe in {where}. Connect it again to bring them back.</p>
            : <p className="k-confirm-warn">Nothing is saved anywhere else yet. Download your save file first, or they are gone for good.</p>}
          {!cloud && <button className="k-btn" onClick={download}><Icon name="save" size={15} />Download save file</button>}
          <div className="k-editor-foot">
            <button className="k-btn ghost grow" onClick={() => setView("main")} disabled={busy === "signout"}>Cancel</button>
            <button className="k-btn danger grow" onClick={signOut} disabled={busy === "signout"}>{busy === "signout" ? "Signing out…" : "Sign out"}</button>
          </div>
        </div>
      </Sheet>
    );
  }

  // ── Signed in ──
  return (
    <Sheet title="Profile" subtitle="Signed in on this device" onClose={onClose} className="k-profile">
      <section className="k-acct-card">
        <Avatar profile={profile} size={64} dot={dot} />
        <div className="k-acct-who">
          <b>{profile.name || "You"}</b>
          <small>{cloud?.account?.email || (cloud ? where : "On this device")}</small>
        </div>
        <button className="k-btn ghost" onClick={() => setView("edit")}><Icon name="edit" size={14} />Edit</button>
      </section>

      <section className="k-acct-sec">
        <h3 className="k-eyebrow"><Icon name="cloud" size={12} />Cloud save</h3>
        {ORDER.length === 0 ? (
          <p className="k-hint">Cloud save isn't available in this copy of Kalculator. The save file works everywhere.</p>
        ) : (
          <>
            <div className="k-providers">
              {ORDER.map((p) => {
                const on = cloud?.provider === p;
                return (
                  <div key={p} className={`k-provider${on ? " on" : ""}`} title={HOME[p]}>
                    <Logo provider={p} />
                    <div><b>{PROVIDERS[p]}</b><small>{on ? `Connected${cloud.account?.email ? ` as ${cloud.account.email}` : ""}` : "Not connected"}</small></div>
                    {!on && <button className="k-btn" disabled={busy !== null} onPointerEnter={warm} onFocus={warm} onClick={() => connect(p)}>{busy === p ? "Connecting…" : "Connect"}</button>}
                  </div>
                );
              })}
            </div>
            {cloud ? (
              <>
                <p className="k-status" data-dot={dot}><i />{status}</p>
                <div className="k-acct-row">
                  <button className="k-btn" disabled={busy !== null || syncing} onPointerEnter={warm} onClick={() => run(cloud.provider, () => sync({ interactive: true }))}>
                    <Icon name="refresh" size={14} />{dot === "auth" ? "Sign in again" : "Save now"}
                  </button>
                  <button className="k-btn ghost" disabled={busy !== null} onClick={unlink}>Disconnect</button>
                </div>
                <p className="k-hint">Saves by itself a few seconds after each change.</p>
              </>
            ) : <p className="k-hint">Keep a copy in your own cloud. It updates by itself and follows you to your other devices.</p>}
          </>
        )}
      </section>

      <section className="k-acct-sec">
        <h3 className="k-eyebrow"><Icon name="key" size={12} />Save file</h3>
        <p className="k-hint first">Your save file is your key. Keep it safe: opening it on any device brings back your profile and every document.</p>
        <div className="k-acct-row">
          <button className="k-btn" onClick={download}><Icon name="save" size={14} />Download</button>
          <button className="k-btn ghost" onClick={() => fileRef.current?.click()}><Icon name="folder" size={14} />Open</button>
        </div>
      </section>

      <section className="k-acct-sec foot">
        <button className="k-btn ghost danger-text" onClick={() => setView("out")}><Icon name="logout" size={14} />Sign out</button>
        <button className="k-link" onClick={onPrivacy}><Icon name="shield" size={13} />Privacy</button>
      </section>
      {filePicker}
    </Sheet>
  );
}
