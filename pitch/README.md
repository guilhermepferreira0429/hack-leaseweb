# Pitch · hack-leaseweb

O deck do pitch de 5 minutos (ensaiado para 4:30), em HTML simples: sem build, sem dependências, sem internet.
São 12 slides: estatísticas e problema primeiro, a demo e o painel ao meio, o antes/depois e o mercado depois, o fecho no fim.
Abre-se com **duplo clique em `index.html`** (Chrome ou Edge), carrega-se em **F** para ecrã inteiro e em **P**
para abrir a vista do apresentador no segundo ecrã. As duas janelas andam juntas.

## Teclas

| Tecla | O que faz |
|---|---|
| → · Espaço · PageDown · clique | Avançar um clique |
| ← · PageUp | Recuar |
| Shift + → / ← | Slide seguinte / anterior |
| número + Enter | Ir para o slide (por exemplo `5` Enter para a demo e `6` para o painel) |
| A, depois 1–9 | Anexos. O A9 mostra todas as perguntas do júri de uma vez. As setas param no fecho e nunca entram nos anexos |
| Esc (num anexo) · End | Voltar ao fecho |
| O | Vista geral de todos os slides |
| P | Vista do apresentador: guião do clique atual, slide seguinte, cronómetro, perguntas (Q) |
| G | Guião completo, pronto a imprimir |
| E | Números ao vivo: N (isco), T (exposição), X (minutos), testes |
| D · I · C | Por cima do slide, sem Alt+Tab: painel ao vivo (`/`), ecrã do isco (`/isco`), certificado (`/certificado`) |
| V | Vídeo de recurso (`plano-b.mp4` ao lado do `index.html`) |
| B | Ecrã preto |
| F | Ecrã inteiro |
| T / Shift+T | Arrancar / zerar o cronómetro (arranca sozinho no primeiro clique) |
| H · Esc | Ajuda / fechar |

## Onde mudar o quê

| Quero mudar | Ficheiro |
|---|---|
| O que se diz, palavra a palavra, quem fala e o tempo de cada parte | `js/guiao.js` |
| Os slides (texto, ordem, cliques) | `js/slides.js` |
| Perguntas do júri e respostas de uma frase | `js/perguntas.js` |
| Números ao vivo por defeito, URL do painel, vídeo, alvo de tempo | `js/config.js` |
| Cores e letra | `estilos/base.css` |
| Aspeto dos slides | `estilos/slides.css` |
| Ecrã, apresentador, vista geral, guião | `estilos/deck.css` e `js/deck.js` |

Para acrescentar um clique a um slide: sobe `passos` em `js/slides.js` e usa ``${ap(p, n)}`` na classe do que deve
aparecer no clique `n`. O guião desse clique vai em `js/guiao.js` com `passo: n`.

## Antes de subir ao palco

1. `node pitch/tempo.mjs`: o guião a 150 palavras por minuto tem de ficar abaixo dos 4:30.
2. Às 15:40, tecla **E**: N do `/isco`; T e X depois do ensaio final (ou ao vivo, entre a demo e o slide 7).
   Uma letra coral sublinhada no slide quer dizer que falta o número.
3. Recontar os testes e pôr em `js/config.js` (`testes`).
4. Pôr `plano-b.mp4` ao lado do `index.html` e testar a tecla V.
5. Com o túnel SSH para o cérebro aberto, testar a tecla D (o painel tem de abrir em `config.painelUrl`).
6. Ver o painel da demo (slide 6) e o antes/depois (slide 10); confirmar N, T, X e testes com **E**.

## Notas

- Os números ao vivo ficam guardados no browser (localStorage). Para limpar: tecla E, apagar, Guardar.
- O painel não manda cabeçalhos CORS, por isso o deck não lê o `/isco?json` sozinho; daí a tecla E.
- `node pitch/servir.mjs` serve a pasta em `http://127.0.0.1:8765/`, para testes com browser automático ou se o
  browser bloquear alguma coisa em `file://`.
- Letras: Geist, Geist Mono e Instrument Serif, SIL Open Font License (`fontes/OFL-*.txt`); Inter e JetBrains Mono ficam como fallback.
- Avatares do grupo "Board" e dos quatro agentes em `avatares/` (de `docs/material/design/telegram-avatars/`).
- O painel da demo (slide 6) é um replay scriptado, em três colunas: agentes (com avatares e "thinking now"), serviços migrados e vítima 5432, logs ao vivo; em baixo, o recibo (5/5, testes, 0 segredos) e o "↺ Undo last action". Não precisa do túnel; a tecla D continua a abrir o painel real. Está marcado **REPLAY**, com "press D for the live panel", para não passar por uma segunda demo ao vivo.
- O desenho original dos slides está em `docs/material/design/pitching.pen` (Pencil, 12 slides na ordem antiga; o painel e o antes/depois são só do deck).
