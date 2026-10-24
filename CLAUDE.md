# Sinuquinha do Pix — instruções para agentes de IA

Guia para quem trabalha neste repositório com Claude Code, Codex, Cursor ou outro agente. Também vale para humanos. `AGENTS.md` aponta para este arquivo.

Jogo no ar: https://sinuca.fernandorffdev.com · sinuca 3D online para jogar com os amigos, sem conta. Interface só em português.

## Mapa do código

```
src/shared/   lógica do jogo, roda igual no servidor e no navegador
  physics.ts    física 2D determinística (passo 1/240 s): bolas, tabelas, caçapas, efeito, throw, poderes
  aim.ts        previsão da mira (bola fantasma e caminho com efeito); só desenho, não entra na física
  table.ts      medidas das mesas (pool e snooker), caçapas e arrumação das bolas de cada modo
  rules/        regras puras por modo: eightball, sinuca, snooker (e com poderes), matamata, free; index.ts registra os modos
  room.ts       máquina de estados da mesa (assentos, vez, votos, tempo, log); pura, sem Cloudflare
  protocol.ts   mensagens cliente↔servidor e a validação delas (fronteira de confiança)
  log.ts        uma linha de texto por jogada, montada no servidor
src/worker/   Cloudflare Worker + Durable Objects: room-do.ts (uma mesa por objeto), lobby.ts (lista de mesas)
src/client/   navegador: main.ts (laço e rede), scene.ts (Three.js), controls.ts (mira, força, efeito), ui.ts (telas e HUD),
              look.ts (cor das bolas), music.ts e sound.ts (Web Audio), youtube.ts, rules-text.ts (menu Regras)
scripts/      smoke.mjs (teste rápido contra uma mesa de verdade), scenarios.mjs (cenários de várias pessoas)
tests/        Vitest (física, regras, mesa, protocolo, log)
docs/         desenho e plano originais (docs/superpowers)
```

## Comandos

```bash
npm ci
npx vite build && npx wrangler dev   # servidor + cliente em http://localhost:8787
npx tsc --noEmit -p .                # tipos do cliente e do compartilhado
npx tsc --noEmit -p src/worker       # tipos do servidor
npx vitest run                       # testes
npx vite build                       # build do cliente (dist/)
node scripts/smoke.mjs <url>         # teste rápido (padrão http://localhost:8787)
```

**Gates antes de qualquer commit:** os dois `tsc`, `vitest run` e `vite build`, todos limpos.

## Regras do código

- **Comentários curtos em português, explicando o porquê:** número escolhido, ordem que importa, contorno de bug do navegador ou da Cloudflare, decisão do dono. Não comente o óbvio. Mudou a decisão, mude o comentário junto. Imports sempre no topo do arquivo.
- **Menos código vence:** reaproveite o que existe (`el()` em ui.ts, `foulScores` em rules/shot.ts, `isTeamGame`, `tableFor`), sem abstração para um uso só. Mudança cirúrgica: não reformate código vizinho e preserve o fim de linha de cada arquivo (há arquivos em CRLF e em LF).
- **Física determinística:** em `physics.ts` só `+ - * /` e `Math.sqrt`, passo fixo. Seno, cosseno, `atan2` e `hypot` não arredondam igual em todo navegador e quebram a jogada para quem assiste. Mudou a física, rode `tests/physics.test.ts` e confira a mira (`aim.ts` usa a mesma simulação).
- **Regras e mesa são funções puras:** `room.ts` e `rules/*` não falam com a Cloudflare; o Durable Object só entrega mensagens, grava o estado e agenda o alarme (`nextAlarm`). Teste novo vai direto na função pura.
- **Protocolo é fronteira de confiança:** toda mensagem nova é validada em `parseClientMessage` (tipos, limites, chaves conhecidas). O servidor confere o que o cliente manda (vez, poder em estoque, assento).
- **Mesa gravada sobrevive à versão nova:** campo novo do `RoomState` é opcional e lido com padrão (`s.log ?? []`), porque mesas abertas antes do deploy continuam no Durable Object. O cliente recarrega sozinho quando o `index-*.js` do ar muda (nunca no meio de uma tacada).
- **Texto que o jogador vê** em português simples; regra nova de modo também vai para `rules-text.ts` (menu Regras).

## Decisões de produto (não desfazer sem combinar)

| Data | Decisão | Por quê |
|---|---|---|
| 16/10 | Modos bola 8, sinuca brasileira (1 a 7), snooker (15 vermelhas) e mesa livre; lobby com lista de mesas e link `/#ABCD`; sem conta e sem login; 3D com Three.js | jogar com os amigos sem cadastro |
| 17/10 | Jogo no subdomínio `sinuca.fernandorffdev.com` (o site raiz é de outro projeto); nome **Sinuquinha do Pix** | — |
| 17/10 | Toda mudança testada vai direto para o ar, sem perguntar | jogar a versão nova na hora |
| 17/10 | Jogo solo em todos os modos; até 8 jogadores (bola 8 com 1, 2, 4, 6 ou 8, times par × ímpar) | treinar sozinho e mesas grandes |
| 17/10 | Efeito aparece na linha da mira; atrito entre bolas ("throw") ligado e mostrado na linha | ver o que o efeito faz antes de tacar |
| 17/10 | Quem assiste vê ao vivo a mira, a força e o ponto de efeito de quem está na vez | acompanhar a jogada dos amigos |
| 17/10 | Falta na sinuca e no snooker: os pontos são divididos entre os outros e a sobra sai de quem errou | mesa com mais de 2 pessoas |
| 17/10 | Tacada com bola caindo não pode ser pulada | todos verem a bola entrar |
| 17/10 | Nova partida na mesma mesa; log das jogadas; voto para expulsar (menu próprio e aviso para todos; a vez do expulso é pulada); expulso assiste e volta ou entra no meio da partida só por voto | mesa entre amigos sem dono |
| 17/10 | YouTube da mesa: um vídeo por vez, todos ouvem, qualquer um troca; volume de cada um | música junto |
| 17/10 | Limite de tempo por jogada, mudado ao vivo; ao acabar, taca com a mira e a força daquele momento | partidas sem espera |
| 17/10 | Barra com todas as opções à vista, em 3 blocos (Som e vídeo, Mesa, Ajuda); nada escondido em menu | achar tudo sem procurar |
| 17/10 | **Snooker com poderes** como modo separado; cada cor encaçapada dá um poder fixo para guardar | snooker de sempre continua igual |
| 18/10 | **Mata-mata** (4 vermelhas, 4 amarelas, sozinho, 1x1 ou 2x2): a primeira bola sem falta define a cor; falta = sai uma bola do adversário (a mais longe das caçapas, nunca a última); a última bola é cantada | regra da sinuca de bar |
| 24/10 | Repositório público no GitHub pessoal; publicação pelo GitHub a cada envio para o `main` | portfólio e deploy sem máquina local |

## Testar no navegador

- `npx vite build && npx wrangler dev` e abra `http://localhost:8787`. Depois de cada `vite build`, reinicie o `wrangler dev`.
- Várias pessoas num navegador só: `?as=<nome>` na URL (cada nome é um jogador).
- Recarregar com o mesmo endereço e hash: use recarregar de verdade (F5), não navegar para a mesma URL, e confira se o `index-*.js` carregado é o do `dist`.
- Print preto = tirado antes do quadro ser desenhado: traga a aba para frente e espere ~2 s.
- `node scripts/smoke.mjs <url>` abre uma mesa de verdade com duas pessoas e confere a jogada.

## Git

Fluxo em [CONTRIBUTING.md](CONTRIBUTING.md): branch por tarefa a partir do `main` (`feat/`, `fix/`, `style/`, `docs/`, `refactor/`), commits em português com o tipo na frente (`feat: …`), PR com o modelo de `.github/`, CI verde e *squash and merge*. O dono pode enviar direto para o `main`.

## Pipelines

| Pipeline | Arquivo | Quando roda | O que faz | Se der errado |
|---|---|---|---|---|
| CI | `ci.yml` | todo PR e todo push no `main` | os dois `tsc`, `vitest run`, `vite build` | o PR não entra; abra o log em Actions e corrija na mesma branch |
| Título do PR | `pr-title.yml` | ao abrir ou editar o PR | confere o formato `tipo: o que muda` | edite o título; roda de novo sozinho |
| Produção | `deploy.yml` | push no `main` | gates, publica o jogo, confere se o site serve o build novo e roda o teste rápido | falhou antes do deploy: nada muda no ar; falhou depois: o jogo no ar já está com a versão nova, veja o log |

Logs: https://github.com/fernandorff/sinuca/actions. A Produção usa os segredos `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID` do repositório.

## Publicar

Automático: o push no `main` publica pela pipeline **Produção**. À mão (`npx vite build && npx wrangler deploy`) só em emergência, por quem tem a conta Cloudflare; depois, confira o `index-*.js` servido e rode `node scripts/smoke.mjs https://sinuca.fernandorffdev.com`.
