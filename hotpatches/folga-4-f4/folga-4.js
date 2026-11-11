/**
 * Folga 4 (F4) no popup de cartões da escala — sem rebuild do admin.
 * O menu real é o grid FOLGA/FS/FP; o JS antigo fica em cache imutável 7 dias.
 */
(function () {
  if (window.__folga4V2) return;
  window.__folga4V2 = true;

  var MONTHS = {
    jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6,
    jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12,
  };
  var lastSchedule = null;

  var style = document.createElement("style");
  style.id = "folga-4-style";
  style.textContent = [
    ".alloc-option[data-f4-card]{min-height:3.25rem;padding:.4rem .25rem;border:1px solid #fca5a5;border-radius:9px;background:#fef2f2;color:#991b1b;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.12rem;font:inherit}",
    ".alloc-option[data-f4-card] .alloc-option-code{font-size:.9rem;font-weight:800;line-height:1}",
    ".alloc-option[data-f4-card] .alloc-option-label{font-size:.62rem;line-height:1.1;text-align:center}",
    ".alloc-option[data-f4-card].selected{border:2px solid #f15a22;box-shadow:0 0 0 2px #f15a2224}",
    ".f4-extra-status{margin:.45rem .2rem 0;font-size:.75rem;color:#6b7280}",
    ".f4-extra-status.err{color:#b91c1c}",
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

  function isF4Label(label) {
    var n = String(label || "").toUpperCase().trim();
    return n === "F4" || n === "FOLGA 4" || n === "FOLGA4";
  }

  function captureSchedule(url, body) {
    if (!/\/schedules\//.test(url || "")) return;
    try {
      var data = JSON.parse(body);
      if (!data) return;
      if (Array.isArray(data.employees)) lastSchedule = data;
      else if (lastSchedule && Array.isArray(data.preAllocations)) {
        lastSchedule.preAllocations = data.preAllocations;
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
          throw new Error(body.error || body.message || "Falha ao alocar Folga 4");
        });
      }
      return res.json();
    });
  }

  function statusEl() {
    var card = document.querySelector(".alloc-card");
    if (!card) return null;
    var el = card.querySelector(".f4-extra-status");
    if (el) return el;
    el = document.createElement("p");
    el.className = "f4-extra-status";
    var body = card.querySelector(".alloc-body") || card;
    body.appendChild(el);
    return el;
  }

  function applyF4() {
    var dialog = document.querySelector(".allocation-dialog, .alloc-card");
    var subtitle = dialog && dialog.querySelector(".alloc-subtitle");
    var parsed = parseDialogDates(subtitle ? subtitle.textContent : "");
    var emp = employeeByName(parsed.name);
    var monthId = lastSchedule && lastSchedule.scheduleMonth && lastSchedule.scheduleMonth.id;
    var status = statusEl();
    if (!emp || !monthId || !parsed.dates.length) {
      if (status) {
        status.className = "f4-extra-status err";
        status.textContent = "Não foi possível identificar o colaborador ou o período.";
      }
      return;
    }
    var executed = !!(document.querySelector(".escala-view-tab--active") && /Realizada/i.test(document.querySelector(".escala-view-tab--active").textContent || ""));
    var base = "/api/schedules/" + monthId + (executed ? "/executed/manual-range" : "/manual-range");
    var ranges = groupContiguous(parsed.dates);
    if (status) {
      status.className = "f4-extra-status";
      status.textContent = "Aplicando Folga 4…";
    }
    var chain = Promise.resolve();
    ranges.forEach(function (range) {
      chain = chain.then(function () {
        return api(base, {
          employeeId: emp.id,
          startDate: range.start,
          endDate: range.end,
          type: "F4",
          mode: "set",
        });
      });
    });
    chain.then(function () {
      if (status) status.textContent = "Folga 4 aplicada.";
      var refresh = document.querySelector('.escala-toolbar__nav button[title="Recarregar"]');
      if (refresh) refresh.click();
      else location.reload();
    }).catch(function (err) {
      if (status) {
        status.className = "f4-extra-status err";
        status.textContent = err.message || "Não foi possível alocar Folga 4.";
      }
    });
  }

  function gridHasF4(grid) {
    var nodes = grid.querySelectorAll(".alloc-option, .alloc-option-code, button");
    for (var i = 0; i < nodes.length; i++) {
      var txt = compact(nodes[i].textContent).toUpperCase();
      if (txt === "F4" || txt.indexOf("FOLGA 4") === 0 || /^F4\b/.test(txt)) return true;
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

  function injectF4Card() {
    var card = document.querySelector(".alloc-card");
    if (!card) return;
    if (card.querySelector("[data-f4-card]")) return;
    var grid = preallocGrid(card);
    if (!grid) return;
    if (gridHasF4(grid)) return;

    var template = grid.querySelector(".alloc-option--folga") || grid.querySelector(".alloc-option");
    var btn;
    if (template) {
      btn = template.cloneNode(true);
      btn.classList.remove("selected");
      var code = btn.querySelector(".alloc-option-code");
      var label = btn.querySelector(".alloc-option-label");
      if (code) code.textContent = "F4";
      if (label) label.textContent = "Folga 4";
      if (!code && !label) {
        btn.innerHTML = '<span class="alloc-option-code">F4</span><span class="alloc-option-label">Folga 4</span>';
      }
    } else {
      btn = document.createElement("button");
      btn.type = "button";
      btn.className = "alloc-option alloc-option--folga";
      btn.innerHTML = '<span class="alloc-option-code">F4</span><span class="alloc-option-label">Folga 4</span>';
    }
    btn.setAttribute("data-f4-card", "1");
    btn.type = "button";
    btn.title = "Folga 4 — conta como folga, não como turno";
    btn.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      card.querySelectorAll(".alloc-option.selected, .alloc-clear.selected").forEach(function (el) {
        el.classList.remove("selected");
      });
      btn.classList.add("selected");
      applyF4();
    });

    var afterFolga = null;
    var options = grid.querySelectorAll(".alloc-option");
    for (var i = 0; i < options.length; i++) {
      var txt = compact(options[i].textContent).toUpperCase();
      if (txt.indexOf("FOLGA") === 0 && txt.indexOf("FOLGA SOCIAL") !== 0 && txt.indexOf("F4") !== 0) {
        afterFolga = options[i];
        break;
      }
    }
    if (afterFolga && afterFolga.nextSibling) grid.insertBefore(btn, afterFolga.nextSibling);
    else if (afterFolga) grid.appendChild(btn);
    else grid.insertBefore(btn, grid.firstChild);
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

  function setCellText(cell, text) {
    var token = cell.querySelector(".schedule-cell span, .schedule-cell, .cell-display, .cell-code") || cell;
    var current = compact(token.textContent);
    if (current === "F4") return;
    if (current === "F" || current === "FOLGA" || current === "") {
      var leaf = token;
      var spans = token.querySelectorAll("span");
      if (spans.length) leaf = spans[spans.length - 1];
      leaf.textContent = text;
    }
  }

  function paintF4Cells() {
    if (!lastSchedule) return;
    var names = {};
    (lastSchedule.employees || []).forEach(function (e) {
      names[e.id] = compact(e.name);
    });
    var wanted = {};
    (lastSchedule.preAllocations || []).forEach(function (p) {
      if (!isF4Label(p.label)) return;
      var iso = String(p.date || "").slice(0, 10);
      var name = names[p.employeeId];
      if (name && iso) wanted[name + "|" + iso] = 1;
    });
    if (!Object.keys(wanted).length) return;
    var period = currentPeriod();
    var table = document.querySelector(".schedule-grid");
    if (!table) return;
    var cols = columnMeta(table);
    var rows = table.querySelectorAll("tbody tr");
    for (var r = 0; r < rows.length; r++) {
      var nameEl = rows[r].querySelector(".emp-name");
      if (!nameEl) continue;
      var name = compact(nameEl.textContent);
      var cells = rows[r].querySelectorAll("td.col-day");
      for (var c = 0; c < cells.length; c++) {
        var iso = isoForColumn(cols[c] || {}, period.year, period.month);
        if (!iso || !wanted[name + "|" + iso]) continue;
        setCellText(cells[c], "F4");
      }
    }
  }

  function sync() {
    var path = (location.pathname || "").replace(/\/+$/, "");
    if (path !== "/escala" && path.indexOf("/escala") !== 0) return;
    injectF4Card();
    paintF4Cells();
  }

  setInterval(sync, 300);
  window.addEventListener("popstate", function () { setTimeout(sync, 0); });
})();
