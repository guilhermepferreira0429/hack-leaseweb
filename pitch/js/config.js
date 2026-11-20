// Configuração do pitch. Os números ao vivo (N, T, X) também se mudam em palco com a tecla E:
// ficam guardados no browser e passam para a vista do apresentador.
window.CONFIG = {
  // Duração alvo do pitch, em segundos (o regulamento dá 5:00; ensaiamos para 4:30).
  alvoSegundos: 270,
  // Aos quantos segundos o cronómetro avisa que falta pouco (sinal dos 4:00).
  avisoSegundos: 240,

  // Números medidos no dia. null mostra a letra (N, T, X) para se ver que falta preencher.
  aoVivo: {
    n: null, // tentativas de entrada no isco desde as 08:00 (painel /isco)
    t: null, // segundos de exposição (relógio de exposição do painel)
    x: null, // minutos da migração completa, do plano ao relatório
    testes: 179, // `it(` nos ficheiros *.test.ts de code/ (recontar às 15:30)
  },

  // Painel ao vivo (tecla D abre-o por cima do slide, sem Alt+Tab).
  // No portátil, com um túnel SSH para o cérebro: http://127.0.0.1:3000
  painelUrl: 'http://127.0.0.1:3000/',
  iscoUrl: 'http://127.0.0.1:3000/isco',

  // Vídeo de recurso (tecla V). Caminho relativo a index.html.
  videoPlanoB: 'plano-b.mp4',

  repo: 'github.com/guilhermepferreira0429/hack-leaseweb',
  equipa: ['Guilherme', 'David', 'Enio Carlos'],
};
