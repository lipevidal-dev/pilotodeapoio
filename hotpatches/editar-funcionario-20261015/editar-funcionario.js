/**
 * Reorganiza o diálogo de funcionário que já está publicado,
 * sem regravar dias sem voo nem preferência de turno.
 */
(function () {
  if (window.__empDialogLayout) return;
  window.__empDialogLayout = true;

  var style = document.createElement("style");
  style.textContent = [
    ".emp-gone{display:none!important}",
    ".emp-pair{display:grid;grid-template-columns:7.5rem minmax(0,1fr);gap:.85rem;align-items:start}",
    ".emp-seniority-field .p-inputnumber,.emp-seniority-field .p-inputnumber-input,.emp-seniority-field input{width:7.5rem!important;max-width:7.5rem}",
    ".emp-options{border:1px solid #e5e7eb;border-radius:8px;padding:.75rem .9rem;display:flex;flex-direction:column;gap:.65rem}",
    ".emp-options h3{margin:0;font-size:.8rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#6b7280}",
    ".emp-checks,.emp-roles{display:flex;flex-wrap:wrap;gap:.55rem 1.25rem}",
    ".emp-check{display:inline-flex;align-items:center;gap:.4rem;font-size:.9rem;cursor:pointer}",
    ".form-stack .portal-access-section.emp-portal{display:grid!important;grid-template-columns:1fr 1fr;gap:.75rem 1rem;border-top:0;padding-top:0}",
    ".form-stack .portal-access-section.emp-portal>h3,.form-stack .portal-access-section.emp-portal>p{grid-column:1/-1;margin:0}",
    "@media (max-width:640px){.emp-pair,.form-stack .portal-access-section.emp-portal{grid-template-columns:1fr}}",
    ".lic-bell{color:#dc2626;margin-left:.4rem;display:inline-flex;align-items:center}",
    ".lic-bell .pi{font-size:.95rem}",
    ".lic-tabs{display:flex;align-items:flex-end;gap:.25rem;border-bottom:1px solid #d1d5db;margin:0 0 1rem}",
    ".lic-tab{border:1px solid #d1d5db;border-bottom:none;background:#f3f4f6;color:#4b5563;border-radius:8px 8px 0 0;padding:.45rem .9rem;font-weight:600;cursor:pointer;position:relative;top:1px}",
    ".lic-tab.active{background:#fff;color:#111827}",
    ".lic-panel{display:flex;flex-direction:column;gap:.75rem}",
    ".form-stack[hidden],.lic-panel[hidden],.lic-rows[hidden],.lic-add[hidden],.lic-error[hidden]{display:none!important}",
    ".lic-rows{display:flex;flex-direction:column;gap:.55rem}",
    ".lic-row{display:grid;grid-template-columns:11rem minmax(0,1fr) auto;gap:.5rem;align-items:center}",
    ".lic-row input{width:100%;border:1px solid #d1d5db;border-radius:6px;padding:.45rem .55rem;background:#fff}",
    ".lic-row.lic-due input{color:#dc2626;font-weight:700}",
    ".lic-add,.lic-remove{border:1px solid #d1d5db;background:#fff;border-radius:6px;padding:.4rem .7rem;cursor:pointer}",
    ".lic-error{color:#dc2626;font-size:.85rem;margin:0}",
    "@media (max-width:640px){.lic-row{grid-template-columns:1fr}}",
  ].join("");
  document.head.appendChild(style);

  function labelText(el) {
    return (el.textContent || "").replace(/\s+/g, " ").trim();
  }

  function findLabel(root, text) {
    return Array.prototype.find.call(root.querySelectorAll("label"), function (label) {
      return labelText(label) === text;
    });
  }

  function rowOf(label) {
    if (!label) return null;
    return label.closest(".flex") || label.parentElement;
  }

  function hideLegacy(stack) {
    Array.prototype.forEach.call(stack.querySelectorAll("h3, label"), function (heading) {
      var title = labelText(heading);
      if (title === "Não alocar voos" || title.indexOf("Preferência") === 0 || title === "Turno preferencial") {
        var section = heading.closest("section") || heading.parentElement;
        if (section) section.classList.add("emp-gone");
      }
    });
  }

  function tunePassword(stack) {
    var label = findLabel(stack, "Senha") || findLabel(stack, "Senha do portal");
    var input = label && label.parentElement ? label.parentElement.querySelector("input") : null;
    if (!input) return;
    input.type = "text";
    input.maxLength = 120;
    input.autocomplete = "off";
  }

  function tuneSeniority(stack) {
    var label = findLabel(stack, "Senioridade");
    if (!label || !label.parentElement) return;
    label.parentElement.classList.add("emp-seniority-field");
  }

  function ensureOptions(stack) {
    var box = stack.querySelector(".emp-options");
    if (box) return box;
    box = document.createElement("section");
    box.className = "emp-options";
    box.innerHTML = '<h3>Opções</h3><div class="emp-roles"></div><div class="emp-checks"></div>';
    var checks = box.querySelector(".emp-checks");
    ["Ativo", "Escala manual", "Somente escala manual", "Cargo FCF", "Função CMTE", "Comandante (CMTE)", "Em instrução"].forEach(function (name) {
      var row = rowOf(findLabel(stack, name));
      if (row && checks) checks.appendChild(row);
    });
    ["manual-schedule-section", "fcf-section"].forEach(function (cls) {
      var section = stack.querySelector("." + cls);
      if (section) section.classList.add("emp-gone");
    });
    var cargoLabel = findLabel(stack, "Cargo");
    if (cargoLabel && cargoLabel.parentElement) cargoLabel.parentElement.classList.add("emp-gone");
    return box;
  }

  function place(stack, box) {
    var nome = findLabel(stack, "Nome");
    var seniority = findLabel(stack, "Senioridade");
    var birthday = findLabel(stack, "Aniversário");
    var pair = stack.querySelector(".emp-pair");
    if (!pair && seniority && birthday && seniority.parentElement && birthday.parentElement) {
      pair = document.createElement("div");
      pair.className = "emp-pair";
      seniority.parentElement.before(pair);
      pair.appendChild(seniority.parentElement);
      pair.appendChild(birthday.parentElement);
    }
    var portal = stack.querySelector(".portal-access-section");
    if (portal) portal.classList.add("emp-portal");
    var anchor = portal || pair || (nome && nome.parentElement);
    if (anchor && box.parentElement !== stack) anchor.after(box);
    else if (anchor && box.previousElementSibling !== anchor) anchor.after(box);
  }

  function syncRoleChecks(host, cmp) {
    Array.prototype.forEach.call(host.querySelectorAll("input[data-role-id]"), function (input) {
      input.checked = input.getAttribute("data-role-id") === cmp.formRoleId;
    });
  }

  function syncRoles(stack) {
    var cmp = window.__empDlg;
    var host = stack.querySelector(".emp-roles");
    if (!cmp || !host || typeof cmp.roles !== "function") return;
    var roles = (cmp.roles() || []).filter(function (role) { return role.active !== false; });
    var sig = roles.map(function (role) { return role.id; }).join(",");
    if (host.getAttribute("data-sig") !== sig) {
      host.setAttribute("data-sig", sig);
      host.textContent = "";
      roles.forEach(function (role) {
        var label = document.createElement("label");
        label.className = "emp-check";
        var input = document.createElement("input");
        input.type = "checkbox";
        input.setAttribute("data-role-id", role.id);
        label.appendChild(input);
        label.appendChild(document.createTextNode(" " + (role.code || role.name)));
        input.addEventListener("change", function () {
          if (!input.checked) {
            input.checked = cmp.formRoleId === role.id;
            return;
          }
          cmp.formRoleId = role.id;
          if (typeof cmp.onRoleChange === "function") cmp.onRoleChange();
          syncRoleChecks(host, cmp);
        });
        host.appendChild(label);
      });
    }
    syncRoleChecks(host, cmp);
  }

  function loadPassword(cmp) {
    if (!cmp || cmp.dialogMode !== "edit" || !cmp.editingId) return;
    if (cmp.__pwLoaded === cmp.editingId) return;
    var requestId = cmp.editingId;
    cmp.__pwLoaded = requestId;
    var token = sessionStorage.getItem("escala_auth_token");
    if (!token) return;
    fetch("/api/employees/" + encodeURIComponent(requestId) + "/portal-access", {
      headers: { Authorization: "Bearer " + token },
    }).then(function (res) {
      if (!res.ok) return null;
      return res.json();
    }).then(function (data) {
      if (!data || cmp.editingId !== requestId) return;
      if (data.portalPassword && !cmp.formPortalPassword) cmp.formPortalPassword = data.portalPassword;
    }).catch(function () {
      if (cmp.__pwLoaded === requestId) cmp.__pwLoaded = null;
    });
  }

  var alertNames = {};
  var alertAt = 0;

  function authHeaders() {
    var token = sessionStorage.getItem("escala_auth_token") || localStorage.getItem("escala_auth_token");
    if (!token) return null;
    return { Authorization: "Bearer " + token, "Content-Type": "application/json" };
  }

  function licState(dialog) {
    if (!dialog.__lic) {
      dialog.__lic = { loaded: false, dirty: false, employeeId: "", items: [], alertUntil: "", loading: "" };
    }
    return dialog.__lic;
  }

  function refreshAlerts(force) {
    var now = Date.now();
    if (!force && now - alertAt < 15000) return;
    var headers = authHeaders();
    if (!headers) return;
    alertAt = now;
    fetch("/api/employees/license-alerts", { headers: headers }).then(function (res) {
      if (!res.ok) return null;
      return res.json();
    }).then(function (data) {
      if (!data || !data.alerts) return;
      alertNames = {};
      data.alerts.forEach(function (row) {
        alertNames[(row.name || "").replace(/\s+/g, " ").trim()] = true;
      });
      paintAlerts();
    }).catch(function () {});
  }

  function ensureBell(parent) {
    if (parent.querySelector(".lic-bell")) return;
    var bell = document.createElement("span");
    bell.className = "lic-bell";
    bell.title = "Licença ou habilitação a vencer em até 60 dias";
    bell.innerHTML = '<i class="pi pi-bell"></i>';
    parent.appendChild(bell);
  }

  function paintAlerts() {
    document.querySelectorAll("a, button").forEach(function (el) {
      if (!el.closest("nav, aside, .sidebar, .mobile-drawer")) return;
      var span = el.querySelector("span");
      var text = ((span && span.childNodes.length ? span.childNodes[0].textContent : el.textContent) || "").replace(/\s+/g, " ").trim();
      var href = el.getAttribute("href") || "";
      if (text !== "Funcionários" && !/funcionarios?/.test(href)) return;
      var bell = el.querySelector(".lic-bell");
      if (!Object.keys(alertNames).length) {
        if (bell) bell.remove();
        return;
      }
      ensureBell(el);
    });
    document.querySelectorAll(".emp-name").forEach(function (cell) {
      var name = "";
      cell.childNodes.forEach(function (node) {
        if (node.nodeType === 3) name += node.textContent || "";
      });
      name = name.replace(/\s+/g, " ").trim();
      var bell = cell.querySelector(".lic-bell");
      if (!alertNames[name]) {
        if (bell) bell.remove();
        return;
      }
      ensureBell(cell);
    });
  }

  function applyLicTab(dialog) {
    var name = dialog.dataset.licTab || "cadastro";
    var stack = dialog.querySelector(".form-stack");
    var panel = dialog.querySelector(".lic-panel.lic-hot");
    dialog.querySelectorAll(".lic-tabs .lic-tab").forEach(function (tab) {
      tab.classList.toggle("active", tab.getAttribute("data-tab") === name);
    });
    if (stack) stack.hidden = name !== "cadastro";
    if (panel) panel.hidden = name !== "licencas";
  }

  function showLicTab(dialog, name) {
    dialog.dataset.licTab = name || "cadastro";
    applyLicTab(dialog);
  }

  function renderLicenses(dialog) {
    var state = licState(dialog);
    var host = dialog.querySelector(".lic-hot .lic-rows");
    if (!host) return;
    host.textContent = "";
    state.items.forEach(function (item, index) {
      var row = document.createElement("div");
      var due = !!(item.dueOn && state.alertUntil && item.dueOn <= state.alertUntil);
      row.className = "lic-row" + (due ? " lic-due" : "");
      var date = document.createElement("input");
      date.type = "date";
      date.value = item.dueOn || "";
      var desc = document.createElement("input");
      desc.type = "text";
      desc.maxLength = 200;
      desc.placeholder = "Descrição";
      desc.value = item.description || "";
      var remove = document.createElement("button");
      remove.type = "button";
      remove.className = "lic-remove";
      remove.textContent = "Remover";
      date.addEventListener("input", function () {
        item.dueOn = date.value;
        state.dirty = true;
        row.classList.toggle("lic-due", !!(date.value && state.alertUntil && date.value <= state.alertUntil));
      });
      desc.addEventListener("input", function () {
        item.description = desc.value;
        state.dirty = true;
      });
      remove.addEventListener("click", function () {
        state.items.splice(index, 1);
        state.dirty = true;
        renderLicenses(dialog);
      });
      row.append(date, desc, remove);
      host.appendChild(row);
    });
  }

  function ensureTabs(dialog) {
    if (dialog.querySelector(".lic-tabs")) return;
    var stack = dialog.querySelector(".form-stack");
    if (!stack) return;
    var tabs = document.createElement("div");
    tabs.className = "lic-tabs";
    tabs.innerHTML = '<button type="button" class="lic-tab active" data-tab="cadastro">Cadastro</button><button type="button" class="lic-tab" data-tab="licencas">Licenças e Habilitações</button>';
    var panel = document.createElement("div");
    panel.className = "lic-panel lic-hot";
    panel.hidden = true;
    panel.innerHTML = '<p class="section-hint lic-hint"></p><div class="lic-rows"></div><button type="button" class="lic-add">Adicionar</button><p class="lic-error" hidden></p>';
    stack.before(tabs);
    stack.after(panel);
    tabs.addEventListener("click", function (ev) {
      var tab = ev.target.closest(".lic-tab");
      if (!tab) return;
      showLicTab(dialog, tab.getAttribute("data-tab"));
    });
    panel.querySelector(".lic-add").addEventListener("click", function () {
      var state = licState(dialog);
      state.items.push({ dueOn: "", description: "" });
      state.dirty = true;
      renderLicenses(dialog);
    });
  }

  function syncLicenseMode(dialog) {
    var panel = dialog.querySelector(".lic-panel.lic-hot");
    if (!panel) return;
    var cmp = window.__empDlg;
    var editing = cmp && cmp.dialogMode === "edit" && cmp.editingId;
    var hint = panel.querySelector(".lic-hint");
    var add = panel.querySelector(".lic-add");
    if (hint) {
      hint.textContent = editing
        ? "Informe a data de vencimento e a descrição. Com 60 dias ou menos, o sino vermelho aparece no menu Funcionários e ao lado do nome."
        : "Salve o funcionário antes de cadastrar licenças e habilitações.";
    }
    if (add) add.hidden = !editing;
    panel.querySelector(".lic-rows").hidden = !editing;
  }

  function loadLicensesInto(dialog) {
    if (dialog.querySelector("[data-lic-source='angular']")) return;
    var cmp = window.__empDlg;
    syncLicenseMode(dialog);
    if (!cmp || cmp.dialogMode !== "edit" || !cmp.editingId) return;
    var state = licState(dialog);
    var stamp = window.__empLicStamp || 0;
    if (state.stamp === stamp && state.employeeId === cmp.editingId && (state.loaded || state.loading === cmp.editingId)) return;
    var headers = authHeaders();
    if (!headers) return;
    state.stamp = stamp;
    state.loading = cmp.editingId;
    fetch("/api/employees/" + encodeURIComponent(cmp.editingId) + "/licenses", { headers: headers }).then(function (res) {
      if (!res.ok) return null;
      return res.json();
    }).then(function (data) {
      if (!data || (window.__empLicStamp || 0) !== stamp || !window.__empDlg || window.__empDlg.editingId !== state.loading) return;
      state.employeeId = window.__empDlg.editingId;
      state.items = (data.items || []).map(function (item) {
        return { dueOn: item.dueOn, description: item.description };
      });
      state.alertUntil = data.alertUntil || "";
      state.loaded = true;
      state.dirty = false;
      state.loading = "";
      renderLicenses(dialog);
    }).catch(function () {
      if (state.loading === cmp.editingId) state.loading = "";
    });
  }

  function licensePayload(items) {
    return items
      .map(function (item) { return { dueOn: item.dueOn, description: (item.description || "").trim() }; })
      .filter(function (item) { return item.dueOn || item.description; });
  }

  function licenseError(items) {
    var rows = licensePayload(items);
    if (rows.length > 40) return "São permitidas no máximo 40 licenças.";
    for (var i = 0; i < rows.length; i++) {
      if (!rows[i].dueOn || !rows[i].description) return "Preencha a data e a descrição de cada licença.";
      if (rows[i].description.length > 200) return "A descrição deve ter no máximo 200 caracteres.";
    }
    return "";
  }

  function bindLicenseSave(dialog) {
    if (dialog.dataset.licSave === "1" || dialog.querySelector("[data-lic-source='angular']")) return;
    dialog.dataset.licSave = "1";
    var pass = false;
    dialog.addEventListener("click", function (ev) {
      if (pass) {
        pass = false;
        return;
      }
      var btn = ev.target.closest("button");
      if (!btn || labelText(btn) !== "Salvar") return;
      var state = licState(dialog);
      if (!state.loaded || !state.dirty) return;
      var error = licenseError(state.items);
      var errorEl = dialog.querySelector(".lic-error");
      if (error) {
        ev.preventDefault();
        ev.stopPropagation();
        showLicTab(dialog, "licencas");
        if (errorEl) {
          errorEl.hidden = false;
          errorEl.textContent = error;
        }
        return;
      }
      var headers = authHeaders();
      if (!headers || !state.employeeId) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (errorEl) errorEl.hidden = true;
      fetch("/api/employees/" + encodeURIComponent(state.employeeId) + "/licenses", {
        method: "PUT",
        headers: headers,
        body: JSON.stringify({ items: licensePayload(state.items) }),
      }).then(function (res) {
        if (!res.ok) throw new Error("save");
        return res.json();
      }).then(function () {
        state.dirty = false;
        refreshAlerts(true);
        pass = true;
        btn.click();
      }).catch(function () {
        showLicTab(dialog, "licencas");
        if (errorEl) {
          errorEl.hidden = false;
          errorEl.textContent = "Não foi possível salvar as licenças e habilitações.";
        }
      });
    }, true);
  }

  function tick() {
    refreshAlerts(false);
    paintAlerts();
    var dialog = document.querySelector(".p-dialog");
    if (!dialog) return;
    var stack = dialog.querySelector(".form-stack");
    if (!stack || !findLabel(stack, "Nome")) return;
    ensureTabs(dialog);
    loadLicensesInto(dialog);
    bindLicenseSave(dialog);
    var legacy = /Não alocar voos|Preferência de turno|Turno preferencial/.test(stack.textContent || "") || !!stack.querySelector("p-select");
    tunePassword(stack);
    tuneSeniority(stack);
    if (legacy || !stack.querySelector(".check-group")) hideLegacy(stack);
    if (legacy) {
      var box = ensureOptions(stack);
      place(stack, box);
      syncRoles(stack);
      loadPassword(window.__empDlg);
    }
    applyLicTab(dialog);
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
