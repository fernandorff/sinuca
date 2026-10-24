# Sinuquinha do Pix

Sinuca 3D online para jogar com os amigos direto no navegador, sem conta: cria a mesa, manda o link e joga. Até 8 pessoas por mesa, quem não está jogando assiste ao vivo.

**Jogar:** https://sinuca.fernandorffdev.com

## O que tem

- 6 modos: **Bola 8**, **Sinuca brasileira** (bolas 1 a 7), **Snooker** (15 vermelhas), **Snooker com poderes**, **Mata-mata** (sinuca de bar: 4 vermelhas e 4 amarelas, 1x1 ou 2x2) e **Mesa livre**
- Física própria e determinística: efeito na branca (alto, baixo, lados), atrito entre bolas ("throw"), tabelas e caçapas com medidas da WPA
- Mira com bola fantasma e a linha do caminho já com o efeito; quem assiste vê ao vivo a mira, a força e o ponto de efeito de quem está na vez
- Até 8 jogadores revezando; bola 8 e mata-mata em times; jogo solo em todos os modos
- Mesa com lobby e link `/#ABCD`, nova partida sem sair da mesa, log das jogadas, voto para expulsar e para deixar entrar, limite de tempo por jogada (taca sozinho quando o tempo acaba)
- Vídeo do YouTube da mesa (todo mundo ouve, um por vez, qualquer um troca), música e sons gerados no navegador
- Snooker com poderes: cada cor encaçapada dá um poder para guardar (Caçapa gigante, Bola explosiva, Mesa de gelo, Pontos em dobro)

## Stack

- **Cliente:** TypeScript, Vite, Three.js (WebGL), interface em HTML/CSS puros, Web Audio
- **Servidor:** Cloudflare Workers + Durable Objects (um objeto por mesa, com SQLite e WebSocket com hibernação; um objeto para a lista de mesas)
- **Ao vivo para todos:** o navegador de quem taca simula a jogada; o servidor confere, grava e manda o resultado para todos pelo WebSocket. Como a física só usa `+ - * /` e raiz quadrada, todo navegador chega na mesma posição das bolas
- **Testes:** Vitest (física, regras, protocolo, mesa) e teste rápido contra uma mesa de verdade (`scripts/smoke.mjs`)

## Rodar

```bash
npm ci
npx vite build && npx wrangler dev   # servidor + cliente em http://localhost:8787
npx vitest run                       # testes
```

Várias pessoas num navegador só: `http://localhost:8787/?as=ana`, `?as=bia`…

## Contribuir

- Regras do código para gente e para agentes de IA (Claude Code, Codex, Cursor): [CLAUDE.md](CLAUDE.md), também lido via [AGENTS.md](AGENTS.md)
- Fluxo de Git, issues e PR: [CONTRIBUTING.md](CONTRIBUTING.md)
- Desenho original do jogo: [docs/superpowers/specs/2026-10-16-sinuca-design.md](docs/superpowers/specs/2026-10-16-sinuca-design.md)
- O jogo no ar é publicado sozinho a cada envio para o `main` (pipeline Produção)

## Créditos

Sem assets de terceiros: mesa, bolas e taco são geometria do Three.js; músicas e sons são compostos na hora com Web Audio.
