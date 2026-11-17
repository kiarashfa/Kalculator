import Icon from "./Icon.jsx";
import { initialsOf } from "../workspace.js";

// The profile picture as a rounded square: the photo, or the initials of the
// name, or the plain person icon when nobody is signed in. `dot` is the cloud
// save status ("saved" | "pending" | "auth") drawn on its corner.
export default function Avatar({ profile, size = 32, dot = null }) {
  const initials = initialsOf(profile?.name);
  const kind = profile?.picture ? "photo" : initials ? "initials" : "";
  return (
    <span className="k-avatar" data-kind={kind} style={{ "--av": `${size}px` }}>
      {kind === "photo" && <img src={profile.picture} alt="" width={size} height={size} draggable={false} />}
      {kind === "initials" && <span className="k-avatar-ltr">{initials}</span>}
      {!kind && <Icon name="user" size={Math.round(size * 0.55)} />}
      {dot && <span className="k-avatar-dot" data-dot={dot} />}
    </span>
  );
}
