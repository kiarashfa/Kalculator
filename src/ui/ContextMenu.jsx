import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Icon from "./Icon.jsx";

// The app's own right-click / long-press menu. items: [{ label, icon, hint,
// run, disabled, danger } | "-"]. Keeps itself inside the viewport; arrow keys,
// Enter and Escape work; any outside press or scroll closes it.
export default function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [active, setActive] = useState(-1);
  const actionable = items.map((it, i) => (it !== "-" && !it.disabled ? i : -1)).filter((i) => i >= 0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 8;
    setPos({
      left: Math.max(pad, Math.min(x, window.innerWidth - r.width - pad)),
      top: y + r.height + pad > window.innerHeight ? Math.max(pad, y - r.height) : y,
    });
    el.focus({ preventScroll: true });
  }, [x, y]);

  useEffect(() => {
    const close = () => onClose();
    const onDown = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    const onKey = (e) => {
      e.stopPropagation();
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const k = actionable.indexOf(active);
        const next = e.key === "ArrowDown" ? actionable[(k + 1) % actionable.length] : actionable[(k - 1 + actionable.length) % actionable.length];
        setActive(next ?? -1);
      } else if (e.key === "Enter" && active >= 0) { e.preventDefault(); run(items[active]); }
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    document.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
      document.removeEventListener("scroll", close, true);
    };
  });

  function run(it) {
    onClose();
    it.run?.();
  }

  return (
    <div className="k-menu" role="menu" ref={ref} tabIndex={-1} style={pos} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) => it === "-"
        ? <div key={`s${i}`} className="k-menu-sep" role="separator" />
        : (
          <button key={it.label} role="menuitem" disabled={it.disabled}
            className={`k-menu-item${it.danger ? " danger" : ""}${active === i ? " active" : ""}`}
            onMouseEnter={() => setActive(i)} onClick={() => run(it)}>
            {it.icon ? <Icon name={it.icon} size={15} /> : <span className="ic-spacer" />}
            <span className="k-menu-label">{it.label}</span>
            {it.hint && <kbd>{it.hint}</kbd>}
          </button>
        ))}
    </div>
  );
}
