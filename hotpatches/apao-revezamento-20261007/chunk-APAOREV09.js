const GOL_ORANGE = [241, 90, 34];
const FR_BG = [255, 0, 0];
const FA_BG = [198, 224, 180];
const YELLOW = [255, 255, 0];
const FC_BG = [237, 125, 49];
const V_BG = [166, 166, 166];
const DM_BG = [189, 215, 238];
const L_BG = [0, 176, 240];
const FB_BG = [31, 78, 121];
const ND_BG = [229, 231, 235];
const FP_BG = [233, 213, 255];
const RA_BG = [255, 230, 153];
const SIM_BG = [89, 89, 89];
const WEEKEND_HEADER_BG = [255, 199, 206];
const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];
const LEGEND_LEFT = [["FR","FOLGA REGULAMENTAR"],["FA","FOLGA AGRUPADA"],["FS","FOLGA SOCIAL"],["K","CURSO"],["FC","FOLGA COMPENSA"],["V","VOO"]];
const LEGEND_RIGHT = [["FF","FOLGA FERIADO"],["DM","DISPENSA MÉDICA"],["L","FÉRIAS"],["FB","FOLGA ANIVERSÁRIO"],["EP","EXAME PERIÓDICO"],null];
const TURNOS = [["Turno 1","00:00 - 06:00"],["Turno 2","06:00 - 12:00"],["Turno 3","12:00 - 18:00"],["Turno 4","18:00 - 00:00"]];
const MONTH_SHORT_PT = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
const WEEKDAY_SHORT = { Dom:"dom", Seg:"seg", Ter:"ter", Qua:"qua", Qui:"qui", Sex:"sex", "Sáb":"sáb", Sab:"sáb" };

function toArgb([r,g,b]){return "FF"+[r,g,b].map(v=>v.toString(16).padStart(2,"0")).join("").toUpperCase()}
function monthBanner(y,m){return `Mês: ${MONTH_SHORT_PT[m-1]??String(m).padStart(2,"0")}/${y}`}
function weekdayShort(l){return WEEKDAY_SHORT[l]??String(l).toLowerCase()}
function isWeekendLabel(l){const s=weekdayShort(l);return s==="sáb"||s==="dom"}
function paint(text,bg,fg){return {text,bg,fg:fg||BLACK}}
const STYLES={
  FR:paint("FR",FR_BG), FA:paint("FA",FA_BG), FS:paint("FS",YELLOW), K:paint("K",YELLOW),
  FC:paint("FC",FC_BG), V:paint("V",V_BG), FF:paint("FF",WHITE), DM:paint("DM",DM_BG),
  L:paint("L",L_BG), FB:paint("FB",FB_BG,WHITE), EP:paint("EP",YELLOW),
  ND:paint("ND",ND_BG), FP:paint("FP",FP_BG), RA:paint("RA",RA_BG), SIM:paint("SIM",SIM_BG,WHITE),
};
function norm(s){return String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim().toUpperCase()}
function mapCell(cell){
  const display=norm(cell?.display);
  const kind=cell?.kind??"empty";
  if(!display||kind==="empty") return {text:"",bg:WHITE,fg:BLACK};
  const m=/^T([1-4])$/.exec(display); if(m) return {text:m[1],bg:WHITE,fg:BLACK};
  if(kind==="ferias"||display==="FER"||display==="FERIAS"||display==="L") return STYLES.L;
  if(kind==="fani"||display==="FANI"||display==="FB") return STYLES.FB;
  if(kind==="fa"||display==="FA") return STYLES.FA;
  if(kind==="fs"||display==="FS") return STYLES.FS;
  if(kind==="voo"||display==="VOO"||display==="V") return STYLES.V;
  if(kind==="curso"||display==="CRS"||display==="CURSO"||display==="K") return STYLES.K;
  if(kind==="cma"||display==="CMA"||display==="EP") return STYLES.EP;
  if(display==="DM"||display.includes("DISPENSA")) return STYLES.DM;
  if(display==="FC") return STYLES.FC;
  if(display==="FF") return STYLES.FF;
  if(kind==="fp"||kind==="fp-weekend"||display==="FP") return STYLES.FP;
  if(kind==="nd"||display==="ND") return STYLES.ND;
  if(kind==="simulador"||display==="SIM"||display==="S") return STYLES.SIM;
  if(display==="RA") return STYLES.RA;
  if(kind==="folga"||kind==="folga-weekend"||display==="F"||display==="FR"||display==="FOLGA") return STYLES.FR;
  return {text:display,bg:WHITE,fg:BLACK};
}
function legendLayout(lastCol){
  const start=3; const end=Math.max(lastCol, start+20);
  const horarioCol=end-5+1; const turnoCol=horarioCol-4; const leftEnd=turnoCol-2;
  const code2=start+Math.floor((leftEnd-start+1)/2);
  return {code1:start, label1:[start+1, code2-1], code2, label2:[code2+1, leftEnd], turnoCol, turnoEnd:turnoCol+3, horarioCol, horarioEnd:end};
}
function paintExcel(sheet,row,col,value,opts={}){
  const cell=sheet.getCell(row,col);
  cell.value=value;
  cell.font={bold:true,size:opts.size??9,color:{argb:toArgb(opts.fg||BLACK)},name:"Calibri"};
  cell.fill={type:"pattern",pattern:"solid",fgColor:{argb:toArgb(opts.bg||WHITE)}};
  cell.alignment={vertical:"middle",horizontal:opts.align||"center"};
  cell.border={top:{style:"thin"},left:{style:"thin"},bottom:{style:"thin"},right:{style:"thin"}};
}
function writeExcelLegend(sheet,startRow,lastCol){
  const L=legendLayout(lastCol); const header=startRow;
  sheet.mergeCells(header,1,header,L.turnoCol-2);
  paintExcel(sheet,header,1,"LEGENDA AEROVIÁRIO",{bg:GOL_ORANGE,fg:WHITE,size:11,align:"left"});
  sheet.mergeCells(header,L.turnoCol,header,L.turnoEnd);
  paintExcel(sheet,header,L.turnoCol,"TURNOS",{bg:GOL_ORANGE,fg:WHITE,size:11});
  sheet.mergeCells(header,L.horarioCol,header,L.horarioEnd);
  paintExcel(sheet,header,L.horarioCol,"HORÁRIOS",{bg:GOL_ORANGE,fg:WHITE,size:11});
  sheet.getRow(header).height=18;
  LEGEND_LEFT.forEach((left,i)=>{
    const row=header+1+i; const right=LEGEND_RIGHT[i]; const turno=TURNOS[i];
    const lp=STYLES[left[0]];
    sheet.mergeCells(row,L.label1[0],row,L.label1[1]);
    paintExcel(sheet,row,L.code1,lp.text,{bg:lp.bg,fg:lp.fg,size:8});
    paintExcel(sheet,row,L.label1[0],left[1],{align:"left",size:9});
    sheet.mergeCells(row,L.label2[0],row,L.label2[1]);
    if(right){ const rp=STYLES[right[0]]; paintExcel(sheet,row,L.code2,rp.text,{bg:rp.bg,fg:rp.fg,size:8}); paintExcel(sheet,row,L.label2[0],right[1],{align:"left",size:9}); }
    else { paintExcel(sheet,row,L.code2,"",{bg:WHITE}); paintExcel(sheet,row,L.label2[0],"",{align:"left"}); }
    sheet.mergeCells(row,L.turnoCol,row,L.turnoEnd);
    sheet.mergeCells(row,L.horarioCol,row,L.horarioEnd);
    paintExcel(sheet,row,L.turnoCol,turno?.[0]??"",{align:"center",size:9});
    paintExcel(sheet,row,L.horarioCol,turno?.[1]??"",{align:"center",size:9});
    sheet.getRow(row).height=16;
  });
}
function apaoRows(grid){return (grid.groups||[]).filter(g=>g.type==="APAO").flatMap(g=>g.rows||[])}
function triggerXlsx(buffer,fileName){
  const blob=new Blob([buffer],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
  const url=URL.createObjectURL(blob); const a=document.createElement("a");
  a.href=url;a.download=fileName;a.rel="noopener";a.style.display="none";document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),0);
}
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
  sheet.mergeCells(1,1,2,2); const c=sheet.getCell(1,1); c.value="GOL"; c.font={bold:true,size:22,color:{argb:toArgb(GOL_ORANGE)},name:"Calibri"}; c.alignment={vertical:"middle",horizontal:"center"};
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
  writeExcelLegend(sheet, excelRow+1, lastCol);
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
  doc.setFont("helvetica","bold"); doc.setFontSize(18); doc.setTextColor(...GOL_ORANGE); doc.text("GOL",margin,y+6);
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
  const legendBody=LEGEND_LEFT.map((left,i)=>{ const right=LEGEND_RIGHT[i]; const turno=TURNOS[i]; return [left[0], left[1], right?.[0]??"", right?.[1]??"", turno?.[0]??"", turno?.[1]??""]; });
  autoTable(doc,{ startY:(doc.lastAutoTable?.finalY??y)+3, head:[["LEGENDA AEROVIÁRIO","","","","TURNOS","HORÁRIOS"]], body:legendBody, theme:"grid", tableWidth:pageW-margin*2, margin:{left:margin,right:margin},
    styles:{fontSize:7,cellPadding:0.8,valign:"middle",lineColor:[0,0,0],lineWidth:0.15,textColor:[0,0,0],fontStyle:"bold",minCellHeight:5},
    headStyles:{fillColor:GOL_ORANGE,textColor:WHITE,fontStyle:"bold",halign:"left"},
    columnStyles:{0:{cellWidth:12,halign:"center"},1:{cellWidth:48,halign:"left"},2:{cellWidth:12,halign:"center"},3:{cellWidth:48,halign:"left"},4:{cellWidth:28,halign:"center"},5:{cellWidth:36,halign:"center"}},
    didParseCell:(data)=>{
      if(data.section==="head"){ data.cell.styles.fillColor=GOL_ORANGE; data.cell.styles.textColor=WHITE; if(data.column.index>=4) data.cell.styles.halign="center"; return; }
      if(data.column.index!==0 && data.column.index!==2) return;
      const paint=STYLES[String(data.cell.raw??"")]; if(!paint) return;
      data.cell.styles.fillColor=paint.bg; data.cell.styles.textColor=paint.fg; data.cell.styles.halign="center";
    }
  });
  doc.save(`escala-revezamento-apao_${grid.year}_${String(grid.month).padStart(2,"0")}.pdf`);
}
