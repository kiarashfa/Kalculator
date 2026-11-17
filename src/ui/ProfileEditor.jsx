import { useEffect, useRef, useState } from "react";
import Icon from "./Icon.jsx";
import Avatar from "./Avatar.jsx";
import { NAME_MAX, PICTURE_MAX, cleanName } from "../workspace.js";

// Creating or changing the profile: a name (the initials come from it) and, if wanted,
// a photo. The pencil on the picture opens a photo; it goes through a square cropper
// (drag to place, slider / wheel / + − to zoom, arrow keys to move) and is kept as ONE
// small 192 px image, so the save file grows by a few KB, not by the size of the photo.
const CROP = 208; // the cropper's size on screen (CSS px)
const SIZE = 192; // the stored image
const MAX_ZOOM = 4;
const MAX_FILE = 25 * 1024 * 1024;

function PhotoCropper({ src, onChange, onFail }) {
  const [nat, setNat] = useState(null); // natural size of the chosen image
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const imgRef = useRef(null);
  const frameRef = useRef(null);
  const drag = useRef(null);
  const timer = useRef(null);
  const view = useRef({ zoom: 1, pos: { x: 0, y: 0 } });
  view.current = { zoom, pos };

  const base = nat ? Math.max(CROP / nat.w, CROP / nat.h) : 1; // scale at which the image just covers the frame
  const limit = (z, p) => {
    if (!nat) return p;
    const k = base * z;
    const mx = Math.max(0, (nat.w * k - CROP) / 2), my = Math.max(0, (nat.h * k - CROP) / 2);
    return { x: Math.min(mx, Math.max(-mx, p.x)), y: Math.min(my, Math.max(-my, p.y)) };
  };

  // What the frame shows, drawn at SIZE px: WebP where the browser can, else JPEG.
  function render(z, p) {
    const img = imgRef.current;
    if (!img || !nat) return null;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = SIZE;
    const g = canvas.getContext("2d");
    if (!g) return null;
    const r = SIZE / CROP, k = base * z * r;
    g.imageSmoothingQuality = "high";
    g.drawImage(img, SIZE / 2 + p.x * r - (nat.w * k) / 2, SIZE / 2 + p.y * r - (nat.h * k) / 2, nat.w * k, nat.h * k);
    const webp = canvas.toDataURL("image/webp", 0.82);
    const out = webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", 0.85);
    return out.length <= PICTURE_MAX ? out : canvas.toDataURL("image/jpeg", 0.6);
  }
  const schedule = (z, p) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onChange(render(z, p)), 90);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  // Drawing needs `nat` (the scale), so the first render waits for it.
  useEffect(() => { if (nat) schedule(1, { x: 0, y: 0 }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [nat]);

  const moveTo = (p, z = view.current.zoom) => { const next = limit(z, p); setPos(next); schedule(z, next); };
  const zoomTo = (z) => {
    const nz = Math.min(MAX_ZOOM, Math.max(1, z));
    setZoom(nz);
    moveTo(view.current.pos, nz);
  };
  const onDown = (e) => {
    if (!nat) return;
    drag.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e) => { if (drag.current) moveTo({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y }); };
  const onUp = () => { drag.current = null; };
  const onKey = (e) => {
    if (!nat) return;
    const step = e.shiftKey ? 20 : 6;
    const d = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
    if (d) { e.preventDefault(); e.stopPropagation(); moveTo({ x: pos.x + d[0], y: pos.y + d[1] }); }
    else if (e.key === "+" || e.key === "=") zoomTo(zoom * 1.1);
    else if (e.key === "-") zoomTo(zoom / 1.1);
  };
  // React's onWheel is passive, so the page would scroll too: listen natively.
  useEffect(() => {
    const el = frameRef.current;
    const onWheel = (e) => { e.preventDefault(); zoomTo(view.current.zoom * (e.deltaY < 0 ? 1.08 : 0.93)); };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nat]);

  const k = base * zoom;
  const transform = nat ? `translate(${pos.x - (nat.w * k) / 2}px, ${pos.y - (nat.h * k) / 2}px) scale(${k})` : undefined;

  return (
    <div className="k-photo">
      <div className="k-crop" ref={frameRef} style={{ "--crop": `${CROP}px` }} tabIndex={0}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onKeyDown={onKey}
        role="img" aria-label="Photo: drag to place it, use the slider to zoom">
        <img ref={imgRef} src={src} alt="" draggable={false} style={{ transform, visibility: nat ? "visible" : "hidden" }}
          onLoad={() => setNat({ w: imgRef.current.naturalWidth, h: imgRef.current.naturalHeight })} onError={onFail} />
      </div>
      <div className="k-zoom">
        <button type="button" className="k-iconbtn" aria-label="Zoom out" onClick={() => zoomTo(zoom / 1.15)}>−</button>
        <input type="range" min="1" max={MAX_ZOOM} step="0.01" value={zoom} aria-label="Zoom" onChange={(e) => zoomTo(Number(e.target.value))} />
        <button type="button" className="k-iconbtn" aria-label="Zoom in" onClick={() => zoomTo(zoom * 1.15)}>+</button>
      </div>
      <p className="k-hint">Drag to place it. The picture is saved as a small square image.</p>
    </div>
  );
}

// The editor. `profile` is null when creating. onSave receives { name, picture }.
export default function ProfileEditor({ profile, onSave, onCancel, busy }) {
  const [name, setName] = useState(profile?.name ?? "");
  const [photo, setPhoto] = useState(profile?.picture ?? null); // the stored image (data URL)
  const [src, setSrc] = useState("");                           // a newly chosen photo being cropped
  const [error, setError] = useState("");
  const fileRef = useRef(null);

  useEffect(() => () => { if (src) URL.revokeObjectURL(src); }, [src]);

  function choose(file) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return setError("That isn't an image file.");
    if (file.size > MAX_FILE) return setError("That photo is too large. Pick one under 25 MB.");
    setError("");
    setSrc(URL.createObjectURL(file));
  }

  const clean = cleanName(name);
  const canSave = clean.length > 0 && !busy;
  const save = () => { if (canSave) onSave({ name: clean, picture: photo }); };

  return (
    <form className="k-editor-form" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <div className="k-editor-hero">
        <div className="k-pic">
          <Avatar profile={{ name: clean, picture: photo }} size={88} />
          <button type="button" className="k-pencil" title="Choose a photo" aria-label="Choose a photo" onClick={() => fileRef.current?.click()}>
            <Icon name="edit" size={14} />
          </button>
        </div>
        {photo && <button type="button" className="k-link" onClick={() => { setPhoto(null); setSrc(""); }}>Remove photo</button>}
      </div>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ""; }} />

      {src && <PhotoCropper key={src} src={src} onChange={setPhoto}
        onFail={() => { setSrc(""); setError("That photo couldn't be opened. Try a JPEG, PNG or WebP."); }} />}

      <label className="k-label" htmlFor="pf-name">Name</label>
      <input id="pf-name" className="k-input" value={name} maxLength={NAME_MAX} placeholder="Your name" autoFocus={!profile} autoComplete="name"
        onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} aria-describedby="pf-name-hint" />
      <p id="pf-name-hint" className="k-hint">Without a photo, your picture shows the initials of your name.</p>

      {error && <p className="k-error" role="alert">{error}</p>}
      <div className="k-editor-foot">
        <button type="button" className="k-btn ghost grow" onClick={onCancel}>Cancel</button>
        <button type="submit" className="k-btn primary grow" disabled={!canSave}>{busy ? "Saving…" : profile ? "Save" : "Create profile"}</button>
      </div>
    </form>
  );
}
