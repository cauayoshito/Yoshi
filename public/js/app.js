/* ============================================================
   YOSHI BET — Front-end v2 (estilo Blaze/Betano)
   Integrado à API (server/): autenticação JWT, carteira e
   jogos rodam no servidor; aqui fica interface e animação.
   ============================================================ */

(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];

  const TOKEN_KEY = "yoshibet_token";
  let token = localStorage.getItem(TOKEN_KEY);
  let user = null;
  let balanceCents = 0;
  let GAMES = [];

  const fmt = (cents) =>
    (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  /* ============ CLIENTE DA API ============ */
  async function api(method, path, body) {
    let res;
    try {
      res = await fetch(path, {
        method,
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new Error("Sem conexão com o servidor. Rode: cd server && npm start");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401 && token) setLoggedOut();
      throw new Error(data.error || "Erro inesperado, tente novamente");
    }
    return data;
  }

  /* ============ TOAST ============ */
  let toastTimer;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add("hidden"), 3400);
  }

  /* ============ HELPERS DE UI ============ */
  function btnLoading(btn, on) {
    btn.classList.toggle("loading", on);
    btn.disabled = on;
  }

  $$(".pw-eye").forEach((eye) =>
    eye.addEventListener("click", () => {
      const input = eye.previousElementSibling;
      input.type = input.type === "password" ? "text" : "password";
      eye.textContent = input.type === "password" ? "👁" : "🙈";
    })
  );

  /* ============ SESSÃO / SALDO ============ */
  function setBalance(cents) {
    if (typeof cents !== "number") return;
    balanceCents = cents;
    $("#balanceValue").textContent = fmt(cents);
    $("#profileBalance").textContent = fmt(cents);
  }

  function setLoggedIn(u, tk) {
    user = u;
    if (tk) {
      token = tk;
      localStorage.setItem(TOKEN_KEY, tk);
    }
    $("#authButtons").classList.add("hidden");
    $("#userArea").classList.remove("hidden");
    $("#profileName").textContent = u.name;
    $("#profileEmail").textContent = u.email;
    setBalance(u.balanceCents);
  }

  function setLoggedOut() {
    user = null;
    token = null;
    localStorage.removeItem(TOKEN_KEY);
    $("#authButtons").classList.remove("hidden");
    $("#userArea").classList.add("hidden");
    setBalance(0);
  }

  function requireLogin() {
    if (user) return true;
    toast("Faça login ou cadastre-se para jogar 🚀");
    openModal("registerModal");
    return false;
  }

  /* ============ SIDEBAR (drawer no mobile) ============ */
  const sidebar = $("#sidebar");
  const backdrop = $("#sidebarBackdrop");
  function closeSidebar() {
    sidebar.classList.remove("open");
    backdrop.classList.remove("show");
  }
  $("#menuBtn").addEventListener("click", () => {
    sidebar.classList.toggle("open");
    backdrop.classList.toggle("show", sidebar.classList.contains("open"));
  });
  backdrop.addEventListener("click", closeSidebar);

  /* ============ NAVEGAÇÃO ENTRE VIEWS ============ */
  // Views físicas: home, catalog, promos, profile.
  // Nomes de categoria viram o catálogo filtrado.
  const CATALOG_CATS = {
    originals: { cat: "originals", title: "🐲 Yoshi Originals" },
    casino: { cat: "slots", title: CAT_TITLES.slots },
    crash: { cat: "crash", title: CAT_TITLES.crash },
    live: { cat: "live", title: CAT_TITLES.live },
    table: { cat: "table", title: CAT_TITLES.table },
    new: { cat: "new", title: CAT_TITLES.new },
  };

  function showView(name) {
    let target = name;
    if (CATALOG_CATS[name]) {
      target = "catalog";
      openCatalog(CATALOG_CATS[name].cat, CATALOG_CATS[name].title);
    }
    if (name === "home") {
      searchTerm = "";
      $("#searchInput").value = "";
    }
    if (name === "profile") {
      if (!user) return void requireLogin();
      loadHistory();
    }

    ["home", "catalog", "promos", "profile", "sports", "game"].forEach((v) =>
      $(`#view-${v}`).classList.toggle("hidden", v !== target)
    );
    $$(".side-link").forEach((a) => a.classList.toggle("active", a.dataset.view === name));
    $$(".bnav-item[data-view]").forEach((a) => a.classList.toggle("active", a.dataset.view === name));
    closeSidebar();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  document.addEventListener("click", (e) => {
    const viewEl = e.target.closest("[data-view]");
    if (viewEl) {
      e.preventDefault();
      showView(viewEl.dataset.view);
    }
    const viewBtn = e.target.closest("[data-view-btn]");
    if (viewBtn) showView(viewBtn.dataset.viewBtn);
  });

  /* ============ MODAIS ============ */
  function openModal(id) {
    $$(".modal-overlay").forEach((m) => m.classList.add("hidden"));
    $(`#${id}`).classList.remove("hidden");
  }
  function closeModals() {
    $$(".modal-overlay").forEach((m) => m.classList.add("hidden"));
    stopPixPolling();
  }

  document.addEventListener("click", (e) => {
    const opener = e.target.closest("[data-modal]");
    if (opener) {
      e.preventDefault();
      const id = opener.dataset.modal;
      if (id === "depositModal" && !user) return void requireLogin();
      openModal(id);
    }
    if (e.target.closest("[data-close]") || e.target.classList.contains("modal-overlay")) {
      closeModals();
    }
    const switcher = e.target.closest("[data-switch]");
    if (switcher) {
      e.preventDefault();
      openModal(switcher.dataset.switch);
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeModals();
      closeSidebar();
    }
    // Atalho "/" foca a busca (padrão das casas grandes)
    if (e.key === "/" && document.activeElement !== $("#searchInput")) {
      e.preventDefault();
      $("#searchInput").focus();
    }
  });

  /* ============ LOGIN / CADASTRO ============ */
  $("#registerForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = e.target.querySelector("button[type=submit]");
    btnLoading(submitBtn, true);
    try {
      const data = await api("POST", "/api/auth/register", {
        name: $("#regName").value.trim(),
        email: $("#regEmail").value.trim(),
        password: $("#regPass").value,
      });
      setLoggedIn(data.user, data.token);
      closeModals();
      toast(`Bem-vindo, ${data.user.name}! 🎉 Deposite e ganhe 100% de bônus.`);
      openModal("depositModal");
    } catch (err) {
      toast(err.message);
    }
    btnLoading(submitBtn, false);
  });

  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = e.target.querySelector("button[type=submit]");
    btnLoading(submitBtn, true);
    try {
      const data = await api("POST", "/api/auth/login", {
        email: $("#loginEmail").value.trim(),
        password: $("#loginPass").value,
      });
      setLoggedIn(data.user, data.token);
      closeModals();
      toast(`Bem-vindo de volta, ${data.user.name}! 🍀`);
    } catch (err) {
      toast(err.message);
    }
    btnLoading(submitBtn, false);
  });

  $("#logoutBtn").addEventListener("click", () => {
    setLoggedOut();
    showView("home");
    toast("Você saiu da conta. Até logo! 👋");
  });

  $("#avatarBtn").addEventListener("click", () => showView("profile"));
  $("#balanceChip").addEventListener("click", () => showView("profile"));

  $("#withdrawBtn").addEventListener("click", async () => {
    if (balanceCents < 2000) return void toast("Saque mínimo: R$ 20,00");
    try {
      const data = await api("POST", "/api/wallet/withdraw", {
        amountCents: balanceCents,
        pixKey: user.email,
      });
      setBalance(data.balanceCents);
      toast(`⚡ Saque de R$ ${fmt(data.withdrawal.amount_cents)} enviado para sua chave PIX!`);
    } catch (err) {
      toast(err.message);
    }
  });

  /* ============ DEPÓSITO PIX ============ */
  let depositValue = 50; // em reais
  let pixPollTimer = null;

  function stopPixPolling() {
    clearInterval(pixPollTimer);
    pixPollTimer = null;
    $("#pixArea").classList.add("hidden");
    $("#generatePixBtn").disabled = false;
  }

  function updateBonusNote() {
    $("#bonusNote").innerHTML =
      `🎁 Primeiro depósito ganha <strong>+R$ ${fmt(Math.min(depositValue, 500) * 100)} de bônus</strong> (100%)`;
  }

  $$(".amount-btn").forEach((btn) =>
    btn.addEventListener("click", () => {
      $$(".amount-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      depositValue = Number(btn.dataset.amount);
      $("#depositAmount").value = depositValue;
      updateBonusNote();
    })
  );

  $("#depositAmount").addEventListener("input", (e) => {
    depositValue = Math.max(0, Number(e.target.value) || 0);
    $$(".amount-btn").forEach((b) =>
      b.classList.toggle("active", Number(b.dataset.amount) === depositValue)
    );
    updateBonusNote();
  });

  $("#generatePixBtn").addEventListener("click", async () => {
    if (depositValue < 20) return void toast("Depósito mínimo: R$ 20");
    const genBtn = $("#generatePixBtn");
    btnLoading(genBtn, true);
    try {
      const charge = await api("POST", "/api/wallet/deposit", {
        amountCents: Math.round(depositValue * 100),
      });
      $("#pixCode").value = charge.brcode;
      $("#pixQrImg").src = charge.qrDataUrl;
      $("#pixArea").classList.remove("hidden");
      btnLoading(genBtn, false);
      genBtn.disabled = true;

      pixPollTimer = setInterval(async () => {
        try {
          const st = await api("GET", `/api/wallet/deposit/${charge.txid}`);
          if (st.status === "paid") {
            stopPixPolling();
            closeModals();
            setBalance(st.balanceCents);
            toast(`✅ Depósito de R$ ${fmt(st.amount_cents)} confirmado!`);
          }
        } catch { /* tenta de novo no próximo tick */ }
      }, 1500);
    } catch (err) {
      btnLoading(genBtn, false);
      toast(err.message);
    }
  });

  $("#copyPixBtn").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("#pixCode").value);
      toast("Código PIX copiado! 📋");
    } catch {
      $("#pixCode").select();
      document.execCommand("copy");
      toast("Código PIX copiado! 📋");
    }
  });

  /* ============ CARDS / FILEIRAS / CATÁLOGO ============ */
  /* Arte de card gerada: cena SVG em camadas (fundo, raios, glow, símbolo, acentos) */
  function accentsFor(g) {
    if (g.provider === "Yoshi Originals") return ["⭐", "💰"];
    if (g.cats.includes("crash")) return ["⚡", "⭐"];
    if (g.cats.includes("live")) return ["💎", "🏆"];
    if (g.cats.includes("table")) return ["🍀", "💎"];
    return ["💰", "⭐"];
  }

  function gradientStops(gradient) {
    const hexes = gradient.match(/#[0-9a-fA-F]{3,8}/g) || ["#1a2038", "#2a3358"];
    return [hexes[0], hexes[hexes.length - 1]];
  }

  function cardArtSVG(g) {
    const [c1, c2] = gradientStops(g.gradient);
    const main = twe(g.emoji);
    const [a1, a2] = accentsFor(g).map((e) => twe(e));
    const uid = g.id.replace(/[^a-z0-9-]/gi, "");
    const rays = Array.from({ length: 8 }, (_, i) => {
      const rot = i * 45 + 22;
      return `<path d="M150 195 L120 -40 L180 -40 Z" fill="rgba(255,255,255,0.045)" transform="rotate(${rot} 150 195)"/>`;
    }).join("");
    const sparks = [[52, 96, 2.4], [246, 78, 1.8], [230, 300, 2.2], [64, 318, 1.6], [270, 180, 1.4]]
      .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="rgba(255,255,255,0.35)"/>`) 
      .join("");
    return `<svg class="ga-svg" viewBox="0 0 300 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="bg-${uid}" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/>
        </linearGradient>
        <radialGradient id="gl-${uid}" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stop-color="rgba(255,255,255,0.32)"/>
          <stop offset="0.55" stop-color="rgba(255,255,255,0.08)"/>
          <stop offset="1" stop-color="rgba(255,255,255,0)"/>
        </radialGradient>
      </defs>
      <rect width="300" height="400" fill="url(#bg-${uid})"/>
      ${rays}
      <circle cx="150" cy="192" r="105" fill="url(#gl-${uid})"/>
      <circle cx="150" cy="192" r="82" fill="none" stroke="rgba(255,255,255,0.16)" stroke-width="2"/>
      <circle cx="150" cy="192" r="92" fill="none" stroke="rgba(255,255,255,0.07)" stroke-width="1"/>
      ${sparks}
      ${a1 ? `<image href="${a1}" x="34" y="52" width="40" height="40" opacity="0.9" transform="rotate(-14 54 72)"/>` : ""}
      ${a2 ? `<image href="${a2}" x="226" y="252" width="36" height="36" opacity="0.85" transform="rotate(12 244 270)"/>` : ""}
      ${main ? `<image class="ga-main" href="${main}" x="88" y="130" width="124" height="124"/>` : ""}
      <rect width="300" height="400" fill="url(#bg-${uid})" opacity="0" />
    </svg>`;
  }

  function gameCardHTML(g) {
    const badge = g.badge
      ? `<span class="game-badge badge-${g.badge}">${
          { hot: "🔥 HOT", new: "NOVO", demo: "JOGÁVEL" }[g.badge]
        }</span>`
      : "";
    return `<div class="game-card" data-game="${g.id}">
      ${badge}
      <div class="game-art">${cardArtSVG(g)}</div>
      <div class="game-info">
        <div class="game-name">${g.name}</div>
        <div class="game-provider">${g.provider}</div>
      </div>
      <div class="game-play"><span>▶</span></div>
    </div>`;
  }

  const ROWS = [
    { key: "originals", title: "🐲 Yoshi Originals", filter: (g) => g.provider === "Yoshi Originals" },
    { key: "all", title: "🔥 Populares", filter: (g) => g.cats.includes("all") },
    { key: "casino", title: "🎰 Slots", filter: (g) => g.cats.includes("slots") },
    { key: "crash", title: "🚀 Crash", filter: (g) => g.cats.includes("crash") },
    { key: "live", title: "🎥 Ao Vivo", filter: (g) => g.cats.includes("live") },
    { key: "table", title: "🃏 Mesa", filter: (g) => g.cats.includes("table") },
  ];

  function renderRows() {
    const container = $("#rowsContainer");
    if (!GAMES.length) {
      // skeletons enquanto a API responde
      container.innerHTML = ROWS.slice(0, 3)
        .map(
          () => `<section class="game-row">
            <div class="row-head"><h3>&nbsp;</h3></div>
            <div class="row-track">${'<div class="skeleton-card"></div>'.repeat(7)}</div>
          </section>`
        )
        .join("");
      return;
    }
    container.innerHTML = ROWS.map((row) => {
      const games = GAMES.filter(row.filter);
      if (!games.length) return "";
      const seeAll = row.key !== "all"
        ? `<button class="row-see" data-view-btn="${row.key}">Ver todos ›</button>`
        : "";
      return `<section class="game-row" data-row="${row.key}">
        <div class="row-head">
          <h3>${row.title}</h3>
          <div class="row-actions">
            ${seeAll}
            <button class="row-arrow" data-scroll="-1" aria-label="Anterior">‹</button>
            <button class="row-arrow" data-scroll="1" aria-label="Próximo">›</button>
          </div>
        </div>
        <div class="row-track">${games.map(gameCardHTML).join("")}</div>
      </section>`;
    }).join("");
  }

  // Setas das fileiras
  document.addEventListener("click", (e) => {
    const arrow = e.target.closest("[data-scroll]");
    if (!arrow) return;
    const track = arrow.closest(".game-row").querySelector(".row-track");
    track.scrollBy({ left: Number(arrow.dataset.scroll) * track.clientWidth * 0.8, behavior: "smooth" });
  });

  let searchTerm = "";

  function openCatalog(cat, title) {
    const list =
      cat === "originals"
        ? GAMES.filter((g) => g.provider === "Yoshi Originals")
        : GAMES.filter((g) => g.cats.includes(cat));
    $("#gridTitle").textContent = title;
    $("#gamesCount").textContent = `${list.length} jogos`;
    $("#gamesGrid").innerHTML = list.map(gameCardHTML).join("");
  }

  function openSearch(term) {
    const t = term.toLowerCase();
    const list = GAMES.filter(
      (g) => g.name.toLowerCase().includes(t) || g.provider.toLowerCase().includes(t)
    );
    $("#gridTitle").textContent = `Resultados para "${term}"`;
    $("#gamesCount").textContent = `${list.length} jogos`;
    $("#gamesGrid").innerHTML = list.map(gameCardHTML).join("");
    ["home", "catalog", "promos", "profile", "sports", "game"].forEach((v) =>
      $(`#view-${v}`).classList.toggle("hidden", v !== "catalog")
    );
  }

  $("#searchInput").addEventListener("input", (e) => {
    searchTerm = e.target.value.trim();
    if (searchTerm) openSearch(searchTerm);
    else showView("home");
  });

  // Clique em qualquer card (fileiras ou catálogo)
  document.addEventListener("click", (e) => {
    const card = e.target.closest("[data-game]");
    if (!card) return;
    const game = GAMES.find((g) => g.id === card.dataset.game);
    if (!game || !requireLogin()) return;
    if (game.playable === "slot") return void openSlot();
    if (game.playable === "mines") return void openMines();
    $("#gameModalArt").textContent = game.emoji;
    $("#gameModalTitle").textContent = game.name;
    $("#gameModalProvider").textContent = game.provider;
    openModal("gameModal");
  });

  $("#gameModalDemoBtn").addEventListener("click", openSlot);

  /* ============ HISTÓRICO ============ */
  async function loadSportBets() {
    try {
      const data = await api("GET", "/api/sports/bets");
      const list = $("#sportBetsList");
      if (!data.bets.length) {
        list.innerHTML = '<p class="muted">Nenhuma aposta ainda. Confira a Copa 2026! ⚽</p>';
        return;
      }
      const statusChip = {
        pending: '<span class="chip-status chip-pending">Em aberto</span>',
        won: '<span class="chip-status chip-won">Ganhou</span>',
        lost: '<span class="chip-status chip-lost">Perdeu</span>',
        void: '<span class="chip-status">Anulada</span>',
      };
      list.innerHTML = data.bets
        .map(
          (b) => `<div class="history-item">
            <span>${b.match ? `${b.match.home.name} x ${b.match.away.name}` : b.match_id} · <strong>${b.pickLabel}</strong> @ ${b.odds.toFixed(2)} · R$ ${fmt(b.stake_cents)}</span>
            <span>${statusChip[b.status] || b.status} <strong class="hl-green">R$ ${fmt(b.potential_win_cents)}</strong></span>
          </div>`
        )
        .join("");
    } catch { /* silencioso */ }
  }

  async function loadHistory() {
    loadSportBets();
    try {
      const data = await api("GET", "/api/games/history");
      const list = $("#historyList");
      if (!data.rounds.length) {
        list.innerHTML = '<p class="muted">Nenhuma jogada ainda. Bora jogar? 🎰</p>';
        return;
      }
      const names = { slot: "Fortune Yoshi", mines: "Mines" };
      list.innerHTML = data.rounds
        .map((r) => {
          const net = r.win_cents - r.bet_cents;
          const cls = net >= 0 ? "history-win" : "history-loss";
          const sign = net >= 0 ? "+" : "−";
          return `<div class="history-item">
            <span>${names[r.game] || r.game} · aposta R$ ${fmt(r.bet_cents)}</span>
            <span class="${cls}">${sign} R$ ${fmt(Math.abs(net))}</span>
          </div>`;
        })
        .join("");
    } catch (err) {
      toast(err.message);
    }
  }

  /* ============ HERO / CARROSSEL ============ */
  const track = $("#carouselTrack");
  const banners = track.children.length;
  let slide = 0;
  let heroTimer;
  const dotsWrap = $("#carouselDots");
  for (let i = 0; i < banners; i++) {
    const dot = document.createElement("button");
    dot.addEventListener("click", () => goSlide(i, true));
    dotsWrap.appendChild(dot);
  }
  function goSlide(i, manual = false) {
    slide = (i + banners) % banners;
    track.style.transform = `translateX(-${slide * 100}%)`;
    [...dotsWrap.children].forEach((d, j) => d.classList.toggle("active", j === slide));
    if (manual) restartHeroTimer();
  }
  function restartHeroTimer() {
    clearInterval(heroTimer);
    heroTimer = setInterval(() => goSlide(slide + 1), 6000);
  }
  $("#heroPrev").addEventListener("click", () => goSlide(slide - 1, true));
  $("#heroNext").addEventListener("click", () => goSlide(slide + 1, true));
  restartHeroTimer();
  goSlide(0);

  /* ============ APOSTAS AO VIVO (decorativo) ============ */
  const LB_MAX = 10;

  function randomBet() {
    const name = WINNER_NAMES[Math.floor(Math.random() * WINNER_NAMES.length)];
    const masked = name.slice(0, 2) + "***";
    const game = GAMES.length
      ? GAMES[Math.floor(Math.random() * GAMES.length)]
      : { name: "Fortune Yoshi", emoji: "🐲" };
    const bet = [2, 5, 10, 20, 50, 100, 250][Math.floor(Math.random() * 7)];
    const won = Math.random() < 0.42;
    const mult = won ? (1 + Math.random() * 9) : 0;
    const profit = won ? bet * mult : -bet;
    const time = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    return { masked, game, bet, mult, profit, won, time };
  }

  function liveBetRowHTML(b, isNew = false) {
    const profitCls = b.won ? "lb-profit-win" : "lb-profit-loss";
    const profitTxt = (b.won ? "+R$ " : "−R$ ") + Math.abs(b.profit).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `<tr class="${isNew ? "lb-new" : ""}">
      <td><span class="lb-game"><span class="ico">${icon(b.game.emoji)}</span>${b.game.name}</span></td>
      <td class="lb-user">${b.masked}</td>
      <td class="lb-time hide-sm">${b.time}</td>
      <td>R$ ${b.bet.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</td>
      <td class="lb-mult hide-sm">${b.won ? b.mult.toFixed(2) + "x" : "—"}</td>
      <td class="${profitCls}">${profitTxt}</td>
    </tr>`;
  }

  function seedLiveBets() {
    $("#liveBetsBody").innerHTML = Array.from({ length: LB_MAX }, () => liveBetRowHTML(randomBet())).join("");
  }

  function pushLiveBet() {
    const body = $("#liveBetsBody");
    body.insertAdjacentHTML("afterbegin", liveBetRowHTML(randomBet(), true));
    while (body.children.length > LB_MAX) body.lastElementChild.remove();
  }

  setInterval(pushLiveBet, 2800);


  /* ============ COPA 2026 (apostas via API) ============ */
  let MATCHES = [];
  let slipSelection = null; // { matchId, pick, odds, pickLabel, matchName }

  const fmtKickoff = (iso) => {
    const d = new Date(iso);
    const day = d.toLocaleDateString("pt-BR", {
      weekday: "short", day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo",
    });
    const time = d.toLocaleTimeString("pt-BR", {
      hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo",
    });
    return { day: day.replace(".", "").replace(/^./, (c) => c.toUpperCase()), time };
  };

  function matchCardHTML(m, compact = false) {
    const k = fmtKickoff(m.kickoff);
    const finished = m.status === "finished";
    const liveBadge =
      m.status === "live"
        ? '<span class="live-badge"><span class="pulse-dot"></span> AO VIVO</span>'
        : finished
          ? '<span class="match-venue">Encerrado</span>'
          : `<span class="match-venue">${m.venue}</span>`;
    const middle = finished && m.result
      ? `<span class="vs vs-score">${m.result.home_score} x ${m.result.away_score}</span>`
      : '<span class="vs">VS</span>';
    const pickName = { home: m.home.name, draw: "Empate", away: m.away.name };
    const oddBtn = (label, key) =>
      `<button class="odd" ${finished ? "disabled" : ""} data-match-id="${m.id}" data-pick="${key}" data-odds="${m.odds[key]}"
        data-pick-label="${pickName[key]}" data-match-name="${m.home.name} x ${m.away.name}">
        <span>${label}</span><strong>${m.odds[key].toFixed(2)}</strong>
      </button>`;
    return `<div class="match-card ${m.featured ? "match-featured" : ""} ${compact ? "match-compact" : ""}">
      <div class="match-meta">
        <span>${k.day} · ${k.time}</span>
        ${liveBadge}
      </div>
      <div class="match-teams">
        <div class="team">${icon(m.home.flag, "flag")}<span>${m.home.name}</span></div>
        ${middle}
        <div class="team team-away"><span>${m.away.name}</span>${icon(m.away.flag, "flag")}</div>
      </div>
      <div class="match-odds">
        ${oddBtn("1", "home")}
        ${oddBtn("X", "draw")}
        ${oddBtn("2", "away")}
      </div>
    </div>`;
  }

  function renderSports() {
    const container = $("#matchesContainer");
    if (!MATCHES.length) {
      container.innerHTML = '<p class="muted">Carregando partidas…</p>';
      return;
    }
    const byDay = {};
    MATCHES.forEach((m) => {
      const day = fmtKickoff(m.kickoff).day;
      (byDay[day] ||= []).push(m);
    });
    container.innerHTML = Object.entries(byDay)
      .map(
        ([day, matches]) => `<div class="match-day">
          <h3 class="match-day-title">${day}</h3>
          <div class="match-list">${matches.map((m) => matchCardHTML(m)).join("")}</div>
        </div>`
      )
      .join("");
  }

  function renderSportsPreview() {
    if (!MATCHES.length) return void ($("#sportsPreview").innerHTML = "");
    const picks = [
      ...MATCHES.filter((m) => m.status === "live"),
      ...MATCHES.filter((m) => m.featured && m.status !== "live"),
      ...MATCHES.filter((m) => !m.featured && m.status === "upcoming"),
    ].slice(0, 3);
    $("#sportsPreview").innerHTML = `
      <div class="row-head">
        <h3>${icon("⚽")} Copa 2026 · Oitavas</h3>
        <div class="row-actions">
          <button class="row-see" data-view-btn="sports">Ver todos ›</button>
        </div>
      </div>
      <div class="row-track match-preview-track">
        ${picks.map((m) => matchCardHTML(m, true)).join("")}
      </div>`;
  }

  /* ---- Cupom de aposta ---- */
  function openSlip(sel) {
    slipSelection = sel;
    $("#bsMatch").textContent = sel.matchName;
    $("#bsPick").textContent = sel.pickLabel;
    $("#bsOdds").textContent = sel.odds.toFixed(2);
    updateSlipReturn();
    $("#betSlip").classList.remove("hidden");
  }

  function closeSlip() {
    slipSelection = null;
    $("#betSlip").classList.add("hidden");
    $$(".odd.active").forEach((o) => o.classList.remove("active"));
  }

  function updateSlipReturn() {
    if (!slipSelection) return;
    const stake = Number($("#bsStake").value) || 0;
    $("#bsReturn").textContent = `R$ ${fmt(Math.floor(stake * 100 * slipSelection.odds))}`;
    $("#bsSubmit").textContent = stake > 0 ? `Apostar R$ ${fmt(stake * 100)}` : "Fazer aposta";
  }

  $("#bsStake").addEventListener("input", updateSlipReturn);
  $("#bsClose").addEventListener("click", closeSlip);
  $$(".bs-quick button").forEach((b) =>
    b.addEventListener("click", () => {
      $("#bsStake").value = b.dataset.stake;
      updateSlipReturn();
    })
  );

  $("#bsSubmit").addEventListener("click", async () => {
    if (!slipSelection) return;
    const stakeCents = Math.round(Number($("#bsStake").value) * 100);
    if (!stakeCents || stakeCents <= 0) return void toast("Informe o valor da aposta");
    btnLoading($("#bsSubmit"), true);
    try {
      const data = await api("POST", "/api/sports/bet", {
        matchId: slipSelection.matchId,
        pick: slipSelection.pick,
        stakeCents,
      });
      setBalance(data.balanceCents);
      toast(`✅ Aposta feita: ${data.bet.pickLabel} @ ${data.bet.odds.toFixed(2)} · retorno potencial R$ ${fmt(data.bet.potential_win_cents)}`);
      closeSlip();
    } catch (err) {
      toast(err.message);
      if (/Saldo insuficiente/i.test(err.message)) openModal("depositModal");
    }
    btnLoading($("#bsSubmit"), false);
  });

  // Seleção de odds abre o cupom
  document.addEventListener("click", (e) => {
    const odd = e.target.closest(".odd");
    if (!odd || odd.disabled) return;
    if (!requireLogin()) return;
    $$(".odd.active").forEach((o) => o.classList.remove("active"));
    odd.classList.add("active");
    openSlip({
      matchId: odd.dataset.matchId,
      pick: odd.dataset.pick,
      odds: Number(odd.dataset.odds),
      pickLabel: odd.dataset.pickLabel,
      matchName: odd.dataset.matchName,
    });
  });

  /* ============ SLOT: agora é o Yoshi Fortune (js/game.js) ============ */
  const BET_STEPS = [50, 100, 200, 500, 1000, 2500, 5000]; // centavos
  function stepBet(current, delta) {
    let idx = BET_STEPS.indexOf(current) + delta;
    idx = Math.max(0, Math.min(BET_STEPS.length - 1, idx));
    return BET_STEPS[idx];
  }
  function openSlot() {
    showView("game");
    window.YoshiFortune?.enter();
  }

  /* ============ MINES ============ */
  const MINES_SIZE = 25;
  let minesBetCents = 100;
  let minesActive = false;
  let minesRevealed = new Set();
  let minesBombsShown = [];

  async function openMines() {
    closeModals();
    resetMinesUI();
    openModal("minesModal");
    try {
      const { round } = await api("GET", "/api/games/mines/active");
      if (round) {
        minesActive = true;
        minesRevealed = new Set(round.revealed);
        $("#minesMulti").textContent = `${round.multiplier.toFixed(2)}x`;
        $("#minesWin").textContent = fmt(round.cashoutCents);
        $("#minesActionBtn").textContent = "RETIRAR 💰";
        renderMinesGrid(false);
      }
    } catch { /* segue com jogo novo */ }
  }

  function resetMinesUI() {
    minesActive = false;
    minesRevealed = new Set();
    minesBombsShown = [];
    $("#minesMulti").textContent = "1.00x";
    $("#minesWin").textContent = "0,00";
    $("#minesActionBtn").textContent = "COMEÇAR";
    renderMinesGrid(true);
  }

  function renderMinesGrid(disabled) {
    $("#minesGrid").innerHTML = Array.from({ length: MINES_SIZE }, (_, i) => {
      const revealed = minesRevealed.has(i);
      const isBomb = minesBombsShown.includes(i);
      let cls = "mine-cell";
      let content = icon("💎");
      if (revealed || isBomb) {
        cls += isBomb ? " revealed-bomb" : " revealed-gem";
        content = isBomb ? icon("💣") : icon("💎");
      }
      return `<button class="${cls}" data-cell="${i}" ${disabled || revealed || isBomb ? "disabled" : ""}>${content}</button>`;
    }).join("");
  }

  $("#minesBetMinus").addEventListener("click", () => {
    minesBetCents = stepBet(minesBetCents, -1);
    $("#minesBet").textContent = fmt(minesBetCents);
  });
  $("#minesBetPlus").addEventListener("click", () => {
    minesBetCents = stepBet(minesBetCents, 1);
    $("#minesBet").textContent = fmt(minesBetCents);
  });

  $("#minesActionBtn").addEventListener("click", async () => {
    try {
      if (!minesActive) {
        const data = await api("POST", "/api/games/mines/start", { betCents: minesBetCents });
        minesActive = true;
        minesRevealed = new Set();
        minesBombsShown = [];
        setBalance(data.balanceCents);
        $("#minesActionBtn").textContent = "RETIRAR 💰";
        renderMinesGrid(false);
      } else {
        const data = await api("POST", "/api/games/mines/cashout");
        setBalance(data.balanceCents);
        minesBombsShown = data.bombs;
        renderMinesGrid(true);
        minesActive = false;
        $("#minesActionBtn").textContent = "COMEÇAR";
        toast(`💰 Você retirou R$ ${fmt(data.winCents)} (${data.multiplier.toFixed(2)}x)!`);
      }
    } catch (err) {
      toast(err.message);
      if (/Saldo insuficiente/i.test(err.message)) openModal("depositModal");
    }
  });

  $("#minesGrid").addEventListener("click", async (e) => {
    const cell = e.target.closest("[data-cell]");
    if (!cell || !minesActive || cell.disabled) return;
    const i = Number(cell.dataset.cell);
    try {
      const data = await api("POST", "/api/games/mines/reveal", { cell: i });
      minesRevealed.add(i);

      if (data.outcome === "bomb") {
        minesBombsShown = data.bombs;
        minesActive = false;
        setBalance(data.balanceCents);
        renderMinesGrid(true);
        $("#minesMulti").textContent = "0.00x";
        $("#minesWin").textContent = "0,00";
        $("#minesActionBtn").textContent = "COMEÇAR";
        toast("💥 BOOM! Você perdeu. Tente de novo!");
        return;
      }

      if (data.outcome === "cashout") {
        minesBombsShown = data.bombs;
        minesActive = false;
        setBalance(data.balanceCents);
        renderMinesGrid(true);
        $("#minesActionBtn").textContent = "COMEÇAR";
        toast(`🏆 INCRÍVEL! Limpou o campo e ganhou R$ ${fmt(data.winCents)}!`);
        return;
      }

      $("#minesMulti").textContent = `${data.multiplier.toFixed(2)}x`;
      $("#minesWin").textContent = fmt(data.cashoutCents);
      renderMinesGrid(false);
    } catch (err) {
      toast(err.message);
    }
  });

  /* ============ BRIDGE (js/game.js) ============ */
  window.YB = { api, toast, requireLogin, setBalance, fmt, icon, openModal, closeModals, stepBet };
  Object.defineProperty(window.YB, "user", { get: () => user });

  /* ============ PWA ============ */
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }

  /* ============ INICIALIZAÇÃO ============ */
  (async () => {
    renderRows(); // skeletons
    seedLiveBets();
    renderSports();

    try {
      const [gamesData, matchesData] = await Promise.all([
        api("GET", "/api/games"),
        api("GET", "/api/sports/matches"),
      ]);
      GAMES = gamesData.games;
      MATCHES = matchesData.matches;
    } catch (err) {
      toast(err.message);
    }
    renderRows();
    seedLiveBets();
    renderSports();
    renderSportsPreview();

    if (token) {
      try {
        const { user: me } = await api("GET", "/api/auth/me");
        setLoggedIn(me);
      } catch { /* token expirado — segue deslogado */ }
    }
  })();
})();
