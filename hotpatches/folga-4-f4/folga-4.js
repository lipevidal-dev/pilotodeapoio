/**
 * Folga 4 (F4) no popup da escala — fallback se o chunk Angular ainda não tiver a opção.
 * Não reconstrói o admin. Não altera outras alocações.
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

  function captureSchedule(url, body) {
    if (!/\/schedules\//.test(url || "")) return;
    try {
      var data = JSON.parse(body);
      if (!data || !Array.isArray(data.employees)) return;
      lastSchedule = data;
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
      if (/Folga 4|\bF4\b/.test(compact(items[i].textContent))) return true;
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

  function sync() {
    var path = (location.pathname || "").replace(/\/+$/, "");
    if (path === "/escala" || path.indexOf("/escala") === 0) injectOverlayOption();
  }

  setInterval(sync, 400);
  window.addEventListener("popstate", function () { setTimeout(sync, 0); });
})();
