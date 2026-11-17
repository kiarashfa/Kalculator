import Avatar from "./Avatar.jsx";
import useAccount from "../useAccount.js";

// The header button: the visitor's picture (with the cloud save status on its corner),
// or a plain person icon that opens the sign in panel.
export default function ProfileButton({ onClick }) {
  const { profile, dot } = useAccount();
  const label = profile ? `${profile.name || "Profile"}: profile and cloud save` : "Sign in or create a profile";
  return (
    <button className={`k-iconbtn k-me${profile ? " signed" : ""}`} title={label} aria-label={label} onClick={onClick}>
      <Avatar profile={profile} size={30} dot={dot} />
    </button>
  );
}
