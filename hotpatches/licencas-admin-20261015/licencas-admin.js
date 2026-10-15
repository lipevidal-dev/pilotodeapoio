/**
 * Login licençasadmin no site publicado:
 * - o campo de login deixava de enviar o "ç"
 * - este perfil só vê/edita Funcionários
 */
(function () {
  if (window.__licencasAdminGate) return;
  window.__licencasAdminGate = true;

  function asciiLogin(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9._@-]/g, "");
  }

  function isLicencasAdminLogin(value) {
    var n = asciiLogin(value);
    return n === "licencasadmin" || n === "licenasadmin";
  }

  function readUser() {
    try {
      return JSON.parse(sessionStorage.getItem("escala_auth_user") || "null");
    } catch (err) {
      return null;
    }
  }

  function isRestricted() {
    var user = readUser();
    return !!(user && isLicencasAdminLogin(user.email || user.login));
  }

  function sanitizeField(input) {
    if (!input) return;
    var next = asciiLogin(input.value).slice(0, 20);
    if (input.value !== next) input.value = next;
  }

  document.addEventListener(
    "input",
    function (event) {
      var target = event.target;
      if (!target || target.id !== "login") return;
      sanitizeField(target);
    },
    true,
  );

  function rewriteBody(raw) {
    if (!raw || typeof raw !== "string") return raw;
    try {
      var payload = JSON.parse(raw);
      ["login", "email"].forEach(function (key) {
        if (typeof payload[key] !== "string") return;
        var next = asciiLogin(payload[key]);
        if (next === "licenasadmin") next = "licencasadmin";
        payload[key] = next;
      });
      return JSON.stringify(payload);
    } catch (err) {
      return raw;
    }
  }

  if (window.fetch) {
    var originalFetch = window.fetch;
    window.fetch = function (input, init) {
      var url = typeof input === "string" ? input : input && input.url;
      if (url && String(url).indexOf("/auth/login") >= 0 && init && typeof init.body === "string") {
        init = Object.assign({}, init, { body: rewriteBody(init.body) });
      }
      return originalFetch.call(this, input, init);
    };
  }

  function hideNav() {
    if (!isRestricted()) return;
    document.querySelectorAll(".nav-link, .mobile-drawer__link, .mobile-tab").forEach(function (el) {
      var href = el.getAttribute("href") || "";
      var text = (el.textContent || "").replace(/\s+/g, " ").trim();
      var allowed = href.indexOf("funcionarios") >= 0 || text === "Funcionários";
      if (!allowed) el.style.display = "none";
    });
    document.querySelectorAll(".nav-section-title, .mobile-drawer__title").forEach(function (title) {
      var text = (title.textContent || "").replace(/\s+/g, " ").trim();
      if (text && text !== "Configurações") title.style.display = "none";
    });
  }

  function gateRoute() {
    if (!isRestricted()) return;
    var path = location.pathname || "/";
    if (path === "/login" || path === "/funcionarios" || path.indexOf("/funcionarios") === 0) return;
    if (window.__licencasRedirecting) return;
    window.__licencasRedirecting = true;
    window.location.replace("/funcionarios");
  }

  function tick() {
    hideNav();
    gateRoute();
  }

  new MutationObserver(tick).observe(document.documentElement, { childList: true, subtree: true });
  tick();
})();
