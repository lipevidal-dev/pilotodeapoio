/**
 * Folga Feriado (FF) no popup de cartões da escala — sem rebuild do admin.
 * Mesma cor vermelha da Folga (alloc-option--folga / cell-folga).
 */
(function () {
  if (window.__folgaFeriadoV5) return;
  window.__folgaFeriadoV5 = true;

  var MONTHS = {
    jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6,
    jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12,
  };
  var lastSchedule = null;

  var style = document.createElement("style");
  style.id = "folga-feriado-style";
  style.textContent = [
    ".alloc-option[data-ff-card]{min-height:3.25rem;padding:.4rem .25rem;border:1px solid #fca5a5;border-radius:9px;background:#fef2f2;color:#991b1b;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.12rem;font:inherit}",
    ".alloc-option[data-ff-card] .alloc-option-code{font-size:.9rem;font-weight:800;line-height:1}",
    ".alloc-option[data-ff-card] .alloc-option-label{font-size:.62rem;line-height:1.1;text-align:center}",
    ".alloc-option[data-ff-card].selected{border:2px solid #f15a22;box-shadow:0 0 0 2px #f15a2224}",
    ".schedule-cell.cell-folga[data-ff-painted],.legend-chip.cell-folga{background:#fecaca;color:#991b1b}",
    "td.col-day[data-ff=\"1\"] .schedule-cell{font-size:0!important;line-height:0!important}",
    "td.col-day[data-ff=\"1\"] .schedule-cell::after{content:\"FF\";font-size:.68rem;font-weight:800;line-height:1.25;letter-spacing:.02em;display:inline-block}",
    ".ff-extra-status{margin:.45rem .2rem 0;font-size:.75rem;color:#6b7280}",
    ".ff-extra-status.err{color:#b91c1c}",
  ].join("");
  (document.head || document.documentElement).appendChild(style);

  function token() {
    return sessionStorage.getItem("escala_auth_token") || localStorage.getItem("escala_auth_token") || "";
  }

  function pad(n) {
    return (n < 10 ? "0" : "") + String(n);
  }

  function compact(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function isoFromParts(year, month, day) {
    return year + "-" + pad(month) + "-" + pad(day);
  }

  function addDays(iso, delta) {
    var p = iso.split("-").map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + delta));
    return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
  }

  function foldName(value) {
    return compact(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  }

  function namesMatch(a, b) {
    var fa = foldName(a);
    var fb = foldName(b);
    if (!fa || !fb) return false;
    return fa === fb || fa.indexOf(fb) >= 0 || fb.indexOf(fa) >= 0;
  }

  function isFfLabel(label) {
    var n = String(label || "").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
    return n === "FF" || n.indexOf("FERIADO") >= 0;
  }

  function captureSchedule(url, body) {
    if (!/\/schedules\//.test(url || "")) return;
    if (/\/executed(?:\?|$)/.test(url || "")) return;
    try {
      var data = JSON.parse(body);
      if (!data) return;
      if (Array.isArray(data.employees)) lastSchedule = data;
      else if (lastSchedule && Array.isArray(data.preAllocations)) {
        lastSchedule.preAllocations = data.preAllocations;
      }
    } catch (err) {}
  }

  function rewriteManualType(raw) {
    try {
      var data = JSON.parse(raw);
      var n = String(data.type || "").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
      if (n === "FF" || n.indexOf("FERIADO") >= 0) {
        data.type = "FF";
        return JSON.stringify(data);
      }
    } catch (err) {}
    return raw;
  }

  var origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function () {
      var input = arguments[0];
      var init = arguments[1];
      var url = typeof input === "string" ? input : (input && input.url) || "";
      if (/manual-range/.test(url) && init && typeof init.body === "string") {
        init = Object.assign({}, init, { body: rewriteManualType(init.body) });
        arguments[1] = init;
      }
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
    this.__ffUrl = String(url || "");
    if (!this.__ffCapture) {
      this.__ffCapture = true;
      var xhr = this;
      this.addEventListener("load", function () {
        try { captureSchedule(xhr.__ffUrl || "", xhr.responseText); } catch (err) {}
      });
    }
    return xhrOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    if (this.__ffUrl && /manual-range/.test(this.__ffUrl) && typeof body === "string") {
      body = rewriteManualType(body);
    }
    return xhrSend.call(this, body);
  };

  var lastPullAt = 0;
  function pullSchedule() {
    var now = Date.now();
    if (now - lastPullAt < 5000) return;
    var tok = token();
    if (!tok) return;
    var period = currentPeriod();
    if (!period.year || !period.month) return;
    lastPullAt = now;
    var url = "/api/schedules/" + period.year + "/" + period.month + "?_ts=" + now;
    var run = origFetch || window.fetch;
    if (!run) return;
    run.call(window, url, { headers: { Authorization: "Bearer " + tok } })
      .then(function (res) { return res.ok ? res.text() : null; })
      .then(function (text) { if (text) captureSchedule(url, text); })
      .catch(function () {});
  }

  function currentPeriod() {
    var monthRec = lastSchedule && lastSchedule.scheduleMonth;
    if (monthRec && monthRec.year && monthRec.month) {
      return { year: Number(monthRec.year), month: Number(monthRec.month) };
    }
    var text = compact((document.querySelector(".escala-toolbar__period") || {}).textContent || "").toLowerCase();
    var named = text.match(/\b(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\b[^\d]*(\d{4})/);
    if (named) return { year: Number(named[2]), month: MONTHS[named[1]] };
    var now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  }

  function employeeByName(name) {
    var employees = (lastSchedule && lastSchedule.employees) || [];
    var wanted = compact(name);
    for (var i = 0; i < employees.length; i++) {
      if (compact(employees[i].name) === wanted) return employees[i];
    }
    var wantedFold = wanted.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    for (var j = 0; j < employees.length; j++) {
      var n = compact(employees[j].name).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      if (n === wantedFold) return employees[j];
    }
    return null;
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
      var month = Number(range[2]) || period.month;
      var year = period.year;
      if (month === 1 && period.month === 12) year += 1;
      for (var d = start; d <= end; d++) dates.push(isoFromParts(year, month, d));
      return { name: name, dates: dates };
    }
    var one = text.match(/(\d{2})\/(\d{2})/);
    if (one) {
      var day = Number(one[1]);
      var subMonth = Number(one[2]) || period.month;
      var y = period.year;
      if (subMonth === 1 && period.month === 12) y += 1;
      dates.push(isoFromParts(y, subMonth, day));
    }
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
          throw new Error(body.error || body.message || "Falha ao alocar Folga Feriado");
        });
      }
      return res.json();
    });
  }

  function statusEl() {
    var card = document.querySelector(".alloc-card");
    if (!card) return null;
    var el = card.querySelector(".ff-extra-status");
    if (el) return el;
    el = document.createElement("p");
    el.className = "ff-extra-status";
    var body = card.querySelector(".alloc-body") || card;
    body.appendChild(el);
    return el;
  }

  function applyFf() {
    var dialog = document.querySelector(".allocation-dialog, .alloc-card");
    var subtitle = dialog && dialog.querySelector(".alloc-subtitle");
    var parsed = parseDialogDates(subtitle ? subtitle.textContent : "");
    var emp = employeeByName(parsed.name);
    var monthId = lastSchedule && lastSchedule.scheduleMonth && lastSchedule.scheduleMonth.id;
    var status = statusEl();
    if (!emp || !monthId || !parsed.dates.length) {
      if (status) {
        status.className = "ff-extra-status err";
        status.textContent = "Não foi possível identificar o colaborador ou o período.";
      }
      return;
    }
    var executed = !!(document.querySelector(".escala-view-tab--active") && /Realizada/i.test(document.querySelector(".escala-view-tab--active").textContent || ""));
    var base = "/api/schedules/" + monthId + (executed ? "/executed/manual-range" : "/manual-range");
    var ranges = groupContiguous(parsed.dates);
    if (status) {
      status.className = "ff-extra-status";
      status.textContent = "Aplicando Folga Feriado…";
    }
    var chain = Promise.resolve();
    ranges.forEach(function (range) {
      chain = chain.then(function () {
        return api(base, {
          employeeId: emp.id,
          startDate: range.start,
          endDate: range.end,
          type: "FF",
          mode: "set",
        });
      });
    });
    chain.then(function () {
      if (status) status.textContent = "Folga Feriado aplicada.";
      var refresh = document.querySelector('.escala-toolbar__nav button[title="Recarregar"]');
      if (refresh) refresh.click();
      else location.reload();
    }).catch(function (err) {
      if (status) {
        status.className = "ff-extra-status err";
        status.textContent = err.message || "Não foi possível alocar Folga Feriado.";
      }
    });
  }

  function gridHasFf(grid) {
    var nodes = grid.querySelectorAll(".alloc-option, .alloc-option-code, button");
    for (var i = 0; i < nodes.length; i++) {
      var txt = compact(nodes[i].textContent).toUpperCase();
      if (txt === "FF" || txt.indexOf("FOLGA FERIADO") === 0 || /^FF\b/.test(txt)) return true;
    }
    return false;
  }

  function preallocGrid(card) {
    var headings = card.querySelectorAll("h3, .alloc-section-title");
    for (var i = 0; i < headings.length; i++) {
      if (/pr[eé]-aloca/i.test(compact(headings[i].textContent))) {
        return headings[i].parentElement.querySelector(".alloc-options-grid") || headings[i].nextElementSibling;
      }
    }
    var grids = card.querySelectorAll(".alloc-options-grid");
    return grids.length > 1 ? grids[1] : grids[0];
  }

  function injectFfCard() {
    var card = document.querySelector(".alloc-card");
    if (!card) return;
    if (card.querySelector("[data-ff-card]")) return;
    var grid = preallocGrid(card);
    if (!grid) return;
    if (gridHasFf(grid)) return;

    var template = grid.querySelector(".alloc-option--folga") || grid.querySelector(".alloc-option");
    var btn;
    if (template) {
      btn = template.cloneNode(true);
      btn.classList.remove("selected");
      btn.removeAttribute("data-f4-card");
      btn.removeAttribute("data-apao-extra-card");
      var code = btn.querySelector(".alloc-option-code");
      var label = btn.querySelector(".alloc-option-label");
      if (code) code.textContent = "FF";
      if (label) label.textContent = "Folga Feriado";
      if (!code && !label) {
        btn.innerHTML = '<span class="alloc-option-code">FF</span><span class="alloc-option-label">Folga Feriado</span>';
      }
    } else {
      btn = document.createElement("button");
      btn.type = "button";
      btn.className = "alloc-option alloc-option--folga";
      btn.innerHTML = '<span class="alloc-option-code">FF</span><span class="alloc-option-label">Folga Feriado</span>';
    }
    btn.classList.add("alloc-option--folga");
    btn.setAttribute("data-ff-card", "1");
    btn.type = "button";
    btn.title = "Folga Feriado";
    btn.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
      card.querySelectorAll(".alloc-option.selected, .alloc-clear.selected").forEach(function (el) {
        el.classList.remove("selected");
      });
      btn.classList.add("selected");
    });

    var after = null;
    var options = grid.querySelectorAll(".alloc-option");
    for (var i = 0; i < options.length; i++) {
      var txt = compact(options[i].textContent).toUpperCase();
      if (txt === "F4" || txt.indexOf("FOLGA 4") === 0) after = options[i];
    }
    if (!after) {
      for (var j = 0; j < options.length; j++) {
        var t2 = compact(options[j].textContent).toUpperCase();
        if (t2 === "F" || t2.indexOf("FOLGA") === 0) {
          if (t2.indexOf("FOLGA SOCIAL") === 0 || t2.indexOf("FOLGA PEDIDA") === 0) continue;
          after = options[j];
          break;
        }
      }
    }
    if (after && after.nextSibling) grid.insertBefore(btn, after.nextSibling);
    else if (after) grid.appendChild(btn);
    else grid.insertBefore(btn, grid.firstChild);
  }

  function injectLegend() {
    var legend = document.querySelector(".schedule-legend, .escala-legend, app-schedule-legend");
    if (!legend) return;
    if (legend.querySelector("[data-ff-legend]")) return;
    var chips = legend.querySelectorAll(".legend-chip");
    var after = null;
    for (var i = 0; i < chips.length; i++) {
      var txt = compact(chips[i].textContent).toUpperCase();
      if (txt === "F4" || txt === "F") after = chips[i];
      if (txt === "FF") return;
    }
    if (!after && !chips.length) return;
    var chip = document.createElement("span");
    chip.className = "legend-chip cell-folga";
    chip.setAttribute("data-ff-legend", "1");
    chip.textContent = "FF";
    chip.title = "Folga Feriado";
    var wrap = after && after.parentElement;
    if (wrap && after.nextSibling) wrap.insertBefore(chip, after.nextSibling);
    else if (wrap) wrap.appendChild(chip);
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

  function setCellFf(cell) {
    var td = cell.closest ? (cell.closest("td") || cell) : cell;
    td.setAttribute("data-ff", "1");
    var painted = td.querySelector(".schedule-cell") || td;
    painted.classList.add("cell-folga");
    painted.setAttribute("data-ff-painted", "1");
    painted.title = "Folga Feriado";
  }

  function collectFfMarks(data) {
    var names = {};
    (data.employees || []).forEach(function (e) {
      names[e.id] = compact(e.name);
    });
    var wanted = [];
    function add(empId, date, label) {
      if (!isFfLabel(label)) return;
      var iso = String(date || "").slice(0, 10);
      var name = names[empId];
      if (name && iso) wanted.push({ name: name, iso: iso });
    }
    (data.preAllocations || []).forEach(function (p) { add(p.employeeId, p.date, p.label); });
    (data.assignments || []).forEach(function (a) { add(a.employeeId, a.date, a.label); });
    return wanted;
  }

  function paintFfCells() {
    var table = document.querySelector(".schedule-grid, table.schedule-grid, .schedule-table");
    if (!table) return;
    if (!lastSchedule) {
      pullSchedule();
      return;
    }
    var wanted = collectFfMarks(lastSchedule);
    var marked = table.querySelectorAll("td.col-day[data-ff]");
    for (var i = 0; i < marked.length; i++) marked[i].removeAttribute("data-ff");
    if (!wanted.length) {
      pullSchedule();
      return;
    }
    var period = currentPeriod();
    var cols = columnMeta(table);
    var rows = table.querySelectorAll("tbody tr");
    for (var r = 0; r < rows.length; r++) {
      var nameEl = rows[r].querySelector(".emp-name");
      if (!nameEl) continue;
      var name = compact(nameEl.textContent);
      var cells = rows[r].querySelectorAll("td.col-day");
      for (var c = 0; c < cells.length; c++) {
        var iso = isoForColumn(cols[c] || {}, period.year, period.month);
        if (!iso) continue;
        for (var w = 0; w < wanted.length; w++) {
          if (wanted[w].iso === iso && namesMatch(name, wanted[w].name)) {
            setCellFf(cells[c]);
            break;
          }
        }
      }
    }
  }

  function isFfSelected(card) {
    var selected = card.querySelector(".alloc-option.selected");
    if (!selected) return false;
    if (selected.getAttribute("data-ff-card")) return true;
    var txt = compact(selected.textContent).toUpperCase();
    return txt === "FF" || txt.indexOf("FOLGA FERIADO") === 0 || /^FF\b/.test(txt);
  }

  function wireApplyIntercept(card) {
    if (!card || card.getAttribute("data-ff-apply-wired")) return;
    card.setAttribute("data-ff-apply-wired", "1");
    card.addEventListener("click", function (ev) {
      var applyBtn = ev.target && ev.target.closest ? ev.target.closest("button, .p-button") : null;
      if (!applyBtn) return;
      var txt = compact(applyBtn.textContent).toUpperCase();
      if (txt.indexOf("APLICAR") < 0) return;
      if (!isFfSelected(card)) return;
      var subtitle = card.querySelector(".alloc-subtitle");
      var parsed = parseDialogDates(subtitle ? subtitle.textContent : "");
      var emp = employeeByName(parsed.name);
      var monthId = lastSchedule && lastSchedule.scheduleMonth && lastSchedule.scheduleMonth.id;
      if (!emp || !monthId || !parsed.dates.length) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
      applyFf();
    }, true);
  }

  function sync() {
    var path = (location.pathname || "").replace(/\/+$/, "");
    if (path !== "/escala" && path.indexOf("/escala") !== 0) return;
    injectFfCard();
    var card = document.querySelector(".alloc-card");
    if (card) wireApplyIntercept(card);
    injectLegend();
    paintFfCells();
  }

  setInterval(sync, 300);
  window.addEventListener("popstate", function () { setTimeout(sync, 0); });
  setTimeout(pullSchedule, 400);
  setTimeout(sync, 800);
})();
