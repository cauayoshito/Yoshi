/* ============================================================
   YOSHI BET — Painel administrativo
   Requer conta com role=admin (e-mail definido em ADMIN_EMAIL)
   ============================================================ */

(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const TOKEN_KEY = "yoshibet_token";
  let token = localStorage.getItem(TOKEN_KEY);

  const fmt = (cents) =>
    "R$ " + (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  let toastTimer;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add("hidden"), 3400);
  }

  async function api(method, path, body) {
    const res = await fetch(path, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || "Erro inesperado");
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function showGate() {
    $("#admGate").classList.remove("hidden");
    $("#admPanel").classList.add("hidden");
  }
  function showPanel() {
    $("#admGate").classList.add("hidden");
    $("#admPanel").classList.remove("hidden");
  }

  $("#admLoginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const data = await api("POST", "/api/auth/login", {
        email: $("#admEmail").value.trim(),
        password: $("#admPass").value,
      });
      if (data.user.role !== "admin") return void toast("Esta conta não é de administrador");
      token = data.token;
      localStorage.setItem(TOKEN_KEY, token);
      boot();
    } catch (err) {
      toast(err.message);
    }
  });

  $("#admLogout").addEventListener("click", () => {
    localStorage.removeItem(TOKEN_KEY);
    token = null;
    showGate();
  });

  /* ---- Renderização ---- */
  function renderStats(s) {
    const tiles = [
      { lbl: "Usuários", val: s.users, cls: "" },
      { lbl: "Depósitos", val: fmt(s.depositsCents), cls: "stat-green" },
      { lbl: "Saques", val: fmt(s.withdrawalsCents), cls: "" },
      { lbl: "GGR (receita de jogo)", val: fmt(s.ggrCents), cls: "stat-gold" },
      { lbl: "Bônus concedidos", val: fmt(s.bonusCents), cls: "" },
      { lbl: "Saldo dos jogadores", val: fmt(s.balancesCents), cls: "" },
      { lbl: "Apostas em aberto", val: s.pendingSportBets, cls: "" },
    ];
    $("#statsGrid").innerHTML = tiles
      .map((t) => `<div class="stat-tile ${t.cls}"><div class="lbl">${t.lbl}</div><div class="val">${t.val}</div></div>`)
      .join("");
  }

  function renderMatches(matches) {
    const statusLabel = { upcoming: "Agendada", live: "🟢 Ao vivo", finished: "Encerrada" };
    $("#matchesBody").innerHTML = matches
      .map((m) => {
        const name = `${m.home.name} x ${m.away.name}`;
        const ko = new Date(m.kickoff).toLocaleString("pt-BR", {
          day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
          timeZone: "America/Sao_Paulo",
        });
        const resultCell = m.result
          ? `<strong>${m.result.home_score} x ${m.result.away_score}</strong> <span class="muted">(${m.result.source})</span>`
          : `<form class="score-form" data-match="${m.id}">
              <input type="number" min="0" max="20" placeholder="0" required aria-label="Gols ${m.home.name}" />
              <span>x</span>
              <input type="number" min="0" max="20" placeholder="0" required aria-label="Gols ${m.away.name}" />
              <button class="btn btn-primary" type="submit">Liquidar</button>
            </form>`;
        return `<tr>
          <td>${name}</td>
          <td>${ko}</td>
          <td>${statusLabel[m.status] || m.status}</td>
          <td>${m.bets}</td>
          <td>${fmt(m.stakedCents)}</td>
          <td>${resultCell}</td>
        </tr>`;
      })
      .join("");
  }

  function renderUsers(users) {
    $("#usersBody").innerHTML = users
      .map(
        (u) => `<tr>
          <td>#${u.id}</td>
          <td>${u.name}${u.role === "admin" ? ' <span class="adm-badge">ADMIN</span>' : ""}</td>
          <td>${u.email}</td>
          <td>${fmt(u.balance_cents)}</td>
          <td>${fmt(u.deposited_cents)}</td>
          <td>${u.rounds_count}</td>
          <td>${u.sport_bets_count}</td>
          <td>${u.created_at}</td>
        </tr>`
      )
      .join("");
  }

  function renderTx(transactions) {
    const label = { deposit: "Depósito", bonus: "Bônus", withdraw: "Saque", bet: "Aposta", win: "Prêmio" };
    $("#txBody").innerHTML = transactions
      .map(
        (t) => `<tr>
          <td>#${t.id}</td>
          <td>${t.user_name}</td>
          <td>${label[t.type] || t.type}</td>
          <td class="${t.amount_cents >= 0 ? "tx-pos" : "tx-neg"}">${t.amount_cents >= 0 ? "+" : ""}${fmt(t.amount_cents)}</td>
          <td>${t.created_at}</td>
        </tr>`
      )
      .join("");
  }

  // Registrar resultado manualmente
  document.addEventListener("submit", async (e) => {
    const form = e.target.closest(".score-form");
    if (!form) return;
    e.preventDefault();
    const [homeInput, awayInput] = form.querySelectorAll("input");
    try {
      const r = await api("POST", `/api/admin/matches/${form.dataset.match}/result`, {
        homeScore: Number(homeInput.value),
        awayScore: Number(awayInput.value),
      });
      toast(`✅ ${r.matchId}: ${r.homeScore}x${r.awayScore} — ${r.won} apostas pagas (${fmt(r.paidCents)}), ${r.lost} perdidas`);
      refresh();
    } catch (err) {
      toast(err.message);
    }
  });

  async function refresh() {
    const [stats, matches, users, activity] = await Promise.all([
      api("GET", "/api/admin/stats"),
      api("GET", "/api/admin/matches"),
      api("GET", "/api/admin/users"),
      api("GET", "/api/admin/activity"),
    ]);
    renderStats(stats);
    renderMatches(matches.matches);
    renderUsers(users.users);
    renderTx(activity.transactions);
  }

  async function boot() {
    if (!token) return void showGate();
    try {
      await refresh();
      showPanel();
      setInterval(refresh, 30_000);
    } catch (err) {
      if (err.status === 401 || err.status === 403) showGate();
      else toast(err.message);
    }
  }

  boot();
})();
