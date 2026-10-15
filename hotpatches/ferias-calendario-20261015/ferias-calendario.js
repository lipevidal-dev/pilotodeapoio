/**
 * Espelho de férias no portal (/portal/ferias).
 * Calendário compacto só leitura, no visual do cadastro admin.
 */
(function () {
  if (window.__feriasCalendarioV2) return;
  window.__feriasCalendarioV2 = true;
  window.__feriasCalendarioV1 = true;

  var API = "/api/portal/vacations/calendar";
  var ROOT_ID = "ferias-espelho";
  var WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  var MONTHS = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
  ];

  var view = { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };
  var periods = [];
  var loading = false;
  var errorMsg = null;

  var style = document.createElement("style");
  style.id = "ferias-espelho-style";
  style.textContent = [
    "#" + ROOT_ID + "{margin:0 0 1rem;padding:1.05rem 1.1rem;border:1px solid #e8eaed;border-radius:12px;background:#fff;box-sizing:border-box}",
    "#" + ROOT_ID + " h2{margin:0 0 .65rem;font-size:1.05rem;color:#2d2d2d}",
    "#" + ROOT_ID + " .status-line{margin:0 0 .55rem;color:#6b7280;font-size:.78rem;font-weight:600}",
    "#" + ROOT_ID + " .err{color:#b91c1c}",
    "#" + ROOT_ID + " .op-cal{width:100%;max-width:420px;margin:0 auto;box-sizing:border-box}",
    "#" + ROOT_ID + " .op-cal-panel{width:100%;box-sizing:border-box;padding:.5rem .55rem;border:1px solid #e8eaed;border-radius:8px;background:#fff;box-shadow:0 1px 2px rgba(15,23,42,.05)}",
    "#" + ROOT_ID + " .op-cal-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:.35rem}",
    "#" + ROOT_ID + " .op-cal-title{font-size:.85rem;font-weight:600;color:#2d2d2d}",
    "#" + ROOT_ID + " .op-cal-nav{border:none;background:transparent;color:#f15a22;cursor:pointer;padding:.15rem .35rem;border-radius:4px;font-size:.7rem}",
    "#" + ROOT_ID + " .op-cal-nav:hover{background:#fff4ed}",
    "#" + ROOT_ID + " .op-cal-weekdays,#" + ROOT_ID + " .op-cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px}",
    "#" + ROOT_ID + " .op-cal-weekdays{gap:1px;margin-bottom:2px}",
    "#" + ROOT_ID + " .op-cal-wd{text-align:center;font-size:.68rem;font-weight:600;color:#9ca3af;padding:.1rem 0}",
    "#" + ROOT_ID + " .op-cal-day{min-height:42px;height:42px;border:1px solid #eceff3;border-radius:5px;background:#fafbfc;color:#2d2d2d;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0;padding:1px 2px;font-size:.7rem;font-weight:600;line-height:1.1;cursor:default;user-select:none}",
    "#" + ROOT_ID + " .op-cal-day.out{opacity:.35}",
    "#" + ROOT_ID + " .op-cal-day.weekend:not(.occupied){background:#f4f5f7}",
    "#" + ROOT_ID + " .op-cal-day.today:not(.occupied){box-shadow:inset 0 0 0 1px rgba(241,90,34,.45)}",
    "#" + ROOT_ID + " .op-cal-day.occupied{background:#f8fafc}",
    "#" + ROOT_ID + " .op-cal-day-num{font-size:.62rem;font-weight:500;color:#9ca3af;line-height:1}",
    "#" + ROOT_ID + " .op-cal-badge{font-size:.58rem;font-weight:700;letter-spacing:.01em;line-height:1;padding:2px 4px;border-radius:3px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
    "#" + ROOT_ID + " .op-cal-badge.kind-ferias{background:#e0f2fe;color:#0369a1}",
    "#" + ROOT_ID + " .op-cal-badge.kind-fp{background:#fef9c3;color:#854d0e}",
    "#" + ROOT_ID + " .list{width:100%;box-sizing:border-box;background:#f8fafc;border:1px solid #e8eaed;border-radius:10px;padding:.75rem .85rem;margin-top:.75rem}",
    "#" + ROOT_ID + " .list h3{margin:0 0 .4rem;font-size:.86rem;color:#2d2d2d}",
    "#" + ROOT_ID + " ul{list-style:none;margin:0;padding:0;display:grid;gap:.35rem}",
    "#" + ROOT_ID + " li{display:flex;flex-wrap:wrap;gap:.3rem .65rem;align-items:center;font-size:.82rem;color:#2d2d2d}",
    "#" + ROOT_ID + " .status{border-radius:999px;padding:.12rem .5rem;font-size:.7rem;font-weight:800}",
    "#" + ROOT_ID + " .status.ok{background:#e0f2fe;color:#0369a1}",
    "#" + ROOT_ID + " .status.wait{background:#fef3c7;color:#92400e}",
  ].join("");
  document.documentElement.appendChild(style);

  function pathIsFerias() {
    var path = (location.pathname || "").replace(/\/+$/, "");
    return path === "/portal/ferias";
  }

  function token() {
    return sessionStorage.getItem("escala_auth_token") || localStorage.getItem("escala_auth_token") || "";
  }

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function toIso(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function todayIso() {
    return toIso(new Date());
  }

  function formatIso(iso) {
    if (!iso) return "";
    var p = iso.split("-");
    return p[2] + "/" + p[1] + "/" + p[0];
  }

  function addIsoDays(iso, delta) {
    var p = iso.split("-").map(Number);
    var d = new Date(p[0], p[1] - 1, p[2] + delta);
    return toIso(d);
  }

  function entriesByDay() {
    var map = {};
    periods.forEach(function (period) {
      var day = period.startDate;
      while (day <= period.endDate) {
        (map[day] || (map[day] = [])).push(period);
        day = addIsoDays(day, 1);
      }
    });
    return map;
  }

  function monthCells() {
    var first = new Date(view.year, view.month - 1, 1);
    var start = new Date(view.year, view.month - 1, 1 - first.getDay());
    var cells = [];
    for (var i = 0; i < 42; i++) {
      var d = new Date(start);
      d.setDate(start.getDate() + i);
      cells.push({ date: d, iso: toIso(d), inMonth: d.getMonth() === view.month - 1 });
    }
    return cells;
  }

  function monthPeriods() {
    var start = view.year + "-" + pad(view.month) + "-01";
    var end = view.year + "-" + pad(view.month) + "-31";
    return periods.filter(function (p) {
      return p.startDate <= end && p.endDate >= start;
    });
  }

  function statusLabel(status) {
    return status === "APPROVED" ? "Aprovado" : "Pendente";
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function cellMeta(entries) {
    if (!entries.length) return { badge: "", kind: "", title: "" };
    var pendingOnly = entries.every(function (e) { return e.status === "PENDING"; });
    return {
      badge: pendingOnly ? "PEND" : "FÉRIAS",
      kind: pendingOnly ? "kind-fp" : "kind-ferias",
      title: entries.map(function (e) {
        return (e.mine ? "Você" : e.employeeName) + " (" + statusLabel(e.status) + ")";
      }).join("\n"),
    };
  }

  function load() {
    loading = true;
    errorMsg = null;
    render();
    var t = token();
    fetch(API + "?year=" + view.year + "&month=" + view.month + "&_ts=" + Date.now(), {
      headers: t ? { Authorization: "Bearer " + t } : {},
    })
      .then(function (res) {
        if (!res.ok) throw new Error("fail");
        return res.json();
      })
      .then(function (data) {
        periods = (data && data.periods) || [];
        loading = false;
        render();
      })
      .catch(function () {
        loading = false;
        errorMsg = "Não foi possível carregar os pedidos deste mês.";
        render();
      });
  }

  function render() {
    var page = document.querySelector(".vacation-page");
    if (!page) return;
    var root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement("div");
      root.id = ROOT_ID;
      var header = page.querySelector(".vacation-header");
      if (header && header.nextSibling) page.insertBefore(root, header.nextSibling);
      else page.insertBefore(root, page.firstChild);
    }

    var byDay = entriesByDay();
    var cells = monthCells();
    var html = "<h2>Espelho de férias</h2>";
    if (loading) html += "<p class='status-line'>Carregando…</p>";
    if (errorMsg) html += "<p class='status-line err'>" + errorMsg + "</p>";
    html += "<div class='op-cal'><div class='op-cal-panel'>";
    html += "<div class='op-cal-header'>";
    html += "<button type='button' class='op-cal-nav' data-cal='prev' aria-label='Mês anterior'><i class='pi pi-chevron-left'></i></button>";
    html += "<span class='op-cal-title'>" + MONTHS[view.month - 1] + " " + view.year + "</span>";
    html += "<button type='button' class='op-cal-nav' data-cal='next' aria-label='Próximo mês'><i class='pi pi-chevron-right'></i></button>";
    html += "</div>";
    html += "<div class='op-cal-weekdays'>" + WEEKDAYS.map(function (w) { return "<span class='op-cal-wd'>" + w + "</span>"; }).join("") + "</div>";
    html += "<div class='op-cal-grid'>";
    cells.forEach(function (cell) {
      var entries = byDay[cell.iso] || [];
      var meta = cellMeta(entries);
      var cls = ["op-cal-day"];
      if (!cell.inMonth) cls.push("out");
      if (isWeekend(cell.date)) cls.push("weekend");
      if (cell.iso === todayIso()) cls.push("today");
      if (entries.length) cls.push("occupied");
      html += "<div class='" + cls.join(" ") + "' title='" + escapeHtml(meta.title) + "'>";
      if (entries.length) {
        html += "<span class='op-cal-day-num'>" + cell.date.getDate() + "</span>";
        html += "<span class='op-cal-badge " + meta.kind + "'>" + meta.badge + "</span>";
      } else {
        html += cell.date.getDate();
      }
      html += "</div>";
    });
    html += "</div></div></div>";

    var listed = monthPeriods();
    if (listed.length) {
      html += "<div class='list'><h3>Pedidos neste mês</h3><ul>";
      listed.forEach(function (p) {
        html += "<li><strong>" + escapeHtml(p.mine ? "Você" : p.employeeName) + "</strong>";
        html += "<span>" + formatIso(p.startDate) + " a " + formatIso(p.endDate) + "</span>";
        html += "<span class='status " + (p.status === "APPROVED" ? "ok" : "wait") + "'>" + statusLabel(p.status) + "</span></li>";
      });
      html += "</ul></div>";
    }
    root.innerHTML = html;

    root.querySelector("[data-cal='prev']").onclick = function () {
      if (view.month === 1) { view.year -= 1; view.month = 12; }
      else view.month -= 1;
      load();
    };
    root.querySelector("[data-cal='next']").onclick = function () {
      if (view.month === 12) { view.year += 1; view.month = 1; }
      else view.month += 1;
      load();
    };
  }

  function isWeekend(date) {
    var day = date.getDay();
    return day === 0 || day === 6;
  }

  function sync() {
    if (!pathIsFerias()) {
      var extra = document.getElementById(ROOT_ID);
      if (extra) extra.remove();
      return;
    }
    if (!document.querySelector(".vacation-page")) return;
    if (document.querySelector(".mirror-cal")) return;
    if (!document.getElementById(ROOT_ID)) load();
  }

  setInterval(sync, 400);
  window.addEventListener("popstate", function () { setTimeout(sync, 0); });
})();
