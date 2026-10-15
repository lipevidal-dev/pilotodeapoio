/**
 * Espelho de férias no portal do colaborador (/portal/ferias).
 * Mostra pedidos aprovados e pendentes de toda a equipe.
 */
(function () {
  if (window.__feriasCalendarioV1) return;
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
  var selectedIso = null;
  var loading = false;
  var errorMsg = null;
  var pickingStart = true;

  var style = document.createElement("style");
  style.id = "ferias-espelho-style";
  style.textContent = [
    "#" + ROOT_ID + "{margin:0 0 1rem;padding:1.1rem 1.15rem;border:1px solid #e8eaed;border-radius:12px;background:#fff}",
    "#" + ROOT_ID + " h2{margin:0;font-size:1.05rem;color:#2d2d2d}",
    "#" + ROOT_ID + " .hint{margin:.3rem 0 .75rem;color:#6b7280;font-size:.82rem;font-weight:500}",
    "#" + ROOT_ID + " .nav{display:flex;align-items:center;justify-content:space-between;margin-bottom:.45rem}",
    "#" + ROOT_ID + " .nav button{border:none;background:transparent;color:#f15a22;cursor:pointer;padding:.25rem .45rem;border-radius:6px}",
    "#" + ROOT_ID + " .nav button:hover{background:#fff4ed}",
    "#" + ROOT_ID + " .title{font-size:.92rem;font-weight:700;color:#2d2d2d}",
    "#" + ROOT_ID + " .weekdays,#" + ROOT_ID + " .grid{display:grid;grid-template-columns:repeat(7,1fr);gap:3px}",
    "#" + ROOT_ID + " .weekdays span{text-align:center;font-size:.68rem;font-weight:700;color:#9ca3af;padding:.15rem 0}",
    "#" + ROOT_ID + " .day{min-height:3.05rem;border:1px solid #eceff3;border-radius:7px;background:#fafbfc;color:#2d2d2d;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.1rem;padding:.12rem .05rem;font:inherit;cursor:pointer}",
    "#" + ROOT_ID + " .day.out{opacity:.38}",
    "#" + ROOT_ID + " .day.today{box-shadow:inset 0 0 0 1px rgba(241,90,34,.45)}",
    "#" + ROOT_ID + " .day.has-approved{background:#e0f2fe;border-color:#7dd3fc}",
    "#" + ROOT_ID + " .day.has-pending{background:#fef3c7;border-color:#fcd34d}",
    "#" + ROOT_ID + " .day.has-approved.has-pending{background:linear-gradient(135deg,#e0f2fe 50%,#fef3c7 50%);border-color:#fbbf24}",
    "#" + ROOT_ID + " .day.is-mine{box-shadow:inset 0 0 0 2px #f15a22}",
    "#" + ROOT_ID + " .day.selected{border-color:#f15a22}",
    "#" + ROOT_ID + " .num{font-size:.78rem;font-weight:700;line-height:1}",
    "#" + ROOT_ID + " .count{font-size:.62rem;font-weight:800;color:#0369a1;line-height:1}",
    "#" + ROOT_ID + " .legend{display:flex;flex-wrap:wrap;gap:.75rem 1rem;margin:.7rem 0;color:#6b7280;font-size:.75rem;font-weight:700}",
    "#" + ROOT_ID + " .swatch{display:inline-block;width:.72rem;height:.72rem;border-radius:3px;margin-right:.3rem;vertical-align:-1px}",
    "#" + ROOT_ID + " .detail,#" + ROOT_ID + " .list{background:#f8fafc;border:1px solid #e8eaed;border-radius:10px;padding:.75rem .85rem;margin-top:.55rem}",
    "#" + ROOT_ID + " .detail h3,#" + ROOT_ID + " .list h3{margin:0 0 .4rem;font-size:.86rem;color:#2d2d2d}",
    "#" + ROOT_ID + " ul{list-style:none;margin:0;padding:0;display:grid;gap:.35rem}",
    "#" + ROOT_ID + " li{display:flex;flex-wrap:wrap;gap:.3rem .65rem;align-items:center;font-size:.82rem;color:#2d2d2d}",
    "#" + ROOT_ID + " .status{border-radius:999px;padding:.12rem .5rem;font-size:.7rem;font-weight:800}",
    "#" + ROOT_ID + " .status.ok{background:#e0f2fe;color:#0369a1}",
    "#" + ROOT_ID + " .status.wait{background:#fef3c7;color:#92400e}",
    "#" + ROOT_ID + " .err{color:#b91c1c;font-size:.82rem;font-weight:600}",
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

  function setNativeValue(input, value) {
    var proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
    if (proto && proto.set) proto.set.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function fillFormDate(iso) {
    if (iso < todayIso()) return;
    var start = document.querySelector('.vacation-page input[name="startDate"]');
    var end = document.querySelector('.vacation-page input[name="endDate"]');
    if (!start || !end) return;
    if (pickingStart || !start.value) {
      setNativeValue(start, iso);
      setNativeValue(end, "");
      pickingStart = false;
      return;
    }
    if (iso < start.value) {
      setNativeValue(end, start.value);
      setNativeValue(start, iso);
    } else {
      setNativeValue(end, iso);
    }
    pickingStart = true;
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

  function onDayClick(iso) {
    selectedIso = iso;
    fillFormDate(iso);
    render();
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
    var html = "";
    html += "<h2>Espelho de férias</h2>";
    html += "<p class='hint'>Azul = aprovado. Amarelo = aguardando aprovação. Clique no dia para ver os nomes e preencher as datas.</p>";
    if (loading) html += "<p class='hint'>Carregando…</p>";
    if (errorMsg) html += "<p class='err'>" + errorMsg + "</p>";
    html += "<div class='nav'>";
    html += "<button type='button' data-cal='prev' aria-label='Mês anterior'><i class='pi pi-chevron-left'></i></button>";
    html += "<span class='title'>" + MONTHS[view.month - 1] + " " + view.year + "</span>";
    html += "<button type='button' data-cal='next' aria-label='Próximo mês'><i class='pi pi-chevron-right'></i></button>";
    html += "</div>";
    html += "<div class='weekdays'>" + WEEKDAYS.map(function (w) { return "<span>" + w + "</span>"; }).join("") + "</div>";
    html += "<div class='grid'>";
    cells.forEach(function (cell) {
      var entries = byDay[cell.iso] || [];
      var cls = ["day"];
      if (!cell.inMonth) cls.push("out");
      if (cell.iso === todayIso()) cls.push("today");
      if (cell.iso === selectedIso) cls.push("selected");
      if (entries.some(function (e) { return e.status === "APPROVED"; })) cls.push("has-approved");
      if (entries.some(function (e) { return e.status === "PENDING"; })) cls.push("has-pending");
      if (entries.some(function (e) { return e.mine; })) cls.push("is-mine");
      html += "<button type='button' class='" + cls.join(" ") + "' data-iso='" + cell.iso + "'>";
      html += "<span class='num'>" + cell.date.getDate() + "</span>";
      if (entries.length) html += "<span class='count'>" + entries.length + "</span>";
      html += "</button>";
    });
    html += "</div>";
    html += "<div class='legend'>";
    html += "<span><i class='swatch' style='background:#e0f2fe;border:1px solid #7dd3fc'></i>Aprovado</span>";
    html += "<span><i class='swatch' style='background:#fef3c7;border:1px solid #fcd34d'></i>Pendente</span>";
    html += "<span><i class='swatch' style='background:#fff;border:2px solid #f15a22'></i>Meu pedido</span>";
    html += "</div>";
    html += "<div class='detail'>";
    if (selectedIso) {
      var sel = byDay[selectedIso] || [];
      html += "<h3>" + formatIso(selectedIso) + "</h3>";
      if (!sel.length) html += "<p class='hint' style='margin:0'>Ninguém pediu férias neste dia.</p>";
      else {
        html += "<ul>";
        sel.forEach(function (e) {
          html += "<li><strong>" + (e.mine ? "Você" : e.employeeName) + "</strong>";
          html += "<span class='status " + (e.status === "APPROVED" ? "ok" : "wait") + "'>" + statusLabel(e.status) + "</span></li>";
        });
        html += "</ul>";
      }
    } else {
      html += "<p class='hint' style='margin:0'>Toque um dia para ver quem já pediu férias naquela data.</p>";
    }
    html += "</div>";
    var listed = monthPeriods();
    if (listed.length) {
      html += "<div class='list'><h3>Pedidos neste mês</h3><ul>";
      listed.forEach(function (p) {
        html += "<li><strong>" + (p.mine ? "Você" : p.employeeName) + "</strong>";
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
    root.querySelectorAll("[data-iso]").forEach(function (btn) {
      btn.onclick = function () { onDayClick(btn.getAttribute("data-iso")); };
    });
  }

  function sync() {
    if (!pathIsFerias()) {
      var extra = document.getElementById(ROOT_ID);
      if (extra) extra.remove();
      return;
    }
    if (!document.querySelector(".vacation-page")) return;
    if (!document.getElementById(ROOT_ID)) {
      load();
    }
  }

  setInterval(sync, 400);
  window.addEventListener("popstate", function () { setTimeout(sync, 0); });
})();
