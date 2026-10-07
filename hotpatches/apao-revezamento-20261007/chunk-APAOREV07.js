const BAR_ORANGE = [255, 102, 0];
const GOL_ORANGE = BAR_ORANGE;
const FR_BG = [255, 0, 0];
const FA_BG = [146, 208, 80];
const YELLOW = [255, 255, 0];
const FC_BG = [255, 192, 0];
const V_BG = [247, 150, 70];
const FF_BG = [179, 162, 199];
const DM_BG = [217, 217, 217];
const L_BG = [0, 176, 240];
const FB_BG = [0, 112, 192];
const LEGEND_PEACH = [252, 213, 180];
const LEGEND_BROWN = [151, 71, 6];
const GRAY_BAR = [166, 166, 166];
const ND_BG = [229, 231, 235];
const FP_BG = [233, 213, 255];
const RA_BG = [255, 230, 153];
const SIM_BG = [89, 89, 89];
const WEEKEND_HEADER_BG = [255, 124, 128];
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
  FR:paint("FR",FR_BG), FA:paint("FA",FA_BG), FS:paint("FS",FA_BG), K:paint("K",YELLOW),
  FC:paint("FC",FC_BG), V:paint("V",V_BG), FF:paint("FF",FF_BG), DM:paint("DM",DM_BG),
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
function paintExcel(sheet,row,col,value,opts={}){
  const cell=sheet.getCell(row,col);
  cell.value=value;
  cell.font={bold:opts.bold!==false,size:opts.size??9,color:{argb:toArgb(opts.fg||BLACK)},name:opts.font||"Calibri"};
  cell.fill={type:"pattern",pattern:"solid",fgColor:{argb:toArgb(opts.bg||WHITE)}};
  cell.alignment={vertical:"middle",horizontal:opts.align||"center"};
  cell.border=opts.border||{top:{style:"thin"},left:{style:"thin"},bottom:{style:"thin"},right:{style:"thin"}};
}
function writeExcelLegend(sheet,startRow,lastDayCol){
  const titleEnd=17, turnoStart=18, turnoEnd=25, horaStart=26, horaEnd=Math.max(lastDayCol,33);
  for(let col=lastDayCol+1; col<=horaEnd; col++) sheet.getColumn(col).width=4;
  const header=startRow;
  sheet.mergeCells(header,1,header,titleEnd);
  paintExcel(sheet,header,1,"LEGENDA AEROVIÁRIO",{bg:LEGEND_PEACH,fg:LEGEND_BROWN,size:10});
  sheet.mergeCells(header,turnoStart,header+1,turnoEnd);
  paintExcel(sheet,header,turnoStart,"TURNOS",{bg:BAR_ORANGE,fg:WHITE,size:12,font:"Arial"});
  sheet.mergeCells(header,horaStart,header+1,horaEnd);
  paintExcel(sheet,header,horaStart,"HORÁRIOS",{bg:BAR_ORANGE,fg:WHITE,size:12,font:"Arial"});
  sheet.getRow(header).height=18.95;
  LEGEND_LEFT.forEach((left,i)=>{
    const row=header+1+i; const right=LEGEND_RIGHT[i]; const turno=i===0?null:TURNOS[i-1];
    sheet.getRow(row).height=i===LEGEND_LEFT.length-1?21.75:19.5;
    if(left[0]==="V"){
      sheet.mergeCells(row,1,row,3); paintExcel(sheet,row,1,"V",{bg:V_BG,fg:BLACK,size:10,bold:false,font:"Arial"});
      sheet.mergeCells(row,4,row,12); paintExcel(sheet,row,4,"VOO",{bg:WHITE,size:10,font:"Arial"});
      sheet.mergeCells(row,13,row,horaEnd); paintExcel(sheet,row,13,"",{bg:GRAY_BAR,size:10,font:"Arial"});
      return;
    }
    const lp=STYLES[left[0]];
    paintExcel(sheet,row,1,lp.text,{bg:lp.bg,fg:lp.fg,size:9});
    sheet.mergeCells(row,2,row,3); paintExcel(sheet,row,2,left[1],{bg:WHITE,size:9});
    sheet.mergeCells(row,4,row,12);
    if(right){ const rp=STYLES[right[0]]; paintExcel(sheet,row,4,rp.text,{bg:rp.bg,fg:rp.fg,size:9}); }
    else paintExcel(sheet,row,4,"",{bg:WHITE});
    sheet.mergeCells(row,13,row,titleEnd); paintExcel(sheet,row,13,right?.[1]??"",{bg:WHITE,size:9});
    if(!turno) return;
    sheet.mergeCells(row,turnoStart,row,turnoEnd);
    sheet.mergeCells(row,horaStart,row,horaEnd);
    paintExcel(sheet,row,turnoStart,turno[0],{bg:WHITE,size:12,font:"Arial"});
    paintExcel(sheet,row,horaStart,turno[1],{bg:WHITE,size:12,font:"Arial"});
  });
}
async function loadLogo(){
  try{
    const r=await fetch("/assets/brand/logo-gol-wordmark.png");
    if(!r.ok) return null;
    const bytes=new Uint8Array(await r.arrayBuffer());
    let binary="";
    for(let i=0;i<bytes.length;i++) binary+=String.fromCharCode(bytes[i]);
    return btoa(binary);
  }catch{ return null; }
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
  const sheet=workbook.addWorksheet("Escala de Revezamento",{views:[{state:"frozen",ySplit:4}],pageSetup:{orientation:"landscape",fitToPage:true,fitToWidth:1,fitToHeight:1,paperSize:9,scale:80}});
  const days=grid.dayNumbers; const lastDayCol=3+days.length;
  sheet.getColumn(1).width=35.14; sheet.getColumn(2).width=14.14; sheet.getColumn(3).width=9.14;
  for(let col=4; col<=lastDayCol; col++) sheet.getColumn(col).width=4;
  sheet.getRow(1).height=20.25; sheet.getRow(2).height=28.5; sheet.getRow(3).height=13.5; sheet.getRow(4).height=30.75;
  const logo=await loadLogo();
  if(logo){ const id=workbook.addImage({base64:logo,extension:"png"}); sheet.addImage(id,{tl:{col:0.2,row:0.12},ext:{width:143,height:58},editAs:"oneCell"}); }
  const title=sheet.getCell(1,2); title.value="Escala de Revezamento"; title.font={name:"Arial",bold:true,size:15,color:{argb:"FF000000"}}; title.alignment={vertical:"middle",horizontal:"left"};
  for(let col=2; col<=lastDayCol; col++){ const cell=sheet.getCell(2,col); cell.fill={type:"pattern",pattern:"solid",fgColor:{argb:toArgb(BAR_ORANGE)}}; cell.font={name:"Arial",bold:true,size:12,color:{argb:"FFFFFFFF"}}; cell.alignment={vertical:"middle",horizontal:"left"}; }
  sheet.getCell(2,2).value=monthBanner(grid.year,grid.month);
  sheet.mergeCells(3,1,4,2); const nome=sheet.getCell(3,1); nome.value="NOME"; nome.font={name:"Arial",bold:true,size:9}; nome.alignment={vertical:"middle",horizontal:"center"}; nome.border={top:{style:"thin"},left:{style:"thin"},bottom:{style:"thin"},right:{style:"thin"}};
  sheet.mergeCells(3,3,4,3); const cif=sheet.getCell(3,3); cif.value="CIF"; cif.font={name:"Arial",bold:true,size:9}; cif.alignment={vertical:"middle",horizontal:"center"}; cif.border={top:{style:"thin"},left:{style:"thin"},bottom:{style:"thin"},right:{style:"thin"}};
  days.forEach((day,index)=>{ const col=index+4; const weekend=isWeekendLabel(grid.weekdayLabels[index]??""); const fill=toArgb(weekend?WEEKEND_HEADER_BG:WHITE); const dayCell=sheet.getCell(3,col); const wdCell=sheet.getCell(4,col); dayCell.value=day; dayCell.font={name:"Arial",bold:true,size:9}; dayCell.alignment={vertical:"middle",horizontal:"center"}; dayCell.fill={type:"pattern",pattern:"solid",fgColor:{argb:fill}}; dayCell.border={right:{style:"thin"},bottom:{style:"thin"}}; wdCell.value=weekdayShort(grid.weekdayLabels[index]??""); wdCell.font={name:"Arial",bold:true,size:8}; wdCell.alignment={vertical:"middle",horizontal:"center",textRotation:90}; wdCell.fill={type:"pattern",pattern:"solid",fgColor:{argb:fill}}; wdCell.border={right:{style:"thin"},bottom:{style:"medium"}}; });
  let excelRow=5;
  for(const row of apaoRows(grid)){
    const excel=sheet.getRow(excelRow); excel.height=19.35;
    sheet.mergeCells(excelRow,1,excelRow,2);
    const name=excel.getCell(1); name.value=String(row.name||"").toUpperCase(); name.font={name:"Arial",bold:true,size:10}; name.alignment={vertical:"middle",horizontal:"center"}; name.border={left:{style:"medium"},right:{style:"dotted"},bottom:{style:"dotted"}};
    const cifCell=excel.getCell(3); cifCell.value=String(row.cif||"").trim(); cifCell.font={name:"Arial",bold:true,size:10}; cifCell.alignment={vertical:"middle",horizontal:"center"}; cifCell.border={left:{style:"dotted"},bottom:{style:"dotted"}};
    days.forEach((day,index)=>{ const mapped=mapCell(row.cells?.[day-1]); const c=excel.getCell(index+4); c.value=mapped.text||null; c.font={name:"Arial",bold:true,size:10,color:{argb:toArgb(mapped.fg)}}; c.fill={type:"pattern",pattern:"solid",fgColor:{argb:toArgb(mapped.bg)}}; c.alignment={vertical:"middle",horizontal:"center"}; c.border={top:{style:"thin"},left:{style:"thin"},bottom:{style:"thin"},right:{style:"thin"}}; });
    excelRow+=1;
  }
  writeExcelLegend(sheet, excelRow, lastDayCol);
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
  doc.setFont("helvetica","bold");
  if(logo){
    doc.addImage("data:image/png;base64,"+logo,"PNG",margin,y,28,11);
    doc.setFontSize(16); doc.setTextColor(17,24,39); doc.text("Escala de Revezamento",margin+32,y+8); y+=14;
  }else{
    doc.setFontSize(18); doc.setTextColor(...GOL_ORANGE); doc.text("GOL",margin,y+6);
    doc.setFontSize(16); doc.setTextColor(17,24,39); doc.text("Escala de Revezamento",margin+34,y+6); y+=12;
  }
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
  const legendBody=LEGEND_LEFT.map((left,i)=>{ const right=LEGEND_RIGHT[i]; const turno=i===0?null:TURNOS[i-1]; return [left[0], left[1], right?.[0]??"", right?.[1]??"", turno?.[0]??"", turno?.[1]??""]; });
  autoTable(doc,{ startY:(doc.lastAutoTable?.finalY??y)+3, head:[["LEGENDA AEROVIÁRIO","","","","TURNOS","HORÁRIOS"]], body:legendBody, theme:"grid", tableWidth:pageW-margin*2, margin:{left:margin,right:margin},
    styles:{fontSize:7,cellPadding:0.8,valign:"middle",lineColor:[0,0,0],lineWidth:0.15,textColor:[0,0,0],fontStyle:"bold",minCellHeight:5},
    headStyles:{fillColor:GOL_ORANGE,textColor:WHITE,fontStyle:"bold",halign:"left"},
    columnStyles:{0:{cellWidth:12,halign:"center"},1:{cellWidth:48,halign:"left"},2:{cellWidth:12,halign:"center"},3:{cellWidth:48,halign:"left"},4:{cellWidth:28,halign:"center"},5:{cellWidth:36,halign:"center"}},
    didParseCell:(data)=>{
      if(data.section==="head"){ if(data.column.index>=4){ data.cell.styles.fillColor=GOL_ORANGE; data.cell.styles.textColor=WHITE; data.cell.styles.halign="center"; } else { data.cell.styles.fillColor=LEGEND_PEACH; data.cell.styles.textColor=LEGEND_BROWN; } return; }
      if(data.column.index!==0 && data.column.index!==2) return;
      const paint=STYLES[String(data.cell.raw??"")]; if(!paint) return;
      data.cell.styles.fillColor=paint.bg; data.cell.styles.textColor=paint.fg; data.cell.styles.halign="center";
    }
  });
  doc.save(`escala-revezamento-apao_${grid.year}_${String(grid.month).padStart(2,"0")}.pdf`);
}
