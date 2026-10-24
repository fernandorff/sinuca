<!--
Título no formato do commit: `tipo: o que muda, em português` (tipos: feat, fix, style, refactor, docs, ci, test).
Ex.: `feat: modo bola 9`. O título vira o commit no `main`.
-->

Closes #<!-- número da issue, se houver; a palavra tem de ser em inglês (Closes, Fixes ou Resolves) para o GitHub fechar a issue sozinho -->

## Por quê

<!-- O problema ou a ideia, em uma ou duas frases. -->

## O que muda

<!-- O que o jogador vê de diferente, ou o que muda por dentro. Lista curta. -->

## Prints

<!-- Obrigatório se mudou algo na tela: antes e depois. Arraste as imagens aqui. -->

| Antes | Depois |
|---|---|
|  |  |

## Como testei

- [ ] `npx tsc --noEmit -p .` e `npx tsc --noEmit -p src/worker`
- [ ] `npx vitest run`
- [ ] `npx vite build`
- [ ] Joguei no navegador (`npx wrangler dev`) com duas pessoas (`?as=ana` e `?as=bia`)
- [ ] Decisão não óbvia com 1 linha de comentário explicando o porquê
