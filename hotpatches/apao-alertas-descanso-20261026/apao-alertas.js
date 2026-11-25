/**
 * Alertas de descanso APAO + VOO/CURSO/SIMULADOR/ADM no popup.
 * Só leitura/informativo: não bloqueia alocação e não mexe no PAO.
 * v9: troca de verdade — grava/pinta os dois orig; orig vazio limpa o outro lado.
 * v10: VOO/Curso/Simulador usam o mês da toolbar, não o lead-in/executada do mês anterior.
 * v12: VOO/Curso/Simulador viram cartões de pré-alocação (igual PAO); ADM nos turnos APAO.
 */
(function () {
  if (window.__apaoAlertasV12) return;
  window.__apaoAlertasV12 = true;

  var HOUR_MS = 60 * 60 * 1000;
  var DAY_MS = 24 * HOUR_MS;
  var MONTHS = {
    jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6,
    jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12,
  };
  var SHIFT_TIMES = {
    T1: { start: "00:00", end: "06:00" },
    T2: { start: "06:00", end: "12:00" },
    T3: { start: "12:00", end: "18:00" },
    T4: { start: "18:00", end: "00:00" },
  };
  var DAY_OFF = { F: 1, FS: 1, FA: 1, FANI: 1, FP: 1, FOLGA: 1 };
  var EXTRA_CARDS = [
    { key: "VOO", code: "VOO", label: "VOO", cls: "alloc-option--voo", section: "pre" },
    { key: "CURSO", code: "CURSO", label: "Curso", cls: "alloc-option--curso", section: "pre" },
    { key: "SIMULADOR", code: "SIMULADOR", label: "Simulador", cls: "alloc-option--simulador", section: "pre" },
    { key: "ADM", code: "ADM", label: "Atividade Administrativa", cls: "alloc-option--shift", section: "turnos" },
  ];

  var lastSchedule = null;
  var lastSwaps = [];
  var lastPaintKey = "";

  var style = document.getElementById("apao-alertas-style") || document.createElement("style");
  style.id = "apao-alertas-style";
  style.textContent = [
    ".group-row .group-filler.col-day{text-align:center;vertical-align:middle}",
    ".schedule-grid td.col-day{position:relative}",
    ".apao-rest-alerts{display:inline-flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:.12rem;vertical-align:middle}",
    ".apao-rest-alerts--cell{position:absolute;top:.05rem;right:.05rem;z-index:3}",
    ".apao-rest-alert{display:inline-flex;align-items:center;gap:.15rem;min-height:1.25rem;padding:.08rem .3rem;border:1px solid #fdba74;border-radius:999px;background:#fff7ed;color:#9a3412;font-size:.65rem;font-weight:800;line-height:1;letter-spacing:normal;text-transform:none;cursor:help}",
    ".apao-rest-alert img{width:.9rem;height:.9rem;object-fit:contain}",
    ".apao-rest-alerts--cell .apao-rest-alert{min-height:auto;padding:.05rem}",
    ".alloc-option[data-apao-extra-card]{min-height:3.25rem;padding:.4rem .25rem;border:1px solid currentColor;border-radius:9px;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.12rem;font:inherit}",
    ".alloc-option[data-apao-extra-card] .alloc-option-code{font-size:.9rem;font-weight:800;line-height:1}",
    ".alloc-option[data-apao-extra-card] .alloc-option-label{font-size:.62rem;line-height:1.1;text-align:center}",
    ".alloc-option[data-apao-extra-card].selected{border:2px solid #f15a22;box-shadow:0 0 0 2px #f15a2224}",
    ".alloc-option[data-apao-extra-card].alloc-option--voo{background:#fff7ed;color:#c2410c;border-color:#fdba74}",
    ".alloc-option[data-apao-extra-card].alloc-option--curso{background:#fef3c7;color:#92400e;border-color:#fcd34d}",
    ".alloc-option[data-apao-extra-card].alloc-option--simulador{background:#f3f4f6;color:#374151;border-color:#d1d5db}",
    ".alloc-option[data-apao-extra-card].alloc-option--shift{background:#eff6ff;color:#1d4ed8;border-color:#93c5fd}",
    ".apao-extra-status{margin:.45rem 0 0;font-size:.75rem;color:#6b7280}",
    ".apao-extra-status.err{color:#b91c1c}",
    ".schedule-cell.cell-fa,.legend-chip.cell-fa{background:#bbf7d0!important;color:#166534!important;border-color:#86efac!important}",
    ".schedule-cell.cell-swap-applied{position:relative}",
    ".schedule-cell.cell-swap-applied::after{content:'';position:absolute;top:0;right:0;width:0;height:0;border-style:solid;border-width:0 .55rem .55rem 0;border-color:transparent #dc2626 transparent transparent;pointer-events:none}",
  ].join("");
  (document.head || document.documentElement).appendChild(style);

  function token() {
    return sessionStorage.getItem("escala_auth_token") || localStorage.getItem("escala_auth_token") || "";
  }

  function pad(n) {
    return (n < 10 ? "0" : "") + String(n);
  }

  function utcDay(iso) {
    var p = iso.split("-").map(Number);
    return Date.UTC(p[0], p[1] - 1, p[2]);
  }

  function timestampAt(iso, time) {
    var hm = time.split(":").map(Number);
    return utcDay(iso) + (hm[0] * 60 + hm[1]) * 60 * 1000;
  }

  function isoFromParts(year, month, day) {
    return year + "-" + pad(month) + "-" + pad(day);
  }

  function addDays(iso, delta) {
    var p = iso.split("-").map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + delta));
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
  }

  function formatDate(iso) {
    var p = iso.split("-");
    return p[2] + "/" + p[1] + "/" + p[0];
  }

  function formatHours(hours) {
    return Math.round(hours) === hours ? String(hours) : hours.toFixed(1).replace(".", ",");
  }

  function compact(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function baseShift(code) {
    var upper = String(code || "").trim().toUpperCase();
    if (upper.indexOf("TI") === 0 && upper.length > 2) return "T" + upper.slice(2);
    return upper;
  }

  function cellCode(text) {
    var upper = compact(text).toUpperCase();
    if (!upper || upper === "·") return "";
    var shift = upper.match(/\b(TI?\d+)\b/);
    if (shift) return shift[1];
    var off = upper.match(/\b(FANI|FOLGA|FS|FA|FP|F|ND)\b/);
    return off ? off[1] : upper.split(" ")[0];
  }

  function shiftTimes(code) {
    var base = baseShift(code);
    if (SHIFT_TIMES[base]) return SHIFT_TIMES[base];
    var shifts = (lastSchedule && lastSchedule.shifts) || [];
    for (var i = 0; i < shifts.length; i++) {
      if (String(shifts[i].code || "").toUpperCase() === base) {
        return { start: shifts[i].startTime, end: shifts[i].endTime };
      }
    }
    return null;
  }

  function periodFor(iso, code) {
    var times = shiftTimes(code);
    if (!times) return null;
    var startAt = timestampAt(iso, times.start);
    var endAt = timestampAt(iso, times.end);
    if (endAt <= startAt) endAt += DAY_MS;
    return { code: baseShift(code), startAt: startAt, endAt: endAt };
  }

  function isShiftLabel(text) {
    return !!shiftTimes(text);
  }

  function isDayOff(text) {
    return !!DAY_OFF[String(text || "").trim().toUpperCase()];
  }

  function isoDay(value) {
    var s = String(value || "");
    var m = s.match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : s.slice(0, 10);
  }

  function expandIso(start, length) {
    var n = Math.max(1, Number(length) || 1);
    var out = [];
    var base = isoDay(start);
    if (!base) return out;
    for (var i = 0; i < n; i++) out.push(addDays(base, i));
    return out;
  }

  function shortToken(label) {
    var n = compact(label).toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (!n) return "";
    if (n.indexOf("VOO") >= 0) return "VOO";
    if (n === "ND" || n.indexOf("NAO DISPONIVEL") >= 0) return "ND";
    if (n.indexOf("FOLGA PEDIDA") >= 0 || n === "FP") return "FP";
    if (n === "FOLGA SOCIAL" || n === "FS") return "FS";
    if (n.indexOf("FOLGA AGRUPADA") >= 0 || n === "FA") return "FA";
    if (n.indexOf("FOLGA ANIVERS") >= 0 || n === "FANI") return "FANI";
    if (n === "FOLGA" || n === "F") return "F";
    if (n.indexOf("SIMULADOR") >= 0) return "SIM";
    if (n.indexOf("CURSO") >= 0) return "CRS";
    if (n === "CMA") return "CMA";
    if (n.indexOf("FERIAS") >= 0) return "FER";
    return n;
  }

  function isBlankTok(value) {
    var raw = compact(value).toLowerCase();
    if (!raw) return true;
    return raw === "·" || raw === "-" || raw === "—" || raw === "–" || raw === "−" || raw === "em branco";
  }

  function normTok(value) {
    var raw = compact(value).toUpperCase();
    if (isBlankTok(raw)) return "";
    if (raw.indexOf("TI") === 0 && raw.length > 2) return "T" + raw.slice(2);
    return raw;
  }

  function tokensMatch(display, stored) {
    var a = normTok(baseShift(display) || display);
    var b = normTok(baseShift(stored) || stored);
    if (!a || !b) return !a && !b;
    return a === b || a.indexOf(b) === 0 || b.indexOf(a) === 0;
  }

  function findDayIndex(list, empId, iso) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].employeeId === empId && isoDay(list[i].date) === iso) return i;
    }
    return -1;
  }

  function retargetDate(prev, iso) {
    if (!prev) return iso + "T12:00:00.000Z";
    var s = String(prev);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return iso;
    if (s.indexOf("T") > 0) return iso + s.slice(10);
    return iso + "T12:00:00.000Z";
  }

  function tokenAt(assignments, pres, empId, iso) {
    var aIdx = findDayIndex(assignments, empId, iso);
    if (aIdx >= 0) {
      var shift = baseShift(assignments[aIdx].shiftCode);
      if (shift) return shift;
      var fromAssign = shortToken(assignments[aIdx].label);
      if (fromAssign) return fromAssign;
    }
    var pIdx = findDayIndex(pres, empId, iso);
    if (pIdx >= 0) {
      var fromPre = shortToken(pres[pIdx].label);
      if (fromPre) return fromPre;
    }
    return "";
  }

  function upsertAssignment(list, empId, iso, token) {
    var desired = normTok(baseShift(token) || shortToken(token) || token);
    if (!desired) return false;
    var idx = findDayIndex(list, empId, iso);
    if (idx >= 0) {
      var cur = normTok(baseShift(list[idx].shiftCode) || shortToken(list[idx].label));
      if (tokensMatch(cur, desired)) return false;
      list[idx] = Object.assign({}, list[idx], {
        shiftCode: desired,
        date: retargetDate(list[idx].date, iso),
      });
      return true;
    }
    list.push({
      employeeId: empId,
      date: iso + "T12:00:00.000Z",
      shiftCode: desired,
      label: null,
      source: "MANUAL",
    });
    return true;
  }

  function removeAt(list, empId, iso) {
    var idx = findDayIndex(list, empId, iso);
    if (idx < 0) return false;
    list.splice(idx, 1);
    return true;
  }

  function setDayToken(assignments, pres, empId, iso, token) {
    var desired = normTok(baseShift(token) || shortToken(token) || token);
    if (!desired) {
      var removedA = removeAt(assignments, empId, iso);
      var removedP = removeAt(pres, empId, iso);
      return removedA || removedP;
    }
    return upsertAssignment(assignments, empId, iso, desired);
  }

  function partAt(joined, index) {
    var parts = String(joined || "").split("+").map(function (p) { return p.trim(); }).filter(Boolean);
    if (!parts.length) return "";
    return parts[Math.min(index, parts.length - 1)] || "";
  }

  function applyApprovedSwapsToPayload(data) {
    if (!data || !Array.isArray(data.shiftSwaps) || !Array.isArray(data.assignments)) return false;
    var assignments = data.assignments;
    var pres = Array.isArray(data.preAllocations) ? data.preAllocations : [];
    var changed = false;
    for (var s = 0; s < data.shiftSwaps.length; s++) {
      var swap = data.shiftSwaps[s];
      if (!swap || swap.status !== "APPROVED") continue;
      if (String(swap.notes || "").indexOf("__ADMIN_EXECUTED_AUDIT__") >= 0) continue;
      var srcDates = swap.requesterDates && swap.requesterDates.length
        ? swap.requesterDates.map(isoDay)
        : expandIso(swap.date, swap.pairLength || 1);
      var tgtDates = swap.targetDates && swap.targetDates.length
        ? swap.targetDates.map(isoDay)
        : expandIso(swap.targetDate || swap.date, swap.pairLength || 1);
      var n = Math.min(srcDates.length, tgtDates.length);
      var self = swap.kind === "SELF";
      var reqEmp = swap.requesterEmployeeId;
      var tgtEmp = self ? reqEmp : swap.targetEmployeeId;
      if (!reqEmp || !tgtEmp) continue;
      for (var i = 0; i < n; i++) {
        var srcIso = srcDates[i];
        var tgtIso = tgtDates[i];
        var origReq = normTok(baseShift(partAt(swap.requesterShiftCode, i)) || shortToken(partAt(swap.requesterShiftCode, i)) || partAt(swap.requesterShiftCode, i));
        var origTgt = normTok(baseShift(partAt(swap.targetShiftCode, i)) || shortToken(partAt(swap.targetShiftCode, i)) || partAt(swap.targetShiftCode, i));
        if (!origReq && !origTgt) continue;
        if (origReq && origTgt && origReq === origTgt) continue;
        var nowReq = normTok(tokenAt(assignments, pres, reqEmp, srcIso));
        var nowTgt = normTok(tokenAt(assignments, pres, tgtEmp, tgtIso));
        if (tokensMatch(nowReq, origTgt) && tokensMatch(nowTgt, origReq)) continue;
        changed = setDayToken(assignments, pres, reqEmp, srcIso, origTgt) || changed;
        changed = setDayToken(assignments, pres, tgtEmp, tgtIso, origReq) || changed;
      }
    }
    if (changed) {
      data.assignments = assignments;
      data.preAllocations = pres;
    }
    return changed;
  }

  function isExecutedScheduleUrl(url) {
    return /\/(?:portal\/)?schedules\/\d+\/\d+(?:\/executed)?(?:\?|$)/.test(url || "");
  }

  function patchExecutedBody(url, text) {
    if (!isExecutedScheduleUrl(url) || !text) return text;
    try {
      var data = JSON.parse(text);
      if (applyApprovedSwapsToPayload(data)) return JSON.stringify(data);
    } catch (err) {}
    return text;
  }

  function captureSchedule(url, body) {
    if (!/\/schedules\//.test(url || "")) return;
    try {
      var data = typeof body === "string" ? JSON.parse(body) : body;
      if (!data || !Array.isArray(data.employees) || !Array.isArray(data.assignments)) return;
      if (/\/executed(?:\?|$)/.test(url || "")) {
        if (Array.isArray(data.shiftSwaps)) lastSwaps = data.shiftSwaps;
        return;
      }
      var rec = data.scheduleMonth;
      var shown = currentPeriodFromToolbar();
      if (rec && shown && (Number(rec.year) !== shown.year || Number(rec.month) !== shown.month)) {
        return;
      }
      lastSchedule = data;
      if (Array.isArray(data.shiftSwaps)) lastSwaps = data.shiftSwaps;
      var shifts = data.shifts || [];
      for (var i = 0; i < shifts.length; i++) {
        var code = String(shifts[i].code || "").toUpperCase();
        if (code && shifts[i].startTime && shifts[i].endTime) {
          SHIFT_TIMES[code] = { start: shifts[i].startTime, end: shifts[i].endTime };
        }
      }
    } catch (err) {}
  }

  var origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function () {
      var input = arguments[0];
      var url = typeof input === "string" ? input : (input && input.url) || "";
      return origFetch.apply(this, arguments).then(function (res) {
        if (!isExecutedScheduleUrl(url)) {
          try {
            var clone = res.clone();
            clone.text().then(function (text) { captureSchedule(url, text); }).catch(function () {});
          } catch (err) {}
          return res;
        }
        return res.text().then(function (text) {
          var patched = patchExecutedBody(url, text);
          captureSchedule(url, patched);
          return new Response(patched, {
            status: res.status,
            statusText: res.statusText,
            headers: res.headers,
          });
        });
      });
    };
  }

  var xhrOpen = XMLHttpRequest.prototype.open;
  var textDesc = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, "responseText");
  var respDesc = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, "response");
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__apaoUrl = String(url || "");
    var xhr = this;
    xhr.addEventListener("readystatechange", function () {
      if (xhr.readyState !== 4) return;
      try {
        var value = null;
        if (respDesc && respDesc.get) {
          try { value = respDesc.get.call(xhr); } catch (err) { value = null; }
        }
        if (value && typeof value === "object") {
          applyApprovedSwapsToPayload(value);
          captureSchedule(xhr.__apaoUrl, value);
          return;
        }
        var raw = "";
        if (textDesc && textDesc.get) {
          try { raw = textDesc.get.call(xhr); } catch (err) { raw = ""; }
        }
        if (!raw) {
          try { raw = xhr.responseText; } catch (err) { raw = ""; }
        }
        var patched = patchExecutedBody(xhr.__apaoUrl, raw);
        captureSchedule(xhr.__apaoUrl, patched);
      } catch (err) {}
    });
    return xhrOpen.apply(this, arguments);
  };
  function groupTitle(group) {
    var textEl = group.querySelector(".group-label-text");
    var raw = compact((textEl || group).textContent || "");
    var wrap = group.querySelector(".apao-rest-alerts");
    if (wrap) raw = compact(raw.replace(compact(wrap.textContent), ""));
    return raw.replace(/\s+\d+(\s+\d+)*$/, "");
  }

  function isApaoTitle(title) {
    var t = compact(title).toUpperCase();
    return t === "APAO" || t.indexOf("APAO ") === 0;
  }

  function columnMeta(table) {
    var heads = table.querySelectorAll("thead th.col-day");
    var cols = [];
    for (var i = 0; i < heads.length; i++) {
      var th = heads[i];
      var label = compact((th.querySelector(".day-num") || th).textContent || "");
      cols.push({
        lead: th.classList.contains("col-lead") || th.classList.contains("previous-month-cell"),
        label: label,
      });
    }
    return cols;
  }

  function isoForColumn(col, year, month) {
    var label = col.label || "";
    var parts = label.split("/");
    if (parts.length === 2) {
      var day = Number(parts[0]);
      var leadMonth = Number(parts[1]);
      var leadYear = leadMonth > month ? year - 1 : year;
      return isoFromParts(leadYear, leadMonth, day);
    }
    var dayOnly = parseInt(label, 10);
    if (!dayOnly) return null;
    return isoFromParts(year, month, dayOnly);
  }

  function currentPeriodFromToolbar() {
    var text = compact((document.querySelector(".escala-toolbar__period") || {}).textContent || "").toLowerCase();
    var named = text.match(/\b(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\b[^\d]*(\d{4})/);
    if (named) return { year: Number(named[2]), month: MONTHS[named[1]] };
    var numeric = text.match(/(\d{1,2})\s*[\/\-]\s*(\d{4})/);
    if (numeric) return { year: Number(numeric[2]), month: Number(numeric[1]) };
    return null;
  }

  function currentPeriod() {
    var shown = currentPeriodFromToolbar();
    if (shown) return shown;
    var monthRec = lastSchedule && lastSchedule.scheduleMonth;
    if (monthRec && monthRec.year && monthRec.month) {
      return { year: Number(monthRec.year), month: Number(monthRec.month) };
    }
    var now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  }

  function computeAlerts(table) {
    var period = currentPeriod();
    var cols = columnMeta(table);
    var rows = table.querySelectorAll("tbody tr");
    var inApao = false;
    var rest11 = [];
    var rest36 = [];

    for (var r = 0; r < rows.length; r++) {
      var group = rows[r].querySelector(".group-label");
      if (group) {
        inApao = isApaoTitle(groupTitle(group));
        continue;
      }
      if (!inApao) continue;
      var nameEl = rows[r].querySelector(".emp-name");
      if (!nameEl) continue;
      var name = compact(nameEl.textContent);
      var cells = rows[r].querySelectorAll("td.col-day");
      var sequence = [];
      for (var c = 0; c < cells.length; c++) {
        var meta = cols[c] || {
          lead: cells[c].classList.contains("col-lead") || cells[c].classList.contains("previous-month-cell"),
          label: String(c + 1),
        };
        var iso = isoForColumn(meta, period.year, period.month);
        var display = cellCode((cells[c].querySelector(".schedule-cell") || cells[c]).textContent);
        sequence.push({
          iso: iso,
          inMonth: !meta.lead && !cells[c].classList.contains("col-lead"),
          display: display,
        });
      }
      for (var i = 0; i < sequence.length; i++) {
        var prev = sequence[i];
        if (!prev || !prev.iso || !isShiftLabel(prev.display)) continue;
        var prevShift = periodFor(prev.iso, prev.display);
        if (!prevShift) continue;
        var next = sequence[i + 1];
        if (next && next.inMonth && next.iso && utcDay(next.iso) - utcDay(prev.iso) === DAY_MS && isShiftLabel(next.display)) {
          var nextShift = periodFor(next.iso, next.display);
          if (nextShift) {
            var hours = Math.round(((nextShift.startAt - prevShift.endAt) / HOUR_MS) * 10) / 10;
            if (hours < 11) {
              rest11.push({
                name: name,
                from: prev.iso,
                to: next.iso,
                prev: prevShift.code,
                next: nextShift.code,
                hours: hours,
              });
            }
          }
        }
        var off = sequence[i + 1];
        var after = sequence[i + 2];
        if (
          off && after && after.inMonth && off.iso && after.iso &&
          utcDay(off.iso) - utcDay(prev.iso) === DAY_MS &&
          utcDay(after.iso) - utcDay(off.iso) === DAY_MS &&
          isDayOff(off.display) && isShiftLabel(after.display)
        ) {
          var afterShift = periodFor(after.iso, after.display);
          if (afterShift) {
            var hours36 = Math.round(((afterShift.startAt - prevShift.endAt) / HOUR_MS) * 10) / 10;
            if (hours36 < 36) {
              rest36.push({
                name: name,
                from: prev.iso,
                to: after.iso,
                prev: prevShift.code,
                next: afterShift.code,
                hours: hours36,
              });
            }
          }
        }
      }
    }
    return { rest11: rest11, rest36: rest36 };
  }

  function tooltip(title, items) {
    var lines = [title + " (" + items.length + ")"];
    for (var i = 0; i < Math.min(items.length, 8); i++) {
      var it = items[i];
      lines.push(it.name + ": " + formatDate(it.from) + " " + it.prev + " → " + formatDate(it.to) + " " + it.next + " (" + formatHours(it.hours) + "h de descanso)");
    }
    if (items.length > 8) lines.push("+ " + (items.length - 8) + " outro(s) alerta(s)");
    return lines.join("\n");
  }

  function renderBadge(kind, count, tip, icon) {
    var el = document.createElement("span");
    el.className = "apao-rest-alert";
    el.setAttribute("aria-label", kind + (count ? ": " + count : ""));
    el.title = tip;
    el.innerHTML = '<img src="' + icon + '" alt="" aria-hidden="true">' +
      (count ? "<span>" + count + "</span>" : "");
    return el;
  }

  function groupByDay(items) {
    var map = {};
    for (var i = 0; i < items.length; i++) {
      var day = items[i].to;
      if (!map[day]) map[day] = [];
      map[day].push(items[i]);
    }
    return map;
  }

  function fillWrap(wrap, rest11, rest36, withCount) {
    wrap.innerHTML = "";
    if (rest11.length) {
      wrap.appendChild(renderBadge(
        "Descanso entre turnos menor que 11 horas",
        withCount ? rest11.length : "",
        tooltip("Descanso menor que 11 horas entre turnos", rest11),
        "assets/icons/coverage-attention.svg"
      ));
    }
    if (rest36.length) {
      wrap.appendChild(renderBadge(
        "Descanso pós-folga menor que 36 horas",
        withCount ? rest36.length : "",
        tooltip("Descanso menor que 36 horas após turno + folga", rest36),
        "assets/icons/coverage-attention-warning.svg"
      ));
    }
  }

  function ensureWrap(parent, className) {
    var wrap = parent.querySelector("." + className.split(" ").join("."));
    if (!wrap) {
      wrap = document.createElement("span");
      wrap.className = className;
      wrap.setAttribute("aria-label", "Alertas de descanso APAO");
      parent.appendChild(wrap);
    }
    return wrap;
  }

  function paintHost(parent, className, rest11, rest36, withCount) {
    var wrap = parent.querySelector("." + className.split(" ").join("."));
    if (!rest11.length && !rest36.length) {
      if (wrap) wrap.parentNode.removeChild(wrap);
      return;
    }
    wrap = ensureWrap(parent, className);
    fillWrap(wrap, rest11, rest36, withCount);
  }

  function paintAlerts() {
    var table = document.querySelector(".schedule-grid");
    if (!table) return;
    var labels = table.querySelectorAll("tbody .group-label");
    for (var g = 0; g < labels.length; g++) {
      var leftover = labels[g].querySelector(".apao-rest-alerts");
      if (leftover) leftover.parentNode.removeChild(leftover);
    }
    var computed = computeAlerts(table);
    var by11 = groupByDay(computed.rest11);
    var by36 = groupByDay(computed.rest36);
    var period = currentPeriod();
    var cols = columnMeta(table);
    var key = computed.rest11.map(function (it) { return it.name + it.to; }).join(",") + "|" +
      computed.rest36.map(function (it) { return it.name + it.to; }).join(",");
    if (key === lastPaintKey && table.querySelector(".apao-rest-alerts--head, .apao-rest-alerts--cell")) return;
    lastPaintKey = key;

    var heads = table.querySelectorAll("thead th.col-day");
    var h;
    for (h = 0; h < heads.length; h++) {
      var head = heads[h];
      var headMeta = cols[h] || {
        lead: head.classList.contains("col-lead") || head.classList.contains("previous-month-cell"),
        label: "",
      };
      var headIso = isoForColumn(headMeta, period.year, period.month);
      var stack = head.querySelector(".day-head-stack") || head;
      var head11 = !headMeta.lead && headIso && by11[headIso] ? by11[headIso] : [];
      var head36 = !headMeta.lead && headIso && by36[headIso] ? by36[headIso] : [];
      paintHost(stack, "apao-rest-alerts apao-rest-alerts--head", head11, head36, true);
    }

    var rows = table.querySelectorAll("tbody tr");
    var inApao = false;
    for (var r = 0; r < rows.length; r++) {
      var group = rows[r].querySelector(".group-label");
      if (group) {
        inApao = isApaoTitle(groupTitle(group));
        var fillers = rows[r].querySelectorAll("td.col-day");
        for (h = 0; h < fillers.length; h++) {
          var fillerMeta = cols[h] || { lead: fillers[h].classList.contains("col-lead"), label: "" };
          var fillerIso = isoForColumn(fillerMeta, period.year, period.month);
          var f11 = inApao && !fillerMeta.lead && fillerIso && by11[fillerIso] ? by11[fillerIso] : [];
          var f36 = inApao && !fillerMeta.lead && fillerIso && by36[fillerIso] ? by36[fillerIso] : [];
          paintHost(fillers[h], "apao-rest-alerts", f11, f36, true);
        }
        continue;
      }
      var nameEl = rows[r].querySelector(".emp-name");
      var dayCells = rows[r].querySelectorAll("td.col-day");
      if (!nameEl || !dayCells.length) continue;
      var name = compact(nameEl.textContent);
      for (h = 0; h < dayCells.length; h++) {
        var cellMeta = cols[h] || {
          lead: dayCells[h].classList.contains("col-lead") || dayCells[h].classList.contains("previous-month-cell"),
          label: "",
        };
        var cellIso = isoForColumn(cellMeta, period.year, period.month);
        var cell11 = [];
        var cell36 = [];
        if (inApao && !cellMeta.lead && cellIso) {
          cell11 = (by11[cellIso] || []).filter(function (it) { return it.name === name; });
          cell36 = (by36[cellIso] || []).filter(function (it) { return it.name === name; });
        }
        paintHost(dayCells[h], "apao-rest-alerts apao-rest-alerts--cell", cell11, cell36, false);
      }
    }
  }

  function employeeByName(name) {
    var employees = (lastSchedule && lastSchedule.employees) || [];
    var wanted = compact(name);
    for (var i = 0; i < employees.length; i++) {
      if (compact(employees[i].name) === wanted) return employees[i];
    }
    return null;
  }

  function isApaoName(name) {
    var emp = employeeByName(name);
    if (emp) {
      var cargo = String(emp.cargoCode || emp.type || "").toUpperCase();
      return cargo === "APAO";
    }
    var table = document.querySelector(".schedule-grid");
    if (!table) return false;
    var rows = table.querySelectorAll("tbody tr");
    var inApao = false;
    for (var i = 0; i < rows.length; i++) {
      var group = rows[i].querySelector(".group-label");
      if (group) {
        inApao = isApaoTitle(groupTitle(group));
        continue;
      }
      if (!inApao) continue;
      var empName = rows[i].querySelector(".emp-name");
      if (empName && compact(empName.textContent) === compact(name)) return true;
    }
    return false;
  }

  function parseDialogDates(subtitle) {
    var period = currentPeriod();
    var text = compact(subtitle);
    var name = compact(text.split("•")[0]);
    var dates = [];
    var range = text.match(/(\d{2})\/(\d{2}).*até\s+(\d{2})\/(\d{2})/);
    if (range) {
      var start = Number(range[1]);
      var end = Number(range[3]);
      for (var d = start; d <= end; d++) dates.push(isoFromParts(period.year, period.month, d));
      return { name: name, dates: dates };
    }
    var multi = text.match(/dias\s+(.+)$/i);
    if (multi) {
      var bits = multi[1].replace("/" + pad(period.month), "").split(",");
      for (var i = 0; i < bits.length; i++) {
        var day = parseInt(bits[i], 10);
        if (day) dates.push(isoFromParts(period.year, period.month, day));
      }
      return { name: name, dates: dates };
    }
    var one = text.match(/(\d{2})\/(\d{2})/);
    if (one) dates.push(isoFromParts(period.year, period.month, Number(one[1])));
    return { name: name, dates: dates };
  }

  function groupContiguous(dates) {
    var sorted = dates.slice().sort();
    var ranges = [];
    for (var i = 0; i < sorted.length; i++) {
      var cur = sorted[i];
      if (!ranges.length || addDays(ranges[ranges.length - 1].end, 1) !== cur) {
        ranges.push({ start: cur, end: cur });
      } else {
        ranges[ranges.length - 1].end = cur;
      }
    }
    return ranges;
  }

  function api(path, payload) {
    return fetch(path, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: token() ? "Bearer " + token() : "",
      },
      body: JSON.stringify(payload),
    }).then(function (res) {
      if (!res.ok) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          throw new Error(body.error || body.message || "Falha ao alocar");
        });
      }
      return res.json();
    });
  }

  function applyExtra(type, statusEl) {
    var dialog = document.querySelector(".allocation-dialog, .alloc-card");
    var subtitle = dialog && dialog.querySelector(".alloc-subtitle");
    var parsed = parseDialogDates(subtitle ? subtitle.textContent : "");
    var emp = employeeByName(parsed.name);
    var monthId = lastSchedule && lastSchedule.scheduleMonth && lastSchedule.scheduleMonth.id;
    if (!emp || !monthId || !parsed.dates.length) {
      statusEl.className = "apao-extra-status err";
      statusEl.textContent = "Não foi possível identificar o colaborador ou o período.";
      return;
    }
    var executed = !!(document.querySelector(".escala-view-tab--active") && /Realizada/i.test(document.querySelector(".escala-view-tab--active").textContent || ""));
    var base = "/api/schedules/" + monthId + (executed ? "/executed/manual-range" : "/manual-range");
    var ranges = groupContiguous(parsed.dates);
    statusEl.className = "apao-extra-status";
    statusEl.textContent = "Aplicando " + type + "…";
    var chain = Promise.resolve();
    ranges.forEach(function (range) {
      chain = chain.then(function () {
        return api(base, {
          employeeId: emp.id,
          startDate: range.start,
          endDate: range.end,
          type: type,
          mode: "set",
        });
      });
    });
    chain.then(function () {
      statusEl.textContent = "Alocação aplicada.";
      var refresh = document.querySelector('.escala-toolbar__nav button[title="Recarregar"]');
      if (refresh) refresh.click();
      else location.reload();
    }).catch(function (err) {
      statusEl.className = "apao-extra-status err";
      statusEl.textContent = err.message || "Não foi possível alocar.";
    });
  }

  function classForCode(code) {
    var c = baseShift(code);
    if (c === "T6") return "cell-t6";
    if (c === "T7") return "cell-t7";
    if (c === "T8") return "cell-t8";
    if (c === "T9") return "cell-t9";
    if (c === "ND") return "cell-nd";
    if (c === "FS") return "cell-fs";
    if (c === "FA") return "cell-fa";
    if (c === "FANI") return "cell-fani";
    if (c === "FP") return "cell-fp";
    if (c === "F" || c === "FOLGA") return "cell-folga";
    if (c === "FER") return "cell-ferias";
    if (c === "ADM") return "cell-shift";
    if (c === "VOO") return "cell-voo";
    if (c === "SIM") return "cell-simulador";
    if (c === "CRS") return "cell-curso";
    if (c === "CMA") return "cell-cma";
    if (/^TI/.test(normTok(code))) return "cell-instruction";
    if (/^T/.test(c)) return "cell-shift";
    return "cell-other";
  }

  function findDataRow(table, name) {
    var want = compact(name).toUpperCase();
    if (!want) return null;
    var rows = table.querySelectorAll("tbody tr");
    for (var i = 0; i < rows.length; i++) {
      var el = rows[i].querySelector(".emp-name");
      if (!el) continue;
      if (compact(el.textContent).toUpperCase() === want) return rows[i];
    }
    for (var j = 0; j < rows.length; j++) {
      var el2 = rows[j].querySelector(".emp-name");
      if (!el2) continue;
      var got = compact(el2.textContent).toUpperCase();
      if (got.indexOf(want) >= 0 || want.indexOf(got) >= 0) return rows[j];
    }
    return null;
  }

  function tdForIso(table, row, iso, year, month) {
    if (!row || !iso) return null;
    var cols = columnMeta(table);
    var tds = row.querySelectorAll("td.col-day");
    for (var i = 0; i < tds.length; i++) {
      var meta = cols[i] || {};
      if (meta.lead || tds[i].classList.contains("col-lead")) continue;
      if (isoForColumn(meta, year, month) === iso) return tds[i];
    }
    return null;
  }

  function setCellDisplay(td, code) {
    if (!td) return;
    var desired = normTok(baseShift(code) || shortToken(code) || code);
    var cell = td.querySelector(".schedule-cell") || td;
    var classList = ["cell-t6","cell-t7","cell-t8","cell-t9","cell-shift","cell-nd","cell-folga","cell-fs","cell-fa","cell-empty"];
    if (!desired) {
      cell.textContent = "";
      cell.classList.add("schedule-cell", "cell-empty", "cell-swap-applied");
      classList.forEach(function (cls) {
        if (cls !== "cell-empty") cell.classList.remove(cls);
      });
      return;
    }
    var cur = cellCode(cell.textContent);
    if (!tokensMatch(cur, desired)) cell.textContent = desired;
    cell.classList.add("schedule-cell", classForCode(desired), "cell-swap-applied");
    classList.forEach(function (cls) {
      if (cls !== classForCode(desired)) cell.classList.remove(cls);
    });
  }

  function applySwapsToDom() {
    var swaps = lastSwaps.length ? lastSwaps : (lastSchedule && lastSchedule.shiftSwaps) || [];
    if (!swaps.length) return;
    var table = document.querySelector(".schedule-table, table.schedule-grid, .schedule-grid table");
    if (!table) return;
    var period = currentPeriod();
    for (var s = 0; s < swaps.length; s++) {
      var swap = swaps[s];
      if (!swap || swap.status !== "APPROVED") continue;
      if (String(swap.notes || "").indexOf("__ADMIN_EXECUTED_AUDIT__") >= 0) continue;
      var srcDates = swap.requesterDates && swap.requesterDates.length
        ? swap.requesterDates.map(isoDay)
        : expandIso(swap.date, swap.pairLength || 1);
      var tgtDates = swap.targetDates && swap.targetDates.length
        ? swap.targetDates.map(isoDay)
        : expandIso(swap.targetDate || swap.date, swap.pairLength || 1);
      var n = Math.min(srcDates.length, tgtDates.length);
      var self = swap.kind === "SELF";
      var reqRow = findDataRow(table, swap.requesterName);
      var tgtRow = findDataRow(table, self ? swap.requesterName : swap.targetName);
      if (!reqRow || !tgtRow) continue;
      for (var i = 0; i < n; i++) {
        var reqTd = tdForIso(table, reqRow, srcDates[i], period.year, period.month);
        var tgtTd = tdForIso(table, tgtRow, tgtDates[i], period.year, period.month);
        var origReq = normTok(baseShift(partAt(swap.requesterShiftCode, i)) || shortToken(partAt(swap.requesterShiftCode, i)) || partAt(swap.requesterShiftCode, i));
        var origTgt = normTok(baseShift(partAt(swap.targetShiftCode, i)) || shortToken(partAt(swap.targetShiftCode, i)) || partAt(swap.targetShiftCode, i));
        if (!origReq && !origTgt) continue;
        if (origReq && origTgt && origReq === origTgt) continue;
        setCellDisplay(reqTd, origTgt);
        setCellDisplay(tgtTd, origReq);
      }
    }
  }

  function extraStatusEl(card) {
    var el = card.querySelector(".apao-extra-status");
    if (el) return el;
    el = document.createElement("p");
    el.className = "apao-extra-status";
    var body = card.querySelector(".alloc-body") || card;
    body.appendChild(el);
    return el;
  }

  function headingGrid(card, pattern, fallbackIndex) {
    var headings = card.querySelectorAll("h3, .alloc-section-title");
    for (var i = 0; i < headings.length; i++) {
      if (pattern.test(compact(headings[i].textContent))) {
        return headings[i].parentElement.querySelector(".alloc-options-grid") || headings[i].nextElementSibling;
      }
    }
    var grids = card.querySelectorAll(".alloc-options-grid");
    return grids.length > fallbackIndex ? grids[fallbackIndex] : grids[0];
  }

  function gridHasCode(grid, code) {
    if (!grid) return false;
    var wanted = String(code || "").toUpperCase();
    var nodes = grid.querySelectorAll(".alloc-option, .alloc-option-code");
    for (var i = 0; i < nodes.length; i++) {
      var txt = compact(nodes[i].textContent).toUpperCase();
      if (!txt) continue;
      if (txt === wanted || txt.indexOf(wanted + " ") === 0) return true;
      var codeEl = nodes[i].querySelector && nodes[i].querySelector(".alloc-option-code");
      if (codeEl && compact(codeEl.textContent).toUpperCase() === wanted) return true;
    }
    return false;
  }

  function makeExtraCard(grid, opt) {
    var template = grid.querySelector(".alloc-option--" + (opt.section === "turnos" ? "shift" : "folga")) ||
      grid.querySelector(".alloc-option");
    var btn;
    if (template) {
      btn = template.cloneNode(true);
      btn.classList.remove("selected");
      btn.className = "alloc-option " + opt.cls;
      var code = btn.querySelector(".alloc-option-code");
      var label = btn.querySelector(".alloc-option-label");
      if (code) code.textContent = opt.code;
      if (label) label.textContent = opt.label;
      if (!code && !label) {
        btn.innerHTML = '<span class="alloc-option-code">' + opt.code + '</span><span class="alloc-option-label">' + opt.label + "</span>";
      }
    } else {
      btn = document.createElement("button");
      btn.className = "alloc-option " + opt.cls;
      btn.innerHTML = '<span class="alloc-option-code">' + opt.code + '</span><span class="alloc-option-label">' + opt.label + "</span>";
    }
    btn.type = "button";
    btn.setAttribute("data-apao-extra-card", opt.key);
    btn.title = opt.label;
    return btn;
  }

  function selectExtraCard(card, btn) {
    card.querySelectorAll(".alloc-option.selected, .alloc-clear.selected").forEach(function (el) {
      el.classList.remove("selected");
    });
    btn.classList.add("selected");
  }

  function injectExtraCards(card) {
    EXTRA_CARDS.forEach(function (opt) {
      if (card.querySelector('[data-apao-extra-card="' + opt.key + '"]')) return;
      var grid = opt.section === "turnos"
        ? headingGrid(card, /^turnos$/i, 0)
        : headingGrid(card, /pr[eé]-aloca/i, 1);
      if (!grid) return;
      if (gridHasCode(grid, opt.code) || (opt.key === "ADM" && gridHasCode(grid, "ATIVIDADE ADMINISTRATIVA"))) return;
      var btn = makeExtraCard(grid, opt);
      btn.addEventListener("click", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        selectExtraCard(card, btn);
      });
      grid.appendChild(btn);
    });
  }

  function wireApplyIntercept(card) {
    if (card.getAttribute("data-apao-apply-wired")) return;
    card.setAttribute("data-apao-apply-wired", "1");
    card.addEventListener("click", function (ev) {
      var native = ev.target && ev.target.closest ? ev.target.closest(".alloc-option:not([data-apao-extra-card]), .alloc-clear") : null;
      if (native) {
        card.querySelectorAll("[data-apao-extra-card].selected").forEach(function (el) {
          el.classList.remove("selected");
        });
        return;
      }
      var applyBtn = ev.target && ev.target.closest ? ev.target.closest("button, .p-button") : null;
      if (!applyBtn) return;
      var txt = compact(applyBtn.textContent).toUpperCase();
      if (txt.indexOf("APLICAR") < 0) return;
      var selected = card.querySelector("[data-apao-extra-card].selected");
      if (!selected) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
      applyExtra(selected.getAttribute("data-apao-extra-card"), extraStatusEl(card));
    }, true);
  }

  function enhanceDialog() {
    var card = document.querySelector(".alloc-card");
    if (!card) return;
    var leftover = card.querySelector(".apao-extra-options");
    if (leftover && leftover.parentNode) leftover.parentNode.removeChild(leftover);
    var subtitle = (card.querySelector(".alloc-subtitle") || {}).textContent || "";
    var name = compact(subtitle.split("•")[0]);
    if (!name || !isApaoName(name)) return;
    injectExtraCards(card);
    wireApplyIntercept(card);
  }

  var lastFetchKey = "";
  var lastFetchAt = 0;
  function refreshSwapsFromApi() {
    var period = currentPeriod();
    var key = period.year + "-" + period.month;
    var now = Date.now();
    if (key === lastFetchKey && lastSwaps.length) return;
    if (key === lastFetchKey && now - lastFetchAt < 8000) return;
    var tok = token();
    if (!tok) return;
    lastFetchKey = key;
    lastFetchAt = now;
    var url = "/api/schedules/" + period.year + "/" + period.month + "/executed?_ts=" + now;
    var run = origFetch || window.fetch;
    if (!run) return;
    run.call(window, url, { headers: { Authorization: "Bearer " + tok } })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (!data) {
          lastFetchKey = "";
          return;
        }
        if (Array.isArray(data.shiftSwaps)) lastSwaps = data.shiftSwaps;
        if (!lastSchedule && Array.isArray(data.employees)) lastSchedule = data;
        applySwapsToDom();
      })
      .catch(function () { lastFetchKey = ""; });
  }

  function sync() {
    var path = (location.pathname || "").replace(/\/+$/, "");
    if (path === "/escala" || path.indexOf("/escala") === 0) paintAlerts();
    refreshSwapsFromApi();
    applySwapsToDom();
    enhanceDialog();
  }

  setInterval(sync, 400);
  window.addEventListener("popstate", function () { setTimeout(sync, 0); });
  var obs = new MutationObserver(function () {
    var path = (location.pathname || "").replace(/\/+$/, "");
    applySwapsToDom();
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
})();
