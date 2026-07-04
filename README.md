# 🐲 YOSHI BET — Plataforma iGaming (Demo Front-end)

Plataforma de cassino online no estilo das grandes casas brasileiras (tema escuro,
verde neon + dourado, depósito via PIX, bônus de boas-vindas), construída 100% com
HTML, CSS e JavaScript puros — sem dependências, roda em qualquer hospedagem estática.

> ⚠️ **Projeto demonstrativo.** Nenhuma aposta com dinheiro real é realizada.
> Saldo, contas e histórico são simulados no `localStorage` do navegador.

## ✨ Funcionalidades

- **Home** com carrossel de banners promocionais, busca e categorias (Populares, Slots, Crash, Ao Vivo, Mesa, Novos)
- **Catálogo com 27 jogos** dos provedores mais famosos do mercado BR (PG Soft, Pragmatic Play, Evolution, Spribe…)
- **2 jogos demo jogáveis:**
  - 🐲 **Fortune Yoshi** — slot 3×3 com 5 linhas de pagamento e multiplicadores por símbolo
  - 💣 **Mines** — campo 5×5 com 4 bombas, multiplicador progressivo e botão de retirada
- **Cadastro e login** (demo, localStorage)
- **Depósito via PIX** simulado: QR code, código copia-e-cola e confirmação automática com bônus de 100%
- **Carteira** com saldo, saque simulado e histórico das últimas 30 jogadas
- **Ticker de ganhos ao vivo**, página de promoções, rodapé com selos 18+/PIX/SSL
- **Totalmente responsivo** com bottom-nav mobile no estilo app

## 🚀 Como rodar

É um site estático — basta abrir o `index.html` ou servir a pasta:

```bash
# opção 1: abrir direto
open index.html

# opção 2: servidor local
python3 -m http.server 8000
# acesse http://localhost:8000
```

Para publicar: GitHub Pages, Vercel, Netlify ou qualquer hospedagem estática.

## 📁 Estrutura

```
├── index.html      # Estrutura: header, views, modais, jogos
├── css/style.css   # Tema escuro completo + responsivo
└── js/
    ├── data.js     # Catálogo de jogos e constantes
    └── app.js      # Navegação, auth, carteira, PIX, slot e mines
```

## 🔜 Próximos passos (para virar produção de verdade)

- Backend real (auth com JWT, carteira transacional, RNG auditado)
- Integração com agregadores de jogos licenciados
- Gateway de pagamento PIX real (ex.: provedores autorizados pelo BACEN)
- KYC/verificação de idade e ferramentas de jogo responsável
- Licenciamento junto à SPA/Ministério da Fazenda (apostas de quota fixa)
