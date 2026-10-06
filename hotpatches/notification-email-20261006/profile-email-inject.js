(function () {
  const API = "/api";
  const MARK = "notif-email-hotpatch";

  function token() {
    return sessionStorage.getItem("escala_auth_token");
  }

  function authHeaders() {
    const t = token();
    return t
      ? { Authorization: "Bearer " + t, "Content-Type": "application/json" }
      : { "Content-Type": "application/json" };
  }

  function ensureUi() {
    const page = document.querySelector(".profile-page");
    if (!page) return;
    if (document.getElementById(MARK)) return;

    const card = document.createElement("div");
    card.id = MARK;
    card.className = "p-card p-component profile-card gol-card-accent";
    card.style.marginTop = "1rem";
    card.innerHTML =
      '<div class="p-card-body"><div class="p-card-content">' +
      '<h2 style="margin:0 0 .75rem;font-size:1.1rem">E-mail para notificações</h2>' +
      '<p style="margin:0 0 .75rem;color:#6b7280;font-size:.9rem">Opcional. Usado para avisos como alteração na escala APAO.</p>' +
      '<div class="field" style="margin-bottom:.75rem">' +
      '<label for="hot-notification-email">E-mail</label>' +
      '<input id="hot-notification-email" type="email" class="p-inputtext p-component w-full" style="width:100%"/>' +
      "</div>" +
      '<div style="display:flex;gap:.5rem;align-items:center">' +
      '<button id="hot-notification-save" type="button" class="p-button p-component btn-gol-primary">Salvar e-mail</button>' +
      '<span id="hot-notification-msg" style="font-size:.9rem"></span>' +
      "</div></div></div>";

    const firstCard = page.querySelector(".p-card, p-card, .profile-card");
    if (firstCard && firstCard.parentElement) {
      firstCard.parentElement.insertBefore(card, firstCard.nextSibling);
    } else {
      page.appendChild(card);
    }

    const input = card.querySelector("#hot-notification-email");
    const msg = card.querySelector("#hot-notification-msg");
    const btn = card.querySelector("#hot-notification-save");

    fetch(API + "/auth/me", { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && data.user) {
          input.value = data.user.notificationEmail || "";
        }
      })
      .catch(() => {});

    btn.addEventListener("click", function () {
      msg.textContent = "Salvando…";
      msg.style.color = "#6b7280";
      const value = (input.value || "").trim();
      fetch(API + "/auth/notification-email", {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ notificationEmail: value }),
      })
        .then(async (r) => {
          const body = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(body.error || "Falha ao salvar");
          if (body.user) {
            try {
              const raw = sessionStorage.getItem("escala_auth_user");
              const user = raw ? JSON.parse(raw) : {};
              user.notificationEmail = body.user.notificationEmail || null;
              sessionStorage.setItem("escala_auth_user", JSON.stringify(user));
            } catch (_) {}
          }
          msg.textContent = "E-mail salvo.";
          msg.style.color = "#16a34a";
        })
        .catch((err) => {
          msg.textContent = err.message || "Erro ao salvar.";
          msg.style.color = "#dc2626";
        });
    });
  }

  const obs = new MutationObserver(function () {
    ensureUi();
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
  ensureUi();
})();
