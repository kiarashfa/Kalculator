// ═══════════════════════════════════════════════════════════════════════════
// Stand-alone panels: the graph overlay and the three converters (units,
// currency, number bases). Unchanged behaviour, moved out of Kalculator.jsx.
// ═══════════════════════════════════════════════════════════════════════════
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { parseInBase, formatBases } from "./baseConvert.js";
import { MathEngine } from "./compute.js";

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
export function GraphView({ expressions, onClose }) {
  const canvasRef=useRef(null);const[vp,setVp]=useState({xMin:-10,xMax:10,yMin:-7,yMax:7});const dragRef=useRef(null);
  const colors=["#f472b6","#60a5fa","#34d399","#fbbf24","#a78bfa","#fb923c"];
  const draw=useCallback(()=>{const cv=canvasRef.current;if(!cv)return;const ctx=cv.getContext("2d");const W=cv.width=cv.offsetWidth*2,H=cv.height=cv.offsetHeight*2;ctx.scale(2,2);const w=W/2,h=H/2;const{xMin,xMax,yMin,yMax}=vp;const sx=x=>((x-xMin)/(xMax-xMin))*w,sy=y=>h-((y-yMin)/(yMax-yMin))*h;ctx.fillStyle="#0a0a0f";ctx.fillRect(0,0,w,h);const gs=v=>{const r=v/8,m=Math.pow(10,Math.floor(Math.log10(r))),n=r/m;return n<1.5?m:n<3.5?2*m:n<7.5?5*m:10*m;};const xs=gs(xMax-xMin),ys=gs(yMax-yMin);ctx.strokeStyle="rgba(255,255,255,0.06)";ctx.lineWidth=0.5;for(let x=Math.ceil(xMin/xs)*xs;x<=xMax;x+=xs){const px=sx(x);ctx.beginPath();ctx.moveTo(px,0);ctx.lineTo(px,h);ctx.stroke();ctx.fillStyle="rgba(255,255,255,0.3)";ctx.font="10px monospace";ctx.textAlign="center";if(Math.abs(x)>xs*0.01)ctx.fillText(parseFloat(x.toPrecision(4)),px,sy(0)+14);}for(let y=Math.ceil(yMin/ys)*ys;y<=yMax;y+=ys){const py=sy(y);ctx.beginPath();ctx.moveTo(0,py);ctx.lineTo(w,py);ctx.stroke();ctx.fillStyle="rgba(255,255,255,0.3)";ctx.font="10px monospace";ctx.textAlign="right";if(Math.abs(y)>ys*0.01)ctx.fillText(parseFloat(y.toPrecision(4)),sx(0)-6,py+3);}ctx.strokeStyle="rgba(255,255,255,0.25)";ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(sx(0),0);ctx.lineTo(sx(0),h);ctx.stroke();ctx.beginPath();ctx.moveTo(0,sy(0));ctx.lineTo(w,sy(0));ctx.stroke();expressions.forEach((expr,idx)=>{const pts=MathEngine.graphPts(expr,xMin,xMax,Math.min(800,w));ctx.strokeStyle=colors[idx%colors.length];ctx.lineWidth=2;ctx.lineJoin="round";ctx.beginPath();let d=false,prevY=null;for(const p of pts){if(p.y===null||Math.abs(p.y)>(yMax-yMin)*50){d=false;prevY=null;continue;}if(prevY!==null&&Math.abs(p.y-prevY)>(yMax-yMin)){d=false;}/* asymptote jump → pen up */const px=sx(p.x),py=sy(p.y);if(!d){ctx.moveTo(px,py);d=true;}else ctx.lineTo(px,py);prevY=p.y;}ctx.stroke();});expressions.forEach((e,i)=>{ctx.fillStyle=colors[i%colors.length];ctx.font="bold 12px monospace";ctx.textAlign="left";ctx.fillText(`f(x) = ${e}`,12,20+i*20);});},[vp,expressions]);
  useEffect(()=>{draw();},[draw]);
  return(<div style={{position:"fixed",inset:0,zIndex:100,background:"#0a0a0f",display:"flex",flexDirection:"column"}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 16px",borderBottom:"1px solid rgba(255,255,255,0.08)"}}><span style={{color:"#f472b6",fontWeight:700,fontSize:14}}>GRAPH</span><div style={{display:"flex",gap:8}}><button onClick={()=>setVp({xMin:-10,xMax:10,yMin:-7,yMax:7})} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"#ccc",borderRadius:6,padding:"6px 14px",cursor:"pointer",fontSize:11}}>Reset</button><button onClick={onClose} style={{background:"rgba(244,114,182,0.15)",border:"1px solid rgba(244,114,182,0.3)",color:"#f472b6",borderRadius:6,padding:"6px 14px",cursor:"pointer",fontSize:11,fontWeight:600}}>Close</button></div></div><canvas ref={canvasRef} style={{flex:1,cursor:"grab",touchAction:"none"}} onWheel={e=>{e.preventDefault();const f=e.deltaY>0?1.15:0.87;setVp(v=>{const cx=(v.xMin+v.xMax)/2,cy=(v.yMin+v.yMax)/2,hw=((v.xMax-v.xMin)/2)*f,hh=((v.yMax-v.yMin)/2)*f;return{xMin:cx-hw,xMax:cx+hw,yMin:cy-hh,yMax:cy+hh};});}} onPointerDown={e=>{const r=canvasRef.current.getBoundingClientRect();dragRef.current={x:e.clientX,y:e.clientY,v:{...vp},r};canvasRef.current.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(!dragRef.current)return;const{x,y,v,r}=dragRef.current;const dx=(e.clientX-x)/r.width*(v.xMax-v.xMin),dy=(e.clientY-y)/r.height*(v.yMax-v.yMin);setVp({xMin:v.xMin-dx,xMax:v.xMax-dx,yMin:v.yMin+dy,yMax:v.yMax+dy});}} onPointerUp={()=>{dragRef.current=null;}}/></div>);
}


// ─── Unit Converter ─────────────────────────────────────────────────────────
export function UnitPanel() {
  const cats=Object.keys(UNIT_DATA);const[cat,setCat]=useState("Length");const[fu,setFu]=useState("");const[tu,setTu]=useState("");const[fv,setFv]=useState("1");const[search,setSearch]=useState("");const[showCat,setShowCat]=useState(false);
  const units=useMemo(()=>Object.keys(UNIT_DATA[cat]||{}),[cat]);
  useEffect(()=>{setFu(units[0]||"");setTu(units[1]||"");},[cat,units]);
  const result=useMemo(()=>{const v=parseFloat(fv);if(isNaN(v))return"";const r=convertUnit(v,cat,fu,tu);if(r===null)return"—";if(Math.abs(r)<1e-4||Math.abs(r)>1e12)return r.toExponential(6);return parseFloat(r.toPrecision(10)).toLocaleString("en-US",{maximumFractionDigits:10});},[fv,cat,fu,tu]);
  const ss={width:"100%",padding:"10px 12px",borderRadius:8,fontSize:13,fontFamily:"'DM Mono',monospace",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",color:"#ddd",appearance:"none",outline:"none"};
  const fc=cats.filter(c=>c.toLowerCase().includes(search.toLowerCase()));
  return(<div style={{padding:16,display:"flex",flexDirection:"column",gap:12,flex:1,overflowY:"auto"}}><button onClick={()=>setShowCat(!showCat)} style={{padding:"10px 14px",borderRadius:10,fontSize:13,fontWeight:600,fontFamily:"'DM Mono',monospace",cursor:"pointer",textAlign:"left",background:"rgba(251,191,36,0.08)",border:"1px solid rgba(251,191,36,0.15)",color:"#fbbf24",display:"flex",justifyContent:"space-between",alignItems:"center"}}><span>{cat}</span><span style={{fontSize:10,opacity:0.6}}>{showCat?"▲":"▼"}</span></button>{showCat&&<div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:10,maxHeight:240,overflowY:"auto",padding:4}}><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search..." style={{width:"100%",padding:"8px",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.06)",borderRadius:6,color:"#ccc",fontSize:12,fontFamily:"'DM Mono',monospace",outline:"none",marginBottom:4,boxSizing:"border-box"}}/>{fc.map(c=><button key={c} onClick={()=>{setCat(c);setShowCat(false);setSearch("");}} style={{display:"block",width:"100%",textAlign:"left",padding:"8px 10px",background:c===cat?"rgba(251,191,36,0.1)":"transparent",border:"none",color:c===cat?"#fbbf24":"#999",fontSize:12,fontFamily:"'DM Mono',monospace",cursor:"pointer",borderRadius:6}}>{c}</button>)}</div>}<div style={{background:"rgba(255,255,255,0.02)",borderRadius:12,padding:14,border:"1px solid rgba(255,255,255,0.05)"}}><div style={{fontSize:10,color:"#666",marginBottom:8,textTransform:"uppercase",letterSpacing:1}}>From</div><input value={fv} onChange={e=>setFv(e.target.value)} type="number" inputMode="decimal" style={{width:"100%",padding:"10px 0",background:"transparent",border:"none",outline:"none",color:"#fff",fontSize:28,fontFamily:"'DM Mono',monospace",fontWeight:600,boxSizing:"border-box"}}/><select value={fu} onChange={e=>setFu(e.target.value)} style={ss}>{units.map(u=><option key={u} value={u}>{u}</option>)}</select></div><div style={{display:"flex",justifyContent:"center"}}><button onClick={()=>{setFu(tu);setTu(fu);}} style={{width:40,height:40,borderRadius:"50%",background:"rgba(251,191,36,0.1)",border:"1px solid rgba(251,191,36,0.2)",color:"#fbbf24",cursor:"pointer",fontSize:18,display:"flex",alignItems:"center",justifyContent:"center"}}>⇅</button></div><div style={{background:"rgba(255,255,255,0.02)",borderRadius:12,padding:14,border:"1px solid rgba(255,255,255,0.05)"}}><div style={{fontSize:10,color:"#666",marginBottom:8,textTransform:"uppercase",letterSpacing:1}}>To</div><div style={{fontSize:28,fontWeight:600,color:"#fbbf24",fontFamily:"'DM Mono',monospace",padding:"10px 0",minHeight:50,wordBreak:"break-all"}}>{result||"—"}</div><select value={tu} onChange={e=>setTu(e.target.value)} style={ss}>{units.map(u=><option key={u} value={u}>{u}</option>)}</select></div></div>);
}


// ─── Currency ───────────────────────────────────────────────────────────────
export function CurrencyPanel() {
  const codes=Object.keys(CURRENCY_DATA);const[fc,setFc]=useState("USD");const[tc,setTc]=useState("EUR");const[amt,setAmt]=useState("1");const[search,setSearch]=useState("");const[pick,setPick]=useState(null);
  const result=useMemo(()=>{const v=parseFloat(amt);if(isNaN(v))return"";const r=v/CURRENCY_DATA[fc].rate*CURRENCY_DATA[tc].rate;if(Math.abs(r)>1e9)return r.toExponential(4);return r.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:4});},[amt,fc,tc]);
  const rate=useMemo(()=>parseFloat((CURRENCY_DATA[tc].rate/CURRENCY_DATA[fc].rate).toPrecision(6)),[fc,tc]);
  const filtered=codes.filter(c=>{const s=search.toLowerCase();return c.toLowerCase().includes(s)||CURRENCY_DATA[c].name.toLowerCase().includes(s);});
  const CB=({code,onClick})=><button onClick={onClick} style={{width:"100%",padding:"10px 12px",borderRadius:8,textAlign:"left",display:"flex",alignItems:"center",gap:10,cursor:"pointer",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",color:"#ddd",fontFamily:"'DM Mono',monospace",fontSize:13}}><span style={{fontSize:20}}>{CURRENCY_DATA[code].flag}</span><div><div style={{fontWeight:600}}>{code}</div><div style={{fontSize:10,color:"#666"}}>{CURRENCY_DATA[code].name}</div></div><span style={{marginLeft:"auto",fontSize:10,color:"#555"}}>▼</span></button>;
  if(pick)return(<div style={{padding:16,display:"flex",flexDirection:"column",gap:8,flex:1,overflowY:"auto"}}><div style={{display:"flex",gap:8,alignItems:"center"}}><button onClick={()=>{setPick(null);setSearch("");}} style={{background:"none",border:"none",color:"#a78bfa",fontSize:18,cursor:"pointer",padding:"4px 8px"}}>←</button><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search..." autoFocus style={{flex:1,padding:"10px 12px",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:8,color:"#ccc",fontSize:13,fontFamily:"'DM Mono',monospace",outline:"none"}}/></div><div style={{overflowY:"auto",display:"flex",flexDirection:"column",gap:4,flex:1}}>{filtered.map(c=><button key={c} onClick={()=>{if(pick==="from")setFc(c);else setTc(c);setPick(null);setSearch("");}} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:(pick==="from"?fc:tc)===c?"rgba(167,139,250,0.1)":"transparent",border:(pick==="from"?fc:tc)===c?"1px solid rgba(167,139,250,0.2)":"1px solid transparent",borderRadius:8,cursor:"pointer",color:"#ccc",fontFamily:"'DM Mono',monospace",fontSize:13,textAlign:"left",width:"100%"}}><span style={{fontSize:20}}>{CURRENCY_DATA[c].flag}</span><span style={{fontWeight:600}}>{c}</span><span style={{color:"#666",fontSize:11}}>{CURRENCY_DATA[c].name}</span></button>)}</div></div>);
  return(<div style={{padding:16,display:"flex",flexDirection:"column",gap:12,flex:1,overflowY:"auto"}}><div style={{textAlign:"center",fontSize:10,color:"#777"}}>⚠ Approximate offline rates · as of {CURRENCY_RATES_DATE} · not live</div><div style={{background:"rgba(255,255,255,0.02)",borderRadius:12,padding:14,border:"1px solid rgba(255,255,255,0.05)"}}><div style={{fontSize:10,color:"#666",marginBottom:8,textTransform:"uppercase",letterSpacing:1}}>From</div><input value={amt} onChange={e=>setAmt(e.target.value)} type="number" inputMode="decimal" style={{width:"100%",padding:"10px 0",background:"transparent",border:"none",outline:"none",color:"#fff",fontSize:28,fontFamily:"'DM Mono',monospace",fontWeight:600,boxSizing:"border-box"}}/><CB code={fc} onClick={()=>setPick("from")}/></div><div style={{display:"flex",justifyContent:"center",alignItems:"center",gap:12}}><div style={{fontSize:11,color:"#555"}}>1 {fc} = {rate} {tc}</div><button onClick={()=>{setFc(tc);setTc(fc);}} style={{width:40,height:40,borderRadius:"50%",background:"rgba(167,139,250,0.1)",border:"1px solid rgba(167,139,250,0.2)",color:"#a78bfa",cursor:"pointer",fontSize:18,display:"flex",alignItems:"center",justifyContent:"center"}}>⇅</button></div><div style={{background:"rgba(255,255,255,0.02)",borderRadius:12,padding:14,border:"1px solid rgba(255,255,255,0.05)"}}><div style={{fontSize:10,color:"#666",marginBottom:8,textTransform:"uppercase",letterSpacing:1}}>To</div><div style={{fontSize:28,fontWeight:600,color:"#a78bfa",fontFamily:"'DM Mono',monospace",padding:"10px 0",minHeight:50}}>{result||"—"}</div><CB code={tc} onClick={()=>setPick("to")}/></div></div>);
}


// ─── Base Converter (programmer mode) ───────────────────────────────────────
export function BasePanel() {
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

