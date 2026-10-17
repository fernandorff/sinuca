# Sinuca online — design

Data: 16/10/2026 · Pasta: `D:\Projetos\sinuca` · Endereço: `sinuca.fernandorffdev.com`

Legenda de origem: **(Fernando)** = decidido por ele no chat de 16/10/2026 · **(minha decisão)** = escolha do Claude, ele pode mudar · **(medido)** = conferido nesta data · **(doc)** = documentação com link · **(dedução)** = suposição, ainda sem confirmação.

## 1. Para que serve

Um jogo de sinuca 3D no navegador para o Fernando jogar com os amigos. A pessoa abre o endereço, digita um apelido e entra numa mesa, sem conta, sem senha e sem instalar nada **(Fernando)**. Funciona no celular e no PC.

Dá certo quando: ele manda o link no grupo, os amigos abrem no celular, a partida começa em menos de um minuto e todos veem a mesma mesa.

## 2. Objetivos, fora de escopo e o que seria fracasso

**Objetivos**
- 4 modos de jogo, escolhidos por quem cria a mesa **(Fernando)**: bola 8, sinuca brasileira (bola da vez, 1 a 7), snooker com 15 vermelhas e mesa livre (física sem regra).
- Lobby com **lista de mesas abertas** e **link direto** da mesa (`/#ABCD`) **(Fernando)**.
- Até **4 jogadores** por mesa, revezando a vez **(Fernando)**; quem entra com a mesa cheia fica assistindo **(minha decisão)**.
- Visual **3D com Three.js** **(Fernando)**.
- Tacada com **mira, força e efeito na branca** (puxada, seguida e efeito lateral) **(Fernando)**.

**Fora de escopo (v1)**: contas, login, ranking, histórico, chat, jogar contra o computador, anticheat e segurança além de validar o formato das mensagens **(Fernando: "n vai precisar de conta nem nada de segurança")**.

**Seria fracasso mesmo funcionando**
- Jogadores verem a mesa diferente um do outro (dessincronia).
- Demorar para abrir ou travar no celular dos amigos.
- Mexer no site principal `fernandorffdev.com` (que é da sessão 💼 Carreira e roda na Vercel).
- Cair a conexão quando o celular bloqueia a tela e a pessoa perder o lugar na mesa.

## 3. Restrições

- **DNS no Cloudflare** **(medido: NS `michael`/`davina.ns.cloudflare.com`)**; o site principal é Astro na Vercel, em `D:\Projetos\Carreira\Portfolio\site` **(medido)**. O jogo usa **só o subdomínio** `sinuca.`, sem tocar no registro raiz.
- **Plano grátis do Cloudflare** **(doc: [preço dos Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/))**: Durable Objects só com armazenamento SQLite; 100 mil requisições/dia; mensagem WebSocket recebida conta 1/20 de requisição, e a enviada não conta; com a API de hibernação, o objeto parado não cobra tempo. Para um grupo de amigos isso sobra **(dedução)**.
- O `wrangler` não está instalado; Node 25.5.0 **(medido)**. Conferir se o wrangler aceita Node 25 antes do plano.
- O login no Cloudflare (`wrangler login`) é ação do Fernando. O deploy só acontece com autorização dele, a cada vez.

## 4. Como funciona (minhas decisões, ele pode mudar)

### 4.1 Pilha
- **Vite + Three.js puro + TypeScript**, sem React.
- **Um Worker do Cloudflare** serve o build estático (Workers Static Assets) e os WebSockets.
- **Física e regras em TypeScript, num código só**, usado pelo navegador e pelo Worker.

### 4.2 Física: 2D por dentro, 3D por fora
- As bolas vivem num plano. O Three.js só desenha a mesa, as bolas, o taco e a câmera.
- **Física própria** (~200 linhas), sem motor 3D (Cannon/Rapier/Ammo): esses motores não tratam bem o rolamento e o efeito da branca.
- Passo fixo (ex.: 1/240 s). Choque elástico bola com bola, tabela com restituição, atrito de deslizar até passar a rolar e efeito (seguida, puxada, lateral). Caçapa como região de captura nas quinas e no meio.
- **Determinística**: no laço interno, só soma, multiplicação e `Math.sqrt` (que é exato em todo navegador); seno e cosseno só uma vez, ao converter o ângulo da tacada em vetor, antes do laço.

### 4.3 Quem manda no resultado
- Quem tacou simula a tacada e envia `{ângulo, força, efeitoX, efeitoY, posiçãoDaBranca}` para a mesa.
- A mesa (Durable Object) confere só se é a vez dessa pessoa e se a mensagem tem o formato certo, e repassa a tacada para todos.
- Todo mundo roda a mesma simulação para ver a animação.
- Quando as bolas param, quem tacou envia as **posições finais e os eventos** (primeira bola tocada, bolas encaçapadas e em qual caçapa, branca encaçapada, tabela tocada). A mesa aplica as regras, guarda isso como verdade e manda o estado para todos, que se ajustam a ele.
- O servidor não roda física: não gasta CPU e não tem como dessincronizar. Como é só entre amigos, confiar no cliente de quem tacou basta **(Fernando: sem segurança)**.
- **A verdade é a posição final enviada**; a simulação nos outros aparelhos serve só para a animação. Se no fim da animação alguma bola estiver fora do lugar, ela desliza até a posição certa em cerca de 150 ms, sem salto **(minha decisão)**.
- **Se quem tacou cair** antes de mandar o resultado: todos os aparelhos enviam o resultado da própria simulação; a mesa usa o de quem tacou e, se ele não chegar em 10 s, usa o primeiro que chegou **(minha decisão)**.
- **Eventos são uma linha do tempo em ordem** (com o número do passo da simulação), não uma lista solta, porque as regras dependem da ordem: primeira bola tocada, tabela depois do contato **(minha decisão)**.

### 4.4 Regras: uma função pura por modo
`aplicarTacada(estado, eventos) → { novoEstado, faltas, próximoJogador, fimDeJogo? }`. Cada modo informa qual bola é válida, quanto vale cada bola, o custo de cada falta, quais bolas voltam à mesa e quando o jogo acaba. A física e a rede não sabem qual modo está rodando.

### 4.5 Lobby e mesas
- **Um Durable Object "Lobby"** (único) com a lista de mesas abertas: código, modo, jogadores e se está esperando gente.
- **Um Durable Object por mesa**, com o estado completo, os assentos e a fila de vez.
- Os dois usam a **API de hibernação de WebSocket**.
- Link: `sinuca.fernandorffdev.com/#ABCD`. Lista: tela inicial com as mesas e o botão "Criar mesa".
- **Reconexão**: o navegador guarda `{mesa, idDoJogador}` no `localStorage` e, ao reconectar, volta para o mesmo lugar. A mesa segura o lugar por alguns minutos.
- **Limpeza**: um alarme do Durable Object tira do lobby a mesa vazia depois de N minutos.
- Apelido: até 20 caracteres, sem HTML. Mensagens com tamanho e tipos conferidos (é a única validação que fica).

### 4.6 Controles
- **PC**: arrastar o mouse mira; segurar e puxar dá a força (ou barra de força); clicar numa bolinha de efeito escolhe onde bater na branca.
- **Celular**: arrastar o dedo mira; barra de força na lateral; bolinha de efeito tocável.
- Câmera: atrás do taco ao mirar, vista de cima com um toque, e acompanha as bolas durante a tacada.
- Bola na mão: arrastar a branca para onde a regra permite.

### 4.7 Mesas
- **Mesa de pool** (2,54 × 1,27 m, bolas de 57 mm) para bola 8 e mesa livre.
- **Mesa de sinuca/snooker** (mais comprida, caçapas mais justas, bolas de 52,5 mm, com o "D") para a sinuca brasileira e o snooker.
- As medidas exatas ficam com o construtor; na tela, as duas ocupam o mesmo espaço.

## 5. Regras de cada modo

> **Para o Fernando confirmar.** As regras da sinuca brasileira e do snooker abaixo são um resumo; as etapas 3 e 4 só começam com a confirmação dele. As lacunas (bola da vez encaçapada junto com outra, bola na caçapa errada, falta da branca depois de acertar) eu levo a ele antes da etapa 3. A bola 8 e a mesa livre não dependem disso.

### 5.1 Bola 8 — 2 jogadores ou 4 (2 duplas)
- A bola 8 não tem regra para 3 jogadores, então a mesa aceita 2 ou 4. Com 4, as duplas dividem o grupo de bolas e a vez segue a ordem A1, B1, A2, B2; a bola 8 é de quem estiver na vez. Se um parceiro cair, o lugar fica reservado e, enquanto isso, o parceiro dele joga a vez dele. Com 3 pessoas, a partida espera o quarto ou começa com 2 **(minha decisão)**.
- Saída livre. A mesa fica aberta até a primeira bola encaçapada numa tacada válida; essa bola define o grupo (lisas 1 a 7 ou listradas 9 a 15).
- Tacada válida: bater primeiro numa bola do próprio grupo e, depois, encaçapar alguma bola ou fazer uma bola tocar a tabela.
- Falta (branca encaçapada, primeira bola errada, nenhuma tabela): o próximo jogador fica com a **bola na mão em qualquer lugar**.
- Bola 8: só depois de limpar o grupo, e **vale em qualquer caçapa, sem cantar** **(Fernando, 16/10/2026)**. Encaçapar a 8 antes da hora, ou junto com a branca, ou numa tacada com falta é **derrota**.
- Fonte: regra mundial da WPA, simplificada (sem push-out e sem a regra de 3 faltas) **(minha decisão)**.

### 5.2 Mesa livre — 1 a 4 jogadores
- Bolas de pool, sem árbitro. Encaçapou, joga de novo; não encaçapou, passa a vez. Branca encaçapada volta na marca da cabeceira. Botão "arrumar mesa" para recomeçar.

### 5.3 Sinuca brasileira — 2 a 4 jogadores
Fonte: [Wikipedia "Sinuca brasileira"](https://en.wikipedia.org/wiki/Sinuca_brasileira) (texto curto, com uma fonte só) e um [regulamento de torneio](https://www.amb.com.br/wp-content/uploads/2023/07/REGULAMENTO-DA-SINUCA.pdf) que segue a CBBS **(doc)**.
- Bolas: vermelha 1, amarela 2, verde 3, marrom 4, azul 5, rosa 6 e preta 7, nas marcas do snooker. A vermelha fica entre a rosa e a tabela.
- Saída: a branca começa no "D", e a primeira tacada tem que tocar a vermelha sem encaçapá-la.
- Em cada tacada, o jogador **canta a bola e a caçapa** e escolhe:
  - **Bola da vez** (a de menor valor na mesa): se acertar, marca os pontos e a bola **sai** da mesa. Em seguida pode tentar qualquer outra bola sem castigo: se acertar, marca e a bola **volta** à marca. Se errar a bola da vez, não há castigo, mas a vez passa.
  - **Bola numerada** (qualquer outra): se acertar, marca os pontos e a bola **volta** à marca; a próxima tacada tem que ser na bola da vez. Se errar, é **falta de 7 pontos**.
- Branca encaçapada: falta. O próximo jogador marca os pontos e coloca a branca no "D".
- **Fim**: quando todas as bolas saem da mesa, ganha quem tiver mais pontos **(dedução: a fonte não diz)**.
- **Com 3 ou 4 jogadores**, os pontos da falta vão para o **próximo da vez** **(minha decisão)**.

### 5.4 Snooker (15 vermelhas) — 2 a 4 jogadores
- Regra do snooker: alternar vermelha e uma cor (a cor volta para a marca) enquanto houver vermelha na mesa; depois, as cores em ordem, da amarela à preta.
- Falta: no mínimo 4 pontos, ou o valor da maior bola envolvida (até 7). Com 3 ou 4 jogadores, os pontos vão para o próximo da vez **(minha decisão)**.
- Fica de fora na v1 **(minha decisão)**: a regra do "miss", a "free ball" e a re-spotted black no empate. No empate, quem tiver mais pontos na preta final vence.

## 6. Ordem de construção (para o Fernando confirmar)
1. **Bola 8 de ponta a ponta**: lobby, link, mesa 3D, física com efeito, regras, reconexão e deploy no subdomínio. Já dá para jogar com os amigos.
2. **Mesa livre** (é a bola 8 sem árbitro, e sai quase de graça).
3. **Sinuca brasileira** (mesa de sinuca e regra nova).
4. **Snooker** (reaproveita a mesa da sinuca e as 15 vermelhas).

## 7. Como saber que funciona
- **Física**: testes automáticos — mesma tacada dá o mesmo resultado sempre; a energia só diminui; a bola não atravessa a tabela; a branca com puxada volta depois do choque frontal.
- **Regras**: testes de cada modo, com eventos montados à mão (falta, grupo, 8 antes da hora, castigo de 7, fim de jogo).
- **Rede**: `wrangler dev` local, com 2 a 4 abas (uma em viewport de celular) jogando a mesma mesa: as posições finais batem; fechar e reabrir a aba volta ao mesmo lugar.
- **No ar**: abrir `sinuca.fernandorffdev.com` pelo celular em 4G e jogar uma partida curta.

## 7.1 Metas de desempenho (minha decisão)
- 60 quadros por segundo num Android intermediário, e não menos de 30 num celular fraco (abaixar a sombra e a resolução quando cair).
- Download inicial abaixo de 1 MB compactado; o Three.js é a maior parte.
- A física sempre com o passo fixo, sem passo adaptativo (o adaptativo quebra o determinismo).

## 7.2 Publicação
- Rota de domínio próprio do Worker (`routes` com `custom_domain = true`), e o Cloudflare cria o registro DNS e o certificado sozinho **(doc: [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/))**. A página não diz se o plano grátis inclui isso **(a conferir no primeiro deploy)**; se não incluir, fica em `*.workers.dev` até resolver.
- O subdomínio `sinuca` não pode ter CNAME antes **(doc)**.

## 8. Fica com o construtor
Medidas e coeficientes da física (ajustados até "parecer sinuca"); materiais e iluminação da cena; som (opcional); layout das telas; formato exato das mensagens; tempo que o lugar fica reservado e tempo da limpeza; nome das bolas de cada modo na interface.
