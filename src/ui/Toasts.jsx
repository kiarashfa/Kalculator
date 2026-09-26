import { useCallback, useRef, useState } from "react";

// Short notices above the keypad, optionally with one action ("Undo").
// toast(text, { action, run, tone: "error", ms })
export function useToasts() {
  const [toasts, setToasts] = useState([]);
  const seq = useRef(0);
  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback((text, opts = {}) => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-2), { id, text, ...opts }]);
    setTimeout(() => dismiss(id), opts.ms ?? (opts.action ? 6000 : 2600));
    return id;
  }, [dismiss]);
  return { toasts, toast, dismiss };
}

export function Toasts({ toasts, dismiss }) {
  if (!toasts.length) return null;
  return (
    <div className="k-toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`k-toast${t.tone ? " " + t.tone : ""}`}>
          <span>{t.text}</span>
          {t.action && (
            <button onClick={() => { dismiss(t.id); t.run?.(); }}>{t.action}</button>
          )}
        </div>
      ))}
    </div>
  );
}
