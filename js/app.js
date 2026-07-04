/* ============================================================
   YOSHI BET — Lógica da plataforma (demo front-end)
   Saldo, autenticação e histórico ficam no localStorage.
   Nenhum dinheiro real envolvido.
   ============================================================ */

(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];

  const STORAGE_KEY = "yoshibet_state";

  const state = loadState();

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) { /* estado corrompido — recomeça */ }
    return { user: null, balance: 0, history: [] };
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  const fmt = (v) =>
    v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  /* ============ TOAST ============ */
  let toastTimer;
  function toast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add("hidden"), 3200);
  }

  /* ============ UI DE AUTENTICAÇÃO / SALDO ============ */
  function refreshUI() {
    const logged = !!state.user;
    $("#authButtons").classList.toggle("hidden", logged);
    $("#userArea").classList.toggle("hidden", !logged);
    $("#balanceValue").textContent = fmt(state.balance);
    $("#profileBalance").textContent = fmt(state.balance);
    if (state.user) {
      $("#profileName").textContent = state.user.name;
      $("#profileEmail").textContent = state.user.email;
    }
    renderHistory();
  }

  function requireLogin() {
    if (state.user) return true;
    toast("Faça login ou cadastre-se para jogar 🚀");
    openModal("registerModal");
    return false;
  }

  function credit(amount) {
    state.balance = Math.round((state.balance + amount) * 100) / 100;
    saveState();
    refreshUI();
  }

  function debit(amount) {
    if (state.balance < amount) {
      toast("Saldo insuficiente. Deposite para continuar 💰");
      openModal("depositModal");
      return false;
    }
    state.balance = Math.round((state.balance - amount) * 100) / 100;
    saveState();
    refreshUI();
    return true;
  }

  function addHistory(game, bet, win) {
    state.history.unshift({ game, bet, win, at: Date.now() });
    state.history = state.history.slice(0, 30);
    saveState();
    renderHistory();
  }

  function renderHistory() {
    const list = $("#historyList");
    if (!state.history.length) {
      list.innerHTML = '<p class="muted">Nenhuma jogada ainda. Bora jogar? 🎰</p>';
      return;
    }
    list.innerHTML = state.history
      .map((h) => {
        const net = h.win - h.bet;
        const cls = net >= 0 ? "history-win" : "history-loss";
        const sign = net >= 0 ? "+" : "−";
        return `<div class="history-item">
          <span>${h.game} · aposta R$ ${fmt(h.bet)}</span>
          <span class="${cls}">${sign} R$ ${fmt(Math.abs(net))}</span>
        </div>`;
      })
      .join("");
  }

  /* ============ NAVEGAÇÃO ENTRE VIEWS ============ */
  const VIEWS = ["home", "promos", "profile"];

  function showView(name) {
    // casino/live/crash abrem a home filtrada na categoria
    const catMap = { casino: "slots", live: "live", crash: "crash" };
    let target = name;
    if (catMap[name]) {
      target = "home";
      setCategory(catMap[name]);
    } else if (name === "home") {
      setCategory("all");
    }
    if (name === "profile" && !state.user) return void requireLogin();

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
  }

  document.addEventListener("click", (e) => {
    const opener = e.target.closest("[data-modal]");
    if (opener) {
      e.preventDefault();
      const id = opener.dataset.modal;
      if (id === "depositModal" && !state.user) return void requireLogin();
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

  /* ============ LOGIN / CADASTRO (demo) ============ */
  $("#registerForm").addEventListener("submit", (e) => {
    e.preventDefault();
    state.user = { name: $("#regName").value.trim(), email: $("#regEmail").value.trim() };
    saveState();
    refreshUI();
    closeModals();
    toast(`Bem-vindo, ${state.user.name}! 🎉 Faça seu primeiro depósito e ganhe 100% de bônus.`);
    openModal("depositModal");
  });

  $("#loginForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const email = $("#loginEmail").value.trim();
    state.user = { name: email.split("@")[0], email };
    saveState();
    refreshUI();
    closeModals();
    toast(`Bem-vindo de volta, ${state.user.name}! 🍀`);
  });

  $("#logoutBtn").addEventListener("click", () => {
    state.user = null;
    saveState();
    refreshUI();
    showView("home");
    toast("Você saiu da conta. Até logo! 👋");
  });

  $("#avatarBtn").addEventListener("click", () => showView("profile"));
  $("#balanceChip").addEventListener("click", () => showView("profile"));

  $("#withdrawBtn").addEventListener("click", () => {
    if (state.balance <= 0) return void toast("Sem saldo para sacar 😅");
    toast(`Demo: saque de R$ ${fmt(state.balance)} solicitado via PIX ⚡`);
    state.balance = 0;
    saveState();
    refreshUI();
  });

  /* ============ DEPÓSITO PIX (demo) ============ */
  let depositValue = 50;
  let pixTimer = null;

  function updateBonusNote() {
    $("#bonusNote").innerHTML =
      `🎁 Você receberá <strong>+R$ ${fmt(Math.min(depositValue, 500))} de bônus</strong> (100%)`;
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

  $("#generatePixBtn").addEventListener("click", () => {
    if (depositValue < 20) return void toast("Depósito mínimo: R$ 20");
    const code = `00020126580014BR.GOV.BCB.PIX0136${crypto.randomUUID()}5204000053039865406${depositValue.toFixed(2)}5802BR5909YOSHI BET6009SAO PAULO`;
    $("#pixCode").value = code;
    $("#pixArea").classList.remove("hidden");
    clearTimeout(pixTimer);
    // Demo: confirma o "pagamento" sozinho após alguns segundos
    pixTimer = setTimeout(() => {
      const bonus = Math.min(depositValue, 500);
      credit(depositValue + bonus);
      closeModals();
      $("#pixArea").classList.add("hidden");
      toast(`✅ Depósito de R$ ${fmt(depositValue)} confirmado + R$ ${fmt(bonus)} de bônus!`);
    }, 4000);
  });

  $("#copyPixBtn").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("#pixCode").value);
      toast("Código PIX copiado! 📋");
    } catch (_) {
      $("#pixCode").select();
      document.execCommand("copy");
      toast("Código PIX copiado! 📋");
    }
  });

  /* ============ GRADE DE JOGOS ============ */
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
    // Com busca ativa, procura no catálogo inteiro; sem busca, filtra pela categoria
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
    $("#gridTitle").textContent = searchTerm ? `🔍 Resultados para "${searchTerm}"` : CAT_TITLES[currentCat];
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
    // Placeholder para jogos de provedores externos
    $("#gameModalArt").textContent = game.emoji;
    $("#gameModalTitle").textContent = game.name;
    $("#gameModalProvider").textContent = game.provider;
    openModal("gameModal");
  });

  $("#gameModalDemoBtn").addEventListener("click", openSlot);

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

  /* ============ TICKER DE GANHADORES ============ */
  function buildWinners() {
    const items = [];
    for (let i = 0; i < 14; i++) {
      const name = WINNER_NAMES[Math.floor(Math.random() * WINNER_NAMES.length)];
      const game = GAMES[Math.floor(Math.random() * GAMES.length)];
      const value = (Math.random() * 4900 + 100).toFixed(2);
      items.push(
        `<span class="winner-item">💵 <em>${name}</em> ganhou <strong>R$ ${Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</strong> em ${game.name}</span>`
      );
    }
    // duplica para o loop do ticker ficar contínuo
    $("#winnersTrack").innerHTML = items.join("") + items.join("");
  }
  buildWinners();
  setInterval(buildWinners, 30000);

  /* ============ SLOT: FORTUNE YOSHI ============ */
  let slotBet = 1;
  let spinning = false;

  function openSlot() {
    closeModals();
    renderSlotGrid(randomSlotSymbols());
    $("#slotMsg").textContent = "Boa sorte! 🍀";
    openModal("slotModal");
  }

  function randomSlotSymbols() {
    return Array.from({ length: 9 }, () => SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)]);
  }

  function renderSlotGrid(symbols, winCells = []) {
    $("#slotGrid").innerHTML = symbols
      .map((s, i) => `<div class="slot-cell ${winCells.includes(i) ? "win-cell" : ""}" data-i="${i}">${s}</div>`)
      .join("");
  }

  function updateSlotBet(delta) {
    const steps = [0.5, 1, 2, 5, 10, 25, 50];
    let idx = steps.indexOf(slotBet) + delta;
    idx = Math.max(0, Math.min(steps.length - 1, idx));
    slotBet = steps[idx];
    $("#slotBet").textContent = fmt(slotBet);
  }
  $("#slotBetMinus").addEventListener("click", () => updateSlotBet(-1));
  $("#slotBetPlus").addEventListener("click", () => updateSlotBet(1));

  const SLOT_LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8], // linhas
    [0, 4, 8], [2, 4, 6],            // diagonais
  ];
  const SYMBOL_MULT = { "🐲": 20, "7️⃣": 15, "💎": 10, "⭐": 6, "🔔": 4, "🍀": 3, "🍒": 2 };

  $("#spinBtn").addEventListener("click", () => {
    if (spinning) return;
    if (!debit(slotBet)) return;
    spinning = true;
    $("#spinBtn").disabled = true;
    $("#slotMsg").textContent = "Girando… 🎰";
    $$("#slotGrid .slot-cell").forEach((c) => c.classList.add("spinning"));

    const shuffle = setInterval(() => {
      $$("#slotGrid .slot-cell").forEach((c) => {
        c.textContent = SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)];
      });
    }, 90);

    setTimeout(() => {
      clearInterval(shuffle);
      const result = randomSlotSymbols();
      let winCells = [];
      let totalMult = 0;
      for (const line of SLOT_LINES) {
        const [a, b, c] = line.map((i) => result[i]);
        if (a === b && b === c) {
          totalMult += SYMBOL_MULT[a] || 2;
          winCells.push(...line);
        }
      }
      renderSlotGrid(result, winCells);
      const win = Math.round(slotBet * totalMult * 100) / 100;
      if (win > 0) {
        credit(win);
        $("#slotMsg").textContent = `🎉 VOCÊ GANHOU R$ ${fmt(win)}!`;
      } else {
        $("#slotMsg").textContent = "Quase! Tente de novo 🍀";
      }
      addHistory("Fortune Yoshi", slotBet, win);
      spinning = false;
      $("#spinBtn").disabled = false;
    }, 1400);
  });

  /* ============ MINES ============ */
  const MINES_SIZE = 25;
  const MINES_BOMBS = 4;
  let minesBet = 1;
  let minesActive = false;
  let minesBombs = new Set();
  let minesRevealed = new Set();

  function minesMultiplier(revealedCount) {
    // multiplicador cresce a cada gema encontrada (com margem da casa)
    let m = 1;
    for (let i = 0; i < revealedCount; i++) {
      const remainingSafe = MINES_SIZE - MINES_BOMBS - i;
      const remainingTotal = MINES_SIZE - i;
      m *= (remainingTotal / remainingSafe) * 0.97;
    }
    return m;
  }

  function openMines() {
    closeModals();
    resetMines();
    openModal("minesModal");
  }

  function resetMines() {
    minesActive = false;
    minesBombs = new Set();
    minesRevealed = new Set();
    $("#minesMulti").textContent = "1.00x";
    $("#minesWin").textContent = "0,00";
    $("#minesActionBtn").textContent = "COMEÇAR";
    renderMinesGrid(true);
  }

  function renderMinesGrid(disabled) {
    $("#minesGrid").innerHTML = Array.from({ length: MINES_SIZE }, (_, i) => {
      const isRevealed = minesRevealed.has(i);
      const isBomb = minesBombs.has(i);
      let cls = "mine-cell";
      let content = "💎";
      if (isRevealed) {
        cls += isBomb ? " revealed-bomb" : " revealed-gem";
        content = isBomb ? "💣" : "💎";
      }
      return `<button class="${cls}" data-cell="${i}" ${disabled || isRevealed ? "disabled" : ""}>${content}</button>`;
    }).join("");
  }

  function updateMinesBet(delta) {
    const steps = [0.5, 1, 2, 5, 10, 25, 50];
    let idx = steps.indexOf(minesBet) + delta;
    idx = Math.max(0, Math.min(steps.length - 1, idx));
    minesBet = steps[idx];
    $("#minesBet").textContent = fmt(minesBet);
  }
  $("#minesBetMinus").addEventListener("click", () => updateMinesBet(-1));
  $("#minesBetPlus").addEventListener("click", () => updateMinesBet(1));

  $("#minesActionBtn").addEventListener("click", () => {
    if (!minesActive) {
      if (!debit(minesBet)) return;
      minesActive = true;
      minesRevealed = new Set();
      minesBombs = new Set();
      while (minesBombs.size < MINES_BOMBS) {
        minesBombs.add(Math.floor(Math.random() * MINES_SIZE));
      }
      $("#minesActionBtn").textContent = "RETIRAR 💰";
      renderMinesGrid(false);
    } else {
      // cash out
      const mult = minesMultiplier(minesRevealed.size);
      const win = Math.round(minesBet * mult * 100) / 100;
      credit(win);
      addHistory("Mines", minesBet, win);
      toast(`💰 Você retirou R$ ${fmt(win)} (${mult.toFixed(2)}x)!`);
      // revela as bombas
      minesBombs.forEach((b) => minesRevealed.add(b));
      renderMinesGrid(true);
      minesActive = false;
      $("#minesActionBtn").textContent = "COMEÇAR";
    }
  });

  $("#minesGrid").addEventListener("click", (e) => {
    const cell = e.target.closest("[data-cell]");
    if (!cell || !minesActive) return;
    const i = Number(cell.dataset.cell);
    if (minesRevealed.has(i)) return;
    minesRevealed.add(i);

    if (minesBombs.has(i)) {
      // perdeu
      minesBombs.forEach((b) => minesRevealed.add(b));
      renderMinesGrid(true);
      minesActive = false;
      addHistory("Mines", minesBet, 0);
      $("#minesMulti").textContent = "0.00x";
      $("#minesWin").textContent = "0,00";
      $("#minesActionBtn").textContent = "COMEÇAR";
      toast("💥 BOOM! Você perdeu. Tente de novo!");
      return;
    }

    const gems = [...minesRevealed].filter((c) => !minesBombs.has(c)).length;
    const mult = minesMultiplier(gems);
    $("#minesMulti").textContent = `${mult.toFixed(2)}x`;
    $("#minesWin").textContent = fmt(Math.round(minesBet * mult * 100) / 100);
    renderMinesGrid(false);

    // ganhou tudo: revelou todas as gemas
    if (gems === MINES_SIZE - MINES_BOMBS) {
      const win = Math.round(minesBet * mult * 100) / 100;
      credit(win);
      addHistory("Mines", minesBet, win);
      toast(`🏆 INCRÍVEL! Limpou o campo e ganhou R$ ${fmt(win)}!`);
      minesActive = false;
      $("#minesActionBtn").textContent = "COMEÇAR";
    }
  });

  /* ============ INICIALIZAÇÃO ============ */
  refreshUI();
  renderGames();
})();
