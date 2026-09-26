import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from "react";
import { math, mathFrac } from "./mathInstance.js";
import { createMathEngine } from "./mathjsEngine.js";
import { loadHistory, saveHistory } from "./historyDB.js";
import { parseInBase, formatBases } from "./baseConvert.js";
import { mkSeq, mkChar, toExpr, toText, cloneTree } from "./mathAst.js";
import * as Ed from "./mathEdit.js";
import MathView, { caretFromPoint } from "./MathView.jsx";

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
    ["Enter", "Evaluate ="], ["← → ↑ ↓", "Move the cursor (in & out of fractions)"], ["Home / End", "Start / end"],
    ["Backspace / Del", "Delete"], ["Ctrl+Z / Ctrl+Y", "Undo / redo"], ["Esc", "Clear"],
    ["/", "Fraction"], ["^", "Exponent"], ["( )", "Group · ) closes"], ["sin( sqrt( …", "Type function names"],
    ["pi", "π"], ["!", "Factorial"], ["%", "Percent (÷100)"], ["x", "Variable (solve/graph)"], ["i", "Imaginary unit (calc)"],
  ];
  const tips = [
    ["Tap / drag", "Place the cursor anywhere in the expression"],
    ["◀ ▶", "Cursor keys on the keypad"],
    ["ƒ", "Show / hide the function keys (phones)"],
    ["⇧", "Cycle keypad layers — basic → 2ⁿᵈ → ƒ (gcd, nCr, mean…)"],
    ["Tap an entry", "Load a past expression back to edit it"],
    ["Tap a result", "Copies it to the clipboard"],
    ["+ − × after =", "Continues from Ans"],
    ["STO", "Store the current value into A–M, then reuse it"],
    ["⚙", "Turn suggestions / live result on or off"],
  ];
  const Row = ([k, d]) => (
    <div key={k + d} style={{ display: "flex", gap: 12, alignItems: "baseline", padding: "5px 0" }}>
      <span style={{ flex: "0 0 112px", textAlign: "right", color: "#f472b6", fontFamily: "'DM Mono',monospace", fontSize: 12, fontWeight: 600 }}>{k}</span>
      <span style={{ color: "#bbb", fontSize: 12 }}>{d}</span>
    </div>
  );
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(5,5,8,0.7)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 400, maxHeight: "85%", overflowY: "auto", background: "#13131c", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 16, padding: 20 }}>
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


// ─── Small UI pieces ────────────────────────────────────────────────────────
const ICON_PATHS = {
  left: "M15 18l-6-6 6-6",
  right: "M9 18l6-6-6-6",
  up: "M6 15l6-6 6 6",
  undo: "M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 010 11H11",
  redo: "M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 000 11H13",
  trash: "M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3",
  sliders: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
  back: "M21 5H9l-7 7 7 7h12a1 1 0 001-1V6a1 1 0 00-1-1zM17 9.5l-5 5M12 9.5l5 5",
};
function Icon({ name, size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

function SettingToggle({ on, onChange, label, hint }) {
  return (
    <button className="k-toggle" role="switch" aria-checked={on} onClick={() => onChange(!on)}>
      <span>{label}{hint && <small>{hint}</small>}</span>
      <span className={`k-switch${on ? " on" : ""}`} />
    </button>
  );
}

function useMedia(query) {
  const [match, setMatch] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatch(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return match;
}

// Per-viewer UI preferences (not calculation data) → localStorage.
const SETTINGS_KEY = "kalculator.settings";
const DEFAULT_SETTINGS = { suggest: true, preview: true, fnOpen: false };
function loadSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") }; }
  catch { return { ...DEFAULT_SETTINGS }; }
}
function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}

// Must match the wide-layout media query in styles/app.css.
const WIDE_QUERY = "(min-width: 760px) and (orientation: landscape)";

const MODES = [
  { id: "calc", label: "CALC", color: "#f472b6", title: "Calculator" },
  { id: "solve", label: "SOLVE", color: "#60a5fa", title: "Equation solver" },
  { id: "graph", label: "GRAPH", color: "#34d399", title: "Graph f(x)" },
  { id: "calculus", label: "∫dx", color: "#22d3ee", title: "Calculus: derivative & integral" },
  { sep: true },
  { id: "base", label: "BASE", color: "#fb923c", title: "Number bases (DEC/HEX/BIN/OCT)" },
  { id: "units", label: "UNITS", color: "#fbbf24", title: "Unit converter" },
  { id: "fx", label: "FX", color: "#a78bfa", title: "Currency converter" },
];
const MODE_COLOR = Object.fromEntries(MODES.filter((m) => m.id).map((m) => [m.id, m.color]));

// Display labels for keypad values whose action name differs from the glyph we
// want to show on the (narrow) 5-column keys. The action value itself is unchanged.
const KEY_LABEL = {
  "1/x": "⬚⁻¹", sq: "⬚²", cube: "⬚³", sqrt: "√⬚", cbrt: "³√⬚",
  log2: "log₂", median: "med", variance: "var",
};

// Every function that becomes a structural func node — from the keypad or by
// typing its name followed by "(". A new one also needs mathInstance.js.
const FUNC_NAMES = [
  "sin", "cos", "tan", "asin", "acos", "atan", "sinh", "cosh", "tanh", "log", "ln", "log2", "abs", "exp", "cbrt",
  "cot", "sec", "coth", "sech", "acot", "asec", "asinh", "acosh", "atanh", "acoth", "asech", // extended trig / hyperbolic
  "gcd", "lcm", "min", "max", "nCr", "nPr", "mod", "logb",            // multi-arg (commas in the single arg seq)
  "mean", "median", "std", "variance", "sum", "mode",                 // statistics (variadic; mode → array result)
];
// Keys that, pressed right after "=" on an empty line, continue from Ans.
const CONTINUES_ANS = new Set(["+", "-", "*", "/", "^", "%", "!", "sq", "cube", "1/x"]);
// Does a flat expression use the variable x (not the x inside "exp")?
const usesX = (expr) => /(^|[^a-zA-Z])x([^a-zA-Z]|$)/.test(expr);
// Results read with a true minus sign (display only; copying keeps ASCII).
const prettyNum = (s) => String(s).replace(/(^|[\s(,=e])-/g, "$1−");

// ─── History entry ──────────────────────────────────────────────────────────
function HistoryEntry({ h, latest, copied, onRecall, onCopy, onToggleFraction }) {
  const primary = h.fraction ? (h.showDecimal ? h.result : h.fraction) : h.result;
  const canEdit = !!h.tree;
  return (
    <div className={`k-entry${latest ? " latest" : ""}`}>
      <div className={`k-entry-expr${canEdit ? "" : " static"}`} onClick={canEdit ? onRecall : undefined} title={canEdit ? "Edit this expression" : undefined}>
        {h.op?.kind === "int" && <span className="k-opnote">∫<sub>{h.op.a}</sub><sup>{h.op.b}</sup></span>}
        {h.op?.kind === "d" && <span className="k-opnote">d/dx</span>}
        {h.tree ? <MathView root={h.tree} /> : <span className="k-flat">{h.expr}</span>}
        {h.op?.kind === "int" && <span className="k-opnote">dx</span>}
        {h.op?.kind === "d" && <span className="k-opnote">at x = {h.op.a}</span>}
      </div>
      <div className="k-entry-res">
        {h.solutions && h.solutions.length > 0 ? (
          <div className="k-roots">
            {h.solutions.map((s, k) => (
              <span key={k} onClick={() => onCopy(s)} title="Tap to copy">
                x{h.solutions.length > 1 && <sub>{k + 1}</sub>} = {prettyNum(s)}
              </span>
            ))}
          </div>
        ) : (
          <span
            className={`k-res ${h.type}${copied ? " copied" : ""}`}
            onClick={h.type === "calc" || h.type === "solve" ? () => onCopy(primary) : undefined}
            title={h.type === "calc" ? "Tap to copy" : undefined}
          >
            {copied ? "copied ✓" : `${h.type === "calc" ? "= " : ""}${prettyNum(primary)}`}
          </span>
        )}
        {h.fraction && (
          <button className="k-fracchip" onClick={onToggleFraction} title="Toggle fraction / decimal">
            {h.showDecimal ? h.fraction : h.result}
          </button>
        )}
        {copied && h.solutions && <span className="k-note">copied ✓</span>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════════════
export default function Kalculator() {
  // ── Editor state ──
  // The tree is edited in place by the pure ops in mathEdit.js. Refs hold the
  // source of truth (tree + caret) so several keys handled in one tick never
  // act on a stale tree; `rev` only triggers the re-render.
  const astRef = useRef(null);
  if (!astRef.current) astRef.current = mkSeq();
  const curRef = useRef(null);
  if (!curRef.current) curRef.current = Ed.startOf(astRef.current);
  const [rev, setRev] = useState(0);
  const bump = () => setRev((r) => r + 1);
  const undoRef = useRef({ past: [], future: [] });
  const justEvalRef = useRef(false); // true right after "=" until the next edit

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
  const [copiedKey, setCopiedKey] = useState(null); // history index showing a brief "copied ✓"
  const [evalError, setEvalError] = useState(false); // "=" failed: keep the expression, say so
  const [showHelp, setShowHelp] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState(loadSettings);
  const wide = useMedia(WIDE_QUERY);
  const scrollRef = useRef(null);
  const editorRef = useRef(null);
  const persistedRef = useRef(false); // gate saving until the initial load settles

  const ast = astRef.current;
  const cur = curRef.current;
  const isMath = mode === "calc" || mode === "solve" || mode === "graph" || mode === "calculus";
  const setSetting = (k, v) => setSettings((s) => ({ ...s, [k]: v }));
  const fnOpen = wide || settings.fnOpen;
  const setFnOpen = (v) => setSetting("fnOpen", v);

  useEffect(() => saveSettings(settings), [settings]);

  // Persist history across sessions (IndexedDB; no-ops where unavailable).
  useEffect(() => {
    loadHistory().then((loaded) => {
      // only restore if the user hasn't already started computing (avoids a race)
      setHistory((curr) => (curr.length === 0 && loaded.length ? loaded : curr));
      persistedRef.current = true;
    });
  }, []);
  useEffect(() => { if (persistedRef.current) saveHistory(history); }, [history]);
  useEffect(() => { const s = scrollRef.current; if (s) s.scrollTop = s.scrollHeight; }, [history.length, mode]);
  // The display is bottom-anchored: when it shrinks (function panel opens,
  // window resizes) keep the expression line in view instead of old history.
  useEffect(() => {
    const s = scrollRef.current;
    if (!s || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => { s.scrollTop = s.scrollHeight; });
    ro.observe(s);
    return () => ro.disconnect();
  }, [isMath]);
  // keep the caret in view while typing / moving
  useLayoutEffect(() => {
    editorRef.current?.querySelector(".m-caret, .m-slot-on")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [rev]);

  // ── Edit plumbing ──
  const snapshot = () => ({ tree: JSON.parse(JSON.stringify(astRef.current)), cur: { ...curRef.current } });
  function record() {
    const u = undoRef.current;
    u.past.push(snapshot());
    if (u.past.length > 200) u.past.shift();
    u.future = [];
  }
  // An editing op (undoable) — op(tree, caret) → caret, from mathEdit.js.
  function edit(op) {
    record();
    curRef.current = op(astRef.current, curRef.current) || curRef.current;
    justEvalRef.current = false;
    setEvalError(false);
    bump();
  }
  // A caret move (not undoable). Returns false when the op had nowhere to go.
  function nav(op) {
    const next = op(astRef.current, curRef.current);
    if (!next) return false;
    curRef.current = next;
    bump();
    return true;
  }
  function setTree(tree, caret) {
    record();
    astRef.current = tree;
    curRef.current = caret || Ed.endOf(tree);
    justEvalRef.current = false;
    setEvalError(false);
    bump();
  }
  function restore(from, to) {
    const u = undoRef.current;
    if (!u[from].length) return;
    u[to].push(snapshot());
    const s = u[from].pop();
    astRef.current = s.tree;
    curRef.current = s.cur;
    setEvalError(false);
    bump();
  }
  const undo = () => restore("past", "future");
  const redo = () => restore("future", "past");

  function clearAll() {
    if (astRef.current.children.length) setTree(mkSeq());
    setStoreArmed(null);
  }

  // Load a past expression back into the editor (undoable).
  function recall(h) {
    if (!h?.tree) return;
    setTree(cloneTree(h.tree));
  }
  function recallLast() {
    if (astRef.current.children.length) return;
    for (let i = history.length - 1; i >= 0; i--) if (history[i].tree) { recall(history[i]); return; }
  }

  // ── Evaluate ──
  function calculate() {
    const tree = astRef.current;
    const expr = toExpr(tree);
    if (!expr.trim() || expr === "()") return;
    const saved = cloneTree(tree);
    let entry;
    if (mode === "solve") {
      const res = MathEngine.solve(expr);
      entry = { expr, tree: saved, result: res.display, solutions: res.kind === "roots" ? res.solutions : undefined, type: "solve" };
    } else if (mode === "graph") {
      setGraphExprs((p) => [...p, expr]);
      setShowGraph(true);
      entry = { expr, tree: saved, result: "Plotted ✓", type: "graph" };
    } else if (mode === "calculus") {
      // = performs the definite integral; the d/dx button does the derivative
      const a = parseFloat(caA), b = parseFloat(caB);
      if (isNaN(a) || isNaN(b)) { setEvalError("Integral bounds a and b must be numbers"); return; }
      const r = MathEngine.numIntegral(expr, a, b);
      if (r === null) { setEvalError("Can't integrate this — check f(x)"); return; }
      entry = { expr: `∫[${caA},${caB}] (${expr}) dx`, tree: saved, op: { kind: "int", a: caA, b: caB }, result: MathEngine.fmt(r), type: "calc" };
    } else {
      const scope = { ans: lastAns, ...vars };
      const res = MathEngine.evalRich(expr, scope);
      if (res.kind === "real") {
        setLastAns(res.value);
        entry = { expr, tree: saved, result: res.display, fraction: MathEngine.exactFraction(expr, scope), type: "calc" };
      } else if (res.kind === "complex") {
        setLastAns(res.value); // complex ans is reusable (math.js handles it)
        entry = { expr, tree: saved, result: res.display, type: "calc" };
      } else if (res.kind === "infinite" || res.kind === "undefined") {
        entry = { expr, tree: saved, result: res.display, type: "error" }; // ∞ / Undefined, no ans
      } else {
        // Keep the expression so it can be fixed — nothing is lost on a typo.
        setEvalError("Can't evaluate this — check the expression");
        return;
      }
    }
    setHistory((h) => [...h, entry]);
    setTree(mkSeq()); // undoable: Ctrl+Z brings the expression back
    justEvalRef.current = true;
    setStoreArmed(null);
  }

  // Calculus mode: numerical derivative of f(x) at x = a (the ∫ button / "=" do the integral).
  function doDerivative() {
    const expr = toExpr(astRef.current);
    if (!expr.trim() || expr === "()") return;
    const a = parseFloat(caA);
    if (isNaN(a)) { setEvalError("Point a must be a number"); return; }
    const r = MathEngine.numDerivative(expr, a);
    if (r === null) { setEvalError("Can't differentiate this — check f(x)"); return; }
    const entry = { expr: `d/dx (${expr}) @ x=${caA}`, tree: cloneTree(astRef.current), op: { kind: "d", a: caA }, result: MathEngine.fmt(r), type: "calc" };
    setHistory((h) => [...h, entry]); // entry built eagerly: setTree below replaces the tree
    setTree(mkSeq());
    justEvalRef.current = true;
  }

  // ── Keys ──
  function pressKey(k) {
    switch (k) {
      case "=": calculate(); return;
      case "AC": clearAll(); return;
      case "⌫": edit(Ed.backspace); return;
      case "◀": nav(Ed.moveLeft); return;
      case "▶": nav(Ed.moveRight); return;
      case "ANS": edit((t, c) => Ed.insertChar(t, c, "ans")); return;
      case "(": edit((t, c) => Ed.openParen(t, c, FUNC_NAMES)); return;
      case ")": nav(Ed.closeParen); return;
      default: break;
    }
    const fromAns = justEvalRef.current && mode === "calc" && CONTINUES_ANS.has(k) && astRef.current.children.length === 0;
    edit((t, c) => {
      if (fromAns) { t.children.push(mkChar("ans")); c = Ed.endOf(t); }
      if (k === "/") return Ed.insertStruct(t, c, "frac");
      if (k === "^") return Ed.insertExponent(t, c, null);
      if (k === "sq") return Ed.insertExponent(t, c, "2");
      if (k === "cube") return Ed.insertExponent(t, c, "3");
      if (k === "1/x") return Ed.insertReciprocal(t, c);
      if (k === "sqrt") return Ed.insertStruct(t, c, "sqrt");
      if (FUNC_NAMES.includes(k)) return Ed.insertStruct(t, c, "func", k);
      return Ed.insertChar(t, c, k);
    });
  }

  // Physical keyboard, captured app-wide (no need to click the display first).
  const keyHandlerRef = useRef(null);
  keyHandlerRef.current = (e) => {
    const k = e.key;
    if (showHelp || showGraph) {
      if (k === "Escape") { setShowHelp(false); setShowGraph(false); }
      return;
    }
    if (showSettings && k === "Escape") { setShowSettings(false); return; }
    if (!isMath) return;
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
    if (t && t.tagName === "BUTTON" && (k === "Enter" || k === " ")) return; // keyboard-focused button: let it click
    if (e.ctrlKey || e.metaKey) {
      const lk = k.toLowerCase();
      if (lk === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (lk === "y") { e.preventDefault(); redo(); }
      return; // copy / paste / reload … stay with the browser
    }
    if (e.altKey) return;
    let handled = true;
    switch (k) {
      case "Enter": calculate(); break;
      case "Backspace": edit(Ed.backspace); break;
      case "Delete": edit(Ed.deleteForward); break;
      case "Escape": clearAll(); break;
      case "ArrowLeft": nav(Ed.moveLeft); break;
      case "ArrowRight": nav(Ed.moveRight); break;
      case "ArrowUp": if (!nav(Ed.moveUp)) recallLast(); break;
      case "ArrowDown": nav(Ed.moveDown); break;
      case "Home": nav(Ed.moveHome); break;
      case "End": nav(Ed.moveEnd); break;
      case "Tab": // leave a fraction/exponent; at top level Tab keeps its focus role
        if (curRef.current.seqId !== astRef.current.id) nav(Ed.exitRight); else handled = false;
        break;
      default:
        if (k.length !== 1) { handled = false; break; }
        if (/^[a-zA-Z]$/.test(k)) edit((tr, c) => Ed.typeChar(tr, c, k));
        else if (k === "=") edit((tr, c) => Ed.insertChar(tr, c, "=")); // equations (solve); Enter evaluates
        else if (/^[0-9.+\-*/^%!,()π]$/.test(k)) pressKey(k);
        else handled = false;
    }
    if (handled) e.preventDefault();
  };
  const clipRef = useRef(null);
  clipRef.current = (e) => {
    if (!isMath || showHelp || showGraph) return;
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (e.type === "paste") {
      const text = e.clipboardData?.getData("text");
      if (!text) return;
      e.preventDefault();
      edit((tr, c) => Ed.insertText(tr, c, text));
    } else if (e.type === "copy" && window.getSelection()?.isCollapsed !== false && astRef.current.children.length) {
      e.preventDefault(); // nothing selected: copy the expression as text
      e.clipboardData?.setData("text/plain", toText(astRef.current));
    }
  };
  useEffect(() => {
    const onKey = (e) => keyHandlerRef.current(e);
    const onClip = (e) => clipRef.current(e);
    window.addEventListener("keydown", onKey);
    window.addEventListener("paste", onClip);
    window.addEventListener("copy", onClip);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("paste", onClip);
      window.removeEventListener("copy", onClip);
    };
  }, []);

  // ── Pointer: tap / drag places the caret ──
  const dragRef = useRef(false);
  function placeCaret(e) {
    const c = caretFromPoint(editorRef.current, e.clientX, e.clientY);
    if (c && (c.seqId !== curRef.current.seqId || c.pos !== curRef.current.pos)) { curRef.current = c; bump(); }
  }
  const onEditorPointerDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); // no text selection / focus jump
    dragRef.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    placeCaret(e);
  };
  const onEditorPointerMove = (e) => { if (dragRef.current) placeCaret(e); };
  const onEditorPointerUp = () => { dragRef.current = false; };

  // Toggle a history result between its exact fraction and decimal forms.
  const toggleDecimal = (i) => setHistory((h) => h.map((e, idx) => (idx === i ? { ...e, showDecimal: !e.showDecimal } : e)));
  function copyText(key, text) {
    try { navigator.clipboard?.writeText(text); } catch { /* unavailable */ }
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((c) => (c === key ? null : c)), 1200);
  }

  // ── Variables (STO) ──
  // STO snapshots the current expression's value; the next slot tap stores it.
  function armStore() {
    if (storeArmed) { setStoreArmed(null); return; } // toggle off
    const expr = toExpr(astRef.current);
    if (!expr.trim() || expr === "()") return;
    const res = MathEngine.evalRich(expr, { ans: lastAns, ...vars });
    if (res.kind === "real" || res.kind === "complex") setStoreArmed({ value: res.value, display: res.display });
  }
  function onVar(name) {
    if (storeArmed) {
      setVars((v) => ({ ...v, [name]: storeArmed.value }));
      setHistory((h) => [...h, { expr: `STO → ${name}`, result: storeArmed.display, type: "calc" }]);
      setStoreArmed(null);
      clearAll();
    } else {
      pressKey(name); // recall: use the variable in the expression
    }
  }

  function switchMode(m) {
    setMode(m);
    setShowSettings(false);
    setEvalError(false);
  }

  // ── Derived display state ──
  const flatExpr = useMemo(() => toExpr(ast), [ast, rev]);
  const scope = useMemo(() => ({ ans: lastAns, ...vars }), [lastAns, vars]);
  const isEmpty = ast.children.length === 0;

  const preview = useMemo(() => {
    if (evalError) return { text: evalError, cls: "err" };
    if (!flatExpr) return null;
    if (mode === "calc") {
      if (!settings.preview || /^-?[0-9.]+$/.test(flatExpr)) return null; // a bare number previews itself
      const r = MathEngine.evalRich(flatExpr, scope);
      return r.kind === "real" || r.kind === "complex" || r.kind === "infinite" || r.kind === "undefined"
        ? { text: `= ${prettyNum(r.display)}` } : null;
    }
    if (mode === "solve") return { text: usesX(flatExpr) ? "Press = to solve for x" : "Use x for the unknown", cls: "hint" };
    if (mode === "graph") return { text: "Press = to plot f(x)", cls: "hint" };
    if (mode === "calculus") return { text: `= → ∫ from ${caA} to ${caB}  ·  d/dx → slope at x = ${caA}`, cls: "hint" };
    return null;
  }, [flatExpr, mode, settings.preview, scope, evalError, caA, caB]);

  const suggestions = useMemo(() => {
    if (!settings.suggest || !flatExpr || !(mode === "calc" || mode === "solve" || mode === "graph")) return [];
    const out = [];
    if (mode === "calc") {
      // HandyCalc-style: the value of the sub-expression the caret is in
      const sub = Ed.enclosingNode(ast, cur);
      if (sub) {
        const se = toExpr(sub);
        const v = se !== flatExpr ? MathEngine.evalRich(se, scope) : null;
        if (v && v.kind === "real") out.push({ key: "sub", label: `${toText(sub)} = ${v.display}`, info: true });
      }
      if (!settings.preview) {
        const r = MathEngine.evalRich(flatExpr, scope);
        if (r.kind === "real") out.push({ key: "eval", label: `= ${r.display}`, hot: true, run: calculate });
      }
      const frac = MathEngine.exactFraction(flatExpr, scope);
      if (frac) out.push({ key: "frac", label: `= ${frac}`, info: true });
      if (usesX(flatExpr)) {
        out.push({ key: "solve", label: "Solve for x →", hot: true, run: () => switchMode("solve") });
        out.push({ key: "graph", label: "Graph it →", run: () => switchMode("graph") });
      }
    }
    for (const s of MathEngine.suggest(flatExpr)) {
      if (s.action === "eval") continue;
      const fn = s.action.slice(0, s.action.indexOf("("));
      out.push({ key: fn, label: s.label, run: () => edit((t) => Ed.wrapAll(t, fn)) });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatExpr, rev, mode, settings.suggest, settings.preview, scope]);

  // ── Keypad model ──
  // CALC mode shows the imaginary unit `i`; SOLVE/GRAPH show the variable `x`.
  const xi = mode === "calc" ? "i" : "x";
  const layouts = [
    [["1/x","sq","cube","sqrt","cbrt"],["exp","ln","log","log2","logb"],["sin","cos","tan","cot","sec"],["⇧",xi,"π","(",")"]],
    [["gcd","lcm","nCr","nPr","mod"],["abs","min","max","sum","mean"],["mode","median","std","variance",","],["⇧",xi,"π","(",")"]],
    [["asin","acos","atan","acot","asec"],["sinh","cosh","tanh","coth","sech"],["asinh","acosh","atanh","acoth","asech"],["⇧",xi,"π","(",")"]],
  ];
  const fnRows = layouts[layer].slice(0, 3);
  const baseRow = layouts[layer][3];
  const numKeys = [["7","8","9","÷","^"],["4","5","6","×","%"],["1","2","3","−","!"],["0",".","=","+","E"]];
  const keyMap = { "÷": "/", "×": "*", "−": "-" };
  const keyClass = (k) =>
    k === "=" ? "kk kk-eq"
    : "÷×−+^%!".includes(k) ? "kk kk-op"
    : /^[0-9.]$/.test(k) ? "kk kk-num"
    : k === "sqrt" || k === "cbrt" ? "kk kk-root"
    : "kk kk-fn";
  const onKeyBtn = (k) => pressKey(keyMap[k] ?? k);

  // ⇧ cycles keypad layers. Tap toggles basic ↔ 2nd (a tap while on 3rd returns
  // to basic); a long-press jumps to the rarely-used 3rd layer. With the
  // function panel folded away (phones), ⇧ first unfolds it.
  const shiftHold = useRef({ t: null, long: false });
  const shiftDown = (e) => { e.preventDefault(); shiftHold.current.long = false; shiftHold.current.t = setTimeout(() => { shiftHold.current.long = true; setLayer(2); setFnOpen(true); }, 450); };
  const shiftUp = () => {
    clearTimeout(shiftHold.current.t);
    if (shiftHold.current.long) return;
    if (!fnOpen) { setFnOpen(true); return; }
    setLayer((l) => (l === 0 ? 1 : 0));
  };
  const shiftCancel = () => { clearTimeout(shiftHold.current.t); };

  // Swipe up / down on the keypad's top row folds the function panel (phones).
  const swipeRef = useRef(null);
  const onToolsPointerDown = (e) => { swipeRef.current = { y: e.clientY, moved: false }; };
  const onToolsPointerMove = (e) => {
    const s = swipeRef.current;
    if (!s || s.moved || wide) return;
    const dy = e.clientY - s.y;
    if (Math.abs(dy) > 24) { s.moved = true; setFnOpen(dy < 0); }
  };
  const onToolsPointerUp = () => { setTimeout(() => { swipeRef.current = null; }, 0); };
  const tool = (fn) => () => { if (!swipeRef.current?.moved) fn(); };

  const accent = MODE_COLOR[mode] || "#f472b6";
  const undoState = undoRef.current;
  const lastIdx = history.length - 1;
  const placeholder = mode === "solve" ? "x² − 4 = 0" : mode === "graph" || mode === "calculus" ? "f(x)" : "0";

  return (
    <div className="k-app" style={{ "--accent": accent }}
      onMouseDown={(e) => { if (e.target.closest?.("button")) e.preventDefault(); /* keys never steal focus */ }}>
      {showGraph && <GraphView expressions={graphExprs} onClose={() => setShowGraph(false)} />}
      {showHelp && <HelpOverlay onClose={() => setShowHelp(false)} />}

      {/* Header: brand · mode switcher · settings/help */}
      <header className="k-header">
        <div className="k-brand">
          {/* The brand mark is the favicon itself (public/icons/favicon.svg), served
              through BASE_URL so it resolves under the GitHub Pages sub-path. */}
          <img src={`${import.meta.env.BASE_URL}icons/favicon.svg`} alt="" width={28} height={28} />
          <span className="k-brand-name">Kalculator</span>
        </div>
        <nav className="k-modes" aria-label="Mode">
          {MODES.map((m, i) => m.sep
            ? <span key={`sep${i}`} className="k-modes-sep" aria-hidden="true" />
            : <button key={m.id} className={`k-mode${mode === m.id ? " on" : ""}`} style={{ "--c": m.color }}
                aria-pressed={mode === m.id} title={m.title} onClick={() => switchMode(m.id)}>{m.label}</button>
          )}
        </nav>
        <div className="k-actions">
          <button className="k-iconbtn" title="Settings" aria-expanded={showSettings} onClick={() => setShowSettings((s) => !s)}><Icon name="sliders" /></button>
          <button className="k-iconbtn" title="Shortcuts & tips" onClick={() => setShowHelp(true)}>?</button>
        </div>
      </header>

      {showSettings && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 55 }} onClick={() => setShowSettings(false)} />
          <div className="k-pop" role="dialog" aria-label="Settings">
            <div className="k-pop-title">Display</div>
            <SettingToggle on={settings.suggest} onChange={(v) => setSetting("suggest", v)} label="Suggestions" hint="Hint chips under the expression" />
            <SettingToggle on={settings.preview} onChange={(v) => setSetting("preview", v)} label="Live result" hint="Show the answer as you type" />
          </div>
        </>
      )}

      {isMath ? (
        <main className="k-main">
          {/* ── Display ── */}
          <section className="k-display">
            <div className="k-disp-tools">
              <button className="k-mini" title="Undo (Ctrl+Z)" disabled={!undoState.past.length} onClick={undo}><Icon name="undo" size={14} /></button>
              <button className="k-mini" title="Redo (Ctrl+Y)" disabled={!undoState.future.length} onClick={redo}><Icon name="redo" size={14} /></button>
              {history.length > 0 && <button className="k-mini" title="Clear history" onClick={() => setHistory([])}><Icon name="trash" size={14} /></button>}
            </div>
            <div className="k-scroll" ref={scrollRef}>
              <div className="k-feed">
                {history.length === 0 && isEmpty && (
                  <div className="k-empty">
                    <div className="k-empty-glyph">∑</div>
                    <div style={{ color: "#5d6070" }}>Type an expression to get started</div>
                    <div>
                      {mode === "solve" ? "Enter an equation in x · fractions render naturally"
                        : mode === "graph" ? "Enter f(x) · e.g. sin(x) or x²"
                        : <>÷ fractions · ^ exponents · √ roots · <kbd>←</kbd><kbd>→</kbd> move</>}
                    </div>
                  </div>
                )}
                {history.map((h, i) => (
                  <HistoryEntry key={i} h={h}
                    latest={i === lastIdx && isEmpty && justEvalRef.current}
                    copied={copiedKey === i}
                    onRecall={() => recall(h)}
                    onCopy={(text) => copyText(i, text)}
                    onToggleFraction={() => toggleDecimal(i)} />
                ))}
                <div className="k-current">
                  <div className="k-editor" ref={editorRef} role="textbox" aria-label={isEmpty ? "Expression (empty)" : `Expression: ${toText(ast)}`}
                    onPointerDown={onEditorPointerDown} onPointerMove={onEditorPointerMove}
                    onPointerUp={onEditorPointerUp} onPointerCancel={onEditorPointerUp}>
                    <MathView root={ast} cur={cur} blink={rev} placeholder={isEmpty ? placeholder : null} />
                  </div>
                  <div className={`k-preview${preview?.cls ? " " + preview.cls : ""}`}>{preview?.text ?? " "}</div>
                </div>
              </div>
            </div>

            {suggestions.length > 0 && (
              <div className="k-suggest" aria-label="Suggestions">
                {suggestions.map((s) => (
                  <button key={s.key} className={`k-chip${s.hot ? " hot" : ""}${s.info ? " info" : ""}`} onClick={s.run}>{s.label}</button>
                ))}
              </div>
            )}

            {mode === "calculus" && (
              <div className="k-modebar">
                <label htmlFor="ca-a">a</label>
                <input id="ca-a" className="k-field" value={caA} onChange={(e) => setCaA(e.target.value)} inputMode="decimal" aria-label="lower bound / point a" />
                <label htmlFor="ca-b">b</label>
                <input id="ca-b" className="k-field" value={caB} onChange={(e) => setCaB(e.target.value)} inputMode="decimal" aria-label="upper bound b" />
                <button className="k-btn" onClick={doDerivative} title="Derivative of f(x) at x=a">d/dx</button>
                <button className="k-btn" onClick={() => calculate()} title="∫ from a to b" style={{ fontSize: 14 }}>∫</button>
              </div>
            )}
            {mode === "graph" && (
              <div className="k-modebar">
                <button className="k-btn grow" onClick={() => { if (graphExprs.length) setShowGraph(true); }} disabled={!graphExprs.length}>View graph{graphExprs.length ? ` (${graphExprs.length})` : ""}</button>
                <button className="k-btn ghost grow" onClick={() => setGraphExprs([])} disabled={!graphExprs.length}>Clear plots</button>
              </div>
            )}
          </section>

          {/* ── Keypad ── */}
          <section className={`k-keypad${fnOpen ? " fn-open" : ""}`} aria-label="Keypad">
            <div className="k-tools" onPointerDown={onToolsPointerDown} onPointerMove={onToolsPointerMove} onPointerUp={onToolsPointerUp} onPointerCancel={onToolsPointerUp}>
              <button className="kk kk-tool kk-fntoggle" aria-expanded={fnOpen} title={fnOpen ? "Hide function keys" : "Show function keys"} onClick={tool(() => setFnOpen(!fnOpen))}>
                ƒ<Icon name="up" size={14} />
              </button>
              <button className="kk kk-tool" title="Move left" onClick={tool(() => pressKey("◀"))}><Icon name="left" /></button>
              <button className="kk kk-tool" title="Move right" onClick={tool(() => pressKey("▶"))}><Icon name="right" /></button>
              <button className="kk kk-tool" title="Previous answer" onClick={tool(() => pressKey("ANS"))}>ANS</button>
              <button className="kk kk-tool kk-ac" title="Clear" onClick={tool(() => pressKey("AC"))}>AC</button>
              <button className="kk kk-tool" title="Delete" onClick={tool(() => pressKey("⌫"))}><Icon name="back" size={19} /></button>
            </div>

            <div className="k-fnpanel" aria-hidden={!fnOpen}>
              <div className="k-fnpanel-in">
                {mode === "calc" && (
                  <div className="k-vars">
                    <button className={`kk kk-var kk-sto${storeArmed ? " armed" : ""}`} onClick={armStore} title="Store the current value into a variable" tabIndex={fnOpen ? 0 : -1}>{storeArmed ? "STO →" : "STO"}</button>
                    {["A", "B", "C", "D", "M"].map((v) => (
                      <button key={v} className={`kk kk-var${storeArmed ? " armed" : vars[v] !== undefined ? " set" : ""}`} onClick={() => onVar(v)} tabIndex={fnOpen ? 0 : -1}
                        title={vars[v] !== undefined ? `${v} (stored — tap to use)` : `variable ${v}`}>{v}</button>
                    ))}
                  </div>
                )}
                <div className="k-grid">
                  {fnRows.flat().map((k, i) => (
                    <button key={k + i} className={keyClass(k)} onClick={() => onKeyBtn(k)} tabIndex={fnOpen ? 0 : -1}>{KEY_LABEL[k] ?? k}</button>
                  ))}
                </div>
              </div>
            </div>

            <div className="k-grid">
              {baseRow.map((k, i) => k === "⇧"
                ? <button key={k + i} className={`kk kk-shift${layer && fnOpen ? " on" : ""}`} onPointerDown={shiftDown} onPointerUp={shiftUp} onPointerLeave={shiftCancel} onContextMenu={(e) => e.preventDefault()}
                    title={fnOpen ? "Switch function layer (hold: 3rd)" : "Show function keys"}>{fnOpen ? ["⇧", "2nd", "3rd"][layer] : "⇧"}</button>
                : <button key={k + i} className={keyClass(k)} onClick={() => onKeyBtn(k)}>{KEY_LABEL[k] ?? k}</button>
              )}
            </div>
            <div className="k-grid">
              {numKeys.flat().map((k, i) => <button key={k + i} className={keyClass(k)} onClick={() => onKeyBtn(k)}>{KEY_LABEL[k] ?? k}</button>)}
            </div>
          </section>
        </main>
      ) : (
        <main className="k-main">
          <div className="k-toolpanel">
            {mode === "base" ? <BasePanel /> : mode === "units" ? <UnitPanel /> : mode === "fx" ? <CurrencyPanel /> : null}
          </div>
        </main>
      )}
    </div>
  );
}
