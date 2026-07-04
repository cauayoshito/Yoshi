/* ============================================================
   YOSHI BET — Constantes de interface
   (o catálogo de jogos agora vem da API: GET /api/games)
   ============================================================ */

const CAT_TITLES = {
  all: "🔥 Jogos Populares",
  slots: "🎰 Slots",
  crash: "🚀 Jogos Crash",
  live: "🎥 Cassino Ao Vivo",
  table: "🃏 Jogos de Mesa",
  new: "✨ Lançamentos",
};

const WINNER_NAMES = [
  "Lucas S.", "Maria F.", "João P.", "Ana C.", "Pedro H.", "Julia R.",
  "Carlos M.", "Fernanda L.", "Rafael T.", "Beatriz O.", "Gustavo A.", "Camila D.",
];

/* Símbolos usados só na animação do slot — o resultado real vem do servidor */
const SLOT_SYMBOLS = ["🐲", "💎", "🍀", "🔔", "🍒", "⭐", "7️⃣"];

/* ============================================================
   Copa do Mundo 2026 — Oitavas de final (confrontos reais)
   Odds demonstrativas · horários em Brasília
   ============================================================ */
const WC_MATCHES = [
  {
    day: "Hoje · Sáb 04/07", live: true,
    home: { name: "Canadá", flag: "🇨🇦" }, away: { name: "Marrocos", flag: "🇲🇦" },
    time: "14:00", venue: "NRG Stadium, Houston",
    odds: { home: 3.4, draw: 3.1, away: 2.25 },
  },
  {
    day: "Hoje · Sáb 04/07", live: false,
    home: { name: "Paraguai", flag: "🇵🇾" }, away: { name: "França", flag: "🇫🇷" },
    time: "18:00", venue: "Lincoln Financial Field, Filadélfia",
    odds: { home: 6.5, draw: 4.0, away: 1.52 },
  },
  {
    day: "Amanhã · Dom 05/07", live: false, featured: true,
    home: { name: "Brasil", flag: "🇧🇷" }, away: { name: "Noruega", flag: "🇳🇴" },
    time: "17:00", venue: "MetLife Stadium, Nova York",
    odds: { home: 1.55, draw: 4.1, away: 5.9 },
  },
  {
    day: "Amanhã · Dom 05/07", live: false,
    home: { name: "México", flag: "🇲🇽" }, away: { name: "Inglaterra", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
    time: "21:00", venue: "Estádio Azteca, Cidade do México",
    odds: { home: 3.9, draw: 3.3, away: 1.95 },
  },
  {
    day: "Seg 06/07", live: false,
    home: { name: "Espanha", flag: "🇪🇸" }, away: { name: "Portugal", flag: "🇵🇹" },
    time: "16:00", venue: "AT&T Stadium, Dallas",
    odds: { home: 2.1, draw: 3.4, away: 3.5 },
  },
  {
    day: "Seg 06/07", live: false,
    home: { name: "Bélgica", flag: "🇧🇪" }, away: { name: "Estados Unidos", flag: "🇺🇸" },
    time: "21:00", venue: "Lumen Field, Seattle",
    odds: { home: 2.45, draw: 3.2, away: 2.9 },
  },
  {
    day: "Ter 07/07", live: false,
    home: { name: "Argentina", flag: "🇦🇷" }, away: { name: "Egito", flag: "🇪🇬" },
    time: "13:00", venue: "Mercedes-Benz Stadium, Atlanta",
    odds: { home: 1.48, draw: 4.3, away: 6.8 },
  },
  {
    day: "Ter 07/07", live: false,
    home: { name: "Suíça", flag: "🇨🇭" }, away: { name: "Colômbia", flag: "🇨🇴" },
    time: "17:00", venue: "BC Place, Vancouver",
    odds: { home: 2.75, draw: 3.1, away: 2.6 },
  },
];
