/**
 * Deixa as tabelas dos outros menus com o mesmo desenho da lista de Funcionários:
 * cabeçalho escuro, etiquetas no padrão do sistema e cada ação na sua coluna.
 * Não altera texto de cadastro nem o que os botões fazem.
 */
(function () {
  if (window.__layoutTabelas) return;
  window.__layoutTabelas = true;

  var style = document.createElement("style");
  style.textContent = [
    ".p-datatable.gol-table thead>tr>th{background:#2d2d2d!important;color:#fff!important;font-weight:600;font-size:.8rem;text-transform:uppercase;letter-spacing:.04em;border:none!important;padding:.65rem .85rem!important;font-family:inherit}",
    ".p-datatable.gol-table tbody>tr>td{padding:.6rem .85rem!important;font-size:.875rem;border-color:#e8eaed!important;font-family:inherit;color:#2d2d2d}",
    ".p-datatable.gol-table tbody>tr:nth-child(even){background:#fafbfc}",
    ".p-datatable.gol-table tbody>tr:hover{background:#fff4ed!important}",
    ".layout-action-th,.layout-action-td,.layout-select-th,.layout-select-td{text-align:center!important;vertical-align:middle!important;white-space:nowrap}",
    ".layout-action-th{width:7.5rem}",
    ".layout-select-th{width:6.5rem}",
    ".layout-select-label{display:block;margin-bottom:.35rem}",
    ".layout-action-td .p-button{width:2.25rem;height:2.25rem}",
    ".p-datatable .p-button-text.p-button-secondary{color:#6b7280!important}",
    ".p-datatable .p-button-text.p-button-danger{color:#dc2626!important}",
    ".p-datatable .p-button-text.p-button-success{color:#16a34a!important}",
    ".p-datatable .p-button-text.p-button-warn,.p-datatable .p-button-text.p-button-warning{color:#d97706!important}",
    ".p-datatable .p-tag{border:none!important;border-radius:6px!important;font-weight:600!important;font-size:.75rem!important;letter-spacing:.02em;padding:.2rem .55rem!important}",
    ".p-datatable .p-tag-success{background:#dcfce7!important;color:#15803d!important}",
    ".p-datatable .p-tag-warn,.p-datatable .p-tag-warning,.p-datatable .p-tag-info{background:#fff4ed!important;color:#d94e1a!important}",
    ".p-datatable .p-tag-secondary{background:#f3f4f6!important;color:#6b7280!important}",
    ".p-datatable .p-tag-danger{background:#fee2e2!important;color:#dc2626!important}",
    ".p-datatable .p-datatable-thead .p-checkbox-box{background:transparent!important;border-color:rgba(255,255,255,.75)!important}",
    ".p-datatable .p-datatable-thead .p-checkbox-checked .p-checkbox-box,.p-datatable .p-datatable-thead .p-highlight .p-checkbox-box{background:#f15a22!important;border-color:#f15a22!important}",
    ".p-datatable .p-datatable-tbody .p-checkbox-checked .p-checkbox-box,.p-datatable .p-datatable-tbody .p-highlight .p-checkbox-box{background:#f15a22!important;border-color:#f15a22!important}",
  ].join("");
  document.head.appendChild(style);

  function actionName(icon) {
    if (icon === "pi-pencil") return "Editar";
    if (icon === "pi-trash") return "Apagar";
    if (icon === "pi-ban" || icon === "pi-check-circle") return "Ativar/Desativar";
    return "";
  }

  function buttonIcon(btn) {
    var icon = btn.querySelector("[class*='pi-']");
    if (!icon) return "";
    var match = String(icon.className).match(/pi-[a-z0-9-]+/);
    return match ? match[0] : "";
  }

  function buttonText(btn) {
    var label = btn.querySelector(".p-button-label");
    return ((label ? label.textContent : btn.textContent) || "").replace(/\s+/g, " ").trim();
  }

  function iconButtons(cell) {
    var buttons = Array.prototype.filter.call(cell.querySelectorAll("button"), function (btn) {
      return actionName(buttonIcon(btn)) && !buttonText(btn);
    });
    if (buttons.length < 2) return null;
    if (buttons.length !== cell.querySelectorAll("button").length) return null;
    return buttons;
  }

  function findAction(row) {
    var cells = row.cells || [];
    for (var i = cells.length - 1; i >= 0; i--) {
      var buttons = iconButtons(cells[i]);
      if (buttons) return { index: i, buttons: buttons };
    }
    return null;
  }

  function headerReady(row) {
    return Array.prototype.some.call(row.cells || [], function (cell) {
      return (cell.textContent || "").replace(/\s+/g, " ").trim() === "Editar";
    });
  }

  function labelSelection(table) {
    table.querySelectorAll("thead th").forEach(function (th) {
      if (th.querySelector(".layout-select-label") || !th.querySelector(".p-checkbox")) return;
      var text = (th.textContent || "").replace(/\s+/g, " ").trim();
      if (text) return;
      var label = document.createElement("span");
      label.className = "layout-select-label";
      label.textContent = "Selecionar";
      th.insertBefore(label, th.firstChild);
      th.classList.add("layout-select-th");
    });
    table.querySelectorAll("tbody td").forEach(function (td) {
      if (td.querySelector(".p-checkbox")) td.classList.add("layout-select-td");
    });
  }

  function relaxCols(table) {
    table.querySelectorAll("col").forEach(function (col) {
      var width = (col.getAttribute("style") || "") + (col.style.width || "");
      if (width.indexOf("3rem") >= 0) col.style.width = "auto";
    });
  }

  function splitTable(table) {
    var host = table.closest(".p-datatable") || table;
    if (host.closest(".p-dialog")) return;
    host.classList.add("gol-table");
    relaxCols(table);
    labelSelection(table);
    var header = table.querySelector("thead tr");
    if (!header) return;
    var sample = null;
    Array.prototype.some.call(table.querySelectorAll("tbody tr"), function (row) {
      if (row.dataset.layoutActions === "1") return false;
      sample = findAction(row);
      return !!sample;
    });
    if (!sample) return;
    var names = sample.buttons.map(function (btn) { return actionName(buttonIcon(btn)); });
    if (!headerReady(header)) {
      var th = header.cells[sample.index];
      if (!th) return;
      var ref = th.nextSibling;
      names.forEach(function (name) {
        var el = document.createElement("th");
        el.className = "layout-action-th";
        el.textContent = name;
        header.insertBefore(el, ref);
      });
      th.remove();
    }
    Array.prototype.forEach.call(table.querySelectorAll("tbody tr"), function (row) {
      if (row.dataset.layoutActions === "1") return;
      var cell = row.cells[sample.index];
      if (!cell) return;
      if (cell.hasAttribute("colspan")) {
        var span = Number(cell.getAttribute("colspan")) || 1;
        cell.setAttribute("colspan", String(span + names.length - 1));
        row.dataset.layoutActions = "1";
        return;
      }
      var buttons = iconButtons(cell);
      if (!buttons) return;
      var next = cell.nextSibling;
      buttons.forEach(function (btn) {
        var td = document.createElement("td");
        td.className = "layout-action-td";
        td.appendChild(btn);
        row.insertBefore(td, next);
      });
      cell.remove();
      row.dataset.layoutActions = "1";
    });
  }

  function tick() {
    document.querySelectorAll("table").forEach(splitTable);
  }

  var queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () {
      queued = false;
      tick();
    });
  }

  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  schedule();
})();
