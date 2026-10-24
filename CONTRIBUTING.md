# Como contribuir

Este guia diz como uma mudança sai da sua máquina e chega ao jogo. Regras de código e comandos: [CLAUDE.md](CLAUDE.md) (vale para gente e para agentes de IA).

## Fluxo

1. **Combine antes:** abra uma issue pelos modelos **Bug** ou **Ideia** (ou comente numa existente). Modo novo ou regra que muda o jogo só começa depois que o dono decidir na issue.
2. **Crie uma branch a partir do `main` atualizado**, uma por tarefa:
   - `feat/<assunto>` coisa nova (`feat/modo-bola-9`)
   - `fix/<assunto>` conserto (`fix/mira-some-no-celular`)
   - `style/<assunto>` visual e interface
   - `docs/<assunto>`, `refactor/<assunto>`
3. **Commits pequenos, em português**, começando pelo tipo: `feat: …`, `fix: …`, `style: …`, `refactor: …`, `docs: …`, `test: …`, `ci: …`. A mensagem diz o que mudou para quem joga.
4. **Antes de abrir o PR**, rode os gates (os dois `tsc`, `vitest run`, `vite build`) e jogue no navegador com pelo menos duas pessoas (`?as=ana` e `?as=bia` em duas abas).
5. **Abra o pull request para o `main`** preenchendo o modelo (Por quê, O que muda, Prints, Como testei) e com `Closes #n` para ligar a issue. **Título no formato do commit**: uma checagem do GitHub barra título fora do padrão. O PR só entra com o CI verde.
6. **Merge:** *squash and merge* no `main`; o título do PR vira o commit.
7. **Publicação é automática:** o push no `main` publica o jogo no ar pela pipeline Produção.

## Issues

Toda issue sai de um dos dois modelos (a issue em branco está desligada): https://github.com/fernandorff/sinuca/issues/new/choose

| Modelo | Quando | O que pede |
|---|---|---|
| **Bug** | algo no jogo não funciona como deveria | o que aconteceu, como repetir, modo e aparelho, prints |
| **Ideia** | modo, regra, poder ou mudança de interface | o que, por quê, como imagina, se quer fazer o PR |

- **Título:** uma frase que diga o problema ou a ideia, sem prefixo (`Bola atravessa a tabela em tacada forte`). O prefixo `tipo:` é do PR.
- **Um assunto por issue.**
- O PR que resolve a issue leva `Closes #n` (em inglês; "Fecha #n" o GitHub não entende).

## Regras que valem para todo PR

- Um PR, um assunto.
- Mudou a física: os testes de `tests/physics.test.ts` passam e a mira continua batendo com a jogada.
- Mensagem nova entre navegador e servidor: validada em `src/shared/protocol.ts`, com teste.
- Nada de segredo no repositório (chaves, tokens, senhas). O repositório é público.
