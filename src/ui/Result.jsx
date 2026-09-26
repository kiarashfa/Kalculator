// A page's result, as shown under its expression (big on the open page,
// smaller in the Classic history list and the pages overview).

// Results read with a true minus sign (display only; copying keeps ASCII).
export const prettyNum = (s) => String(s).replace(/(^|[\s(,=e])-/g, "$1−");
// A result as it should land on the clipboard: no thousands separators, so it
// pastes back as a number (1,025 → 1025).
export const plainNum = (s) => String(s).replace(/(\d),(?=\d{3}(?:\D|$))/g, "$1");

export default function Result({ out, copied, onCopy, onToggleFraction, stale = false }) {
  if (!out) return null;
  const primary = out.fraction ? (out.showDecimal ? out.result : out.fraction) : out.result;
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
          {out.showDecimal ? out.fraction : out.result}
        </button>
      )}
      {copied && out.solutions && <span className="k-note">copied ✓</span>}
    </div>
  );
}
