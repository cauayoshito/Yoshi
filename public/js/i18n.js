/* ============================================================
   YOSHI BET — i18n + moeda plugável
   Carregado antes de app.js (define window.YBI18n).
   - Idioma: pt-BR (padrão) / en. Persistido em localStorage.
   - Moeda: plugável por config (símbolo/placa vêm do Intl).
   Para operar em outro mercado (ex.: Filipinas/PAGCOR), basta
   trocar CURRENCIES[activeCurrency] ou o default abaixo.
   ============================================================ */
(() => {
  "use strict";

  /* ---------- Moeda plugável ---------- */
  const CURRENCIES = {
    BRL: { locale: "pt-BR", currency: "BRL" },
    USD: { locale: "en-US", currency: "USD" },
    PHP: { locale: "en-PH", currency: "PHP" }, // peso filipino (mercado PAGCOR)
    EUR: { locale: "en-IE", currency: "EUR" },
  };
  const CUR_KEY = "yoshibet_currency";
  let curCode = localStorage.getItem(CUR_KEY) || "BRL";
  if (!CURRENCIES[curCode]) curCode = "BRL";

  let money = makeFormatter(curCode);
  function makeFormatter(code) {
    const c = CURRENCIES[code] || CURRENCIES.BRL;
    const nf = new Intl.NumberFormat(c.locale, {
      style: "currency",
      currency: c.currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return (cents) => nf.format((Number(cents) || 0) / 100);
  }
  function setCurrency(code) {
    if (!CURRENCIES[code]) return;
    curCode = code;
    localStorage.setItem(CUR_KEY, code);
    money = makeFormatter(code);
  }

  /* ---------- Dicionário de traduções ---------- */
  const DICT = {
    "pt-BR": {
      "nav.casino": "Cassino", "nav.home": "Início", "nav.originals": "Yoshi Originals",
      "nav.slots": "Slots", "nav.crash": "Crash", "nav.live": "Ao Vivo", "nav.table": "Mesa",
      "nav.new": "Lançamentos", "nav.sports": "Esportes", "nav.foryou": "Para você",
      "nav.promos": "Promoções", "nav.account": "Minha Conta", "nav.support": "Suporte 24h",
      "rg.play": "Jogue com responsabilidade",
      "header.searchph": "Buscar jogos, provedores...",
      "auth.login": "Entrar", "auth.register": "Criar conta", "auth.deposit": "Depositar",
      "hero1.tag": "🎉 BOAS-VINDAS", "hero1.cta": "Criar conta grátis",
      "hero2.tag": "💸 TODA SEMANA", "hero2.cta": "Ver promoções",
      "hero3.tag": "🏆 TORNEIO", "hero3.cta": "Jogar agora",
      "sports.hero.tag": "⚽ OITAVAS DE FINAL", "sports.hero.sub": "Confrontos reais do mata-mata · Mercado 1X2 (demo)",
      "common.playnow": "Jogar agora",
    },
    en: {
      "nav.casino": "Casino", "nav.home": "Home", "nav.originals": "Yoshi Originals",
      "nav.slots": "Slots", "nav.crash": "Crash", "nav.live": "Live", "nav.table": "Table",
      "nav.new": "New releases", "nav.sports": "Sports", "nav.foryou": "For you",
      "nav.promos": "Promotions", "nav.account": "My Account", "nav.support": "24h Support",
      "rg.play": "Play responsibly",
      "header.searchph": "Search games, providers...",
      "auth.login": "Log in", "auth.register": "Sign up", "auth.deposit": "Deposit",
      "hero1.tag": "🎉 WELCOME", "hero1.cta": "Create free account",
      "hero2.tag": "💸 EVERY WEEK", "hero2.cta": "See promotions",
      "hero3.tag": "🏆 TOURNAMENT", "hero3.cta": "Play now",
      "sports.hero.tag": "⚽ ROUND OF 16", "sports.hero.sub": "Real knockout fixtures · 1X2 market (demo)",
      "common.playnow": "Play now",
    },
  };

  const LANG_KEY = "yoshibet_lang";
  let lang = localStorage.getItem(LANG_KEY) || "pt-BR";
  if (!DICT[lang]) lang = "pt-BR";

  const t = (key) => (DICT[lang] && DICT[lang][key]) || (DICT["pt-BR"][key]) || key;

  /** Aplica traduções a todos os [data-i18n] / [data-i18n-ph] do documento. */
  function apply(root = document) {
    root.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    root.querySelectorAll("[data-i18n-ph]").forEach((el) => {
      el.setAttribute("placeholder", t(el.getAttribute("data-i18n-ph")));
    });
    document.documentElement.lang = lang === "en" ? "en" : "pt-BR";
  }

  function setLang(next) {
    if (!DICT[next]) return;
    lang = next;
    localStorage.setItem(LANG_KEY, next);
    // moeda default por idioma (pode ser sobrescrita manualmente)
    apply();
    window.dispatchEvent(new CustomEvent("yb:langchange", { detail: { lang } }));
  }

  window.YBI18n = {
    t, apply, setLang,
    get lang() { return lang; },
    money: (c) => money(c),
    setCurrency,
    get currency() { return curCode; },
    currencies: Object.keys(CURRENCIES),
  };

  // aplica assim que o DOM estiver pronto
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => apply());
  } else {
    apply();
  }
})();
