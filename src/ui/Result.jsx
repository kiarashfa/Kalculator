import { MathEngine } from "../compute.js";

// A page's result, as shown under its expression (big on the open page,
// smaller in the Classic history list and the pages overview).

// Results read with a true minus sign (display only; copying keeps ASCII).
export const prettyNum = (s) => String(s).replace(/(^|[\s([,=e])-/g, "$1−");
// A result as it should land on the clipboard: no thousands separators, so it
// pastes back as a number (1,025 → 1025).
export const plainNum = (s) => String(s).replace(/(\d),(?=\d{3}(?:\D|$))/g, "$1");
// A real result is re-formatted from its value, so changing digits / notation
// / separators in settings updates every page; anything else shows as stored.
export const shownResult = (out) => (out.type === "calc" && typeof out.value === "number" ? MathEngine.fmt(out.value) : out.result);

export default function Result({ out, copied, onCopy, onToggleFraction, stale = false }) {
  if (!out) return null;
  const shown = shownResult(out);
  const primary = out.fraction ? (out.showDecimal ? shown : out.fraction) : shown;
  const canCopy = out.type === "calc" || out.type === "solve";
  return (
    <div className={`k-result${stale ? " stale" : ""}`}>
      {out.solutions && out.solutions.length > 0 ? (
        <div className="k-roots">
          {out.solutions.map((s, k) => (
            <span key={k} onClick={() => onCopy?.(plainNum(s))} title="Tap to copy">
              x{out.solutions.length > 1 && <sub>{k + 1}</sub>} = {prettyNum(s)}
            </span>
          ))}
        </div>
      ) : (
        <span className={`k-res ${out.type}${copied ? " copied" : ""}`}
          onClick={canCopy ? () => onCopy?.(plainNum(primary)) : undefined}
          title={canCopy ? "Tap to copy" : undefined}>
          {copied ? "copied ✓" : `${out.type === "calc" ? "= " : ""}${prettyNum(primary)}`}
        </span>
      )}
      {out.fraction && (
        <button className="k-fracchip" onClick={onToggleFraction} title="Toggle fraction / decimal">
          {prettyNum(out.showDecimal ? out.fraction : shown)}
        </button>
      )}
      {out.angle && <span className="k-angletag" title={out.angle === "deg" ? "Calculated in degrees" : "Calculated in radians"}>{out.angle === "deg" ? "DEG" : "RAD"}</span>}
      {copied && out.solutions && <span className="k-note">copied ✓</span>}
    </div>
  );
}
