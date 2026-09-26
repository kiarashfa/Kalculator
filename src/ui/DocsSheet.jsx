import { useEffect, useRef, useState } from "react";
import Sheet from "./Sheet.jsx";
import Icon from "./Icon.jsx";
import ContextMenu from "./ContextMenu.jsx";

export function ago(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 172800) return "yesterday";
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

function NameField({ value, onSave, onCancel }) {
  const [v, setV] = useState(value);
  const ref = useRef(null);
  const done = useRef(false); // Enter/Escape, then blur: act once
  const finish = (fn) => { if (!done.current) { done.current = true; fn(); } };
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  return (
    <input ref={ref} className="k-namefield" value={v} maxLength={60} aria-label="Document name"
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(() => onSave(v));
        if (e.key === "Escape") finish(onCancel);
      }}
      onBlur={() => finish(() => onSave(v))} />
  );
}

// Documents: the open one (rename, save to file), the ones kept in this
// browser (open, rename, duplicate, save, delete), and opening a .kalc file.
export default function DocsSheet({ current, pageCount, docs, persistent, fileName, onClose, onOpen, onNew, onRename, onDuplicate, onDelete, onSaveFile, onOpenFile }) {
  const [renaming, setRenaming] = useState(null); // doc id being renamed
  const [menu, setMenu] = useState(null);
  const others = docs.filter((d) => d.id !== current.id);

  const rowMenu = (e, d) => {
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({ x: r.right - 200, y: r.bottom + 4, items: [
      { label: "Open", icon: "file", run: () => onOpen(d.id) },
      { label: "Rename", icon: "edit", run: () => setRenaming(d.id) },
      { label: "Duplicate", icon: "duplicate", run: () => onDuplicate(d.id) },
      { label: "Save to file…", icon: "save", run: () => onSaveFile(d.id, true) },
      "-",
      { label: "Delete", icon: "trash", danger: true, run: () => onDelete(d.id) },
    ] });
  };

  return (
    <Sheet title="Documents" onClose={onClose} className="k-docs"
      subtitle={persistent ? "Saved automatically in this browser" : "This browser can't keep documents — save to a file before you leave"}>
      <section className="k-doc-current">
        <div className="k-doc-name">
          <Icon name="file" size={18} />
          {renaming === current.id
            ? <NameField value={current.name} onSave={(v) => { onRename(current.id, v); setRenaming(null); }} onCancel={() => setRenaming(null)} />
            : <button className="k-doc-title" onClick={() => setRenaming(current.id)} title="Rename">{current.name}<Icon name="edit" size={13} /></button>}
        </div>
        <div className="k-doc-meta">
          {pageCount} page{pageCount === 1 ? "" : "s"} · edited {ago(current.updatedAt)}
          {fileName && <> · <span title="Ctrl+S saves here">{fileName}</span></>}
        </div>
        <div className="k-doc-actions">
          <button className="k-btn" onClick={() => onSaveFile(current.id, false)}><Icon name="save" size={15} />{fileName ? "Save" : "Save to file"}</button>
          {fileName && <button className="k-btn ghost" onClick={() => onSaveFile(current.id, true)}>Save as…</button>}
          <button className="k-btn ghost" onClick={() => onDuplicate(current.id)}><Icon name="duplicate" size={15} />Duplicate</button>
        </div>
      </section>

      <div className="k-doc-bar">
        <button className="k-btn ghost grow" onClick={onNew}><Icon name="file-plus" size={15} />New document</button>
        <button className="k-btn ghost grow" onClick={onOpenFile}><Icon name="folder" size={15} />Open file…</button>
      </div>

      {others.length > 0 && <h3 className="k-eyebrow k-doc-listhead">In this browser</h3>}
      <ul className="k-doc-list">
        {others.map((d) => (
          <li key={d.id} className="k-doc-row">
            {renaming === d.id
              ? <NameField value={d.name} onSave={(v) => { onRename(d.id, v); setRenaming(null); }} onCancel={() => setRenaming(null)} />
              : (
                <button className="k-doc-open" onClick={() => onOpen(d.id)}>
                  <span className="k-doc-rowname">{d.name}</span>
                  <span className="k-doc-rowmeta">{d.pages} page{d.pages === 1 ? "" : "s"} · {ago(d.updatedAt)}</span>
                </button>
              )}
            <button className="k-iconbtn k-doc-more" title="More" onClick={(e) => rowMenu(e, d)}><Icon name="dots" /></button>
          </li>
        ))}
      </ul>
      {!others.length && <p className="k-doc-empty">Other documents you create or open will be listed here.</p>}

      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </Sheet>
  );
}
