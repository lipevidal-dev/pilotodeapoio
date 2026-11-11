/**
 * Folga 4 (F4) no popup da escala e na grade — sem rebuild do admin.
 */
(function () {
  if (window.__folga4V1) return;
  window.__folga4V1 = true;

  var MONTHS = {
    jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6,
    jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12,
  };
  var lastSchedule = null;

  var style = document.createElement("style");
  style.id = "folga-4-style";
  style.textContent = [
    ".p-select-option[data-f4-option],.p-dropdown-item[data-f4-option]{font-weight:700}",
    ".f4-extra-status{margin:.35rem 0 0;font-size:.75rem;color:#6b7280}",
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

  function employeeByName(name) {
    var employees = (lastSchedule && lastSchedule.employees) || [];
    var wanted = compact(name);
    for (var i = 0; i < employees.length; i++) {
      if (compact(employees[i].name) === wanted) return employees[i];
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

  function overlayHasF4(overlay) {
    var items = overlay.querySelectorAll("li, .p-select-option, .p-dropdown-item");
    for (var i = 0; i < items.length; i++) {
      if (/Folga 4/.test(compact(items[i].textContent))) return true;
    }
    return false;
  }

  function injectOverlayOption() {
    var overlay = document.querySelector(".p-select-overlay, .p-dropdown-panel, .p-select-list-container");
    if (!overlay || overlay.querySelector("[data-f4-option]")) return;
    if (overlayHasF4(overlay)) return;
    var items = overlay.querySelectorAll("li, .p-select-option, .p-dropdown-item");
    var template = null;
    var afterFolga = null;
    for (var i = 0; i < items.length; i++) {
      var label = compact(items[i].textContent);
      if (!template) template = items[i];
      if (label === "Folga") afterFolga = items[i];
    }
    if (!template) return;
    var item = template.cloneNode(true);
    item.setAttribute("data-f4-option", "1");
    item.textContent = "Folga 4";
    item.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      applyF4();
    });
    var parent = (afterFolga && afterFolga.parentNode) || template.parentNode;
    if (afterFolga && afterFolga.nextSibling) parent.insertBefore(item, afterFolga.nextSibling);
    else parent.appendChild(item);
  }

  function setCellText(cell, text) {
    var token = cell.querySelector(".schedule-cell span, .schedule-cell, .cell-display, .cell-code") || cell;
    var current = compact(token.textContent);
    if (current === "F4") return;
    if (current === "F" || current === "FOLGA" || current === "") {
      var leaf = token;
      var spans = token.querySelectorAll("span");
      if (spans.length) leaf = spans[spans.length - 1];
      if (leaf.childNodes.length === 1 && leaf.childNodes[0].nodeType === 3) {
        leaf.textContent = text;
      } else {
        leaf.textContent = text;
      }
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
    injectOverlayOption();
    paintF4Cells();
  }

  setInterval(sync, 400);
  window.addEventListener("popstate", function () { setTimeout(sync, 0); });
})();
