const GOL_ORANGE = [241, 90, 34];
const FR_BG = [255, 0, 0];
const FA_BG = [198, 224, 180];
const WEEKEND_HEADER_BG = [255, 199, 206];
const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];
const MONTH_SHORT_PT = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
const WEEKDAY_SHORT = { Dom:"dom", Seg:"seg", Ter:"ter", Qua:"qua", Qui:"qui", Sex:"sex", "Sáb":"sáb", Sab:"sáb" };

function toArgb([r,g,b]){return "FF"+[r,g,b].map(v=>v.toString(16).padStart(2,"0")).join("").toUpperCase()}
function monthBanner(y,m){return `Mês: ${MONTH_SHORT_PT[m-1]??String(m).padStart(2,"0")}/${y}`}
function weekdayShort(l){return WEEKDAY_SHORT[l]??String(l).toLowerCase()}
function isWeekendLabel(l){const s=weekdayShort(l);return s==="sáb"||s==="dom"}
function mapCell(cell){
  const display=String(cell?.display??"").trim().toUpperCase();
  const kind=cell?.kind??"empty";
  if(!display||kind==="empty") return {text:"",bg:WHITE,fg:BLACK};
  const m=/^T([1-4])$/.exec(display); if(m) return {text:m[1],bg:WHITE,fg:BLACK};
  if(kind==="folga"||kind==="folga-weekend"||display==="F"||display==="FR"||display==="FOLGA") return {text:"FR",bg:FR_BG,fg:BLACK};
  if(kind==="fa"||display==="FA") return {text:"FA",bg:FA_BG,fg:BLACK};
  if(kind==="fs"||display==="FS") return {text:"FS",bg:FA_BG,fg:BLACK};
  return {text:display,bg:WHITE,fg:BLACK};
}
function apaoRows(grid){return (grid.groups||[]).filter(g=>g.type==="APAO").flatMap(g=>g.rows||[])}
function triggerXlsx(buffer,fileName){
  const blob=new Blob([buffer],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
  const url=URL.createObjectURL(blob); const a=document.createElement("a");
  a.href=url;a.download=fileName;a.rel="noopener";a.style.display="none";document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),0);
}
async function loadLogo(){try{const r=await fetch("assets/brand/logo-gol-export.png"); if(!r.ok)return null; return await r.arrayBuffer()}catch{return null}}
async function enrichCifs(grid){
  try{
    const token=sessionStorage.getItem("escala_auth_token");
    const headers=token?{Authorization:"Bearer "+token}:{};
    const res=await fetch("/api/employees",{headers});
    if(!res.ok) return grid;
    const list=await res.json();
    const arr=Array.isArray(list)?list:(list.employees||[]);
    const byId=new Map(arr.map(e=>[e.id,e.cif||""]));
    return {...grid, groups:(grid.groups||[]).map(g=>({...g, rows:(g.rows||[]).map(r=>({...r, cif:r.cif||byId.get(r.employeeId)||""}))}))};
  }catch{ return grid; }
}

export async function downloadApaoRevezamentoExcel(grid){
  grid=await enrichCifs(grid);
  const mod=await import("./chunk-YQ6WVFQT.js");
  const ExcelJS=mod.default;
  const workbook=new ExcelJS.Workbook(); workbook.creator="Escala APAO — Revezamento";
  const sheet=workbook.addWorksheet("Escala de Revezamento",{views:[{state:"frozen",xSplit:2,ySplit:5}],pageSetup:{orientation:"landscape",fitToPage:true,fitToWidth:1,fitToHeight:1,paperSize:9}});
  const days=grid.dayNumbers; const lastCol=2+days.length;
  sheet.mergeCells(1,3,2,lastCol);
  const title=sheet.getCell(1,3); title.value="Escala de Revezamento"; title.font={bold:true,size:20,color:{argb:"FF111827"},name:"Calibri"}; title.alignment={vertical:"middle",horizontal:"left"};
  sheet.getRow(1).height=22; sheet.getRow(2).height=22;
  const logo=await loadLogo();
  if(logo){ const id=workbook.addImage({buffer:new Uint8Array(logo),extension:"png"}); sheet.addImage(id,{tl:{col:0,row:0},ext:{width:120,height:32},editAs:"oneCell"}); }
  else { sheet.mergeCells(1,1,2,2); const c=sheet.getCell(1,1); c.value="GOL"; c.font={bold:true,size:18,color:{argb:toArgb(GOL_ORANGE)}}; c.alignment={vertical:"middle",horizontal:"center"}; }
  sheet.mergeCells(3,1,3,lastCol);
  const monthCell=sheet.getCell(3,1); monthCell.value=monthBanner(grid.year,grid.month); monthCell.font={bold:true,size:12,color:{argb:"FFFFFFFF"}}; monthCell.fill={type:"pattern",pattern:"solid",fgColor:{argb:toArgb(GOL_ORANGE)}}; monthCell.alignment={vertical:"middle",horizontal:"left"}; sheet.getRow(3).height=20;
  sheet.mergeCells(4,1,5,1); sheet.mergeCells(4,2,5,2);
  for(const [col,val] of [[1,"NOME"],[2,"CIF"]]){ const c=sheet.getCell(4,col); c.value=val; c.font={bold:true,size:10}; c.alignment={vertical:"middle",horizontal:"center"}; c.border={top:{style:"thin"},left:{style:"thin"},bottom:{style:"thin"},right:{style:"thin"}}; }
  days.forEach((day,index)=>{ const col=index+3; const weekday=grid.weekdayLabels[index]??""; const weekend=isWeekendLabel(weekday); const dayCell=sheet.getCell(4,col); const wdCell=sheet.getCell(5,col); dayCell.value=day; wdCell.value=weekdayShort(weekday); for(const cell of [dayCell,wdCell]){ cell.font={bold:true,size:8}; cell.alignment={vertical:"middle",horizontal:"center",textRotation:cell===wdCell?90:0}; cell.fill={type:"pattern",pattern:"solid",fgColor:{argb:toArgb(weekend?WEEKEND_HEADER_BG:WHITE)}}; cell.border={top:{style:"thin"},left:{style:"thin"},bottom:{style:"thin"},right:{style:"thin"}}; } });
  sheet.getRow(4).height=16; sheet.getRow(5).height=36; sheet.getColumn(1).width=22; sheet.getColumn(2).width=8; for(let col=3;col<=lastCol;col++) sheet.getColumn(col).width=3.4;
  let excelRow=6;
  for(const row of apaoRows(grid)){
    const excel=sheet.getRow(excelRow);
    excel.getCell(1).value=String(row.name||"").toUpperCase(); excel.getCell(2).value=String(row.cif||"").trim();
    for(const col of [1,2]){ const c=excel.getCell(col); c.font={bold:true,size:9}; c.alignment={vertical:"middle",horizontal:col===1?"left":"center"}; c.border={top:{style:"dashed"},left:{style:"thin"},bottom:{style:"dashed"},right:{style:"thin"}}; }
    days.forEach((day,index)=>{ const mapped=mapCell(row.cells?.[day-1]); const c=excel.getCell(index+3); c.value=mapped.text; c.font={bold:true,size:8,color:{argb:toArgb(mapped.fg)}}; c.fill={type:"pattern",pattern:"solid",fgColor:{argb:toArgb(mapped.bg)}}; c.alignment={vertical:"middle",horizontal:"center"}; c.border={top:{style:"thin"},left:{style:"thin"},bottom:{style:"thin"},right:{style:"thin"}}; });
    excel.height=16; excelRow+=1;
  }
  const buffer=await workbook.xlsx.writeBuffer();
  triggerXlsx(buffer, `escala-revezamento-apao_${grid.year}_${String(grid.month).padStart(2,"0")}.xlsx`);
}

export async function downloadApaoRevezamentoPdf(grid){
  grid=await enrichCifs(grid);
  const jspdfMod=await import("https://cdn.jsdelivr.net/npm/jspdf@4.2.1/+esm");
  const autoMod=await import("https://cdn.jsdelivr.net/npm/jspdf-autotable@5.0.8/+esm");
  const jsPDF=jspdfMod.jsPDF;
  const autoTable=autoMod.default;
  const doc=new jsPDF({orientation:"landscape",unit:"mm",format:"a4",compress:true});
  const pageW=doc.internal.pageSize.getWidth(); const margin=6; let y=margin;
  const logo=await loadLogo();
  if(logo){ const bytes=new Uint8Array(logo); let binary=""; for(let i=0;i<bytes.length;i++) binary+=String.fromCharCode(bytes[i]); doc.addImage(`data:image/png;base64,${btoa(binary)}`,"PNG",margin,y,28,8); }
  else { doc.setFont("helvetica","bold"); doc.setFontSize(16); doc.setTextColor(...GOL_ORANGE); doc.text("GOL",margin,y+6); }
  doc.setFont("helvetica","bold"); doc.setFontSize(16); doc.setTextColor(17,24,39); doc.text("Escala de Revezamento",margin+34,y+6); y+=12;
  doc.setFillColor(...GOL_ORANGE); doc.rect(margin,y,pageW-margin*2,7,"F"); doc.setFontSize(11); doc.setTextColor(255,255,255); doc.text(monthBanner(grid.year,grid.month),margin+2,y+5); y+=9;
  const headTop=["NOME","CIF",...grid.dayNumbers.map(String)];
  const headWeek=["","",...grid.weekdayLabels.map(w=>weekdayShort(w))];
  const body=[], bodyMeta=[];
  for(const row of apaoRows(grid)){ const mapped=grid.dayNumbers.map(day=>mapCell(row.cells?.[day-1])); body.push([String(row.name||"").toUpperCase(), String(row.cif||"").trim(), ...mapped.map(c=>c.text)]); bodyMeta.push(mapped); }
  const nameColW=40,cifColW=14; const dayW=(pageW-margin*2-nameColW-cifColW)/Math.max(grid.dayNumbers.length,1);
  autoTable(doc,{ startY:y, head:[headTop,headWeek], body, theme:"grid", tableWidth:pageW-margin*2, margin:{left:margin,right:margin,top:margin,bottom:margin},
    styles:{fontSize:7,cellPadding:0.5,halign:"center",valign:"middle",lineColor:[0,0,0],lineWidth:0.15,textColor:[0,0,0],fontStyle:"bold",minCellHeight:4},
    headStyles:{fillColor:[255,255,255],textColor:[0,0,0],fontStyle:"bold",fontSize:7},
    columnStyles:{0:{cellWidth:nameColW,halign:"left"},1:{cellWidth:cifColW,halign:"center"},...Object.fromEntries(grid.dayNumbers.map((_,i)=>[i+2,{cellWidth:dayW,halign:"center"}]))},
    didParseCell:(data)=>{
      if(data.section==="head"&&data.column.index>=2){ const weekday=grid.weekdayLabels[data.column.index-2]??""; if(isWeekendLabel(weekday)) data.cell.styles.fillColor=WEEKEND_HEADER_BG; return; }
      if(data.section!=="body") return;
      if(data.column.index<=1){ data.cell.styles.fillColor=WHITE; data.cell.styles.halign=data.column.index===0?"left":"center"; return; }
      const meta=bodyMeta[data.row.index]?.[data.column.index-2]; if(!meta) return; data.cell.styles.fillColor=meta.bg; data.cell.styles.textColor=meta.fg;
    }
  });
  doc.save(`escala-revezamento-apao_${grid.year}_${String(grid.month).padStart(2,"0")}.pdf`);
}
