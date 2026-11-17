import { useEffect, useState } from "react";
import { profileMirror, cloudState, cloudDot, onLocalChange } from "./local.js";
import { syncStatus } from "./cloud.js";

// The visitor's profile and cloud state, re-read whenever either changes (here or in
// another tab). Meant for the small components that show them: the header button and
// the profile sheet, not the whole calculator, which would re-render on every save.
const read = () => ({ profile: profileMirror(), cloud: cloudState(), dot: cloudDot(), syncing: syncStatus().state === "saving", problem: syncStatus().message || "" });

export default function useAccount() {
  const [state, setState] = useState(read);
  useEffect(() => {
    setState(read());
    return onLocalChange(() => setState(read()));
  }, []);
  return state;
}
