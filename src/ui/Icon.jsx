// Icons are self-hosted SVG files (public/icons/ui/<name>.svg), drawn through a
// CSS mask so they take the current text color like a glyph would. Nothing is
// inlined into the bundle; the service worker caches them for offline use.
const BASE = `${import.meta.env.BASE_URL}icons/ui/`;

export default function Icon({ name, size = 16, className = "", label }) {
  return (
    <span
      className={`ic ${className}`}
      style={{ "--ic": `url("${BASE}${name}.svg")`, width: size, height: size }}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
