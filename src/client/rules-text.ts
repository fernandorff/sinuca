// Regras de cada modo como o jogo aplica (regras em src/shared/rules), para o menu "Regras".
import type { Mode } from '../shared/rules/index.ts';

export const RULES: Record<Mode, { tagline: string; items: string[] }> = {
  eightball: {
    tagline: 'Lisas contra listradas; a 8 fecha o jogo.',
    items: [
      'Sozinho, 2 jogadores ou 2 duplas (lugares 1 e 3 contra 2 e 4).',
      'Saída com a branca atrás da linha da cabeceira.',
      'A mesa fica aberta até a primeira bola encaçapada sem falta: ela define o seu grupo (lisas 1 a 7 ou listradas 9 a 15).',
      'Tacada válida: a branca bate primeiro numa bola do seu grupo e depois alguma bola cai ou vai à tabela.',
      'Encaçapou do seu grupo: joga de novo.',
      'Falta (branca na caçapa, bola errada primeiro, nenhuma tabela): o próximo fica com a branca na mão, em qualquer lugar.',
      'A 8 vale em qualquer caçapa depois de limpar o seu grupo. Encaçapar a 8 antes da hora, com falta ou junto com a branca: perde.',
    ],
  },
  free: {
    tagline: 'Sem árbitro: só treino e diversão.',
    items: [
      'De 1 a 4 jogadores.',
      'Encaçapou, joga de novo; errou, passa a vez.',
      'Branca na caçapa volta para a cabeceira.',
      '"Arrumar mesa" coloca o triângulo de novo.',
    ],
  },
  sinuca: {
    tagline: 'Bola da vez, castigo de 7 e pontos de 1 a 7.',
    items: [
      'Bolas: vermelha 1, amarela 2, verde 3, marrom 4, azul 5, rosa 6, preta 7.',
      'Saída com a branca no "D". Ela tem que tocar primeiro na vermelha; se não tocar, é castigo de 7.',
      'Bola da vez é a de menor valor na mesa (ela ganha um anel dourado).',
      'Bater primeiro na bola da vez é tacada livre. Se ela cair, você marca os pontos, ela sai da mesa e você ganha uma tacada livre em qualquer bola (essa marca e volta para a marca). Se errar, passa a vez sem castigo.',
      'Bater primeiro em outra bola é tacada de castigo: essa bola tem que cair. Caiu: marca os pontos, ela volta para a marca e a próxima tacada é obrigatoriamente na bola da vez. Não caiu: castigo de 7.',
      'A bola da vez e outra caindo juntas: contam as duas.',
      'Branca na caçapa: castigo de 7, e o próximo põe a branca no "D".',
      'Castigo: os pontos são divididos por igual entre os outros jogadores; a sobra da divisão sai de quem errou (com 2 jogadores, o outro leva tudo).',
      'Acaba quando a mesa fica limpa; vence quem tiver mais pontos. Sozinho, falta não dá ponto a ninguém.',
    ],
  },
  snooker: {
    tagline: 'Vermelha, cor, vermelha, cor… e as cores em ordem no fim.',
    items: [
      '15 vermelhas valem 1. Cores: amarela 2, verde 3, marrom 4, azul 5, rosa 6, preta 7.',
      'Saída com a branca no "D".',
      'Com vermelhas na mesa: encaçape uma vermelha e depois uma cor. A cor volta para a marca, e você repete.',
      'Sem vermelhas: as cores em ordem, da amarela à preta, e elas ficam fora.',
      'Falta: bater primeiro na bola errada, encaçapar a bola errada, não acertar nada ou a branca na caçapa. Vale no mínimo 4 pontos (ou o valor da maior bola envolvida), divididos por igual entre os outros jogadores; a sobra da divisão sai de quem errou (com 2 jogadores, o outro leva tudo).',
      'Acaba quando a mesa fica limpa; vence quem tiver mais pontos. Versão simplificada: sem "miss" e sem "free ball".',
    ],
  },
};

export const CONTROLS = [
  'Mirar: toque ou clique na mesa (vista de cima) ou arraste para os lados (vista de mira). Setas ← → giram de pouquinho; com Shift, mais rápido.',
  'Força: toque ou arraste na barra (mais em baixo, mais forte) ou use a rodinha do mouse.',
  'Tacar: botão Tacar ou barra de Espaço.',
  'Efeito: arraste o ponto vermelho na bolinha branca ou use W A S D (para cima = seguida, para baixo = puxada, para os lados = efeito lateral).',
  'Bola na mão: arraste a branca para onde quiser.',
  'Durante a tacada: Pular (ou Espaço) vai direto para o fim, menos quando alguma bola vai cair.',
];
