import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { math, mathFrac } from "./mathInstance.js";
import { createMathEngine } from "./mathjsEngine.js";
import { loadHistory, saveHistory } from "./historyDB.js";
import { parseInBase, formatBases } from "./baseConvert.js";
import {
  mkSeq, mkChar, mkFrac, mkSup, mkSqrt, mkFunc, mkParen,
  toExpr, findSeq, findParentOf, extractPrecedingOperand,
} from "./mathAst.js";

// math.js-backed engine (eval/solve/graph) + a Fraction-mode instance for exact
// results. Built once at module load.
const MathEngine = createMathEngine(math, mathFrac);

// ─── Unit & Currency Data (compact) ─────────────────────────────────────────
const UNIT_DATA = {
  "Length":{"Meter (m)":1,"Kilometer (km)":1000,"Centimeter (cm)":0.01,"Millimeter (mm)":0.001,"Micrometer (μm)":1e-6,"Nanometer (nm)":1e-9,"Mile (mi)":1609.344,"Yard (yd)":0.9144,"Foot (ft)":0.3048,"Inch (in)":0.0254,"Nautical Mile":1852,"Light Year":9.461e15},
  "Area":{"Square Meter (m²)":1,"Square Kilometer (km²)":1e6,"Square Centimeter (cm²)":1e-4,"Hectare (ha)":10000,"Acre":4046.856,"Square Mile (mi²)":2589988,"Square Yard (yd²)":0.8361,"Square Foot (ft²)":0.0929,"Square Inch (in²)":6.452e-4},
  "Volume":{"Liter (L)":1,"Milliliter (mL)":0.001,"Cubic Meter (m³)":1000,"Gallon (US)":3.785,"Gallon (UK)":4.546,"Quart (US)":0.946,"Pint (US)":0.473,"Cup (US)":0.237,"Fluid Oz (US)":0.0296,"Tablespoon":0.0148,"Teaspoon":0.00493,"Cubic Foot":28.317},
  "Mass":{"Kilogram (kg)":1,"Gram (g)":0.001,"Milligram (mg)":1e-6,"Metric Ton (t)":1000,"Pound (lb)":0.4536,"Ounce (oz)":0.02835,"Stone":6.350,"Short Ton (US)":907.2,"Long Ton (UK)":1016,"Carat":2e-4},
  "Temperature":{"Celsius (°C)":"C","Fahrenheit (°F)":"F","Kelvin (K)":"K","Rankine (°R)":"R"},
  "Speed":{"m/s":1,"km/h":0.2778,"mph":0.4470,"Knot":0.5144,"ft/s":0.3048,"Mach":343,"Speed of Light":299792458},
  "Time":{"Second":1,"Millisecond":0.001,"Minute":60,"Hour":3600,"Day":86400,"Week":604800,"Month (avg)":2629746,"Year":31556952},
  "Energy":{"Joule (J)":1,"Kilojoule (kJ)":1000,"Calorie":4.184,"Kilocalorie":4184,"Watt-hour":3600,"kWh":3.6e6,"BTU":1055,"eV":1.602e-19},
  "Power":{"Watt (W)":1,"Kilowatt (kW)":1000,"Megawatt (MW)":1e6,"Horsepower (hp)":745.7,"BTU/h":0.293},
  "Pressure":{"Pascal (Pa)":1,"Kilopascal (kPa)":1000,"Bar":1e5,"PSI":6895,"Atmosphere":101325,"Torr":133.3},
  "Data":{"Bit":1,"Byte":8,"Kilobyte (KB)":8000,"Megabyte (MB)":8e6,"Gigabyte (GB)":8e9,"Terabyte (TB)":8e12},
  "Frequency":{"Hertz (Hz)":1,"kHz":1000,"MHz":1e6,"GHz":1e9,"RPM":1/60},
  "Force":{"Newton (N)":1,"kN":1000,"Dyne":1e-5,"Pound-force":4.448,"kgf":9.807},
  "Angle":{"Degree (°)":1,"Radian":57.296,"Gradian":0.9,"Revolution":360},
};
function convertTemperature(v,from,to){let c;if(from==="C")c=v;else if(from==="F")c=(v-32)*5/9;else if(from==="K")c=v-273.15;else c=(v-491.67)*5/9;if(to==="C")return c;if(to==="F")return c*9/5+32;if(to==="K")return c+273.15;return(c+273.15)*9/5;}
function convertUnit(v,cat,from,to){if(from===to)return v;const c=UNIT_DATA[cat];if(!c)return null;if(cat==="Temperature")return convertTemperature(v,c[from],c[to]);const ff=c[from],tf=c[to];if(typeof ff!=="number"||typeof tf!=="number")return null;return(v*ff)/tf;}

const CURRENCY_DATA = {
  "USD":{rate:1,name:"US Dollar",flag:"🇺🇸"},"EUR":{rate:0.86,name:"Euro",flag:"🇪🇺"},"GBP":{rate:0.74,name:"British Pound",flag:"🇬🇧"},
  "JPY":{rate:153.8,name:"Japanese Yen",flag:"🇯🇵"},"AUD":{rate:1.39,name:"Australian Dollar",flag:"🇦🇺"},"CAD":{rate:1.38,name:"Canadian Dollar",flag:"🇨🇦"},
  "CHF":{rate:0.81,name:"Swiss Franc",flag:"🇨🇭"},"CNY":{rate:6.73,name:"Chinese Yuan",flag:"🇨🇳"},"INR":{rate:94.8,name:"Indian Rupee",flag:"🇮🇳"},
  "MXN":{rate:16.93,name:"Mexican Peso",flag:"🇲🇽"},"BRL":{rate:5.10,name:"Brazilian Real",flag:"🇧🇷"},"KRW":{rate:1341,name:"South Korean Won",flag:"🇰🇷"},
  "SGD":{rate:1.26,name:"Singapore Dollar",flag:"🇸🇬"},"HKD":{rate:7.84,name:"Hong Kong Dollar",flag:"🇭🇰"},"SEK":{rate:9.59,name:"Swedish Krona",flag:"🇸🇪"},
  "NZD":{rate:1.71,name:"New Zealand Dollar",flag:"🇳🇿"},"ZAR":{rate:16.0,name:"S. African Rand",flag:"🇿🇦"},"TRY":{rate:48.5,name:"Turkish Lira",flag:"🇹🇷"},
  "PLN":{rate:3.71,name:"Polish Zloty",flag:"🇵🇱"},"THB":{rate:32.9,name:"Thai Baht",flag:"🇹🇭"},"AED":{rate:3.67,name:"UAE Dirham",flag:"🇦🇪"},
  "SAR":{rate:3.75,name:"Saudi Riyal",flag:"🇸🇦"},"ILS":{rate:3.02,name:"Israeli Shekel",flag:"🇮🇱"},"EGP":{rate:51.0,name:"Egyptian Pound",flag:"🇪🇬"},
  "PKR":{rate:277.5,name:"Pakistani Rupee",flag:"🇵🇰"},"NGN":{rate:1322,name:"Nigerian Naira",flag:"🇳🇬"},"KWD":{rate:0.31,name:"Kuwaiti Dinar",flag:"🇰🇼"},
};
// Hardcoded snapshot — NOT live. Update this label whenever the rates above change.
const CURRENCY_RATES_DATE = "September 2026";

// ─── Math Engine ─── math.js-backed (./mathjsEngine.js) + structural tree (./mathAst.js) ─


// ─── Structural math tree ─── extracted to ./mathAst.js (Node-testable) ──────


// ─── Math Render ────────────────────────────────────────────────────────────
function MathRender({ node, fontSize, cursorSeqId, cursorPos, onTapSeq }) {
  if (!node) return null;
  const f = fontSize || 22;

  if (node.type === "char") {
    const isOp = "+-×÷*/%=".includes(node.value);
    const isLetter = /^[a-zA-Zπ]/.test(node.value);
    return (
      <span style={{ fontSize: f, fontFamily: "'Space Grotesk',sans-serif", fontWeight: 500,
        color: isOp ? "#f472b6" : isLetter ? "#60a5fa" : "#e8e8e8",
        padding: "0 0.5px", lineHeight: 1.1
      }}>
        {node.value === "*" ? "×" : node.value}
      </span>
    );
  }

  if (node.type === "seq") {
    const isEmpty = node.children.length === 0;
    const isHere = cursorSeqId === node.id;
    return (
      <span
        onClick={(e) => { e.stopPropagation(); onTapSeq(node.id, node.children.length); }}
        style={{
          display: "inline-flex", alignItems: "baseline", flexWrap: "wrap", cursor: "text",
          minWidth: isEmpty ? Math.max(12, f * 0.5) : undefined,
          minHeight: isEmpty ? f * 0.65 : undefined,
          background: isEmpty ? "rgba(244,114,182,0.06)" : "transparent",
          border: isEmpty ? "1px dashed rgba(244,114,182,0.15)" : "none",
          borderRadius: 3, position: "relative", padding: isEmpty ? "0 2px" : 0,
        }}
      >
        {isHere && cursorPos === 0 && <Cursor h={f * 0.85} />}
        {node.children.map((child, i) => (
          <span key={child.id} style={{ display: "inline-flex", alignItems: "baseline" }}
            onClick={(e) => { e.stopPropagation(); onTapSeq(node.id, i + 1); }}>
            <MathRender node={child} fontSize={f} cursorSeqId={cursorSeqId} cursorPos={cursorPos} onTapSeq={onTapSeq} />
            {isHere && cursorPos === i + 1 && <Cursor h={f * 0.85} />}
          </span>
        ))}
      </span>
    );
  }

  if (node.type === "frac") {
    return (
      <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "center", verticalAlign: "middle", margin: "0 4px" }}>
        <span style={{ display: "flex", justifyContent: "center", padding: "2px 6px", minWidth: 20 }}>
          <MathRender node={node.num} fontSize={f * 0.78} cursorSeqId={cursorSeqId} cursorPos={cursorPos} onTapSeq={onTapSeq} />
        </span>
        <span style={{ width: "100%", minWidth: 20, height: 1.5, background: "#777", borderRadius: 1, margin: "2px 0" }} />
        <span style={{ display: "flex", justifyContent: "center", padding: "2px 6px", minWidth: 20 }}>
          <MathRender node={node.den} fontSize={f * 0.78} cursorSeqId={cursorSeqId} cursorPos={cursorPos} onTapSeq={onTapSeq} />
        </span>
      </span>
    );
  }

  if (node.type === "sup") {
    return (
      <span style={{ display: "inline-flex", alignItems: "flex-start" }}>
        <MathRender node={node.base} fontSize={f} cursorSeqId={cursorSeqId} cursorPos={cursorPos} onTapSeq={onTapSeq} />
        <span style={{ marginTop: f * -0.4, marginLeft: 1 }}>
          <MathRender node={node.exp} fontSize={f * 0.58} cursorSeqId={cursorSeqId} cursorPos={cursorPos} onTapSeq={onTapSeq} />
        </span>
      </span>
    );
  }

  if (node.type === "sqrt") {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", margin: "0 2px" }}>
        <span style={{ color: "#888", fontSize: f * 1.15, fontFamily: "serif", lineHeight: 0.85, marginRight: -1 }}>√</span>
        <span style={{ borderTop: "1.5px solid #888", display: "inline-flex", padding: "3px 4px 0", minWidth: 14 }}>
          <MathRender node={node.rad} fontSize={f * 0.85} cursorSeqId={cursorSeqId} cursorPos={cursorPos} onTapSeq={onTapSeq} />
        </span>
      </span>
    );
  }

  if (node.type === "func") {
    return (
      <span style={{ display: "inline-flex", alignItems: "center" }}>
        <span style={{ color: "#34d399", fontSize: f * 0.75, fontFamily: "'DM Mono',monospace", fontWeight: 600, marginRight: 1 }}>{node.name}</span>
        <span style={{ color: "#555", fontSize: f * 0.85 }}>(</span>
        <MathRender node={node.arg} fontSize={f * 0.88} cursorSeqId={cursorSeqId} cursorPos={cursorPos} onTapSeq={onTapSeq} />
        <span style={{ color: "#555", fontSize: f * 0.85 }}>)</span>
      </span>
    );
  }

  if (node.type === "paren") {
    return (
      <span style={{ display: "inline-flex", alignItems: "center" }}>
        <span style={{ color: "#555", fontSize: f }}>( </span>
        <MathRender node={node.inner} fontSize={f} cursorSeqId={cursorSeqId} cursorPos={cursorPos} onTapSeq={onTapSeq} />
        <span style={{ color: "#555", fontSize: f }}> )</span>
      </span>
    );
  }

  return null;
}

function Cursor({ h }) {
  return <span style={{ display: "inline-block", width: 2, height: h, background: "#f472b6", borderRadius: 1, marginLeft: 1, marginRight: 1, animation: "cursorBlink 1s infinite", flexShrink: 0 }} />;
}


// ─── Graph ──────────────────────────────────────────────────────────────────
function GraphView({ expressions, onClose }) {
  const canvasRef=useRef(null);const[vp,setVp]=useState({xMin:-10,xMax:10,yMin:-7,yMax:7});const dragRef=useRef(null);
  const colors=["#f472b6","#60a5fa","#34d399","#fbbf24","#a78bfa","#fb923c"];
  const draw=useCallback(()=>{const cv=canvasRef.current;if(!cv)return;const ctx=cv.getContext("2d");const W=cv.width=cv.offsetWidth*2,H=cv.height=cv.offsetHeight*2;ctx.scale(2,2);const w=W/2,h=H/2;const{xMin,xMax,yMin,yMax}=vp;const sx=x=>((x-xMin)/(xMax-xMin))*w,sy=y=>h-((y-yMin)/(yMax-yMin))*h;ctx.fillStyle="#0a0a0f";ctx.fillRect(0,0,w,h);const gs=v=>{const r=v/8,m=Math.pow(10,Math.floor(Math.log10(r))),n=r/m;return n<1.5?m:n<3.5?2*m:n<7.5?5*m:10*m;};const xs=gs(xMax-xMin),ys=gs(yMax-yMin);ctx.strokeStyle="rgba(255,255,255,0.06)";ctx.lineWidth=0.5;for(let x=Math.ceil(xMin/xs)*xs;x<=xMax;x+=xs){const px=sx(x);ctx.beginPath();ctx.moveTo(px,0);ctx.lineTo(px,h);ctx.stroke();ctx.fillStyle="rgba(255,255,255,0.3)";ctx.font="10px monospace";ctx.textAlign="center";if(Math.abs(x)>xs*0.01)ctx.fillText(parseFloat(x.toPrecision(4)),px,sy(0)+14);}for(let y=Math.ceil(yMin/ys)*ys;y<=yMax;y+=ys){const py=sy(y);ctx.beginPath();ctx.moveTo(0,py);ctx.lineTo(w,py);ctx.stroke();ctx.fillStyle="rgba(255,255,255,0.3)";ctx.font="10px monospace";ctx.textAlign="right";if(Math.abs(y)>ys*0.01)ctx.fillText(parseFloat(y.toPrecision(4)),sx(0)-6,py+3);}ctx.strokeStyle="rgba(255,255,255,0.25)";ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(sx(0),0);ctx.lineTo(sx(0),h);ctx.stroke();ctx.beginPath();ctx.moveTo(0,sy(0));ctx.lineTo(w,sy(0));ctx.stroke();expressions.forEach((expr,idx)=>{const pts=MathEngine.graphPts(expr,xMin,xMax,Math.min(800,w));ctx.strokeStyle=colors[idx%colors.length];ctx.lineWidth=2;ctx.lineJoin="round";ctx.beginPath();let d=false,prevY=null;for(const p of pts){if(p.y===null||Math.abs(p.y)>(yMax-yMin)*50){d=false;prevY=null;continue;}if(prevY!==null&&Math.abs(p.y-prevY)>(yMax-yMin)){d=false;}/* asymptote jump → pen up */const px=sx(p.x),py=sy(p.y);if(!d){ctx.moveTo(px,py);d=true;}else ctx.lineTo(px,py);prevY=p.y;}ctx.stroke();});expressions.forEach((e,i)=>{ctx.fillStyle=colors[i%colors.length];ctx.font="bold 12px monospace";ctx.textAlign="left";ctx.fillText(`f(x) = ${e}`,12,20+i*20);});},[vp,expressions]);
  useEffect(()=>{draw();},[draw]);
  return(<div style={{position:"fixed",inset:0,zIndex:100,background:"#0a0a0f",display:"flex",flexDirection:"column"}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 16px",borderBottom:"1px solid rgba(255,255,255,0.08)"}}><span style={{color:"#f472b6",fontWeight:700,fontSize:14}}>GRAPH</span><div style={{display:"flex",gap:8}}><button onClick={()=>setVp({xMin:-10,xMax:10,yMin:-7,yMax:7})} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"#ccc",borderRadius:6,padding:"6px 14px",cursor:"pointer",fontSize:11}}>Reset</button><button onClick={onClose} style={{background:"rgba(244,114,182,0.15)",border:"1px solid rgba(244,114,182,0.3)",color:"#f472b6",borderRadius:6,padding:"6px 14px",cursor:"pointer",fontSize:11,fontWeight:600}}>Close</button></div></div><canvas ref={canvasRef} style={{flex:1,cursor:"grab",touchAction:"none"}} onWheel={e=>{e.preventDefault();const f=e.deltaY>0?1.15:0.87;setVp(v=>{const cx=(v.xMin+v.xMax)/2,cy=(v.yMin+v.yMax)/2,hw=((v.xMax-v.xMin)/2)*f,hh=((v.yMax-v.yMin)/2)*f;return{xMin:cx-hw,xMax:cx+hw,yMin:cy-hh,yMax:cy+hh};});}} onPointerDown={e=>{const r=canvasRef.current.getBoundingClientRect();dragRef.current={x:e.clientX,y:e.clientY,v:{...vp},r};canvasRef.current.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(!dragRef.current)return;const{x,y,v,r}=dragRef.current;const dx=(e.clientX-x)/r.width*(v.xMax-v.xMin),dy=(e.clientY-y)/r.height*(v.yMax-v.yMin);setVp({xMin:v.xMin-dx,xMax:v.xMax-dx,yMin:v.yMin+dy,yMax:v.yMax+dy});}} onPointerUp={()=>{dragRef.current=null;}}/></div>);
}


// ─── Unit Converter ─────────────────────────────────────────────────────────
function UnitPanel() {
  const cats=Object.keys(UNIT_DATA);const[cat,setCat]=useState("Length");const[fu,setFu]=useState("");const[tu,setTu]=useState("");const[fv,setFv]=useState("1");const[search,setSearch]=useState("");const[showCat,setShowCat]=useState(false);
  const units=useMemo(()=>Object.keys(UNIT_DATA[cat]||{}),[cat]);
  useEffect(()=>{setFu(units[0]||"");setTu(units[1]||"");},[cat,units]);
  const result=useMemo(()=>{const v=parseFloat(fv);if(isNaN(v))return"";const r=convertUnit(v,cat,fu,tu);if(r===null)return"—";if(Math.abs(r)<1e-4||Math.abs(r)>1e12)return r.toExponential(6);return parseFloat(r.toPrecision(10)).toLocaleString("en-US",{maximumFractionDigits:10});},[fv,cat,fu,tu]);
  const ss={width:"100%",padding:"10px 12px",borderRadius:8,fontSize:13,fontFamily:"'DM Mono',monospace",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",color:"#ddd",appearance:"none",outline:"none"};
  const fc=cats.filter(c=>c.toLowerCase().includes(search.toLowerCase()));
  return(<div style={{padding:16,display:"flex",flexDirection:"column",gap:12,flex:1,overflowY:"auto"}}><button onClick={()=>setShowCat(!showCat)} style={{padding:"10px 14px",borderRadius:10,fontSize:13,fontWeight:600,fontFamily:"'DM Mono',monospace",cursor:"pointer",textAlign:"left",background:"rgba(251,191,36,0.08)",border:"1px solid rgba(251,191,36,0.15)",color:"#fbbf24",display:"flex",justifyContent:"space-between",alignItems:"center"}}><span>{cat}</span><span style={{fontSize:10,opacity:0.6}}>{showCat?"▲":"▼"}</span></button>{showCat&&<div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:10,maxHeight:240,overflowY:"auto",padding:4}}><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search..." style={{width:"100%",padding:"8px",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:6,color:"#ccc",fontSize:12,fontFamily:"'DM Mono',monospace",outline:"none",marginBottom:4,boxSizing:"border-box"}}/>{fc.map(c=><button key={c} onClick={()=>{setCat(c);setShowCat(false);setSearch("");}} style={{display:"block",width:"100%",textAlign:"left",padding:"8px 10px",background:c===cat?"rgba(251,191,36,0.1)":"transparent",border:"none",color:c===cat?"#fbbf24":"#999",fontSize:12,fontFamily:"'DM Mono',monospace",cursor:"pointer",borderRadius:6}}>{c}</button>)}</div>}<div style={{background:"rgba(255,255,255,0.02)",borderRadius:12,padding:14,border:"1px solid rgba(255,255,255,0.05)"}}><div style={{fontSize:10,color:"#666",marginBottom:8,textTransform:"uppercase",letterSpacing:1}}>From</div><input value={fv} onChange={e=>setFv(e.target.value)} type="number" inputMode="decimal" style={{width:"100%",padding:"10px 0",background:"transparent",border:"none",outline:"none",color:"#fff",fontSize:28,fontFamily:"'DM Mono',monospace",fontWeight:600,boxSizing:"border-box"}}/><select value={fu} onChange={e=>setFu(e.target.value)} style={ss}>{units.map(u=><option key={u} value={u}>{u}</option>)}</select></div><div style={{display:"flex",justifyContent:"center"}}><button onClick={()=>{setFu(tu);setTu(fu);}} style={{width:40,height:40,borderRadius:"50%",background:"rgba(251,191,36,0.1)",border:"1px solid rgba(251,191,36,0.2)",color:"#fbbf24",cursor:"pointer",fontSize:18,display:"flex",alignItems:"center",justifyContent:"center"}}>⇅</button></div><div style={{background:"rgba(255,255,255,0.02)",borderRadius:12,padding:14,border:"1px solid rgba(255,255,255,0.05)"}}><div style={{fontSize:10,color:"#666",marginBottom:8,textTransform:"uppercase",letterSpacing:1}}>To</div><div style={{fontSize:28,fontWeight:600,color:"#fbbf24",fontFamily:"'DM Mono',monospace",padding:"10px 0",minHeight:50,wordBreak:"break-all"}}>{result||"—"}</div><select value={tu} onChange={e=>setTu(e.target.value)} style={ss}>{units.map(u=><option key={u} value={u}>{u}</option>)}</select></div></div>);
}


// ─── Currency ───────────────────────────────────────────────────────────────
function CurrencyPanel() {
  const codes=Object.keys(CURRENCY_DATA);const[fc,setFc]=useState("USD");const[tc,setTc]=useState("EUR");const[amt,setAmt]=useState("1");const[search,setSearch]=useState("");const[pick,setPick]=useState(null);
  const result=useMemo(()=>{const v=parseFloat(amt);if(isNaN(v))return"";const r=v/CURRENCY_DATA[fc].rate*CURRENCY_DATA[tc].rate;if(Math.abs(r)>1e9)return r.toExponential(4);return r.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:4});},[amt,fc,tc]);
  const rate=useMemo(()=>parseFloat((CURRENCY_DATA[tc].rate/CURRENCY_DATA[fc].rate).toPrecision(6)),[fc,tc]);
  const filtered=codes.filter(c=>{const s=search.toLowerCase();return c.toLowerCase().includes(s)||CURRENCY_DATA[c].name.toLowerCase().includes(s);});
  const CB=({code,onClick})=><button onClick={onClick} style={{width:"100%",padding:"10px 12px",borderRadius:8,textAlign:"left",display:"flex",alignItems:"center",gap:10,cursor:"pointer",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",color:"#ddd",fontFamily:"'DM Mono',monospace",fontSize:13}}><span style={{fontSize:20}}>{CURRENCY_DATA[code].flag}</span><div><div style={{fontWeight:600}}>{code}</div><div style={{fontSize:10,color:"#666"}}>{CURRENCY_DATA[code].name}</div></div><span style={{marginLeft:"auto",fontSize:10,color:"#555"}}>▼</span></button>;
  if(pick)return(<div style={{padding:16,display:"flex",flexDirection:"column",gap:8,flex:1,overflowY:"auto"}}><div style={{display:"flex",gap:8,alignItems:"center"}}><button onClick={()=>{setPick(null);setSearch("");}} style={{background:"none",border:"none",color:"#a78bfa",fontSize:18,cursor:"pointer",padding:"4px 8px"}}>←</button><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search..." autoFocus style={{flex:1,padding:"10px 12px",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:8,color:"#ccc",fontSize:13,fontFamily:"'DM Mono',monospace",outline:"none"}}/></div><div style={{overflowY:"auto",display:"flex",flexDirection:"column",gap:4,flex:1}}>{filtered.map(c=><button key={c} onClick={()=>{if(pick==="from")setFc(c);else setTc(c);setPick(null);setSearch("");}} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:(pick==="from"?fc:tc)===c?"rgba(167,139,250,0.1)":"transparent",border:(pick==="from"?fc:tc)===c?"1px solid rgba(167,139,250,0.2)":"1px solid transparent",borderRadius:8,cursor:"pointer",color:"#ccc",fontFamily:"'DM Mono',monospace",fontSize:13,textAlign:"left",width:"100%"}}><span style={{fontSize:20}}>{CURRENCY_DATA[c].flag}</span><span style={{fontWeight:600}}>{c}</span><span style={{color:"#666",fontSize:11}}>{CURRENCY_DATA[c].name}</span></button>)}</div></div>);
  return(<div style={{padding:16,display:"flex",flexDirection:"column",gap:12,flex:1,overflowY:"auto"}}><div style={{textAlign:"center",fontSize:10,color:"#777"}}>⚠ Approximate offline rates · as of {CURRENCY_RATES_DATE} · not live</div><div style={{background:"rgba(255,255,255,0.02)",borderRadius:12,padding:14,border:"1px solid rgba(255,255,255,0.05)"}}><div style={{fontSize:10,color:"#666",marginBottom:8,textTransform:"uppercase",letterSpacing:1}}>From</div><input value={amt} onChange={e=>setAmt(e.target.value)} type="number" inputMode="decimal" style={{width:"100%",padding:"10px 0",background:"transparent",border:"none",outline:"none",color:"#fff",fontSize:28,fontFamily:"'DM Mono',monospace",fontWeight:600,boxSizing:"border-box"}}/><CB code={fc} onClick={()=>setPick("from")}/></div><div style={{display:"flex",justifyContent:"center",alignItems:"center",gap:12}}><div style={{fontSize:11,color:"#555"}}>1 {fc} = {rate} {tc}</div><button onClick={()=>{setFc(tc);setTc(fc);}} style={{width:40,height:40,borderRadius:"50%",background:"rgba(167,139,250,0.1)",border:"1px solid rgba(167,139,250,0.2)",color:"#a78bfa",cursor:"pointer",fontSize:18,display:"flex",alignItems:"center",justifyContent:"center"}}>⇅</button></div><div style={{background:"rgba(255,255,255,0.02)",borderRadius:12,padding:14,border:"1px solid rgba(255,255,255,0.05)"}}><div style={{fontSize:10,color:"#666",marginBottom:8,textTransform:"uppercase",letterSpacing:1}}>To</div><div style={{fontSize:28,fontWeight:600,color:"#a78bfa",fontFamily:"'DM Mono',monospace",padding:"10px 0",minHeight:50}}>{result||"—"}</div><CB code={tc} onClick={()=>setPick("to")}/></div></div>);
}


// ─── Base Converter (programmer mode) ───────────────────────────────────────
function BasePanel() {
  const [val, setVal] = useState("255");
  const [base, setBase] = useState(10);
  const bases = [["DEC", 10], ["HEX", 16], ["BIN", 2], ["OCT", 8]];
  const parsed = useMemo(() => parseInBase(val, base), [val, base]);
  const out = parsed === null ? null : formatBases(parsed);
  const accent = "#fb923c";
  const rows = [["DEC", "dec", ""], ["HEX", "hex", "0x"], ["BIN", "bin", "0b"], ["OCT", "oct", "0o"]];
  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12, flex: 1, overflowY: "auto" }}>
      <div style={{ background: "rgba(255,255,255,0.02)", borderRadius: 12, padding: 14, border: "1px solid rgba(255,255,255,0.05)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ fontSize: 10, color: "#666", textTransform: "uppercase", letterSpacing: 1 }}>Input</span>
          <div style={{ display: "flex", gap: 4 }}>
            {bases.map(([label, b]) => (
              <button key={b} onClick={() => setBase(b)} style={{ fontSize: 10, fontFamily: "'DM Mono',monospace", fontWeight: 600, padding: "3px 8px", borderRadius: 6, cursor: "pointer", background: base === b ? `${accent}22` : "rgba(255,255,255,0.04)", border: base === b ? `1px solid ${accent}` : "1px solid rgba(255,255,255,0.08)", color: base === b ? accent : "#888" }}>{label}</button>
            ))}
          </div>
        </div>
        <input value={val} onChange={e => setVal(e.target.value)} inputMode={base === 10 ? "numeric" : "text"} spellCheck={false} autoCapitalize="characters"
          style={{ width: "100%", padding: "8px 0", background: "transparent", border: "none", outline: "none", color: out ? "#fff" : "#ef4444", fontSize: 28, fontFamily: "'DM Mono',monospace", fontWeight: 600, boxSizing: "border-box", letterSpacing: 1 }} />
        {!out && val.trim() !== "" && <div style={{ fontSize: 11, color: "#ef4444" }}>Not a valid base-{base} number</div>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map(([label, key, prefix]) => (
          <div key={key} style={{ background: "rgba(255,255,255,0.02)", borderRadius: 12, padding: "12px 14px", border: "1px solid rgba(255,255,255,0.05)", display: "flex", alignItems: "baseline", gap: 12 }}>
            <span style={{ fontSize: 10, color: "#666", textTransform: "uppercase", letterSpacing: 1, width: 34, flexShrink: 0 }}>{label}</span>
            <span style={{ fontSize: 18, fontWeight: 600, color: accent, fontFamily: "'DM Mono',monospace", wordBreak: "break-all" }}>
              {out ? (prefix && out[key][0] !== "-" ? prefix : "") + out[key] : "—"}
            </span>
          </div>
        ))}
      </div>
      <div style={{ textAlign: "center", fontSize: 10, color: "#555" }}>Integer base conversion · arbitrary precision</div>
    </div>
  );
}


// ─── Help / shortcuts overlay ───────────────────────────────────────────────
function HelpOverlay({ onClose }) {
  const keys = [
    ["Enter", "Evaluate ="], ["Backspace", "Delete"], ["/", "Fraction"], ["^", "Exponent"],
    ["( )", "Group / exit"], ["!", "Factorial"], ["%", "Percent (÷100)"], ["x", "Variable (solve/graph)"], ["i", "Imaginary unit (calc)"],
  ];
  const tips = [
    ["⇧", "Cycle keypad layers — basic → 2ⁿᵈ → ƒ (gcd, nCr, mean…)"],
    ["STO", "Store the current value into A–M, then reuse it"],
    ["Tap a result", "Copies it to the clipboard"],
    ["Fraction chip", "Toggle exact fraction ↔ decimal"],
    ["∫ mode", "Numerical derivative (d/dx) & definite integral"],
    ["BASE mode", "Convert between DEC / HEX / BIN / OCT"],
  ];
  const Row = ([k, d]) => (
    <div key={k + d} style={{ display: "flex", gap: 12, alignItems: "baseline", padding: "5px 0" }}>
      <span style={{ flex: "0 0 92px", textAlign: "right", color: "#f472b6", fontFamily: "'DM Mono',monospace", fontSize: 12, fontWeight: 600 }}>{k}</span>
      <span style={{ color: "#bbb", fontSize: 12 }}>{d}</span>
    </div>
  );
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(5,5,8,0.7)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 360, maxHeight: "80%", overflowY: "auto", background: "#13131c", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 16, padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span style={{ color: "#eee", fontWeight: 700, fontSize: 15, fontFamily: "'Space Grotesk',sans-serif" }}>Shortcuts & tips</span>
          <button onClick={onClose} style={{ background: "rgba(244,114,182,0.15)", border: "1px solid rgba(244,114,182,0.3)", color: "#f472b6", borderRadius: 6, padding: "4px 12px", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>Close</button>
        </div>
        <div style={{ fontSize: 10, color: "#666", textTransform: "uppercase", letterSpacing: 1, margin: "10px 0 2px" }}>Keyboard</div>
        {keys.map(Row)}
        <div style={{ fontSize: 10, color: "#666", textTransform: "uppercase", letterSpacing: 1, margin: "12px 0 2px" }}>Tips</div>
        {tips.map(Row)}
      </div>
    </div>
  );
}


// Display labels for keypad values whose action name differs from the glyph we
// want to show on the (narrow) 5-column keys. The action value itself is unchanged.
const KEY_LABEL = {
  "1/x": "⬚⁻¹", sq: "⬚²", cube: "⬚³", sqrt: "√⬚", cbrt: "³√⬚",
  log2: "log₂", median: "med", variance: "var",
};

// ═══════════════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════════════
export default function Kalculator() {
  // Use refs for cursor so mutations always see current values
  const [ast, setAst] = useState(() => mkSeq());
  const [cursorSeqId, _setCursorSeqId] = useState(() => ast.id);
  const [cursorPos, _setCursorPos] = useState(0);
  const cursorRef = useRef({ seqId: ast.id, pos: 0 });

  const setCursorSeqId = (id) => { cursorRef.current.seqId = id; _setCursorSeqId(id); };
  const setCursorPos = (p) => { cursorRef.current.pos = p; _setCursorPos(p); };

  const [history, setHistory] = useState([]);
  const [lastAns, setLastAns] = useState(0);
  const [mode, setMode] = useState("calc");
  const [graphExprs, setGraphExprs] = useState([]);
  const [showGraph, setShowGraph] = useState(false);
  const [layer, setLayer] = useState(0); // keypad layer: 0 basic · 1 2nd (inverse/hyp) · 2 ƒ (multi-arg)
  const [caA, setCaA] = useState("0"); // calculus mode: derivative point / integral lower bound
  const [caB, setCaB] = useState("1"); // calculus mode: integral upper bound
  const [vars, setVars] = useState({}); // user variables: { A, B, C, D, M } → value (number|Complex)
  const [storeArmed, setStoreArmed] = useState(null); // STO snapshot {value, display} awaiting a slot
  const [copiedIdx, setCopiedIdx] = useState(null); // history index showing a brief "copied ✓"
  const [showHelp, setShowHelp] = useState(false);
  const [ver, setVer] = useState(0); // force re-render
  const historyRef = useRef(null);
  const containerRef = useRef(null);
  const persistedRef = useRef(false); // gate saving until the initial load settles

  // Persist history across sessions (IndexedDB; no-ops where unavailable).
  useEffect(() => {
    loadHistory().then(loaded => {
      // only restore if the user hasn't already started computing (avoids a race)
      setHistory(curr => (curr.length === 0 && loaded.length ? loaded : curr));
      persistedRef.current = true;
    });
  }, []);
  useEffect(() => { if (persistedRef.current) saveHistory(history); }, [history]);

  const flatExpr = useMemo(() => toExpr(ast), [ast, ver]);
  const suggestions = useMemo(() => {
    if (mode !== "calc" && mode !== "solve" && mode !== "graph") return [];
    return MathEngine.suggest(flatExpr);
  }, [flatExpr, mode, ver]);

  useEffect(() => { if (historyRef.current) historyRef.current.scrollTop = historyRef.current.scrollHeight; }, [history]);

  // ── Core mutation: directly mutates `ast` then triggers re-render ──
  function mutate(fn) {
    fn(ast, cursorRef.current);
    setAst({ ...ast }); // shallow copy to trigger re-render
    setVer(v => v + 1);
  }

  function insertChar(ch) {
    mutate((tree, cur) => {
      const seq = findSeq(tree, cur.seqId);
      if (!seq) return;
      seq.children.splice(cur.pos, 0, mkChar(ch));
      setCursorPos(cur.pos + 1);
    });
  }

  function insertStructural(type, fnName) {
    mutate((tree, cur) => {
      const seq = findSeq(tree, cur.seqId);
      if (!seq) return;

      if (type === "frac") {
        // Grab only the preceding operand as the numerator (was: the whole
        // sequence before the cursor, so 1+2 ÷ wrongly gave (1+2)/▯).
        const { nodes, start } = extractPrecedingOperand(seq, cur.pos);
        const num = mkSeq(nodes);
        const den = mkSeq();
        const frac = mkFrac(num, den);
        seq.children.splice(start, 0, frac);
        if (nodes.length) {
          setCursorSeqId(den.id); setCursorPos(0); // operand → numerator; fill denominator
        } else {
          setCursorSeqId(num.id); setCursorPos(0); // blank fraction; fill numerator first
        }
      } else if (type === "sup") {
        const exp = mkSeq();
        if (cur.pos > 0) {
          const base = seq.children.splice(cur.pos - 1, 1)[0];
          const sup = mkSup(mkSeq([base]), exp);
          seq.children.splice(cur.pos - 1, 0, sup);
        } else {
          const sup = mkSup(mkSeq(), exp);
          seq.children.splice(0, 0, sup);
        }
        setCursorSeqId(exp.id);
        setCursorPos(0);
      } else if (type === "sqrt") {
        const rad = mkSeq();
        seq.children.splice(cur.pos, 0, mkSqrt(rad));
        setCursorSeqId(rad.id);
        setCursorPos(0);
      } else if (type === "func") {
        const arg = mkSeq();
        seq.children.splice(cur.pos, 0, mkFunc(fnName, arg));
        setCursorSeqId(arg.id);
        setCursorPos(0);
      } else if (type === "paren") {
        const inner = mkSeq();
        seq.children.splice(cur.pos, 0, mkParen(inner));
        setCursorSeqId(inner.id);
        setCursorPos(0);
      }
    });
  }

  // Reciprocal (1/x button): wrap the preceding operand as the DENOMINATOR of a
  // fraction with numerator 1 → a true 1/operand. (The old code built operand/1.)
  function insertReciprocal() {
    mutate((tree, cur) => {
      const seq = findSeq(tree, cur.seqId);
      if (!seq) return;
      const { nodes, start } = extractPrecedingOperand(seq, cur.pos);
      const frac = mkFrac(mkSeq([mkChar("1")]), mkSeq(nodes));
      seq.children.splice(start, 0, frac);
      if (nodes.length) {
        // operand captured → reciprocal is complete; sit just after it
        setCursorSeqId(seq.id);
        setCursorPos(start + 1);
      } else {
        // nothing to reciprocate → drop the cursor into the empty denominator
        setCursorSeqId(frac.den.id);
        setCursorPos(0);
      }
    });
  }

  // x² / x³ convenience: wrap the preceding operand as the base of a sup with a
  // pre-filled exponent, then sit just after it (unlike ^, which opens an empty
  // exponent box for you to type into).
  function insertPow(nStr) {
    mutate((tree, cur) => {
      const seq = findSeq(tree, cur.seqId);
      if (!seq) return;
      const { nodes, start } = extractPrecedingOperand(seq, cur.pos);
      const sup = mkSup(mkSeq(nodes), mkSeq([...nStr].map(mkChar)));
      seq.children.splice(start, 0, sup);
      if (nodes.length) { setCursorSeqId(seq.id); setCursorPos(start + 1); }
      else { setCursorSeqId(sup.base.id); setCursorPos(0); }
    });
  }

  function doBackspace() {
    mutate((tree, cur) => {
      const seq = findSeq(tree, cur.seqId);
      if (!seq) return;

      if (cur.pos > 0) {
        const removed = seq.children[cur.pos - 1];
        if (removed.type === "char") {
          seq.children.splice(cur.pos - 1, 1);
          setCursorPos(cur.pos - 1);
        } else {
          // Structural: unwrap children into seq
          let inner = [];
          if (removed.type === "frac") inner = [...removed.num.children, ...removed.den.children];
          else if (removed.type === "sup") inner = [...removed.base.children, ...removed.exp.children];
          else if (removed.type === "sqrt") inner = removed.rad.children;
          else if (removed.type === "func") inner = removed.arg.children;
          else if (removed.type === "paren") inner = removed.inner.children;
          seq.children.splice(cur.pos - 1, 1, ...inner);
          setCursorPos(cur.pos - 1 + inner.length);
        }
      } else {
        // Navigate out
        const info = findParentOf(tree, cur.seqId);
        if (info) {
          setCursorSeqId(info.parentSeq.id);
          setCursorPos(info.structIdx);
        }
      }
    });
  }

  function navigateOut() {
    const info = findParentOf(ast, cursorRef.current.seqId);
    if (info) {
      setCursorSeqId(info.parentSeq.id);
      setCursorPos(info.structIdx + 1);
      setVer(v => v + 1);
    }
  }

  function clearAll() {
    const s = mkSeq();
    setAst(s);
    setCursorSeqId(s.id);
    setCursorPos(0);
    setVer(v => v + 1);
    setStoreArmed(null);
  }

  function calculate() {
    const expr = toExpr(ast);
    if (!expr.trim() || expr === "()") return;
    if (mode === "solve") {
      const res = MathEngine.solve(expr);
      setHistory(h => [...h, { expr, result: res.display, type: "solve" }]);
    } else if (mode === "graph") {
      setGraphExprs(p => [...p, expr]);
      setShowGraph(true);
      setHistory(h => [...h, { expr, result: "Plotted ✓", type: "graph" }]);
    } else if (mode === "calculus") {
      // = performs the definite integral; the d/dx button does the derivative
      const a = parseFloat(caA), b = parseFloat(caB);
      if (isNaN(a) || isNaN(b)) { setHistory(h => [...h, { expr, result: "Need numeric a, b", type: "error" }]); }
      else { const r = MathEngine.numIntegral(expr, a, b); setHistory(h => [...h, { expr: `∫[${caA},${caB}] (${expr}) dx`, result: r === null ? "Error" : MathEngine.fmt(r), type: r === null ? "error" : "calc" }]); }
    } else {
      const res = MathEngine.evalRich(expr, { ans: lastAns, ...vars });
      if (res.kind === "real") {
        setLastAns(res.value);
        const fraction = MathEngine.exactFraction(expr, { ans: lastAns, ...vars }); // "1/2" or null
        setHistory(h => [...h, { expr, result: res.display, fraction, type: "calc" }]);
      } else if (res.kind === "complex") {
        setLastAns(res.value); // complex ans is reusable (math.js handles it)
        setHistory(h => [...h, { expr, result: res.display, type: "calc" }]);
      } else if (res.kind === "infinite" || res.kind === "undefined") {
        setHistory(h => [...h, { expr, result: res.display, type: "error" }]); // ∞ / Undefined, no ans
      } else {
        setHistory(h => [...h, { expr, result: "Error", type: "error" }]);
      }
    }
    clearAll();
  }

  // Calculus mode: numerical derivative of f(x) at x = a (the ∫ button / "=" do the integral).
  function doDerivative() {
    const expr = toExpr(ast);
    if (!expr.trim() || expr === "()") return;
    const a = parseFloat(caA);
    if (isNaN(a)) { setHistory(h => [...h, { expr, result: "Need numeric a", type: "error" }]); return; }
    const r = MathEngine.numDerivative(expr, a);
    setHistory(h => [...h, { expr: `d/dx (${expr}) @ x=${caA}`, result: r === null ? "Error" : MathEngine.fmt(r), type: r === null ? "error" : "calc" }]);
    clearAll();
  }

  function pressKey(val) {
    if (val === "=") { calculate(); return; }
    if (val === "AC") { clearAll(); return; }
    if (val === "⌫") { doBackspace(); return; }
    if (val === "ANS") { insertChar("ans"); return; }
    if (val === "/") { insertStructural("frac"); return; }
    if (val === "^") { insertStructural("sup"); return; }
    if (val === "sqrt" || val === "cbrt") { if (val === "sqrt") insertStructural("sqrt"); else insertStructural("func", "cbrt"); return; }
    if (val === "(") { insertStructural("paren"); return; }
    if (val === ")") { navigateOut(); return; }
    const funcNames = ["sin","cos","tan","asin","acos","atan","sinh","cosh","tanh","log","ln","log2","abs","exp",
      "cot","sec","coth","sech","acot","asec","asinh","acosh","atanh","acoth","asech", // extended trig / hyperbolic
      "gcd","lcm","min","max","nCr","nPr","mod","logb",            // multi-arg (commas in the single arg seq)
      "mean","median","std","variance","sum","mode"];               // statistics (variadic; mode → array result)
    if (funcNames.includes(val)) { insertStructural("func", val); return; }
    insertChar(val);
  }

  const handleKeyDown = (e) => {
    if (mode !== "calc" && mode !== "solve" && mode !== "graph" && mode !== "calculus") return;
    const key = e.key;
    if (key === "Enter") { e.preventDefault(); calculate(); return; }
    if (key === "Backspace") { e.preventDefault(); doBackspace(); return; }
    if (key === "/") { e.preventDefault(); insertStructural("frac"); return; }
    if (key === "^") { e.preventDefault(); insertStructural("sup"); return; }
    if (key === "(") { e.preventDefault(); insertStructural("paren"); return; }
    if (key === ")") { e.preventDefault(); navigateOut(); return; }
    // Store ASCII operators in the AST; the renderer maps * → × for display.
    // (Storing the × glyph here was the bug: tokenize had no branch for it and
    // silently dropped the char, so 2*3 became 23.)
    if (/^[0-9.+\-*%!=xi,]$/.test(key)) { e.preventDefault(); insertChar(key); return; }
  };

  const onTapSeq = (id, pos) => { setCursorSeqId(id); setCursorPos(pos); setVer(v => v + 1); };

  // Toggle a history result between its exact fraction and decimal forms.
  const toggleDecimal = (i) => setHistory(h => h.map((e, idx) => idx === i ? { ...e, showDecimal: !e.showDecimal } : e));

  // ── Variables (STO) ──────────────────────────────────────────────────────
  // STO snapshots the current expression's value; the next slot tap stores it.
  function armStore() {
    if (storeArmed) { setStoreArmed(null); return; } // toggle off
    const expr = toExpr(ast);
    if (!expr.trim() || expr === "()") return;
    const res = MathEngine.evalRich(expr, { ans: lastAns, ...vars });
    if (res.kind === "real" || res.kind === "complex") setStoreArmed({ value: res.value, display: res.display });
  }
  function onVar(name) {
    if (storeArmed) {
      setVars(v => ({ ...v, [name]: storeArmed.value }));
      setHistory(h => [...h, { expr: `${name} =`, result: storeArmed.display, type: "calc" }]);
      setStoreArmed(null);
      clearAll();
    } else {
      insertChar(name); // recall: use the variable in the expression
    }
  }

  // Copy a history result to the clipboard (tap the value).
  function copyResult(i, text) {
    try { navigator.clipboard?.writeText(text); } catch { /* unavailable */ }
    setCopiedIdx(i);
    setTimeout(() => setCopiedIdx(c => (c === i ? null : c)), 1200);
  }

  const modeColors = { calc:{bg:"#f472b6",label:"CALC"}, solve:{bg:"#60a5fa",label:"SOLVE"}, graph:{bg:"#34d399",label:"GRAPH"}, calculus:{bg:"#22d3ee",label:"∫"}, base:{bg:"#fb923c",label:"BASE"}, units:{bg:"#fbbf24",label:"UNITS"}, fx:{bg:"#a78bfa",label:"FX"} };
  const showCalcUI = mode === "calc" || mode === "solve" || mode === "graph" || mode === "calculus";
  const isAstEmpty = ast.children.length === 0;

  // CALC mode shows the imaginary unit `i`; SOLVE/GRAPH show the variable `x`.
  const xi = mode === "calc" ? "i" : "x";
  const layouts = [
    [["1/x","sq","cube","sqrt","cbrt"],["exp","ln","log","log2","logb"],["sin","cos","tan","cot","sec"],["⇧",xi,"π","(",")"]],
    [["gcd","lcm","nCr","nPr","mod"],["abs","min","max","sum","mean"],["mode","median","std","variance",","],["⇧",xi,"π","(",")"]],
    [["asin","acos","atan","acot","asec"],["sinh","cosh","tanh","coth","sech"],["asinh","acosh","atanh","acoth","asech"],["⇧",xi,"π","(",")"]],
  ];
  const mainKeys = layouts[layer];
  const numKeys = [["7","8","9","÷","^"],["4","5","6","×","%"],["1","2","3","−","!"],["0",".","=","+","E"]];
  const keyMap = {"÷":"/","×":"*","−":"-","⇧":null};

  const handleBtnPress = (k) => {
    if (k === "1/x") { insertReciprocal(); return; }
    if (k === "sq") { insertPow("2"); return; }
    if (k === "cube") { insertPow("3"); return; }
    const mapped = keyMap[k] !== undefined ? keyMap[k] : k;
    if (mapped !== null) pressKey(mapped);
  };

  // ⇧ cycles keypad layers. Tap toggles basic ↔ 2nd (a tap while on 3rd returns
  // to basic); a long-press jumps to the rarely-used 3rd layer.
  const shiftHold = useRef({ t: null, long: false });
  const shiftDown = (e) => { e.preventDefault(); shiftHold.current.long = false; shiftHold.current.t = setTimeout(() => { shiftHold.current.long = true; setLayer(2); }, 450); };
  const shiftUp = () => { clearTimeout(shiftHold.current.t); if (!shiftHold.current.long) setLayer(l => (l === 0 ? 1 : 0)); };
  const shiftCancel = () => { clearTimeout(shiftHold.current.t); };

  const getKeyStyle = (k) => {
    const base = { border:"none",borderRadius:10,cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:15,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.1s",padding:0,minHeight:46 };
    if (k==="=") return{...base,background:"linear-gradient(135deg,#f472b6,#ec4899)",color:"#fff",fontSize:20};
    if ("÷×−+^%!".includes(k)) return{...base,background:"rgba(244,114,182,0.12)",color:"#f472b6",border:"1px solid rgba(244,114,182,0.15)"};
    if (k==="⇧") return{...base,fontSize:13,background:layer?"rgba(96,165,250,0.2)":"rgba(255,255,255,0.06)",color:layer?"#60a5fa":"#aaa",border:layer?"1px solid rgba(96,165,250,0.3)":"1px solid rgba(255,255,255,0.08)"};
    if (/^[0-9.]$/.test(k)) return{...base,background:"rgba(255,255,255,0.08)",color:"#fff",border:"1px solid rgba(255,255,255,0.06)"};
    if (k==="sqrt"||k==="cbrt") return{...base,background:"rgba(255,255,255,0.04)",color:"#ddd",fontSize:16,fontFamily:"Cambria,Georgia,'Times New Roman',serif",border:"1px solid rgba(255,255,255,0.06)"};
    return{...base,background:"rgba(255,255,255,0.04)",color:"#ccc",fontSize:12,border:"1px solid rgba(255,255,255,0.06)"};
  };

  return (
    <div ref={containerRef} tabIndex={0} onKeyDown={handleKeyDown} className="kalc-root"
      style={{ width:"100%",maxWidth:420,margin:"0 auto",display:"flex",flexDirection:"column",background:"#0a0a0f",color:"#fff",fontFamily:"'DM Mono',monospace",overflow:"hidden",outline:"none" }}>
      {showGraph && <GraphView expressions={graphExprs} onClose={()=>setShowGraph(false)} />}
      {showHelp && <HelpOverlay onClose={()=>setShowHelp(false)} />}

      {/* Header */}
      <div style={{padding:"12px 16px 8px",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:"1px solid rgba(255,255,255,0.05)"}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          {/* The brand mark is the favicon itself (public/icons/favicon.svg), served
              through BASE_URL so it resolves under the GitHub Pages sub-path. */}
          <img src={`${import.meta.env.BASE_URL}icons/favicon.svg`} alt="" width={28} height={28} style={{display:"block"}} />
          <span style={{fontSize:14,fontWeight:600,color:"#eee",fontFamily:"'Space Grotesk',sans-serif"}}>Kalculator</span>
          <button onClick={()=>setShowHelp(true)} title="Shortcuts & tips" style={{width:18,height:18,borderRadius:"50%",border:"1px solid rgba(255,255,255,0.15)",background:"transparent",color:"#888",fontSize:11,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",lineHeight:1,padding:0}}>?</button>
        </div>
        <div style={{display:"flex",gap:3,flexWrap:"wrap",justifyContent:"flex-end"}}>
          {Object.entries(modeColors).map(([m,c])=>(
            <button key={m} onClick={()=>{setMode(m);setTimeout(()=>containerRef.current?.focus(),50);}} style={{padding:"4px 7px",borderRadius:6,fontSize:9,fontWeight:600,fontFamily:"'DM Mono',monospace",cursor:"pointer",transition:"all 0.2s",border:mode===m?`1px solid ${c.bg}`:"1px solid rgba(255,255,255,0.08)",background:mode===m?`${c.bg}22`:"transparent",color:mode===m?c.bg:"#555"}}>{c.label}</button>
          ))}
        </div>
      </div>

      {showCalcUI ? (<>
        {/* History */}
        <div ref={historyRef} style={{flex:1,overflowY:"auto",padding:"12px 16px",display:"flex",flexDirection:"column",gap:6,minHeight:0}}>
          {history.length>0 && (
            <div style={{position:"sticky",top:0,zIndex:1,display:"flex",justifyContent:"flex-end",marginBottom:-2}}>
              <button onClick={()=>setHistory([])} title="Clear history"
                style={{fontSize:10,fontFamily:"'DM Mono',monospace",background:"rgba(10,10,15,0.85)",border:"1px solid rgba(255,255,255,0.08)",color:"#666",borderRadius:6,padding:"2px 8px",cursor:"pointer",backdropFilter:"blur(4px)"}}>clear</button>
            </div>
          )}
          {history.length===0 && isAstEmpty && (
            <div style={{textAlign:"center",color:"#333",padding:"30px 20px",fontSize:12,lineHeight:1.8}}>
              <div style={{fontSize:32,marginBottom:12,opacity:0.3}}>∑</div>
              <div style={{color:"#555"}}>Type an expression to get started</div>
              <div style={{color:"#444",marginTop:4}}>
                {mode==="solve"?"Enter equation with x · fractions render naturally":mode==="graph"?"Enter f(x) · e.g. sin(x) or x²":"Press ÷ for fractions · ^ for exponents · √ for roots"}
              </div>
            </div>
          )}
          {history.map((h,i)=>{
            const primary = h.fraction ? (h.showDecimal ? h.result : h.fraction) : h.result;
            return (
            <div key={i} style={{display:"flex",flexDirection:"column",gap:2,animation:"fadeIn 0.2s ease-out"}}>
              <div style={{fontSize:11,color:"#555",textAlign:"right",wordBreak:"break-all"}}>{h.expr}</div>
              <div style={{display:"flex",alignItems:"center",justifyContent:"flex-end",gap:8,flexWrap:"wrap"}}>
                {h.fraction && (
                  <button onClick={(e)=>{e.stopPropagation();toggleDecimal(i);}} title="Toggle fraction / decimal"
                    style={{fontSize:11,fontFamily:"'DM Mono',monospace",background:"rgba(244,114,182,0.1)",border:"1px solid rgba(244,114,182,0.2)",color:"#f472b6",borderRadius:6,padding:"3px 8px",cursor:"pointer",fontWeight:600,whiteSpace:"nowrap"}}>
                    {h.showDecimal ? h.fraction : h.result}
                  </button>
                )}
                <span onClick={()=>copyResult(i, primary)} title="Tap to copy"
                  style={{fontSize:h.type==="solve"?16:20,fontWeight:600,textAlign:"right",wordBreak:"break-all",cursor:"pointer",color:copiedIdx===i?"#34d399":h.type==="error"?"#ef4444":h.type==="solve"?"#60a5fa":h.type==="graph"?"#34d399":"#f472b6"}}>
                  {copiedIdx===i ? "copied ✓" : primary}
                </span>
              </div>
            </div>
            );
          })}
        </div>

        {/* Live Math Display */}
        <div onClick={()=>{ onTapSeq(ast.id, ast.children.length); containerRef.current?.focus(); }}
          style={{padding:"14px 16px",borderTop:"1px solid rgba(255,255,255,0.06)",minHeight:56,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,cursor:"text",overflowX:"auto",overflowY:"hidden",background:"rgba(255,255,255,0.012)"}}>
          {isAstEmpty ? (
            <div style={{display:"flex",alignItems:"center",gap:4}}>
              <span style={{color:"#2a2a2a",fontSize:20,fontFamily:"'Space Grotesk',sans-serif"}}>{mode==="solve"?"x² − 4 = 0":(mode==="graph"||mode==="calculus")?"f(x)":"0"}</span>
              <Cursor h={22} />
            </div>
          ) : (
            <MathRender node={ast} fontSize={24} cursorSeqId={cursorSeqId} cursorPos={cursorPos} onTapSeq={onTapSeq} />
          )}
        </div>

        {/* Suggestions */}
        {suggestions.length>0&&<div style={{padding:"4px 12px",display:"flex",gap:6,overflowX:"auto",flexShrink:0,borderTop:"1px solid rgba(255,255,255,0.04)"}}>
          {suggestions.map((s,i)=><button key={i} onClick={()=>{if(s.action==="eval")calculate();}} style={{padding:"5px 10px",borderRadius:8,fontSize:11,fontFamily:"'DM Mono',monospace",background:i===0?"rgba(244,114,182,0.12)":"rgba(255,255,255,0.04)",border:i===0?"1px solid rgba(244,114,182,0.2)":"1px solid rgba(255,255,255,0.06)",color:i===0?"#f472b6":"#888",cursor:"pointer",whiteSpace:"nowrap",flexShrink:0}}>{s.label}</button>)}
        </div>}

        {/* Action bar */}
        <div style={{padding:"4px 12px",display:"flex",gap:6,flexShrink:0}}>
          <button onClick={()=>pressKey("AC")} style={{flex:1,padding:"8px",borderRadius:8,fontSize:12,fontWeight:600,fontFamily:"'DM Mono',monospace",cursor:"pointer",background:"rgba(239,68,68,0.1)",border:"1px solid rgba(239,68,68,0.15)",color:"#ef4444"}}>AC</button>
          <button onClick={()=>pressKey("⌫")} style={{flex:1,padding:"8px",borderRadius:8,fontSize:12,fontWeight:600,fontFamily:"'DM Mono',monospace",cursor:"pointer",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.06)",color:"#888"}}>⌫</button>
          <button onClick={()=>insertChar("ans")} style={{flex:1,padding:"8px",borderRadius:8,fontSize:12,fontWeight:600,fontFamily:"'DM Mono',monospace",cursor:"pointer",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.06)",color:"#888"}}>ANS</button>
          {mode==="graph"&&<button onClick={()=>{if(graphExprs.length)setShowGraph(true);}} style={{flex:1,padding:"8px",borderRadius:8,fontSize:12,fontWeight:600,fontFamily:"'DM Mono',monospace",cursor:"pointer",background:"rgba(52,211,153,0.1)",border:"1px solid rgba(52,211,153,0.15)",color:"#34d399"}}>VIEW</button>}
          {mode==="graph"&&<button onClick={()=>setGraphExprs([])} style={{flex:1,padding:"8px",borderRadius:8,fontSize:12,fontWeight:600,fontFamily:"'DM Mono',monospace",cursor:"pointer",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.06)",color:"#666"}}>CLR</button>}
        </div>

        {/* Variables (STO + recall A–M) */}
        {mode==="calc" && (
          <div style={{padding:"4px 12px",display:"flex",gap:5,flexShrink:0}}>
            <button onClick={armStore} title="Store the current value into a variable"
              style={{flex:"0 0 auto",padding:"6px 10px",borderRadius:8,fontSize:11,fontWeight:700,fontFamily:"'DM Mono',monospace",cursor:"pointer",background:storeArmed?"rgba(96,165,250,0.25)":"rgba(255,255,255,0.04)",border:storeArmed?"1px solid #60a5fa":"1px solid rgba(255,255,255,0.08)",color:storeArmed?"#60a5fa":"#888"}}>{storeArmed?"STO →":"STO"}</button>
            {["A","B","C","D","M"].map(v=>(
              <button key={v} onClick={()=>onVar(v)} title={vars[v]!==undefined?`${v} (stored — tap to use)`:`variable ${v}`}
                style={{flex:1,padding:"6px",borderRadius:8,fontSize:13,fontWeight:600,fontFamily:"'DM Mono',monospace",cursor:"pointer",background:storeArmed?"rgba(96,165,250,0.12)":vars[v]!==undefined?"rgba(96,165,250,0.07)":"rgba(255,255,255,0.04)",border:storeArmed?"1px solid rgba(96,165,250,0.3)":vars[v]!==undefined?"1px solid rgba(96,165,250,0.2)":"1px solid rgba(255,255,255,0.06)",color:(vars[v]!==undefined||storeArmed)?"#60a5fa":"#aaa"}}>{v}</button>
            ))}
          </div>
        )}

        {/* Calculus controls: derivative point / integral bounds + actions */}
        {mode==="calculus" && (
          <div style={{padding:"4px 12px",display:"flex",gap:6,alignItems:"center",flexShrink:0}}>
            <span style={{fontSize:11,color:"#666",fontFamily:"'DM Mono',monospace"}}>a</span>
            <input value={caA} onChange={e=>setCaA(e.target.value)} inputMode="decimal" aria-label="lower bound / point a"
              style={{width:0,flex:1,minWidth:40,padding:"6px 8px",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(34,211,238,0.2)",borderRadius:8,color:"#fff",fontSize:13,fontFamily:"'DM Mono',monospace",outline:"none",boxSizing:"border-box"}}/>
            <span style={{fontSize:11,color:"#666",fontFamily:"'DM Mono',monospace"}}>b</span>
            <input value={caB} onChange={e=>setCaB(e.target.value)} inputMode="decimal" aria-label="upper bound b"
              style={{width:0,flex:1,minWidth:40,padding:"6px 8px",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(34,211,238,0.2)",borderRadius:8,color:"#fff",fontSize:13,fontFamily:"'DM Mono',monospace",outline:"none",boxSizing:"border-box"}}/>
            <button onClick={doDerivative} title="Derivative of f(x) at x=a" style={{padding:"6px 10px",borderRadius:8,fontSize:12,fontWeight:600,fontFamily:"'DM Mono',monospace",cursor:"pointer",background:"rgba(34,211,238,0.1)",border:"1px solid rgba(34,211,238,0.25)",color:"#22d3ee",whiteSpace:"nowrap"}}>d/dx</button>
            <button onClick={()=>calculate()} title="∫ from a to b" style={{padding:"6px 12px",borderRadius:8,fontSize:14,fontWeight:600,fontFamily:"'DM Mono',monospace",cursor:"pointer",background:"rgba(34,211,238,0.18)",border:"1px solid rgba(34,211,238,0.35)",color:"#22d3ee",whiteSpace:"nowrap"}}>∫</button>
          </div>
        )}

        {/* Sci keys */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:5,padding:"4px 12px",flexShrink:0}}>
          {mainKeys.flat().map((k,i)=> k==="⇧"
            ? <button key={k+i} onPointerDown={shiftDown} onPointerUp={shiftUp} onPointerLeave={shiftCancel} onContextMenu={(e)=>e.preventDefault()} style={getKeyStyle(k)}>{["⇧","2nd","3rd"][layer]}</button>
            : <button key={k+i} onClick={()=>handleBtnPress(k)} style={getKeyStyle(k)}>{KEY_LABEL[k]??k}</button>
          )}
        </div>
        {/* Num keys */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:5,padding:"4px 12px 16px",flexShrink:0}}>
          {numKeys.flat().map((k,i)=><button key={k+i} onClick={()=>handleBtnPress(k)} style={getKeyStyle(k)}>{KEY_LABEL[k]??k}</button>)}
        </div>
      </>) : mode==="base" ? <BasePanel/> : mode==="units" ? <UnitPanel/> : mode==="fx" ? <CurrencyPanel/> : null}

      <style>{`
        .kalc-root{height:100vh;height:100dvh;}/* dvh avoids mobile keypad clipping; vh is the fallback */
        @keyframes fadeIn{from{opacity:0;transform:translateY(4px);}to{opacity:1;transform:translateY(0);}}
        @keyframes cursorBlink{0%,100%{opacity:1;}50%{opacity:0;}}
        button:active{transform:scale(0.95)!important;opacity:0.8;}
        ::-webkit-scrollbar{width:3px;}::-webkit-scrollbar-track{background:transparent;}::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:3px;}
        *{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
        select option{background:#1a1a2e;color:#ddd;}
        input[type=number]::-webkit-inner-spin-button,input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;margin:0;}
        input[type=number]{-moz-appearance:textfield;}
        input::placeholder{color:#333;}
      `}</style>
    </div>
  );
}
