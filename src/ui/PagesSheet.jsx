import { useEffect, useRef } from "react";
import Sheet from "./Sheet.jsx";
import Icon from "./Icon.jsx";
import MathView from "../MathView.jsx";
import { prettyNum, shownResult } from "./Result.jsx";
import { isBlank, isFresh, MAX_PAGES } from "../docs.js";

const MODE_TAG = { solve: "Solve", graph: "Graph", calculus: "∫dx" };

// Every page of the open document at a glance: jump, delete, add.
export default function PagesSheet({ docName, pages, current, onGo, onDelete, onNew, onDocs, onClose }) {
  const listRef = useRef(null);
  useEffect(() => { listRef.current?.querySelector(".on")?.scrollIntoView({ block: "center" }); }, []);
  return (
    <Sheet title={docName} subtitle={`${pages.length} of ${MAX_PAGES} pages`} onClose={onClose} className="k-pagesheet"
      footer={<>
        <button className="k-btn ghost grow" onClick={onDocs}><Icon name="file" size={15} />Documents</button>
        <button className="k-btn grow" onClick={onNew}><Icon name="plus" size={15} />New page</button>
      </>}>
      <ol className="k-pagelist" ref={listRef}>
        {pages.map((p, i) => {
          const fresh = isFresh(p);
          return (
            <li key={p.id} className={`k-pagerow${i === current ? " on" : ""}`}>
              <button className="k-pagerow-main" onClick={() => onGo(i)}>
                <span className="k-pagerow-no">{i + 1}</span>
                <span className="k-pagerow-body">
                  {isBlank(p) ? <span className="k-pagerow-blank">Blank page</span> : <MathView root={p.tree} />}
                  <span className="k-pagerow-res">
                    {MODE_TAG[p.mode] && <em>{MODE_TAG[p.mode]}</em>}
                    {fresh && p.out.type !== "graph" ? (p.out.type === "calc" ? "= " : "") + prettyNum(p.out.solutions?.length ? `x = ${p.out.solutions.join(", ")}` : shownResult(p.out)) : ""}
                  </span>
                </span>
              </button>
              <button className="k-iconbtn" title="Delete page" onClick={() => onDelete(i)}><Icon name="trash" size={15} /></button>
            </li>
          );
        })}
      </ol>
    </Sheet>
  );
}
