import { useEffect, useRef } from "react";
import Icon from "./Icon.jsx";

// One overlay component for every panel (info / about, documents, pages):
// a bottom sheet on phones, a centered dialog on wide screens. Escape and a
// tap on the backdrop close it; focus moves in on open and back on close.
export default function Sheet({ title, subtitle, onClose, children, footer, tabs, className = "" }) {
  const panelRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement;
    panelRef.current?.focus({ preventScroll: true });
    // capture phase: Escape closes the sheet before the calculator sees it
    const onKey = (e) => {
      if (e.key !== "Escape" || e.target?.tagName === "INPUT") return; // a field handles its own Escape
      if (document.querySelector(".k-menu")) return; // an open menu closes first
      e.stopPropagation();
      closeRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      if (prev && prev.focus) prev.focus({ preventScroll: true });
    };
  }, []);

  return (
    <div className="k-sheet-wrap" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`k-sheet ${className}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={panelRef}>
        <div className="k-sheet-grip" aria-hidden="true" />
        <header className="k-sheet-head">
          <div className="k-sheet-titles">
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="k-iconbtn" onClick={onClose} title="Close (Esc)"><Icon name="close" /></button>
        </header>
        {tabs}
        <div className="k-sheet-body">{children}</div>
        {footer && <footer className="k-sheet-foot">{footer}</footer>}
      </div>
    </div>
  );
}

// Segmented tabs for a sheet header.
export function SheetTabs({ tabs, value, onChange }) {
  return (
    <div className="k-tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={`k-tab${value === t.id ? " on" : ""}`} onClick={() => onChange(t.id)}>
          {t.icon && <Icon name={t.icon} size={14} />}{t.label}
        </button>
      ))}
    </div>
  );
}
