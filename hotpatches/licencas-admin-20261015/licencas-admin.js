/**
 * Perfil licençasadmin: só o menu Funcionários, no admin já publicado.
 */
(function () {
  if (window.__licencasAdminGateV2) return;
  window.__licencasAdminGateV2 = true;

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

  function readJson(key) {
    try {
      return JSON.parse(sessionStorage.getItem(key) || localStorage.getItem(key) || "null");
    } catch (err) {
      return null;
    }
  }

  function readTokenPayload() {
    var token = sessionStorage.getItem("escala_auth_token") || localStorage.getItem("escala_auth_token") || "";
    var part = token.split(".")[0];
    if (!part) return null;
    try {
      var padded = part.replace(/-/g, "+").replace(/_/g, "/");
      while (padded.length % 4) padded += "=";
      return JSON.parse(atob(padded));
    } catch (err) {
      return null;
    }
  }

  function isRestricted() {
    var user = readJson("escala_auth_user");
    if (user && isLicencasAdminLogin(user.email || user.login || user.name)) return true;
    var payload = readTokenPayload();
    if (payload && isLicencasAdminLogin(payload.email || payload.name)) return true;
    var chip = document.querySelector(".user-chip, .mobile-header__user");
    if (chip && /licen/i.test(chip.textContent || "")) return true;
    return false;
  }

  var style = document.createElement("style");
  style.id = "licencas-admin-style";
  style.textContent = [
    "body.licencas-only .sidebar .nav-link:not([href*='funcionarios']){display:none!important}",
    "body.licencas-only .sidebar .nav-link:not([href*='funcionarios']) + *{display:none!important}",
    "body.licencas-only .mobile-drawer__link:not([href*='funcionarios']){display:none!important}",
    "body.licencas-only .mobile-tab:not([href*='funcionarios']){display:none!important}",
    "body.licencas-only .nav-section-title{display:none!important}",
    "body.licencas-only .mobile-drawer__title{display:none!important}",
    "body.licencas-only .nav:has(.nav-link[href*='funcionarios']) .nav-section-title{display:block!important}",
  ].join("");
  document.documentElement.appendChild(style);

  function apply() {
    var on = isRestricted();
    document.body && document.body.classList.toggle("licencas-only", on);
    if (!on) return;
    document.querySelectorAll("a, button").forEach(function (el) {
      var href = el.getAttribute("href") || el.getAttribute("ng-reflect-router-link") || "";
      var text = (el.textContent || "").replace(/\s+/g, " ").trim();
      var inNav = el.classList.contains("nav-link") || el.classList.contains("mobile-tab") || el.classList.contains("mobile-drawer__link");
      if (!inNav) return;
      var allowed = href.indexOf("funcionarios") >= 0 || text === "Funcionários" || text.indexOf("Funcion") === 0;
      el.style.setProperty("display", allowed ? "" : "none", "important");
    });
    var path = location.pathname || "/";
    if (path !== "/login" && path !== "/funcionarios" && path.indexOf("/funcionarios") !== 0) {
      if (!window.__licencasRedirecting) {
        window.__licencasRedirecting = true;
        window.location.replace("/funcionarios");
      }
    }
  }

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
      return originalFetch.apply(this, arguments);
    };
  }

  var xhrOpen = XMLHttpRequest.prototype.open;
  var xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__licencasUrl = String(url || "");
    return xhrOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    if (this.__licencasUrl && this.__licencasUrl.indexOf("/auth/login") >= 0 && typeof body === "string") {
      arguments[0] = rewriteBody(body);
    }
    return xhrSend.apply(this, arguments);
  };

  document.addEventListener(
    "input",
    function (event) {
      var target = event.target;
      if (!target || target.id !== "login") return;
      var next = asciiLogin(target.value).slice(0, 20);
      if (target.value !== next) target.value = next;
    },
    true,
  );

  new MutationObserver(apply).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(apply, 400);
  apply();
})();
