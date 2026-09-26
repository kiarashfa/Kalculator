import Sheet, { SheetTabs } from "./Sheet.jsx";
import Icon from "./Icon.jsx";

// One sheet for help and about: Guide (how things work), Keys (keyboard
// shortcuts) and About (the app, its developer, support links).
const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "⌘" : "Ctrl+";

const GUIDE = [
  { icon: "pages", title: "One page per calculation", text: "Press = and the answer appears under your expression — you can still edit it. CE opens a blank page; ‹ › flip between pages. Prefer a running list? Turn Pages off in settings." },
  { icon: "hand", title: "Tap or drag to place the cursor", text: "Anywhere in the expression, before or after any digit, even inside fractions and powers. ◀ ▶ nudge it one step." },
  { icon: "copy", title: "Copy & paste keep the math", text: "Right-click (or long-press) the display for copy, paste and LaTeX. 2^3 pastes back as 2³, (1+2)/3 as a fraction." },
  { icon: "file", title: "Documents", text: "Pages are saved in this browser as you go. Save a document to a .kalc file to keep a copy or open it on another device." },
  { icon: "up", title: "ƒ shows the function keys", text: "On phones the function rows fold away for a bigger display. Tap ƒ, press ⇧, or swipe the key row above the numbers." },
  { icon: "check", title: "Hold = for an equals sign", text: "Type equations such as x² − 4 = 0 in Solve. A short press of = still calculates." },
  { icon: "eraser", title: "Hold ⌫ to clear", text: "Clears the expression on the page. Undo (↶) brings it back." },
  { icon: "plus", title: "Keep going from the answer", text: "Right after =, start a new page with + − × ÷ to continue from Ans." },
  { icon: "bulb", title: "Suggestions", text: "Turn on in settings: while you type, chips show the value of the part you're in, the exact fraction, and quick functions." },
];

const KEYS = [
  { group: "Type", rows: [
    [["0–9", "+", "−", "*"], "Numbers and operators"],
    [["/"], "Fraction"], [["^"], "Power"], [["( )"], "Group · ) closes the function you're in"],
    [["sin(", "sqrt(", "pi"], "Type names — they turn into math"],
    [["="], "Equals sign (for equations)"], [["Enter"], "Calculate"],
  ] },
  { group: "Edit", rows: [
    [["←", "→", "↑", "↓"], "Move the cursor, in and out of fractions and powers"],
    [["Home", "End"], "Start / end"], [["Tab"], "Leave a fraction or power"],
    [["⌫", "Del"], "Delete"], [[`${MOD}Z`, `${MOD}Y`], "Undo / redo"],
    [["Esc"], "New page (Classic: clear)"],
  ] },
  { group: "Clipboard", rows: [
    [[`${MOD}C`], "Copy the expression"], [[`${MOD}X`], "Cut"], [[`${MOD}V`], "Paste (formatting kept)"],
  ] },
  { group: "Pages & documents", rows: [
    [["PgUp", "PgDn"], "Previous / next page"], [[`${MOD}S`], "Save to file"], [[`${MOD}O`], "Open a file"],
  ] },
];

// Edit this block to change the About text.
const ABOUT = {
  intro: "Kalculator is a free scientific calculator that writes math the way it looks on paper — fractions stacked, powers raised, roots drawn — while you type. It solves equations, draws graphs, does derivatives and integrals, converts units, currencies and number bases, and keeps your work in documents you can save and reopen.",
  privacy: "It runs entirely in your browser: no account and no ads, and your calculations and documents stay on your device.",
  dev: "Designed and built by Kiarash Farajzadehahary — Kia, the K in Kalculator. It's an independent project, made with care for everyone who counts.",
  links: [
    { icon: "globe", label: "Website", href: "https://kiarashfa.github.io/website/" },
    { icon: "github", label: "GitHub", href: "https://github.com/kiarashfa" },
    { icon: "mail", label: "Email", href: "mailto:kiarashfa@gmail.com" },
  ],
  support: [
    { icon: "paypal", label: "Donate with PayPal", href: "https://www.paypal.com/donate/?hosted_button_id=S3BD5XFBMMWSJ" },
    { icon: "coffee", label: "Buy me a coffee", href: "https://www.buymeacoffee.com/kiarashfa" },
  ],
  source: "https://github.com/kiarashfa/Kalculator",
};

function Guide() {
  return (
    <div className="k-guide">
      {GUIDE.map((g) => (
        <div key={g.title} className="k-guide-card">
          <span className="k-guide-ic"><Icon name={g.icon} size={18} /></span>
          <div><h3>{g.title}</h3><p>{g.text}</p></div>
        </div>
      ))}
    </div>
  );
}

function Keys() {
  return (
    <div className="k-keys">
      {KEYS.map((grp) => (
        <section key={grp.group}>
          <h3 className="k-eyebrow">{grp.group}</h3>
          <div className="k-keys-list">
            {grp.rows.map(([keys, what]) => (
              <div key={what} className="k-keys-row">
                <span className="k-keys-caps">{keys.map((k) => <kbd key={k}>{k}</kbd>)}</span>
                <span className="k-keys-what">{what}</span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function About() {
  const ext = { target: "_blank", rel: "noopener noreferrer" };
  return (
    <div className="k-about">
      <div className="k-about-hero">
        <img src={`${import.meta.env.BASE_URL}icons/favicon.svg`} alt="" width={56} height={56} />
        <div>
          <h3>Kalculator</h3>
          <p>A calculator that writes math the way you do.</p>
        </div>
      </div>
      <p className="k-about-text">{ABOUT.intro}</p>
      <p className="k-about-text dim">{ABOUT.privacy}</p>

      <section className="k-about-card">
        <h3 className="k-eyebrow">The developer</h3>
        <p className="k-about-text">{ABOUT.dev}</p>
        <div className="k-chiprow">
          {ABOUT.links.map((l) => (
            <a key={l.label} className="k-linkchip" href={l.href} {...(l.href.startsWith("http") ? ext : {})}>
              <Icon name={l.icon} size={15} />{l.label}
            </a>
          ))}
        </div>
      </section>

      <section className="k-about-card support">
        <h3 className="k-eyebrow"><Icon name="heart" size={12} /> Support Kalculator</h3>
        <p className="k-about-text">Kalculator is free. If it saves you time, you can help keep it going:</p>
        <div className="k-support">
          {ABOUT.support.map((s) => (
            <a key={s.label} className={`k-supportbtn ${s.icon}`} href={s.href} {...ext}>
              <Icon name={s.icon} size={18} />{s.label}
            </a>
          ))}
        </div>
      </section>

      <p className="k-about-foot">
        © {new Date().getFullYear()} Kiarash Farajzadehahary · Source-available under the KFA License 1.0 ·{" "}
        <a href={ABOUT.source} {...ext}>Source code</a>
      </p>
    </div>
  );
}

const TABS = [
  { id: "guide", label: "Guide", icon: "bulb" },
  { id: "keys", label: "Keys", icon: "keyboard" },
  { id: "about", label: "About", icon: "info" },
];

export default function InfoSheet({ tab, onTab, onClose }) {
  return (
    <Sheet title={tab === "about" ? "About" : "Help"} onClose={onClose} className="k-info"
      tabs={<SheetTabs tabs={TABS} value={tab} onChange={onTab} />}>
      {tab === "guide" && <Guide />}
      {tab === "keys" && <Keys />}
      {tab === "about" && <About />}
    </Sheet>
  );
}
