/* ============================================================
   YOSHI BET — Painel administrativo com dashboards
   Gráficos em SVG puro (sem libs). Paleta das séries validada
   para daltonismo/contraste sobre a superfície escura:
   verde #00aa62 · dourado #bd8900 · azul #6f80e8
   ============================================================ */

(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];
  const TOKEN_KEY = "yoshibet_token";
  let token = localStorage.getItem(TOKEN_KEY);

  const C = { green: "#00aa62", gold: "#bd8900", blue: "#6f80e8" };

  const fmt = (cents) =>
    "R$ " + (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtShort = (cents) => {
    const v = cents / 100;
    if (Math.abs(v) >= 1000) return "R$ " + (v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "k";
    return "R$ " + v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
  };
  const fmtDay = (iso) => {
    const [, m, d] = iso.split("-");
    return `${d}/${m}`;
  };

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

  /* ============ GATE ============ */
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

  /* ============ TOOLTIP COMPARTILHADO ============ */
  const tooltip = $("#chartTooltip");
  function showTooltip(html, x, y) {
    tooltip.innerHTML = html;
    tooltip.classList.remove("hidden");
    const r = tooltip.getBoundingClientRect();
    const left = Math.min(x + 14, window.innerWidth - r.width - 10);
    const top = Math.max(10, y - r.height - 12);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }
  function hideTooltip() {
    tooltip.classList.add("hidden");
  }

  /* ============ PRIMITIVAS SVG ============ */
  const NS = "http://www.w3.org/2000/svg";
  const el = (tag, attrs = {}, parent) => {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    if (parent) parent.appendChild(node);
    return node;
  };

  function sparklineSVG(values, color, w = 96, h = 30) {
    const max = Math.max(...values, 1);
    const min = Math.min(...values, 0);
    const span = max - min || 1;
    const px = (i) => (i / (values.length - 1 || 1)) * (w - 4) + 2;
    const py = (v) => h - 3 - ((v - min) / span) * (h - 8);
    const pts = values.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`);
    const line = `M${pts.join(" L")}`;
    const area = `${line} L${px(values.length - 1).toFixed(1)},${h - 1} L${px(0).toFixed(1)},${h - 1} Z`;
    return `<svg class="kpi-spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="color:${color}" aria-hidden="true">
      <path class="spark-area" d="${area}"></path>
      <path d="${line}" stroke="${color}"></path>
    </svg>`;
  }

  /* ============ KPIs ============ */
  function pctDelta(cur, prev) {
    if (!prev) return cur ? null : 0;
    return ((cur - prev) / Math.abs(prev)) * 100;
  }

  function kpiCard({ icon, label, value, delta, spark, sparkColor }) {
    let deltaHTML = "";
    if (delta === null) deltaHTML = '<span class="kpi-delta flat">— <span class="vs">sem base anterior</span></span>';
    else {
      const cls = delta > 1 ? "up" : delta < -1 ? "down" : "flat";
      const arrow = delta > 1 ? "▲" : delta < -1 ? "▼" : "•";
      deltaHTML = `<span class="kpi-delta ${cls}">${arrow} ${Math.abs(delta).toFixed(1)}% <span class="vs">vs período anterior</span></span>`;
    }
    return `<div class="kpi-card">
      <div class="kpi-head"><span class="kpi-ico">${icon}</span><span class="kpi-label">${label}</span></div>
      <div class="kpi-value">${value}</div>
      <div class="kpi-foot">${deltaHTML}${spark ? sparklineSVG(spark, sparkColor) : ""}</div>
    </div>`;
  }

  function renderKPIs(series, stats) {
    const half = Math.floor(series.length / 2);
    const cur = series.slice(half);
    const prev = series.slice(0, half);
    const sum = (arr, k) => arr.reduce((a, r) => a + r[k], 0);

    const kpis = [
      {
        icon: "💰", label: "Depósitos no período",
        value: fmt(sum(series, "depositsCents")),
        delta: pctDelta(sum(cur, "depositsCents"), sum(prev, "depositsCents")),
        spark: series.map((r) => r.depositsCents), sparkColor: C.green,
      },
      {
        icon: "📈", label: "GGR no período",
        value: fmt(sum(series, "ggrCents")),
        delta: pctDelta(sum(cur, "ggrCents"), sum(prev, "ggrCents")),
        spark: series.map((r) => r.ggrCents), sparkColor: C.gold,
      },
      {
        icon: "🧑‍🤝‍🧑", label: "Novos usuários",
        value: String(sum(series, "newUsers")),
        delta: pctDelta(sum(cur, "newUsers"), sum(prev, "newUsers")),
        spark: series.map((r) => r.newUsers), sparkColor: C.blue,
      },
      {
        icon: "🏦", label: "Saldo dos jogadores",
        value: fmt(stats.balancesCents),
        delta: null,
        spark: null,
      },
    ];
    $("#kpiGrid").innerHTML = kpis.map(kpiCard).join("");
  }

  /* ============ GRÁFICO: FLUXO (linhas depósitos x saques) ============ */
  function renderFlowChart(series) {
    const wrap = $("#flowChart");
    wrap.innerHTML = "";
    const W = 900, H = 240, padL = 56, padR = 14, padT = 12, padB = 26;
    const iw = W - padL - padR, ih = H - padT - padB;

    const sA = series.map((r) => r.depositsCents);
    const sB = series.map((r) => r.withdrawalsCents);
    const max = Math.max(...sA, ...sB, 100) * 1.1;

    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Depósitos e saques por dia" }, wrap);
    const x = (i) => padL + (i / (series.length - 1 || 1)) * iw;
    const y = (v) => padT + ih - (v / max) * ih;

    // grid + eixo Y
    for (let g = 0; g <= 4; g++) {
      const gy = padT + (ih * g) / 4;
      el("line", { x1: padL, x2: W - padR, y1: gy, y2: gy, class: "grid-line" }, svg);
      const label = el("text", { x: padL - 8, y: gy + 3, "text-anchor": "end", class: "axis-label" }, svg);
      label.textContent = fmtShort(max * (1 - g / 4));
    }
    // eixo X (datas espaçadas)
    const step = Math.ceil(series.length / 8);
    series.forEach((r, i) => {
      if (i % step !== 0 && i !== series.length - 1) return;
      const t = el("text", { x: x(i), y: H - 8, "text-anchor": "middle", class: "axis-label" }, svg);
      t.textContent = fmtDay(r.date);
    });

    const linePath = (vals) => "M" + vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" L");
    const areaPath = (vals) =>
      linePath(vals) + ` L${x(vals.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;

    el("path", { d: areaPath(sA), fill: C.green, opacity: 0.1 }, svg);
    el("path", { d: linePath(sA), fill: "none", stroke: C.green, "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" }, svg);
    el("path", { d: linePath(sB), fill: "none", stroke: C.gold, "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" }, svg);

    // hover: crosshair + tooltip
    const cross = el("line", { y1: padT, y2: padT + ih, class: "crosshair", visibility: "hidden" }, svg);
    const dotA = el("circle", { r: 4, fill: C.green, stroke: "#12151c", "stroke-width": 2, visibility: "hidden" }, svg);
    const dotB = el("circle", { r: 4, fill: C.gold, stroke: "#12151c", "stroke-width": 2, visibility: "hidden" }, svg);
    const hit = el("rect", { x: padL, y: padT, width: iw, height: ih, fill: "transparent" }, svg);

    hit.addEventListener("mousemove", (e) => {
      const rect = svg.getBoundingClientRect();
      const relX = ((e.clientX - rect.left) / rect.width) * W;
      const i = Math.max(0, Math.min(series.length - 1, Math.round(((relX - padL) / iw) * (series.length - 1))));
      const r = series[i];
      cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i));
      cross.setAttribute("visibility", "visible");
      dotA.setAttribute("cx", x(i)); dotA.setAttribute("cy", y(sA[i])); dotA.setAttribute("visibility", "visible");
      dotB.setAttribute("cx", x(i)); dotB.setAttribute("cy", y(sB[i])); dotB.setAttribute("visibility", "visible");
      showTooltip(
        `<div class="tt-date">${fmtDay(r.date)}</div>
         <div class="tt-row"><span class="legend-swatch" style="background:${C.green}"></span>Depósitos <strong>&nbsp;${fmt(r.depositsCents)}</strong></div>
         <div class="tt-row"><span class="legend-swatch" style="background:${C.gold}"></span>Saques <strong>&nbsp;${fmt(r.withdrawalsCents)}</strong></div>`,
        e.clientX, e.clientY
      );
    });
    hit.addEventListener("mouseleave", () => {
      cross.setAttribute("visibility", "hidden");
      dotA.setAttribute("visibility", "hidden");
      dotB.setAttribute("visibility", "hidden");
      hideTooltip();
    });

    $("#flowLegend").innerHTML = `
      <span class="legend-item"><span class="legend-swatch" style="background:${C.green}"></span>Depósitos</span>
      <span class="legend-item"><span class="legend-swatch" style="background:${C.gold}"></span>Saques</span>`;
  }

  /* ============ GRÁFICO: GGR (barras divergentes) ============ */
  function renderGGRChart(series) {
    const wrap = $("#ggrChart");
    wrap.innerHTML = "";
    const W = 440, H = 220, padL = 52, padR = 10, padT = 12, padB = 26;
    const iw = W - padL - padR, ih = H - padT - padB;

    const vals = series.map((r) => r.ggrCents);
    const maxAbs = Math.max(...vals.map(Math.abs), 100) * 1.15;

    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "GGR diário" }, wrap);
    const zeroY = padT + ih / 2;
    const y = (v) => zeroY - (v / maxAbs) * (ih / 2);
    const bw = Math.min(22, (iw / series.length) * 0.72);

    for (const gv of [maxAbs, 0, -maxAbs]) {
      const gy = y(gv);
      el("line", { x1: padL, x2: W - padR, y1: gy, y2: gy, class: gv === 0 ? "zero-line" : "grid-line" }, svg);
      const t = el("text", { x: padL - 8, y: gy + 3, "text-anchor": "end", class: "axis-label" }, svg);
      t.textContent = fmtShort(gv);
    }

    const step = Math.ceil(series.length / 7);
    series.forEach((r, i) => {
      const cx = padL + ((i + 0.5) / series.length) * iw;
      if (i % step === 0 || i === series.length - 1) {
        const t = el("text", { x: cx, y: H - 8, "text-anchor": "middle", class: "axis-label" }, svg);
        t.textContent = fmtDay(r.date);
      }
      const v = vals[i];
      const barY = v >= 0 ? y(v) : zeroY;
      const barH = Math.max(1.5, Math.abs(y(v) - zeroY));
      // positivo = casa lucrou (verde) · negativo = casa pagou mais (azul)
      const bar = el("rect", {
        x: cx - bw / 2, y: barY, width: bw, height: barH, rx: 3,
        fill: v >= 0 ? C.green : C.blue,
      }, svg);
      bar.addEventListener("mousemove", (e) =>
        showTooltip(
          `<div class="tt-date">${fmtDay(r.date)}</div>
           <div class="tt-row">GGR <strong>&nbsp;${fmt(v)}</strong></div>
           <div class="tt-row" style="color:var(--text-3)">${r.casinoRounds} rodadas · ${r.sportBets} apostas</div>`,
          e.clientX, e.clientY
        )
      );
      bar.addEventListener("mouseleave", hideTooltip);
    });
  }

  /* ============ GRÁFICO: DONUT PRODUTOS ============ */
  function renderProductChart(products) {
    const wrap = $("#productChart");
    wrap.innerHTML = "";
    const items = [
      { key: "slot", label: "Fortune Yoshi", color: C.green },
      { key: "mines", label: "Mines", color: C.gold },
      { key: "sports", label: "Esportes", color: C.blue },
    ].map((it) => ({ ...it, value: products[it.key]?.stakeCents || 0 }));
    const total = items.reduce((a, i) => a + i.value, 0) || 1;

    const size = 168, r = 62, cx = size / 2, cy = size / 2;
    const circ = 2 * Math.PI * r;
    const svg = el("svg", { viewBox: `0 0 ${size} ${size}`, width: size, height: size, role: "img", "aria-label": "Volume apostado por produto" }, wrap);

    let offset = 0;
    const gap = 2.5; // px de respiro entre segmentos
    for (const it of items) {
      if (!it.value) continue;
      const frac = it.value / total;
      const len = Math.max(0, frac * circ - gap);
      const seg = el("circle", {
        cx, cy, r, fill: "none", stroke: it.color, "stroke-width": 22,
        "stroke-dasharray": `${len} ${circ - len}`,
        "stroke-dashoffset": -offset,
        transform: `rotate(-90 ${cx} ${cy})`,
      }, svg);
      seg.addEventListener("mousemove", (e) =>
        showTooltip(
          `<div class="tt-row"><span class="legend-swatch" style="background:${it.color}"></span>${it.label}
           <strong>&nbsp;${fmt(it.value)}</strong>&nbsp;(${((it.value / total) * 100).toFixed(1)}%)</div>`,
          e.clientX, e.clientY
        )
      );
      seg.addEventListener("mouseleave", hideTooltip);
      offset += frac * circ;
    }
    const l1 = el("text", { x: cx, y: cy - 6, "text-anchor": "middle", class: "donut-center-label" }, svg);
    l1.textContent = "APOSTADO";
    const l2 = el("text", { x: cx, y: cy + 14, "text-anchor": "middle", class: "donut-center-value" }, svg);
    l2.textContent = fmtShort(total);

    const legend = document.createElement("div");
    legend.className = "donut-legend";
    legend.innerHTML = items
      .map(
        (it) => `<div class="donut-row">
          <span class="legend-swatch" style="background:${it.color}"></span>${it.label}
          <span class="pct">${((it.value / total) * 100).toFixed(0)}%</span>
          <span class="val">${fmtShort(it.value)}</span>
        </div>`
      )
      .join("");
    wrap.appendChild(legend);
  }

  /* ============ TOP JOGADORES ============ */
  function renderTopPlayers(top) {
    const maxDep = Math.max(...top.byDeposits.map((p) => p.total_cents), 1);
    const maxProfit = Math.max(...top.byHouseProfit.map((p) => p.profit_cents), 1);
    const col = (title, rows, max, color, key) => `
      <div>
        <div class="top-col-title">${title}</div>
        ${rows.length ? rows.map((p, i) => `
          <div class="top-row"><span class="top-rank">${i + 1}</span>${p.name}<span class="val">${fmt(p[key])}</span></div>
          <div class="top-bar"><i style="width:${Math.max(4, (p[key] / max) * 100)}%;background:${color}"></i></div>
        `).join("") : '<p class="muted">Sem dados ainda</p>'}
      </div>`;
    $("#topPlayers").innerHTML = `<div class="top-cols">
      ${col("Maiores depositantes", top.byDeposits, maxDep, C.green, "total_cents")}
      ${col("Maior receita p/ casa", top.byHouseProfit, maxProfit, C.gold, "profit_cents")}
    </div>`;
  }

  /* ============ TABELAS ============ */
  function renderMatches(matches) {
    const pill = {
      upcoming: '<span class="status-pill pill-upcoming">Agendada</span>',
      live: '<span class="status-pill pill-live">● Ao vivo</span>',
      finished: '<span class="status-pill pill-finished">Encerrada</span>',
    };
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
          <td>${name}</td><td>${ko}</td><td>${pill[m.status] || m.status}</td>
          <td>${m.bets}</td><td>${fmt(m.stakedCents)}</td><td>${resultCell}</td>
        </tr>`;
      })
      .join("");
  }

  let allUsers = [];
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
          <td>${String(u.created_at).slice(0, 16).replace("T", " ")}</td>
        </tr>`
      )
      .join("") || '<tr><td colspan="8" class="muted">Nenhum usuário encontrado</td></tr>';
  }

  $("#userSearch").addEventListener("input", (e) => {
    const t = e.target.value.trim().toLowerCase();
    renderUsers(
      t ? allUsers.filter((u) => u.name.toLowerCase().includes(t) || u.email.toLowerCase().includes(t)) : allUsers
    );
  });

  function renderTx(transactions) {
    const meta = {
      deposit: { label: "Depósito", color: C.green },
      bonus: { label: "Bônus", color: C.gold },
      withdraw: { label: "Saque", color: C.blue },
      bet: { label: "Aposta", color: "#5d6579" },
      win: { label: "Prêmio", color: C.green },
    };
    $("#txBody").innerHTML = transactions
      .map((t) => {
        const m = meta[t.type] || { label: t.type, color: "#5d6579" };
        return `<tr>
          <td>#${t.id}</td>
          <td>${t.user_name}</td>
          <td><span class="tx-type"><span class="tx-dot" style="background:${m.color}"></span>${m.label}</span></td>
          <td class="${t.amount_cents >= 0 ? "tx-pos" : "tx-neg"}">${t.amount_cents >= 0 ? "+" : ""}${fmt(t.amount_cents)}</td>
          <td>${String(t.created_at).slice(0, 16).replace("T", " ")}</td>
        </tr>`;
      })
      .join("");
  }

  // Liquidação manual
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


  /* ============ SLOTS ENGINE (Bloco 4) ============ */
  let currentCfgGame = null;

  function renderEngine(games) {
    $("#seGames").innerHTML = games
      .map((g) => {
        const target = Number(g.target_rtp);
        const real = g.realizedRtp;
        const real24 = g.realizedRtp24h;
        const pct = (v) => (v == null ? "—" : (v * 100).toFixed(2) + "%");
        // barra: escala 80–110% para o desvio ficar legível
        const scale = (v) => Math.max(0, Math.min(100, ((v - 0.8) / 0.3) * 100));
        return `<div class="se-card">
          <div class="se-card-head">
            <h3>${g.name}</h3>
            <span class="se-version">v${g.version}</span>
            <span class="status-pill ${g.active ? "pill-live" : "pill-finished"}">${g.active ? "Ativo" : "Inativo"}</span>
          </div>
          <div class="se-rtp-row"><span>RTP realizado (total)</span><strong>${pct(real)}</strong></div>
          <div class="se-rtp-bar">
            ${real != null ? `<div class="se-rtp-fill" style="width:${scale(real)}%"></div>` : ""}
            <div class="se-rtp-target" style="left:${scale(target)}%" title="alvo ${pct(target)}"></div>
          </div>
          <div class="se-rtp-row"><span>Alvo ${pct(target)} · 24h ${pct(real24)}</span><span>${g.volatility}</span></div>
          <div class="se-stats">
            <div class="se-stat"><div class="lbl">Rodadas</div><div class="val">${Number(g.rounds).toLocaleString("pt-BR")}</div></div>
            <div class="se-stat"><div class="lbl">GGR</div><div class="val">${fmt(g.ggrCents)}</div></div>
            <div class="se-stat"><div class="lbl">Sessões 15min</div><div class="val">${g.active_sessions}</div></div>
          </div>
          <div class="se-actions">
            <button class="btn btn-primary" data-cfg="${g.id}" data-name="${g.name}">⚙️ Editar config</button>
            <button class="btn btn-ghost" data-toggle="${g.id}" data-active="${g.active}">${g.active ? "Desativar" : "Ativar"}</button>
          </div>
        </div>`;
      })
      .join("");
  }

  function renderEngineRounds(rounds) {
    $("#seRoundsBody").innerHTML = rounds
      .map(
        (r) => `<tr>
          <td>#${r.id}</td>
          <td>${r.user_name} <span class="muted">(#${r.user_id})</span></td>
          <td>${r.game_id}</td>
          <td>v${r.game_version}</td>
          <td>${r.nonce}</td>
          <td>${fmt(r.bet_cents)}${r.is_free_spin ? ' <span class="adm-badge">FREE</span>' : ""}</td>
          <td class="${Number(r.payout_cents) > 0 ? "tx-pos" : ""}">${fmt(r.payout_cents)}</td>
          <td>${Number(r.total_multiplier).toFixed(1)}x</td>
          <td title="${r.server_seed_hash}">${r.server_seed_hash.slice(0, 10)}…</td>
          <td>${String(r.created_at).slice(0, 16).replace("T", " ")}</td>
        </tr>`
      )
      .join("") || '<tr><td colspan="10" class="muted">Nenhuma rodada da engine ainda</td></tr>';
  }

  async function openCfgEditor(gameId, name) {
    currentCfgGame = gameId;
    $("#cfgGameName").textContent = name;
    $("#cfgError").classList.add("hidden");
    $("#cfgModal").classList.remove("hidden");
    const [games, versions] = await Promise.all([
      api("GET", "/api/slots/games"),
      api("GET", `/api/admin/slots/games/${gameId}/versions`),
    ]);
    const game = games.games.find((g) => g.id === gameId);
    $("#cfgEditor").value = JSON.stringify(game.config, null, 2);
    $("#cfgVersions").innerHTML = versions.versions.length
      ? versions.versions
          .map(
            (v) => `<div class="cfg-ver-row"><span class="v">v${v.version}</span>
              <span>${v.changed_by}</span>
              <span style="margin-left:auto">${String(v.created_at).slice(0, 16).replace("T", " ")}</span></div>`
          )
          .join("")
      : '<p class="muted" style="font-size:.76rem">Nenhuma alteração publicada ainda (v1 = boot)</p>';
  }

  $("#cfgPublishBtn").addEventListener("click", async () => {
    let cfg;
    try {
      cfg = JSON.parse($("#cfgEditor").value);
    } catch {
      $("#cfgError").textContent = "JSON inválido — corrija a sintaxe";
      return void $("#cfgError").classList.remove("hidden");
    }
    try {
      const r = await api("PUT", `/api/admin/slots/games/${currentCfgGame}/config`, { config: cfg });
      toast(`✅ ${r.gameId} publicado como v${r.version} por ${r.changedBy}`);
      $("#cfgModal").classList.add("hidden");
      refresh();
    } catch (err) {
      $("#cfgError").textContent = err.message;
      $("#cfgError").classList.remove("hidden");
    }
  });

  document.addEventListener("click", async (e) => {
    const cfgBtn = e.target.closest("[data-cfg]");
    if (cfgBtn) return void openCfgEditor(cfgBtn.dataset.cfg, cfgBtn.dataset.name);
    const tglBtn = e.target.closest("[data-toggle]");
    if (tglBtn) {
      try {
        const r = await api("POST", `/api/admin/slots/games/${tglBtn.dataset.toggle}/toggle`, {
          active: tglBtn.dataset.active !== "true",
        });
        toast(`Jogo ${r.id} ${r.active ? "ativado" : "desativado"}`);
        refresh();
      } catch (err) {
        toast(err.message);
      }
    }
  });

  $("#seSnapshotBtn").addEventListener("click", async () => {
    try {
      const r = await api("POST", "/api/admin/slots/rtp-snapshot");
      toast(`📸 Snapshot gravado: ${r.snapshots.map((s) => `${s.gameId} ${(s.rtp * 100).toFixed(2)}%`).join(" · ") || "sem rodadas ainda"}`);
    } catch (err) {
      toast(err.message);
    }
  });

  /* ============ PERÍODO ============ */
  let periodDays = 14;
  $$("#periodTabs button").forEach((b) =>
    b.addEventListener("click", () => {
      $$("#periodTabs button").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      periodDays = Number(b.dataset.days);
      refresh();
    })
  );

  /* ============ REFRESH ============ */
  async function refresh() {
    const [stats, ts, products, top, matches, users, activity, engine, engineRounds] = await Promise.all([
      api("GET", "/api/admin/stats"),
      api("GET", `/api/admin/timeseries?days=${periodDays}`),
      api("GET", "/api/admin/products"),
      api("GET", "/api/admin/top-players"),
      api("GET", "/api/admin/matches"),
      api("GET", "/api/admin/users"),
      api("GET", "/api/admin/activity"),
      api("GET", "/api/admin/slots/overview"),
      api("GET", "/api/admin/slots/rounds?limit=30"),
    ]);
    renderKPIs(ts.series, stats);
    renderFlowChart(ts.series);
    renderGGRChart(ts.series);
    renderProductChart(products.products);
    renderTopPlayers(top);
    renderMatches(matches.matches);
    allUsers = users.users;
    renderUsers(allUsers);
    renderTx(activity.transactions);
    renderEngine(engine.games);
    renderEngineRounds(engineRounds.rounds);
    $("#admUpdated").textContent =
      "Atualizado às " + new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
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
