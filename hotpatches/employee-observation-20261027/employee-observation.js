/**
 * Campo Observação no Editar funcionário e hover no nome da escala.
 * Não altera alertas, trocas, Excel nem cores já publicadas.
 */
(function () {
  if (window.__empObservationV1) return;
  window.__empObservationV1 = true;

  var MAX = 500;
  var byId = {};
  var byName = {};
  var lastEmployeeId = "";
  var pendingObservation = "";

  var style = document.getElementById("emp-observation-style") || document.createElement("style");
  style.id = "emp-observation-style";
  style.textContent = [
    ".emp-observation-field{display:flex;flex-direction:column;gap:.35rem;margin:.15rem 0 .35rem}",
    ".emp-observation-field label{font-size:.8rem;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#6b7280}",
    ".emp-observation-field textarea{width:100%;min-height:4.5rem;resize:vertical;box-sizing:border-box;font:inherit;font-size:.9rem;color:#2d2d2d;background:#fff;border:1px solid #d1d5db;border-radius:6px;padding:.5rem .65rem}",
    ".emp-observation-field textarea:focus{outline:none;border-color:#f15a22;box-shadow:0 0 0 1px #f15a22}",
    ".emp-observation-field small{font-size:.75rem;color:#6b7280}",
    ".emp-name.has-observation{cursor:help;text-decoration:underline dotted;text-underline-offset:.18em}",
  ].join("");
  (document.head || document.documentElement).appendChild(style);

  function token() {
    return sessionStorage.getItem("escala_auth_token") || localStorage.getItem("escala_auth_token") || "";
  }

  function authHeaders() {
    var t = token();
    if (!t) return null;
    return { Authorization: "Bearer " + t, "Content-Type": "application/json" };
  }

  function normalize(value) {
    var text = String(value || "").trim();
    if (!text) return "";
    return text.length > MAX ? text.slice(0, MAX) : text;
  }

  function rememberRow(row) {
    if (!row || !row.id) return;
    var text = normalize(row.observation);
    if (text) byId[row.id] = text;
    else delete byId[row.id];
    var name = String(row.name || "").replace(/\s+/g, " ").trim();
    if (name) {
      if (text) byName[name] = text;
      else delete byName[name];
    }
  }

  function rememberList(data) {
    if (Array.isArray(data)) {
      data.forEach(rememberRow);
      return;
    }
    if (data && Array.isArray(data.items)) {
      data.items.forEach(function (row) {
        if (!row) return;
        if (row.employeeId && row.observation) {
          byId[row.employeeId] = normalize(row.observation);
          return;
        }
        rememberRow(row);
      });
    }
  }

  function pathOf(url) {
    var path = String(url || "");
    try {
      path = new URL(url, location.origin).pathname;
    } catch (err) {}
    return path;
  }

  function employeesUrl(url) {
    return /\/(api\/)?employees\/?$/.test(pathOf(url));
  }

  function employeeItemUrl(url) {
    var path = pathOf(url);
    return /\/employees\/[^/]+$/.test(path) && path.indexOf("license") < 0 && path.indexOf("portal") < 0 && path.indexOf("observation") < 0;
  }

  function employeeIdFromUrl(url) {
    var match = pathOf(url).match(/\/employees\/([^/]+)$/);
    return match ? decodeURIComponent(match[1]) : "";
  }

  function observationForName(name) {
    return byName[String(name || "").replace(/\s+/g, " ").trim()] || "";
  }

  function paintNames() {
    document.querySelectorAll(".emp-name").forEach(function (el) {
      if (el.closest(".employees-table, .p-datatable")) return;
      var text = observationForName(el.textContent);
      if (text) {
        el.setAttribute("title", text);
        el.classList.add("has-observation");
      } else {
        el.removeAttribute("title");
        el.classList.remove("has-observation");
      }
    });
  }

  function loadObservations() {
    var headers = authHeaders();
    if (!headers) return;
    fetch("/api/employees/observations", { headers: headers })
      .then(function (res) {
        if (!res.ok) return null;
        return res.json();
      })
      .then(function (data) {
        if (!data) return;
        rememberList(data);
        paintNames();
      })
      .catch(function () {});
  }

  function saveObservation(id, value) {
    var headers = authHeaders();
    if (!headers || !id) return;
    var observation = normalize(value) || null;
    fetch("/api/employees/" + encodeURIComponent(id) + "/observation", {
      method: "PUT",
      headers: headers,
      body: JSON.stringify({ observation: observation }),
    }).then(function (res) {
      if (!res.ok) return;
      if (observation) byId[id] = observation;
      else delete byId[id];
    }).catch(function () {});
  }

  function findDialog() {
    return document.querySelector(".p-dialog:not(.p-dialog-target-hidden), .p-dialog[aria-modal='true']");
  }

  function ensureField(dialog) {
    if (!dialog) return null;
    var existing = dialog.querySelector(".emp-observation-field textarea");
    if (existing) return existing;
    var stack = dialog.querySelector(".form-stack") || dialog;
    var labels = stack.querySelectorAll("label");
    var anchor = null;
    Array.prototype.forEach.call(labels, function (label) {
      var t = (label.textContent || "").replace(/\s+/g, " ").trim();
      if (t === "CIF" || t === "Nome") anchor = label.closest("div") || label.parentElement;
    });
    var wrap = document.createElement("div");
    wrap.className = "emp-observation-field";
    wrap.innerHTML =
      '<label for="emp-observation-input">Observação</label>' +
      '<textarea id="emp-observation-input" maxlength="' + MAX + '" rows="3" placeholder="Informações do colaborador (hover no nome na escala)"></textarea>' +
      "<small>Até " + MAX + " caracteres. Vazio não mostra hover na escala.</small>";
    if (anchor && anchor.parentElement) anchor.after(wrap);
    else stack.appendChild(wrap);
    return wrap.querySelector("textarea");
  }

  function currentEmployeeId() {
    var cmp = window.__empDlg;
    if (cmp && cmp.editingId) return cmp.editingId;
    try {
      var host = document.querySelector("app-employees");
      if (host && window.ng && typeof window.ng.getComponent === "function") {
        var ngCmp = window.ng.getComponent(host);
        if (ngCmp && ngCmp.editingId) return ngCmp.editingId;
      }
    } catch (err) {}
    return lastEmployeeId;
  }

  function syncDialog() {
    var dialog = findDialog();
    if (!dialog) return;
    var header = (dialog.querySelector(".p-dialog-title, .p-dialog-header") || {}).textContent || "";
    if (header.indexOf("funcionário") < 0 && header.indexOf("Funcionário") < 0) return;
    var area = ensureField(dialog);
    if (!area) return;
    var id = currentEmployeeId();
    if (area.getAttribute("data-emp") === id) return;
    area.setAttribute("data-emp", id);
    area.value = (id && byId[id]) || "";
  }

  function hookSave() {
    document.addEventListener(
      "click",
      function (ev) {
        var btn = ev.target && ev.target.closest ? ev.target.closest("button") : null;
        if (!btn) return;
        var label = (btn.textContent || "").replace(/\s+/g, " ").trim();
        if (label !== "Salvar") return;
        var dialog = btn.closest(".p-dialog");
        if (!dialog) return;
        var area = dialog.querySelector(".emp-observation-field textarea");
        if (!area) return;
        var id = currentEmployeeId();
        var value = area.value;
        pendingObservation = value;
        if (id) {
          var name = "";
          var cmp = window.__empDlg;
          if (cmp && cmp.formName) name = String(cmp.formName).replace(/\s+/g, " ").trim();
          var text = normalize(value);
          if (text) {
            byId[id] = text;
            if (name) byName[name] = text;
          } else {
            delete byId[id];
            if (name) delete byName[name];
          }
          saveObservation(id, value);
          setTimeout(paintNames, 400);
        }
      },
      true,
    );
  }

  var origFetch = window.fetch;
  window.fetch = function () {
    var args = arguments;
    var url = "";
    var method = "GET";
    try {
      if (typeof args[0] === "string") url = args[0];
      else if (args[0] && args[0].url) url = args[0].url;
      if (args[1] && args[1].method) method = String(args[1].method).toUpperCase();
      else if (args[0] && args[0].method) method = String(args[0].method).toUpperCase();
    } catch (err) {}
    return origFetch.apply(this, args).then(function (res) {
      try {
        if (!res || !res.ok) return res;
        if (method === "GET" && employeesUrl(url)) {
          res.clone().json().then(function (data) {
            rememberList(data);
            paintNames();
          }).catch(function () {});
        }
        if (method === "GET" && employeeItemUrl(url)) {
          lastEmployeeId = employeeIdFromUrl(url) || lastEmployeeId;
          res.clone().json().then(function (data) {
            if (data && data.id) {
              lastEmployeeId = data.id;
              rememberRow(data);
            }
            paintNames();
          }).catch(function () {});
        }
        if (method === "POST" && employeesUrl(url)) {
          res.clone().json().then(function (data) {
            if (data && data.id) {
              lastEmployeeId = data.id;
              rememberRow(data);
              if (pendingObservation) saveObservation(data.id, pendingObservation);
            }
            paintNames();
          }).catch(function () {});
        }
        if (method === "PUT" && employeeItemUrl(url)) {
          res.clone().json().then(function (data) {
            if (data && data.id) rememberRow(data);
            paintNames();
          }).catch(function () {});
        }
      } catch (err) {}
      return res;
    });
  };

  var xhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.addEventListener("load", function () {
      try {
        if (this.status < 200 || this.status >= 300) return;
        if (!employeesUrl(url) && !employeeItemUrl(url)) return;
        var data = JSON.parse(this.responseText);
        rememberList(data);
        if (data && !Array.isArray(data) && data.id) {
          lastEmployeeId = data.id;
          rememberRow(data);
        } else if (employeeItemUrl(url)) {
          lastEmployeeId = employeeIdFromUrl(url) || lastEmployeeId;
        }
        paintNames();
      } catch (err) {}
    });
    return xhrOpen.apply(this, arguments);
  };

  hookSave();
  var obs = new MutationObserver(function () {
    syncDialog();
    paintNames();
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
  loadObservations();
  setTimeout(loadObservations, 1500);
})();
