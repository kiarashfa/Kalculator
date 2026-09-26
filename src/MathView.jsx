// ═══════════════════════════════════════════════════════════════════════════
// MathView — renders the structural tree as 2D math, HandyCalc-style.
// Pure presentation: styling lives in styles/app.css (.m-*). Layout notes:
//  · Every glyph uses one font at one size (digits, function names, operators).
//  · Fractions are `inline-grid` with rows `1fr auto 1fr`: numerator and
//    denominator get equal halves, so `vertical-align: middle` puts the bar on
//    the math axis — a "+" between two fractions lines up with both bars.
//  · ( ), |abs| and √ are SVG that stretch to their content's height.
//  · An exponent is rendered together with the node it raises (the preceding
//    sibling), so it can sit at the top of a tall base like (π/8)².
//  · The caret is zero-width: moving it never reflows the expression.
// Every rendered seq carries data-seq, every child data-p (parent seq id) +
// data-i (index) — caretFromPoint() uses them for click/drag placement.
// ═══════════════════════════════════════════════════════════════════════════

const OP_GLYPH = { "*": "×", "-": "−", "/": "÷" };
const BINARY = new Set(["+", "-", "*", "/", "×", "÷", "−"]);
const FN_SUB = { log2: ["log", "2"] }; // name → [label, subscript]

// ─── Stretchy glyphs (SVG in a sized span; see .m-fence in app.css) ─────────
const FENCE_PATH = {
  l: "M22 2 Q3 60 22 118",
  r: "M8 2 Q27 60 8 118",
  bar: "M15 2 L15 118",
};
function Fence({ kind }) {
  return (
    <span className={`m-fence m-fence-${kind}`} aria-hidden="true">
      <svg viewBox="0 0 30 120" preserveAspectRatio="none"><path d={FENCE_PATH[kind === "l" ? "l" : kind === "r" ? "r" : "bar"]} /></svg>
    </span>
  );
}
function Radical({ index }) {
  return (
    <span className={`m-radical${index ? " m-radical-idx" : ""}`} aria-hidden="true">
      {index && <span className="m-index">{index}</span>}
      <svg viewBox="0 0 60 120" preserveAspectRatio="none"><path d="M2 74 L13 66 L29 117 L58 1.5" /></svg>
    </span>
  );
}

// Zero-width caret. The zero-width space gives it a real line box, so its
// height and baseline follow the local font size in inline and flex contexts.
function Caret({ blink }) {
  return <span key={blink} className="m-caret" aria-hidden="true">{"​"}</span>;
}

// ─── Chars ──────────────────────────────────────────────────────────────────
function charClass(v, prev) {
  if (/^[0-9.]$/.test(v)) return "m-n";
  if (BINARY.has(v)) {
    const unary = !prev || (prev.type === "char" && (BINARY.has(prev.value) || prev.value === "=" || prev.value === "," || prev.value === "("));
    return unary ? "m-o m-u" : "m-o";
  }
  if (v === "=") return "m-o m-eq";
  if (v === "%" || v === "!") return "m-o m-post";
  if (v === ",") return "m-comma";
  if (v === "(" || v === ")") return "m-p";
  if (v === "E") return "m-E";
  if (v === "ans") return "m-ans";
  return "m-v";
}
function charText(v) {
  if (v === "ans") return "Ans";
  return OP_GLYPH[v] ?? v;
}

// ─── Nodes ──────────────────────────────────────────────────────────────────
function Node({ node, prev, ctx, dp, di }) {
  const data = { "data-p": dp, "data-i": di };
  switch (node.type) {
    case "char":
      return <span className={charClass(node.value, prev)} {...data}>{charText(node.value)}</span>;
    case "frac":
      return (
        <span className="m-frac" {...data}>
          <Seq seq={node.num} ctx={ctx} cls="m-num" />
          <span className="m-bar" />
          <Seq seq={node.den} ctx={ctx} cls="m-den" />
        </span>
      );
    case "sup":
      return (
        <span className="m-sup" {...data}>
          <Seq seq={node.exp} ctx={ctx} cls="m-exp" />
        </span>
      );
    case "sqrt":
      return (
        <span className="m-sqrt" {...data}>
          <Radical />
          <Seq seq={node.rad} ctx={ctx} cls="m-rad" />
        </span>
      );
    case "paren":
      return (
        <span className="m-paren" {...data}>
          <Fence kind="l" />
          <Seq seq={node.inner} ctx={ctx} cls="m-inner" />
          <Fence kind="r" />
        </span>
      );
    case "func": {
      const { name, arg } = node;
      if (name === "cbrt") {
        return (
          <span className="m-sqrt" {...data}>
            <Radical index="3" />
            <Seq seq={arg} ctx={ctx} cls="m-rad" />
          </span>
        );
      }
      if (name === "abs") {
        return (
          <span className="m-paren m-abs" {...data}>
            <Fence kind="bar" />
            <Seq seq={arg} ctx={ctx} cls="m-inner" />
            <Fence kind="bar" />
          </span>
        );
      }
      if (name === "exp") {
        // exp(x) reads as eˣ; the argument is the exponent slot.
        return (
          <span className="m-supwrap" {...data}>
            <span className="m-b"><span className="m-v">e</span></span>
            <span className="m-sup"><Seq seq={arg} ctx={ctx} cls="m-exp" /></span>
          </span>
        );
      }
      const sub = FN_SUB[name];
      return (
        <span className="m-func" {...data}>
          <span className="m-fn">{sub ? <>{sub[0]}<span className="m-fsub">{sub[1]}</span></> : name}</span>
          <Fence kind="l" />
          <Seq seq={arg} ctx={ctx} cls="m-inner" />
          <Fence kind="r" />
        </span>
      );
    }
    default:
      return null;
  }
}

// ─── Seq ────────────────────────────────────────────────────────────────────
// A seq renders its children with the caret spliced in. Exponents are grouped
// with the node they raise into one .m-supwrap (flex: the exponent aligns to
// the base's top). The top-level seq additionally splits into .m-run groups
// that break only after operators, so a long expression wraps between terms
// and never inside a number.
function Seq({ seq, ctx, cls = "", root = false }) {
  const kids = seq.children;
  const caretPos = ctx.cur && ctx.cur.seqId === seq.id ? ctx.cur.pos : -1;
  const active = caretPos >= 0;
  const base = `m-seq ${cls}${active ? " m-active" : ""}${root ? " m-rootseq" : ""}`;

  if (!kids.length) {
    if (root) {
      return (
        <span className={base} data-seq={seq.id}>
          {active && <Caret blink={ctx.blink} />}
          {ctx.placeholder && <span className="m-placeholder">{ctx.placeholder}</span>}
        </span>
      );
    }
    return (
      <span className={`${base} m-empty`} data-seq={seq.id}>
        <span className={`m-slot${active ? " m-slot-on" : ""}`} key={active ? ctx.blink : "s"} />
      </span>
    );
  }

  const caret = (i) => (caretPos === i ? <Caret key={`c${ctx.blink}`} blink={ctx.blink} /> : null);
  const node = (i) => <Node key={kids[i].id} node={kids[i]} prev={kids[i - 1]} ctx={ctx} dp={seq.id} di={i} />;

  // units: [startIdx, endIdx] — a node plus any exponents trailing it
  const units = [];
  for (let i = 0; i < kids.length; i++) {
    let j = i;
    while (j + 1 < kids.length && kids[j + 1].type === "sup") j++;
    units.push([i, j]);
    i = j;
  }

  const renderUnit = ([i, j]) => {
    if (i === j && kids[i].type !== "sup") return [caret(i), node(i)];
    const first = kids[i].type === "sup" ? i : i + 1; // a leading exponent has no base
    return [
      caret(i),
      <span className="m-supwrap" key={`w${kids[i].id}`}>
        <span className="m-b">{first === i ? <span className="m-slot m-ghost" /> : node(i)}</span>
        {Array.from({ length: j - first + 1 }, (_, k) => [k > 0 || first > i ? caret(first + k) : null, node(first + k)])}
      </span>,
    ];
  };

  let body;
  if (root) {
    // group units into runs that end after a binary operator / relation / comma
    const runs = [];
    let run = [];
    for (const u of units) {
      run.push(u);
      const n = kids[u[1]];
      const breaksAfter = n.type === "char" && /^m-(o|comma)(?! m-u| m-post)/.test(charClass(n.value, kids[u[1] - 1]));
      if (breaksAfter) { runs.push(run); run = []; }
    }
    if (run.length) runs.push(run);
    body = runs.map((r, k) => <span className="m-run" key={`r${k}`}>{r.map(renderUnit)}</span>);
  } else {
    body = units.map(renderUnit);
  }

  return (
    <span className={base} data-seq={seq.id}>
      {body}
      {caret(kids.length)}
    </span>
  );
}

// ─── Public component ───────────────────────────────────────────────────────
// root: the tree · cur: caret {seqId,pos} or null (read-only) · blink: changes
// on every caret move to restart the blink · placeholder: shown when empty.
export default function MathView({ root, cur = null, blink = 0, placeholder = null, className = "" }) {
  if (!root) return null;
  const ctx = { cur, blink, placeholder };
  return (
    <div className={`m-root ${className}`}>
      <Seq seq={root} ctx={ctx} root />
    </div>
  );
}

// ─── Hit testing ────────────────────────────────────────────────────────────
// Nearest caret position to a viewport point: the innermost seq whose box
// contains the point (slightly padded so small exponents are easy to hit),
// then the closest gap between its children — before OR after a glyph.
export function caretFromPoint(container, x, y) {
  if (!container) return null;
  const PAD = 5;
  let best = null, bestArea = Infinity;
  for (const el of container.querySelectorAll("[data-seq]")) {
    const r = el.getBoundingClientRect();
    if (x >= r.left - PAD && x <= r.right + PAD && y >= r.top - PAD && y <= r.bottom + PAD) {
      const area = (r.width + 2 * PAD) * (r.height + 2 * PAD);
      if (area < bestArea) { best = el; bestArea = area; }
    }
  }
  if (!best) best = container.querySelector(".m-rootseq");
  if (!best) return null;
  const seqId = Number(best.dataset.seq);
  const kids = container.querySelectorAll(`[data-p="${seqId}"]`);
  if (!kids.length) return { seqId, pos: 0 };

  let bestPos = 0, bestD = Infinity;
  const consider = (pos, cx, rect) => {
    const dy = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
    const d = Math.abs(x - cx) + dy * 3; // prefer the right line when wrapped
    if (d < bestD) { bestD = d; bestPos = pos; }
  };
  kids.forEach((k, i) => {
    const r = k.getBoundingClientRect();
    consider(i, r.left, r);       // gap before child i
    consider(i + 1, r.right, r);  // gap after child i
  });
  return { seqId, pos: bestPos };
}
