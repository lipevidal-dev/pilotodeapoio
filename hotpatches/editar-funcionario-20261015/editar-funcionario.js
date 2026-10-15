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

  function tick() {
    var dialog = document.querySelector(".p-dialog");
    if (!dialog) return;
    var stack = dialog.querySelector(".form-stack");
    if (!stack || !findLabel(stack, "Nome")) return;
    var legacy = /Não alocar voos|Preferência de turno|Turno preferencial/.test(stack.textContent || "") || !!stack.querySelector("p-select");
    tunePassword(stack);
    tuneSeniority(stack);
    if (!legacy && stack.querySelector(".check-group")) return;
    hideLegacy(stack);
    if (!legacy) return;
    var box = ensureOptions(stack);
    place(stack, box);
    syncRoles(stack);
    loadPassword(window.__empDlg);
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
