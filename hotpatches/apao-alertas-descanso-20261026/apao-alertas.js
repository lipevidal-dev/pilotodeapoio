/**
 * Alertas de descanso APAO + VOO/CURSO/SIMULADOR no popup.
 * Só leitura/informativo: não bloqueia alocação e não mexe no PAO.
 */
(function () {
  if (window.__apaoAlertasV1) return;
  window.__apaoAlertasV1 = true;

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
  var EXTRA_OPTIONS = [
    { key: "VOO", label: "VOO" },
    { key: "CURSO", label: "Curso" },
    { key: "SIMULADOR", label: "Simulador" },
  ];

  var lastSchedule = null;
  var lastPaintKey = "";

  var style = document.createElement("style");
  style.id = "apao-alertas-style";
  style.textContent = [
    ".apao-rest-alerts{display:inline-flex;align-items:center;gap:.3rem;margin-left:.55rem;vertical-align:middle}",
    ".apao-rest-alert{display:inline-flex;align-items:center;gap:.15rem;min-height:1.25rem;padding:.08rem .3rem;border:1px solid #fdba74;border-radius:999px;background:#fff7ed;color:#9a3412;font-size:.65rem;font-weight:800;line-height:1;letter-spacing:normal;text-transform:none;cursor:help}",
    ".apao-rest-alert img{width:.9rem;height:.9rem;object-fit:contain}",
    ".apao-extra-options{display:flex;flex-wrap:wrap;gap:.4rem;margin-top:.7rem}",
    ".apao-extra-options button{min-height:2.1rem;border:1px solid #d7dce2;border-radius:8px;background:#fff;color:#2d2d2d;font:inherit;font-size:.8rem;font-weight:700;padding:.35rem .7rem;cursor:pointer}",
    ".apao-extra-options button:hover{border-color:#f15a22;color:#f15a22;background:#fff4ed}",
    ".apao-extra-status{margin:.45rem 0 0;font-size:.75rem;color:#6b7280}",
    ".apao-extra-status.err{color:#b91c1c}",
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

  function captureSchedule(url, body) {
    if (!/\/schedules\//.test(url || "")) return;
    try {
      var data = JSON.parse(body);
      if (!data || !Array.isArray(data.employees) || !Array.isArray(data.assignments)) return;
      lastSchedule = data;
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
        try {
          var clone = res.clone();
          clone.text().then(function (text) { captureSchedule(url, text); }).catch(function () {});
        } catch (err) {}
        return res;
      });
    };
  }

  var xhrOpen = XMLHttpRequest.prototype.open;
  var xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__apaoUrl = url;
    return xhrOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    this.addEventListener("load", function () {
      captureSchedule(this.__apaoUrl, this.responseText);
    });
    return xhrSend.apply(this, arguments);
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
        lead: th.classList.contains("col-lead"),
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

  function currentPeriod() {
    var monthRec = lastSchedule && lastSchedule.scheduleMonth;
    if (monthRec && monthRec.year && monthRec.month) {
      return { year: Number(monthRec.year), month: Number(monthRec.month) };
    }
    var text = compact((document.querySelector(".escala-toolbar__period") || {}).textContent || "").toLowerCase();
    var named = text.match(/\b(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\b[^\d]*(\d{4})/);
    if (named) return { year: Number(named[2]), month: MONTHS[named[1]] };
    var numeric = text.match(/(\d{1,2})\s*[\/\-]\s*(\d{4})/);
    if (numeric) return { year: Number(numeric[2]), month: Number(numeric[1]) };
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
        var meta = cols[c] || { lead: cells[c].classList.contains("col-lead"), label: String(c + 1) };
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
    el.setAttribute("aria-label", kind + ": " + count);
    el.title = tip;
    el.innerHTML = '<img src="' + icon + '" alt="" aria-hidden="true"><span>' + count + "</span>";
    return el;
  }

  function paintAlerts() {
    var table = document.querySelector(".schedule-grid");
    if (!table) return;
    var labels = table.querySelectorAll("tbody .group-label");
    var apaoLabel = null;
    for (var i = 0; i < labels.length; i++) {
      if (isApaoTitle(groupTitle(labels[i]))) {
        apaoLabel = labels[i];
        break;
      }
    }
    if (!apaoLabel) return;
    var computed = computeAlerts(table);
    var key = computed.rest11.length + "|" + computed.rest36.length + "|" + tooltip("11", computed.rest11) + "|" + tooltip("36", computed.rest36);
    if (key === lastPaintKey && apaoLabel.querySelector(".apao-rest-alerts")) return;
    lastPaintKey = key;
    var wrap = apaoLabel.querySelector(".apao-rest-alerts");
    if (!wrap) {
      wrap = document.createElement("span");
      wrap.className = "apao-rest-alerts";
      wrap.setAttribute("aria-label", "Alertas de descanso APAO");
      apaoLabel.appendChild(wrap);
    }
    wrap.innerHTML = "";
    if (computed.rest11.length) {
      wrap.appendChild(renderBadge(
        "Descanso entre turnos menor que 11 horas",
        computed.rest11.length,
        tooltip("Descanso menor que 11 horas entre turnos", computed.rest11),
        "assets/icons/coverage-attention.svg"
      ));
    }
    if (computed.rest36.length) {
      wrap.appendChild(renderBadge(
        "Descanso pós-folga menor que 36 horas",
        computed.rest36.length,
        tooltip("Descanso menor que 36 horas após turno + folga", computed.rest36),
        "assets/icons/coverage-attention-warning.svg"
      ));
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

  function enhanceDialog() {
    var card = document.querySelector(".alloc-card");
    if (!card || card.querySelector(".apao-extra-options")) return;
    var subtitle = (card.querySelector(".alloc-subtitle") || {}).textContent || "";
    var name = compact(subtitle.split("•")[0]);
    if (!name || !isApaoName(name)) return;
    var body = card.querySelector(".alloc-body") || card;
    var wrap = document.createElement("div");
    wrap.className = "apao-extra-options";
    var status = document.createElement("p");
    status.className = "apao-extra-status";
    status.textContent = "Opções extras do APAO: não bloqueiam o restante da escala.";
    EXTRA_OPTIONS.forEach(function (opt) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = opt.label;
      btn.addEventListener("click", function () {
        applyExtra(opt.key, status);
      });
      wrap.appendChild(btn);
    });
    body.appendChild(wrap);
    body.appendChild(status);
  }

  function sync() {
    var path = (location.pathname || "").replace(/\/+$/, "");
    if (path === "/escala" || path.indexOf("/escala") === 0) paintAlerts();
    enhanceDialog();
  }

  setInterval(sync, 500);
  window.addEventListener("popstate", function () { setTimeout(sync, 0); });
})();
