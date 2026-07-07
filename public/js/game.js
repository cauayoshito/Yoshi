/* ============================================================
   Yoshi Fortune — frontend do jogo (Bloco 3)
   Toda a matemática roda no servidor (/api/slots/*); aqui é só
   animação de reels, HUD, autoplay e provably fair.
   ============================================================ */

(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const { api, toast, requireLogin, setBalance, fmt, money, icon } = window.YB;
  const S = window.YoshiSound;

  // Multi-jogo: tudo vem da config da engine (símbolos, tema, paytable).
  let GAME_ID = "yoshi-fortune";
  let config = null;         // GameConfig do jogo atual
  let SYMBOL_EMOJI = {};      // display.symbols
  let SYMBOL_NAME = {};       // display.labels
  let ALL_SYMBOLS = [];       // config.symbols
  let CATALOG = [];           // cache do /api/slots/games

  let betCents = 100;
  let spinning = false;
  let autoplay = false;
  let freeSpinsLeft = 0;

  const randSym = () => ALL_SYMBOLS[Math.floor(Math.random() * ALL_SYMBOLS.length)] || "❔";
  const cellHTML = (sym) => icon(SYMBOL_EMOJI[sym] || "❔", "yf-sym");

  function applyGame(game) {
    config = game.config;
    GAME_ID = game.id;
    ALL_SYMBOLS = config.symbols;
    SYMBOL_EMOJI = config.display?.symbols || {};
    SYMBOL_NAME = config.display?.labels || {};
    const iconSym = config.wild || config.scatter?.symbol || config.symbols[0];
    $("#yfTitle").innerHTML = `${icon(SYMBOL_EMOJI[iconSym] || "🎰")} ${game.name}`;
    const frame = $(".yf-frame");
    if (config.display?.gradient) frame.style.background = config.display.gradient;
    if (config.display?.accent) frame.style.borderColor = config.display.accent + "8c";
  }

  /* ============ RENDER ============ */

  function renderGrid(symbols) {
    $("#yfGrid").innerHTML = symbols
      .map((s, i) => `<div class="yf-cell" data-i="${i}">${cellHTML(s)}</div>`)
      .join("");
  }

  function renderPaytable() {
    if (!config) return;
    $("#yfPaytable").innerHTML = config.paytable
      .map(
        (p) => `<div class="yf-pay-row">
          <span class="yf-pay-sym">${icon(SYMBOL_EMOJI[p.symbol], "yf-pay-ico")} ${SYMBOL_NAME[p.symbol] || p.symbol}</span>
          <strong>${p.multiplier}x</strong>
        </div>`
      )
      .join("");
  }

  function pushHistory(spin) {
    const list = $("#yfHistory");
    if (list.querySelector("p")) list.innerHTML = "";
    const net = spin.payoutCents - (spin.isFreeSpin ? 0 : spin.betCents);
    const row = document.createElement("div");
    row.className = "yf-hist-row";
    row.innerHTML = `
      <span class="${net >= 0 ? "hl-green" : "yf-hist-loss"}">${net >= 0 ? "+" : "−"}${money(Math.abs(net))}</span>
      <span class="yf-hist-meta">${spin.isFreeSpin ? "grátis" : money(spin.betCents)}${spin.result.featureMultiplier > 1 ? ` · x${spin.result.featureMultiplier}` : ""}</span>
      <button class="yf-verify-link" data-round="${spin.roundId}">Verificar</button>`;
    list.prepend(row);
    while (list.children.length > 8) list.lastElementChild.remove();
  }

  function setFsBanner() {
    $("#yfFsBanner").classList.toggle("hidden", freeSpinsLeft <= 0);
    $("#yfFsCount").textContent = freeSpinsLeft;
    $("#yfSpinBtn").textContent = freeSpinsLeft > 0 ? `GIRAR GRÁTIS (${freeSpinsLeft})` : "GIRAR";
    $("#yfBetMinus").disabled = freeSpinsLeft > 0;
    $("#yfBetPlus").disabled = freeSpinsLeft > 0;
  }

  function burst(text, cls = "") {
    const el = $("#yfBurst");
    el.textContent = text;
    el.className = `yf-burst ${cls}`;
    void el.offsetWidth; // reinicia a animação
    el.classList.add("show");
    setTimeout(() => el.classList.add("hidden"), 1700);
  }

  /* ============ ANIMAÇÃO DE REELS ============ */

  function startReels() {
    document.querySelectorAll(".yf-cell").forEach((c) => c.classList.add("yf-spinning"));
    return setInterval(() => {
      document.querySelectorAll(".yf-cell.yf-spinning").forEach((c) => {
        c.innerHTML = cellHTML(randSym());
      });
    }, 70);
  }

  function stopReelColumn(col, finalGrid, winCells, cols = 3, rows = 3) {
    for (let row = 0; row < rows; row++) {
      const i = row * cols + col;
      const cell = document.querySelector(`.yf-cell[data-i="${i}"]`);
      if (!cell) continue;
      cell.classList.remove("yf-spinning");
      cell.classList.add("yf-stop");
      cell.innerHTML = cellHTML(finalGrid[i]);
      if (winCells.has(i)) cell.classList.add("yf-win");
      setTimeout(() => cell.classList.remove("yf-stop"), 450);
    }
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Animação de cascata (jogos scatter-tumble): destaca ganhos e faz cair. */
  async function playTumbles(spin) {
    const tumbles = spin.result.tumbles || [];
    let gridNow = tumbles[0]?.grid || spin.result.grid;
    renderGrid(gridNow);
    for (let i = 0; i < tumbles.length; i++) {
      const t = tumbles[i];
      t.winningCells.forEach((idx) =>
        document.querySelector(`.yf-cell[data-i="${idx}"]`)?.classList.add("yf-win")
      );
      S.win(t.stepMultiplier);
      await sleep(520);
      const next = tumbles[i + 1]?.grid || spin.result.grid;
      renderGrid(next);
      document.querySelectorAll(".yf-cell").forEach((c) => c.classList.add("yf-stop"));
      await sleep(300);
      document.querySelectorAll(".yf-cell").forEach((c) => c.classList.remove("yf-stop"));
    }
  }

  /* ============ SPIN ============ */

  async function doSpin() {
    if (spinning) return;
    if (!requireLogin()) return;
    spinning = true;
    $("#yfSpinBtn").disabled = true;
    $("#yfMsg").textContent = "Girando…";
    document.querySelectorAll(".yf-cell").forEach((c) => c.classList.remove("yf-win"));

    S.spin();
    const shuffle = startReels();

    try {
      const [spin] = await Promise.all([
        api("POST", `/api/slots/${GAME_ID}/spin`, { betCents }),
        new Promise((r) => setTimeout(r, 650)),
      ]);

      const cols = config?.cols ?? 3, rows = config?.rows ?? 3;

      if (config?.kind === "scatter-tumble") {
        // para todos os reels de uma vez e roda a cascata
        clearInterval(shuffle);
        S.reelStop(0);
        await playTumbles(spin);
      } else {
        // parada coluna a coluna (paylines)
        const winCells = new Set(spin.result.lineWins.flatMap((w) => w.cells));
        for (let col = 0; col < cols; col++) {
          await new Promise((r) => setTimeout(r, 280));
          stopReelColumn(col, spin.result.grid, winCells, cols, rows);
          S.reelStop(col);
        }
        clearInterval(shuffle);
      }

      setBalance(spin.balanceCents);
      freeSpinsLeft = spin.freeSpinsLeft;
      pushHistory(spin);

      if (spin.payoutCents > 0) S.win(spin.result.totalMultiplier);
      if (spin.result.featureMultiplier > 1) {
        S.feature();
        burst(`x${spin.result.featureMultiplier}!`, "yf-burst-mult");
        await new Promise((r) => setTimeout(r, 700));
      }
      if (spin.result.freeSpinsAwarded > 0) {
        S.freeSpins();
        burst(`🎁 +${spin.result.freeSpinsAwarded} FREE SPINS`, "yf-burst-fs");
      }

      $("#yfMsg").innerHTML =
        spin.payoutCents > 0
          ? `🎉 GANHOU <strong class="hl-gold">${money(spin.payoutCents)}</strong>${spin.result.featureMultiplier > 1 ? ` (x${spin.result.featureMultiplier})` : ""}`
          : "Quase! Tente de novo 🍀";

      setFsBanner();
    } catch (err) {
      clearInterval(shuffle);
      document.querySelectorAll(".yf-cell").forEach((c) => c.classList.remove("yf-spinning"));
      $("#yfMsg").textContent = "";
      toast(err.message);
      if (/Saldo insuficiente/i.test(err.message)) {
        autoplay = false;
        $("#yfAutoBtn").classList.remove("active");
        window.YB.openModal("depositModal");
      }
    }

    spinning = false;
    $("#yfSpinBtn").disabled = false;

    // free spins rodam sozinhos; autoplay continua girando
    if (freeSpinsLeft > 0 || autoplay) {
      setTimeout(() => doSpin(), 950);
    }
  }

  /* ============ PROVABLY FAIR ============ */

  async function openFair() {
    if (!requireLogin()) return;
    window.YB.openModal("fairModal");
    $("#fairRevealed").classList.add("hidden");
    try {
      const s = await api("GET", "/api/fair/seeds");
      $("#fairHash").textContent = s.serverSeedHash;
      $("#fairClient").textContent = s.clientSeed;
      $("#fairNonce").textContent = s.nonce;
    } catch (err) {
      toast(err.message);
    }
  }

  $("#fairRotateBtn").addEventListener("click", async () => {
    try {
      const r = await api("POST", "/api/fair/rotate", {
        clientSeed: $("#fairNewClient").value.trim() || undefined,
      });
      $("#fairRevealedSeed").textContent = r.revealed.serverSeed;
      $("#fairRevealed").classList.remove("hidden");
      $("#fairHash").textContent = r.current.serverSeedHash;
      $("#fairClient").textContent = r.current.clientSeed;
      $("#fairNonce").textContent = r.current.nonce;
      $("#fairNewClient").value = "";
      toast("🛡️ Seed revelado! Rodadas anteriores agora são verificáveis.");
    } catch (err) {
      toast(err.message);
    }
  });

  async function sha256Hex(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function openVerify(roundId) {
    window.YB.openModal("verifyModal");
    $("#vfRoundId").textContent = `#${roundId}`;
    $("#vfBody").innerHTML = '<p class="muted">Carregando…</p>';
    try {
      const v = await api("GET", `/api/slots/verify/${roundId}`);
      const gridHTML = `<div class="vf-grid">${v.result.grid
        .map((s, i) => {
          const win = v.result.lineWins.some((w) => w.cells.includes(i));
          return `<div class="vf-cell ${win ? "yf-win" : ""}">${cellHTML(s)}</div>`;
        })
        .join("")}</div>`;

      let seedBlock;
      if (v.fair.serverSeed) {
        const hashOk = (await sha256Hex(v.fair.serverSeed)) === v.fair.serverSeedHash;
        seedBlock = `
          <div class="fair-field fair-ok"><span>Server seed (revelado)</span><code>${v.fair.serverSeed}</code></div>
          <p class="${hashOk ? "hl-green" : "yf-hist-loss"}" style="font-weight:700;font-size:.85rem">
            ${hashOk ? "✅ sha256(serverSeed) confere com o hash publicado — verificado neste navegador" : "❌ Hash NÃO confere!"}
          </p>`;
      } else {
        seedBlock = `<p class="muted">Server seed ainda não revelado — rotacione seus seeds em 🛡️ Fairness para liberar a auditoria desta rodada.</p>`;
      }

      $("#vfBody").innerHTML = `
        ${gridHTML}
        <div class="fair-field"><span>Resultado</span><code>${v.payoutCents > 0 ? `+${money(v.payoutCents)} (${v.result.totalMultiplier}x)` : "sem prêmio"}</code></div>
        <div class="fair-field"><span>Server seed (hash)</span><code>${v.fair.serverSeedHash}</code></div>
        <div class="fair-field"><span>Client seed</span><code>${v.fair.clientSeed}</code></div>
        <div class="fair-field"><span>Nonce</span><code>${v.fair.nonce}</code></div>
        ${seedBlock}
        <p class="muted" style="margin-top:10px">Reprodução independente: <code style="font-size:.7rem">playSpin(config, new ProvablyFairRNG(serverSeed, clientSeed, nonce))</code> na engine open-source.</p>`;
    } catch (err) {
      $("#vfBody").innerHTML = `<p class="yf-hist-loss">${err.message}</p>`;
    }
  }

  /* ============ EVENTOS ============ */

  $("#yfSpinBtn").addEventListener("click", doSpin);

  $("#yfAutoBtn").addEventListener("click", () => {
    autoplay = !autoplay;
    $("#yfAutoBtn").classList.toggle("active", autoplay);
    $("#yfAutoBtn").textContent = autoplay ? "AUTO ●" : "AUTO";
    if (autoplay && !spinning) doSpin();
  });

  $("#yfBetMinus").addEventListener("click", () => {
    betCents = window.YB.stepBet(betCents, -1);
    $("#yfBet").textContent = fmt(betCents);
  });
  $("#yfBetPlus").addEventListener("click", () => {
    betCents = window.YB.stepBet(betCents, 1);
    $("#yfBet").textContent = fmt(betCents);
  });

  $("#yfFairBtn").addEventListener("click", openFair);

  $("#yfMuteBtn").textContent = S.muted ? "🔇" : "🔊";
  $("#yfMuteBtn").addEventListener("click", () => {
    $("#yfMuteBtn").textContent = S.toggleMute() ? "🔇" : "🔊";
  });

  document.addEventListener("click", (e) => {
    const link = e.target.closest(".yf-verify-link");
    if (link) openVerify(Number(link.dataset.round));
  });

  /* ============ ENTRADA NA VIEW ============ */

  async function enter(gameId = "yoshi-fortune") {
    autoplay = false;
    freeSpinsLeft = 0;
    $("#yfAutoBtn").classList.remove("active");
    $("#yfAutoBtn").textContent = "AUTO";

    // carrega o catálogo (uma vez) e aplica o jogo pedido
    try {
      if (!CATALOG.length) CATALOG = (await api("GET", "/api/slots/games")).games;
      const game = CATALOG.find((x) => x.id === gameId) || CATALOG.find((x) => x.id === "yoshi-fortune");
      if (game) {
        applyGame(game);
        renderPaytable();
      }
    } catch { /* usa o que já tiver */ }

    const rows = config?.rows ?? 3, cols = config?.cols ?? 3;
    $("#yfGrid").style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    renderGrid(Array.from({ length: rows * cols }, randSym));
    $("#yfMsg").textContent = "Boa sorte! 🍀";
    $("#yfHistory").innerHTML = '<p class="muted">Nenhuma rodada ainda</p>';

    // retoma free spins pendentes
    if (window.YB.user) {
      try {
        const rounds = await api("GET", "/api/slots/rounds");
        const mine = rounds.rounds.filter((r) => r.game_id === GAME_ID);
        if (mine.length) {
          $("#yfHistory").innerHTML = "";
          mine.slice(0, 8).reverse().forEach((r) =>
            pushHistory({
              roundId: r.id,
              payoutCents: r.payout_cents,
              betCents: r.bet_cents,
              isFreeSpin: r.is_free_spin,
              result: r.result,
            })
          );
        }
      } catch { /* histórico opcional */ }
    }
    setFsBanner();
  }

  window.YoshiFortune = { enter };
})();
