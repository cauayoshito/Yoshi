/* ============================================================
   YOSHI BET — Front-end integrado à API (server/)
   Autenticação JWT, carteira e jogos rodam no servidor;
   aqui fica só interface e animação.
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

  /* ============ NAVEGAÇÃO ENTRE VIEWS ============ */
  const VIEWS = ["home", "promos", "profile"];

  function showView(name) {
    const catMap = { casino: "slots", live: "live", crash: "crash" };
    let target = name;
    if (catMap[name]) {
      target = "home";
      setCategory(catMap[name]);
    } else if (name === "home") {
      setCategory("all");
    }
    if (name === "profile") {
      if (!user) return void requireLogin();
      loadHistory();
    }

    VIEWS.forEach((v) => $(`#view-${v}`).classList.toggle("hidden", v !== target));
    $$(".nav-link").forEach((a) => a.classList.toggle("active", a.dataset.view === name));
    $$(".bnav-item[data-view]").forEach((a) => a.classList.toggle("active", a.dataset.view === name));
    $("#mainNav").classList.remove("open");
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

  $("#menuBtn").addEventListener("click", () => $("#mainNav").classList.toggle("open"));

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
    if (e.key === "Escape") closeModals();
  });

  /* ============ LOGIN / CADASTRO ============ */
  $("#registerForm").addEventListener("submit", async (e) => {
    e.preventDefault();
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
  });

  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
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
    try {
      $("#generatePixBtn").disabled = true;
      const charge = await api("POST", "/api/wallet/deposit", {
        amountCents: Math.round(depositValue * 100),
      });
      $("#pixCode").value = charge.brcode;
      $("#pixArea").classList.remove("hidden");

      // Polling até o "webhook" do PSP confirmar o pagamento
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
      $("#generatePixBtn").disabled = false;
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

  /* ============ CATÁLOGO / GRADE DE JOGOS ============ */
  let currentCat = "all";
  let searchTerm = "";

  function setCategory(cat) {
    currentCat = cat;
    $$(".cat-tab").forEach((t) => t.classList.toggle("active", t.dataset.cat === cat));
    $("#gridTitle").textContent = CAT_TITLES[cat] || "Jogos";
    renderGames();
  }

  function renderGames() {
    const term = searchTerm.toLowerCase();
    const finalList = term
      ? GAMES.filter(
          (g) => g.name.toLowerCase().includes(term) || g.provider.toLowerCase().includes(term)
        )
      : GAMES.filter((g) => g.cats.includes(currentCat));

    $("#gamesCount").textContent = `${finalList.length} jogos`;
    $("#gamesGrid").innerHTML = finalList
      .map((g) => {
        const badge = g.badge
          ? `<span class="game-badge badge-${g.badge}">${
              { hot: "🔥 HOT", new: "NOVO", demo: "JOGÁVEL" }[g.badge]
            }</span>`
          : "";
        return `<div class="game-card" data-game="${g.id}">
          ${badge}
          <div class="game-art" style="background:${g.gradient}">${g.emoji}</div>
          <div class="game-info">
            <div class="game-name">${g.name}</div>
            <div class="game-provider">${g.provider}</div>
          </div>
          <div class="game-play"><span>▶</span></div>
        </div>`;
      })
      .join("");
  }

  $("#searchInput").addEventListener("input", (e) => {
    searchTerm = e.target.value.trim();
    $("#gridTitle").textContent = searchTerm
      ? `🔍 Resultados para "${searchTerm}"`
      : CAT_TITLES[currentCat];
    renderGames();
  });

  $$(".cat-tab").forEach((t) => t.addEventListener("click", () => setCategory(t.dataset.cat)));

  $("#gamesGrid").addEventListener("click", (e) => {
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
  async function loadHistory() {
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

  /* ============ CARROSSEL ============ */
  const track = $("#carouselTrack");
  const banners = track.children.length;
  let slide = 0;
  const dotsWrap = $("#carouselDots");
  for (let i = 0; i < banners; i++) {
    const dot = document.createElement("button");
    dot.addEventListener("click", () => goSlide(i));
    dotsWrap.appendChild(dot);
  }
  function goSlide(i) {
    slide = (i + banners) % banners;
    track.style.transform = `translateX(-${slide * 100}%)`;
    [...dotsWrap.children].forEach((d, j) => d.classList.toggle("active", j === slide));
  }
  setInterval(() => goSlide(slide + 1), 6000);
  goSlide(0);

  /* ============ TICKER DE GANHADORES (decorativo) ============ */
  function buildWinners() {
    if (!GAMES.length) return;
    const items = [];
    for (let i = 0; i < 14; i++) {
      const name = WINNER_NAMES[Math.floor(Math.random() * WINNER_NAMES.length)];
      const game = GAMES[Math.floor(Math.random() * GAMES.length)];
      const value = Math.random() * 4900 + 100;
      items.push(
        `<span class="winner-item">💵 <em>${name}</em> ganhou <strong>R$ ${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong> em ${game.name}</span>`
      );
    }
    $("#winnersTrack").innerHTML = items.join("") + items.join("");
  }
  setInterval(buildWinners, 30000);

  /* ============ SLOT: FORTUNE YOSHI ============ */
  const BET_STEPS = [50, 100, 200, 500, 1000, 2500, 5000]; // centavos
  let slotBetCents = 100;
  let spinning = false;

  function openSlot() {
    closeModals();
    renderSlotGrid(Array.from({ length: 9 }, () => SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)]));
    $("#slotMsg").textContent = "Boa sorte! 🍀";
    openModal("slotModal");
  }

  function renderSlotGrid(symbols, winCells = []) {
    $("#slotGrid").innerHTML = symbols
      .map((s, i) => `<div class="slot-cell ${winCells.includes(i) ? "win-cell" : ""}">${s}</div>`)
      .join("");
  }

  function stepBet(current, delta) {
    let idx = BET_STEPS.indexOf(current) + delta;
    idx = Math.max(0, Math.min(BET_STEPS.length - 1, idx));
    return BET_STEPS[idx];
  }

  $("#slotBetMinus").addEventListener("click", () => {
    slotBetCents = stepBet(slotBetCents, -1);
    $("#slotBet").textContent = fmt(slotBetCents);
  });
  $("#slotBetPlus").addEventListener("click", () => {
    slotBetCents = stepBet(slotBetCents, 1);
    $("#slotBet").textContent = fmt(slotBetCents);
  });

  $("#spinBtn").addEventListener("click", async () => {
    if (spinning) return;
    spinning = true;
    $("#spinBtn").disabled = true;
    $("#slotMsg").textContent = "Girando… 🎰";
    $$("#slotGrid .slot-cell").forEach((c) => c.classList.add("spinning"));

    const shuffle = setInterval(() => {
      $$("#slotGrid .slot-cell").forEach((c) => {
        c.textContent = SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)];
      });
    }, 90);

    try {
      // resultado vem do servidor; animação dura ao menos 1,2s
      const [result] = await Promise.all([
        api("POST", "/api/games/slot/spin", { betCents: slotBetCents }),
        new Promise((r) => setTimeout(r, 1200)),
      ]);
      clearInterval(shuffle);
      renderSlotGrid(result.grid, result.winCells);
      setBalance(result.balanceCents);
      $("#slotMsg").textContent =
        result.winCents > 0
          ? `🎉 VOCÊ GANHOU R$ ${fmt(result.winCents)}!`
          : "Quase! Tente de novo 🍀";
    } catch (err) {
      clearInterval(shuffle);
      $$("#slotGrid .slot-cell").forEach((c) => c.classList.remove("spinning"));
      $("#slotMsg").textContent = "";
      toast(err.message);
      if (/Saldo insuficiente/i.test(err.message)) openModal("depositModal");
    }
    spinning = false;
    $("#spinBtn").disabled = false;
  });

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
    // retoma rodada ativa (ex.: recarregou a página no meio do jogo)
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
      let content = "💎";
      if (revealed || isBomb) {
        cls += isBomb ? " revealed-bomb" : " revealed-gem";
        content = isBomb ? "💣" : "💎";
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
        // limpou o campo — o servidor liquidou sozinho
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

  /* ============ INICIALIZAÇÃO ============ */
  (async () => {
    try {
      const data = await api("GET", "/api/games");
      GAMES = data.games;
    } catch (err) {
      toast(err.message);
    }
    renderGames();
    buildWinners();

    if (token) {
      try {
        const { user: me } = await api("GET", "/api/auth/me");
        setLoggedIn(me);
      } catch { /* token expirado — segue deslogado */ }
    }
  })();
})();
