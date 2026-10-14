(function () {
  var API = "/api";
  var MARK = "vp-menu";

  function token() {
    try {
      return sessionStorage.getItem("escala_auth_token") || localStorage.getItem("escala_auth_token");
    } catch (e) {
      return null;
    }
  }

  function authHeaders() {
    var t = token();
    return t
      ? { Authorization: "Bearer " + t, "Content-Type": "application/json" }
      : { "Content-Type": "application/json" };
  }

  function textOf(el) {
    var span = el.querySelector("span");
    var raw = span ? span.textContent : el.textContent;
    return String(raw || "").replace(/\s+/g, " ").trim();
  }

  function angularMenuExists() {
    return !!document.querySelector(
      'a[href="/portal/voos-planejamento"], a[href="/cadastros/voos-planejamento"]'
    );
  }

  var enabled = false;
  var portalLines = [{ date: "", description: "" }];
  var confirmOpen = false;
  var submitting = false;
  var adminView = null;
  var selectedEmployeeId = null;
  var adminLoading = false;
  var mode = null;
  var notice = "";

  function ensureStyles() {
    if (document.getElementById("vp-styles")) return;
    var style = document.createElement("style");
    style.id = "vp-styles";
    style.textContent =
      ".vp-disabled{opacity:.45!important;cursor:not-allowed!important;pointer-events:none!important}" +
      ".mobile-tab[data-vp-menu] span{font-size:.62rem!important;line-height:1.05!important;white-space:normal!important;text-align:center}" +
      "#vp-root{position:fixed;inset:0;z-index:4000;background:rgba(17,24,39,.45);display:flex;align-items:flex-start;justify-content:center;padding:1.25rem;overflow:auto}" +
      "#vp-root[hidden]{display:none!important}" +
      ".vp-panel{width:min(920px,100%);margin:2vh auto 4vh;background:#fff;color:#2d2d2d;border-radius:12px;box-shadow:0 16px 48px rgba(0,0,0,.22);padding:1.25rem 1.35rem 1.4rem}" +
      ".vp-head{display:flex;justify-content:space-between;gap:1rem;align-items:flex-start;margin-bottom:1rem}" +
      ".vp-head h1{margin:0;font-size:1.35rem}" +
      ".vp-head p{margin:.35rem 0 0;color:#6b7280;font-size:.92rem}" +
      ".vp-close,.vp-btn,.vp-btn-ghost{font:inherit;cursor:pointer;border-radius:8px}" +
      ".vp-close{border:0;background:transparent;color:#6b7280;padding:.35rem .5rem}" +
      ".vp-btn{border:0;background:#f15a22;color:#fff;padding:.62rem 1rem;font-weight:600}" +
      ".vp-btn:disabled{opacity:.6;cursor:wait}" +
      ".vp-btn-ghost{border:1px solid #d1d5db;background:#fff;color:#2d2d2d;padding:.62rem 1rem}" +
      ".vp-add{width:2.75rem;height:2.75rem;padding:0;border:0;border-radius:0;background:#f15a22;color:#fff;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;line-height:1}" +
      ".vp-add i{color:#fff;font-size:1.15rem}" +
      ".vp-add:disabled{opacity:.55;cursor:not-allowed}" +
      ".vp-table{display:grid;gap:.45rem}" +
      ".vp-row{display:grid;grid-template-columns:11.5rem minmax(0,1fr) auto;gap:.5rem;align-items:center}" +
      ".vp-row--head{font-size:.78rem;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.02em}" +
      ".vp-row input{width:100%;box-sizing:border-box;border:1px solid #d1d5db;border-radius:8px;padding:.55rem .65rem;font:inherit}" +
      ".vp-icon{border:0;background:transparent;color:#b91c1c;cursor:pointer;padding:.35rem}" +
      ".vp-actions{display:flex;justify-content:space-between;gap:.75rem;flex-wrap:wrap;margin-top:1rem}" +
      ".vp-note{margin:0 0 .8rem;padding:.7rem .8rem;border-radius:8px;background:#fff7ed;color:#9a3412}" +
      ".vp-ok{margin:0 0 .8rem;padding:.7rem .8rem;border-radius:8px;background:#ecfdf5;color:#166534}" +
      ".vp-err{margin:0 0 .8rem;padding:.7rem .8rem;border-radius:8px;background:#fef2f2;color:#991b1b}" +
      ".vp-toolbar{display:flex;justify-content:space-between;gap:.75rem;flex-wrap:wrap;align-items:center;margin-bottom:1rem}" +
      ".vp-counter{display:flex;align-items:baseline;gap:.6rem;margin:0 0 .8rem}" +
      ".vp-counter strong{font-size:1.45rem;color:#f15a22}" +
      ".vp-counter span{color:#6b7280}" +
      ".vp-roster{list-style:none;margin:0 0 1rem;padding:0;display:flex;flex-direction:column;gap:.35rem;max-height:22rem;overflow:auto}" +
      ".vp-roster li{display:flex;align-items:center;gap:.55rem}" +
      ".vp-mark{width:1.2rem;height:1.2rem;flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;border:2px solid currentColor;border-radius:3px;font-size:.82rem;font-weight:800;line-height:1}" +
      ".vp-mark--ok{color:#16a34a;background:#ecfdf5}" +
      ".vp-mark--no{color:#dc2626;background:#fef2f2}" +
      ".vp-name{border:0;background:transparent;padding:0;font:inherit;font-weight:650;color:#1f2937;cursor:pointer;text-align:left}" +
      ".vp-roster li.is-open .vp-name,.vp-name:hover{color:#f15a22;text-decoration:underline}" +
      ".vp-card{border:1px solid #e5e7eb;border-radius:10px;padding:.75rem .9rem;margin:0 0 .65rem}" +
      ".vp-card header{display:flex;justify-content:space-between;gap:.75rem;flex-wrap:wrap;margin-bottom:.4rem}" +
      ".vp-card ul{margin:0;padding-left:1.1rem}" +
      ".vp-card li{margin:.2rem 0}" +
      ".vp-card li span{display:inline-block;min-width:6.2rem;font-weight:600}" +
      ".vp-email{width:100%;min-height:12rem;box-sizing:border-box;font:13px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;border:1px solid #d1d5db;border-radius:8px;padding:.75rem;white-space:pre}" +
      "#vp-confirm{position:fixed;inset:0;z-index:4100;background:rgba(17,24,39,.55);display:flex;align-items:center;justify-content:center;padding:1rem}" +
      "#vp-confirm[hidden]{display:none!important}" +
      ".vp-dialog{width:min(640px,100%);background:#fff;border-radius:12px;padding:1.2rem 1.25rem 1.15rem;box-shadow:0 16px 48px rgba(0,0,0,.25)}" +
      ".vp-dialog h2{margin:0 0 .75rem;font-size:1.15rem}" +
      ".vp-dialog p{margin:0 0 .75rem;line-height:1.45}" +
      ".vp-dialog .vp-actions{justify-content:flex-end}" +
      "@media(max-width:700px){.vp-row{grid-template-columns:1fr}.vp-row--head{display:none}}";
    document.head.appendChild(style);
  }

  function labelFor(sample) {
    return sample.classList.contains("mobile-tab") ? "Voos Planejamento" : "Voos Planejamento";
  }

  function bindMenu(node, kind) {
    node.setAttribute("data-vp-menu", kind);
    node.setAttribute("href", "#");
    node.addEventListener("click", function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (node.classList.contains("vp-disabled")) return;
      open(kind === "admin" ? "admin" : "portal");
    });
  }

  function placeAfter(sample, kind) {
    var parent = sample.parentElement;
    if (!parent || parent.querySelector("[data-vp-menu='" + kind + "']")) return;
    var node = sample.cloneNode(true);
    node.classList.remove("active", "mobile-tab--active");
    var icon = node.querySelector("i");
    if (icon) icon.className = "pi pi-map";
    var span = node.querySelector("span");
    if (span) span.textContent = labelFor(sample);
    else node.textContent = labelFor(sample);
    bindMenu(node, kind);
    if (kind === "portal") syncOne(node);
    sample.insertAdjacentElement("afterend", node);
  }

  function syncOne(node) {
    node.classList.toggle("vp-disabled", !enabled);
    if (!enabled) {
      node.setAttribute("title", "O administrador ainda não habilitou Voos Planejamento.");
      node.setAttribute("aria-disabled", "true");
    } else {
      node.removeAttribute("title");
      node.removeAttribute("aria-disabled");
    }
  }

  function syncPortal() {
    document.querySelectorAll(".employee-shell [data-vp-menu='portal']").forEach(syncOne);
  }

  function removeInjected() {
    document.querySelectorAll("[data-vp-menu]").forEach(function (node) {
      node.remove();
    });
  }

  function links(root, label) {
    return Array.prototype.filter.call(root.querySelectorAll("a"), function (a) {
      return !a.hasAttribute("data-vp-menu") && textOf(a) === label;
    });
  }

  function ensureMenus() {
    if (angularMenuExists()) {
      removeInjected();
      return;
    }
    document.querySelectorAll(".employee-shell").forEach(function (shell) {
      var anchors = links(shell, "Férias");
      if (!anchors.length) anchors = links(shell, "Troca de Turno").concat(links(shell, "Troca"));
      anchors.forEach(function (anchor) {
        var kind = "portal";
        if (anchor.parentElement && anchor.parentElement.querySelector("[data-vp-menu='portal']")) return;
        placeAfter(anchor, kind);
      });
    });
    document.querySelectorAll(".admin-shell").forEach(function (shell) {
      links(shell, "Voos").forEach(function (anchor) {
        placeAfter(anchor, "admin");
      });
    });
    syncPortal();
  }

  function refreshStatus() {
    if (!token()) return;
    fetch(API + "/portal/flight-planning", { headers: authHeaders() })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (data) {
        if (!data) return;
        var was = enabled;
        enabled = !!data.enabled;
        syncPortal();
        if (mode === "portal" && was !== enabled) render();
      })
      .catch(function () {});
  }

  function rootEl() {
    var root = document.getElementById("vp-root");
    if (root) return root;
    root = document.createElement("div");
    root.id = "vp-root";
    root.setAttribute("data-vp-root", "1");
    root.hidden = true;
    root.innerHTML =
      '<div class="vp-panel" role="dialog" aria-modal="true" aria-labelledby="vp-title">' +
      '<div class="vp-head"><div><h1 id="vp-title">Voos Planejamento</h1><p id="vp-sub"></p></div>' +
      '<button type="button" class="vp-close" id="vp-close">Fechar</button></div>' +
      '<div id="vp-body"></div></div>';
    document.body.appendChild(root);
    root.addEventListener("click", function (ev) {
      if (ev.target === root) close();
    });
    root.querySelector("#vp-close").addEventListener("click", close);
    var confirm = document.createElement("div");
    confirm.id = "vp-confirm";
    confirm.hidden = true;
    confirm.innerHTML =
      '<div class="vp-dialog" role="dialog" aria-modal="true" aria-labelledby="vp-confirm-title">' +
      "<h2 id=\"vp-confirm-title\">Confirmar envio</h2>" +
      "<p>Ao clicar em enviar, o colaborador confirma que somente um voo nobre está sendo pedido, lembrando que a moderação das solicitações será avaliada mês a mês.</p>" +
      "<p>O usuário tem ciência de que os voos solicitados não podem quebrar pairings, e que não se pode pedir um voo somente de ida a um destino. Voos com solicitação para ir a um único destino são feitos para o Recovery no decorrer do mês.</p>" +
      "<p>Solicitações para o planejamento são cabíveis de avaliação antes da aprovação.</p>" +
      '<div class="vp-actions"><button type="button" class="vp-btn-ghost" id="vp-back">Voltar</button>' +
      '<button type="button" class="vp-btn" id="vp-send">Li e confirmo o envio</button></div></div>';
    document.body.appendChild(confirm);
    confirm.addEventListener("click", function (ev) {
      if (ev.target === confirm && !submitting) closeConfirm();
    });
    confirm.querySelector("#vp-back").addEventListener("click", closeConfirm);
    confirm.querySelector("#vp-send").addEventListener("click", confirmSend);
    return root;
  }

  function close() {
    if (submitting) return;
    confirmOpen = false;
    mode = null;
    var root = document.getElementById("vp-root");
    var confirm = document.getElementById("vp-confirm");
    if (root) root.hidden = true;
    if (confirm) confirm.hidden = true;
  }

  function closeConfirm() {
    if (submitting) return;
    confirmOpen = false;
    var confirm = document.getElementById("vp-confirm");
    if (confirm) confirm.hidden = true;
  }

  function open(next) {
    ensureStyles();
    mode = next;
    notice = "";
    rootEl().hidden = false;
    if (next === "admin") loadAdmin();
    else {
      refreshStatus();
      render();
    }
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function formatBr(iso) {
    var parts = String(iso || "").slice(0, 10).split("-");
    if (parts.length !== 3 || !parts[0]) return iso;
    return parts[2] + "/" + parts[1] + "/" + parts[0];
  }

  function formatSent(iso) {
    var date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function render() {
    var root = rootEl();
    var body = root.querySelector("#vp-body");
    var sub = root.querySelector("#vp-sub");
    body.textContent = "";
    if (mode === "admin") {
      sub.textContent = "Habilite o menu do colaborador e copie as solicitações para o e-mail do setor.";
      renderAdmin(body);
      return;
    }
    sub.textContent = "Uma linha para cada solicitação de voo.";
    renderPortal(body);
  }

  function renderPortal(body) {
    if (!enabled) {
      body.appendChild(
        el(
          "p",
          "vp-note",
          "O administrador ainda não habilitou Voos Planejamento. O formulário fica disponível quando essa opção for liberada."
        )
      );
      return;
    }
    if (notice) body.appendChild(el("p", notice.ok ? "vp-ok" : "vp-err", notice.text));
    var table = el("div", "vp-table");
    var head = el("div", "vp-row vp-row--head");
    head.appendChild(el("span", "", "Data"));
    head.appendChild(el("span", "", "Solicitação do voo"));
    head.appendChild(el("span", "", ""));
    table.appendChild(head);
    portalLines.forEach(function (line, index) {
      var row = el("div", "vp-row");
      var date = document.createElement("input");
      date.type = "date";
      date.value = line.date;
      date.setAttribute("aria-label", "Data da linha " + (index + 1));
      date.addEventListener("input", function () {
        portalLines[index].date = date.value;
      });
      var desc = document.createElement("input");
      desc.type = "text";
      desc.maxLength = 400;
      desc.placeholder = "Descreva o voo";
      desc.value = line.description;
      desc.setAttribute("aria-label", "Solicitação do voo da linha " + (index + 1));
      desc.addEventListener("input", function () {
        portalLines[index].description = desc.value;
      });
      var remove = el("button", "vp-icon");
      remove.type = "button";
      remove.setAttribute("aria-label", "Remover linha " + (index + 1));
      remove.innerHTML = '<i class="pi pi-trash"></i>';
      remove.addEventListener("click", function () {
        if (portalLines.length === 1) portalLines = [{ date: "", description: "" }];
        else portalLines = portalLines.filter(function (_, i) { return i !== index; });
        render();
      });
      row.appendChild(date);
      row.appendChild(desc);
      row.appendChild(remove);
      table.appendChild(row);
    });
    body.appendChild(table);
    var actions = el("div", "vp-actions");
    var add = el("button", "vp-add");
    add.type = "button";
    add.setAttribute("aria-label", "Adicionar linha");
    add.innerHTML = '<i class="pi pi-plus" aria-hidden="true"></i>';
    add.disabled = portalLines.length >= 40;
    add.addEventListener("click", function () {
      if (portalLines.length >= 40) return;
      portalLines = portalLines.concat([{ date: "", description: "" }]);
      render();
    });
    var send = el("button", "vp-btn", "Enviar solicitação");
    send.type = "button";
    send.addEventListener("click", askConfirm);
    actions.appendChild(add);
    actions.appendChild(send);
    body.appendChild(actions);
  }

  function askConfirm() {
    notice = "";
    var invalid = -1;
    portalLines.forEach(function (line, index) {
      if (invalid >= 0) return;
      if (!line.date || !String(line.description || "").trim()) invalid = index;
    });
    if (invalid >= 0) {
      notice = { ok: false, text: "Preencha a data e a solicitação do voo na linha " + (invalid + 1) + "." };
      render();
      return;
    }
    confirmOpen = true;
    var confirm = document.getElementById("vp-confirm");
    confirm.hidden = false;
    confirm.querySelector("#vp-send").disabled = false;
  }

  function confirmSend() {
    if (submitting) return;
    submitting = true;
    var button = document.querySelector("#vp-send");
    if (button) button.disabled = true;
    var lines = portalLines.map(function (line) {
      return { date: line.date, description: String(line.description || "").trim() };
    });
    fetch(API + "/portal/flight-planning/requests", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ lines: lines }),
    })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (body) {
          if (!r.ok) throw new Error(body.error || "Não foi possível enviar a solicitação.");
          return body;
        });
      })
      .then(function () {
        submitting = false;
        closeConfirm();
        portalLines = [{ date: "", description: "" }];
        notice = { ok: true, text: "Solicitação enviada. Ela será avaliada pelo planejamento." };
        render();
      })
      .catch(function (err) {
        submitting = false;
        closeConfirm();
        notice = { ok: false, text: err.message || "Não foi possível enviar a solicitação." };
        render();
      });
  }

  function loadAdmin() {
    adminLoading = true;
    render();
    fetch(API + "/flight-planning", { headers: authHeaders() })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (body) {
          if (!r.ok) throw new Error(body.error || "Não foi possível carregar as solicitações.");
          return body;
        });
      })
      .then(function (view) {
        adminView = view;
        enabled = !!view.enabled;
        adminLoading = false;
        syncPortal();
        render();
      })
      .catch(function (err) {
        adminLoading = false;
        adminView = { enabled: enabled, requests: [], emailText: "", error: err.message };
        render();
      });
  }

  function renderRoster(body, view) {
    var roster = view.roster || [];
    var requestedCount = typeof view.requestedCount === "number"
      ? view.requestedCount
      : roster.filter(function (row) { return row.requested; }).length;
    var pendingCount = typeof view.pendingCount === "number"
      ? view.pendingCount
      : roster.length - requestedCount;
    var counter = el("div", "vp-counter");
    counter.appendChild(el("strong", "", requestedCount + " de " + roster.length));
    counter.appendChild(el("span", "", "já solicitaram · " + pendingCount + " ainda não"));
    body.appendChild(counter);
    if (!roster.length) {
      body.appendChild(el("p", "", "Nenhum PAO ou copiloto FCF ativo para acompanhar."));
      return;
    }
    if (selectedEmployeeId && !roster.some(function (row) { return row.employeeId === selectedEmployeeId; })) {
      selectedEmployeeId = null;
    }
    var list = document.createElement("ul");
    list.className = "vp-roster";
    roster.forEach(function (row) {
      var item = document.createElement("li");
      if (row.employeeId === selectedEmployeeId) item.className = "is-open";
      var mark = el("span", row.requested ? "vp-mark vp-mark--ok" : "vp-mark vp-mark--no", row.requested ? "✓" : "✕");
      mark.setAttribute("aria-label", row.requested ? "Já solicitou" : "Ainda não solicitou");
      var name = el("button", "vp-name", row.name);
      name.type = "button";
      name.addEventListener("click", function () {
        selectedEmployeeId = selectedEmployeeId === row.employeeId ? null : row.employeeId;
        render();
      });
      item.appendChild(mark);
      item.appendChild(name);
      list.appendChild(item);
    });
    body.appendChild(list);
    if (!selectedEmployeeId) return;
    var selected = roster.find(function (row) { return row.employeeId === selectedEmployeeId; });
    var own = (view.requests || []).filter(function (request) { return request.employeeId === selectedEmployeeId; });
    var card = el("article", "vp-card");
    var header = document.createElement("header");
    header.appendChild(el("strong", "", (selected && selected.name) || "Colaborador"));
    card.appendChild(header);
    if (!own.length) {
      card.appendChild(el("p", "", "Nenhuma solicitação enviada."));
    } else {
      own.forEach(function (request) {
        card.appendChild(el("p", "", "Enviado em " + formatSent(request.createdAt)));
        var lines = document.createElement("ul");
        (request.lines || []).forEach(function (line) {
          var item = document.createElement("li");
          item.appendChild(el("span", "", formatBr(line.date)));
          item.appendChild(document.createTextNode(line.description || ""));
          lines.appendChild(item);
        });
        card.appendChild(lines);
      });
    }
    body.appendChild(card);
  }

  function renderAdmin(body) {
    if (adminLoading) {
      body.appendChild(el("p", "", "Carregando solicitações…"));
      return;
    }
    var view = adminView || { enabled: false, requests: [], emailText: "" };
    if (view.error) body.appendChild(el("p", "vp-err", view.error));
    if (notice) body.appendChild(el("p", notice.ok ? "vp-ok" : "vp-err", notice.text));
    var bar = el("div", "vp-toolbar");
    bar.appendChild(
      el(
        "span",
        "",
        view.enabled
          ? "Colaboradores podem enviar solicitações."
          : "Menu bloqueado para o colaborador."
      )
    );
    var buttons = el("div", "vp-actions");
    buttons.style.marginTop = "0";
    var toggle = el("button", "vp-btn", view.enabled ? "Desabilitar" : "Habilitar");
    toggle.type = "button";
    toggle.addEventListener("click", function () {
      toggle.disabled = true;
      fetch(API + "/flight-planning/settings", {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ enabled: !view.enabled }),
      })
        .then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (body) {
            if (!r.ok) throw new Error(body.error || "Não foi possível alterar a habilitação.");
            return body;
          });
        })
        .then(function (result) {
          enabled = !!result.enabled;
          notice = {
            ok: true,
            text: enabled
              ? "Os colaboradores já podem abrir Voos Planejamento."
              : "O menu do colaborador ficou bloqueado.",
          };
          syncPortal();
          loadAdmin();
        })
        .catch(function (err) {
          notice = { ok: false, text: err.message };
          render();
        });
    });
    var copy = el("button", "vp-btn-ghost", "Copiar solicitações");
    copy.type = "button";
    copy.disabled = !String(view.emailText || "").trim();
    copy.addEventListener("click", function () {
      copyRequests(view.emailText || "");
    });
    buttons.appendChild(toggle);
    buttons.appendChild(copy);
    bar.appendChild(buttons);
    body.appendChild(bar);
    renderRoster(body, view);
    if (!String(view.emailText || "").trim()) return;
    body.appendChild(el("p", "", "Texto para o e-mail"));
    var area = document.createElement("textarea");
    area.className = "vp-email";
    area.readOnly = true;
    area.value = view.emailText || "";
    area.id = "vp-email";
    body.appendChild(area);
  }

  function copyRequests(text) {
    var value = String(text || "").trim();
    if (!value) return;
    var done = function (ok) {
      notice = ok
        ? { ok: true, text: "O texto das solicitações está na área de transferência." }
        : { ok: false, text: "O navegador bloqueou a cópia. O texto abaixo já está selecionado." };
      render();
      if (!ok) {
        var area = document.getElementById("vp-email");
        if (area) {
          area.focus();
          area.select();
        }
      }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).then(function () { done(true); }).catch(function () { done(false); });
    } else done(false);
  }

  function boot() {
    ensureStyles();
    ensureMenus();
    refreshStatus();
    var queued = false;
    var observer = new MutationObserver(function () {
      if (queued) return;
      queued = true;
      setTimeout(function () {
        queued = false;
        ensureMenus();
      }, 40);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setInterval(refreshStatus, 15000);
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") close();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
