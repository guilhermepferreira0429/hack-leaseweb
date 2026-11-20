// Guião do pitch, palavra a palavra. O que se diz está em inglês (há jurados holandeses); as notas de palco em português.
// Por slide: `parte`, `quem` fala, `segundos` previstos e `falas`.
// Cada fala: `passo` (o clique em que começa), e `texto` (diz-se), `palco` (indicação, não se diz) ou `espera`
// (segundos em que ninguém fala enquanto o ecrã trabalha; contam para o tempo).
// {n}, {t}, {x} e {testes} são trocados pelos números ao vivo (config.js ou tecla E).
// `node pitch/tempo.js` dá o total a 150 palavras por minuto e falha acima dos 4:30.
(typeof window !== 'undefined' ? window : globalThis).GUIAO = {
  abertura: {
    parte: '1. A entrada',
    quem: 'Guilherme',
    segundos: 17,
    falas: [
      { passo: 0, palco: 'O slide já está no ecrã quando o júri se senta. Esperar pelo sinal. Sem "olá, somos a equipa X".' },
      { passo: 0, texto: 'This machine went online on Leaseweb at eight this morning. Since then: {n} attempts to break in. Nobody told anyone it exists.' },
      { passo: 1, texto: "Now, Leaseweb's own survey this year: only eleven percent of companies could leave their cloud provider in three weeks." },
    ],
  },

  pedido: {
    parte: '2. O pedido',
    quem: 'Guilherme',
    segundos: 10,
    falas: [
      { passo: 0, palco: 'Shark Tank: o pedido vem logo à cabeça. Olhar para o júri, não para o ecrã.' },
      { passo: 0, texto: "We're here with one ask: leaving a hyperscaler should take minutes, not months, and be safe. In the next four minutes, we'll prove it, live." },
    ],
  },

  soberania: {
    parte: '3. A tese',
    quem: 'Guilherme',
    segundos: 12,
    falas: [
      { passo: 0, texto: 'Being European is not enough.' },
      { passo: 1, texto: 'Being secure is not enough.' },
      { passo: 2, texto: 'Or compliant.' },
      { passo: 3, texto: 'Or in control.' },
      { passo: 4, palco: 'As quatro peças juntam-se numa palavra. Meio segundo de silêncio antes de falar.' },
      { passo: 4, espera: 1, texto: 'Sovereignty is all of it, at once.' },
    ],
  },

  problema: {
    parte: '4. O problema',
    quem: 'Guilherme',
    segundos: 13,
    falas: [
      { passo: 0, texto: "And here's the catch: half of companies need more than a day to close a critical gap they already know about." },
      { passo: 1, texto: "Migration is exactly when those gaps open. You'll see us close one in seconds." },
    ],
  },

  'para-quem': {
    parte: '5. Para quem',
    quem: 'Guilherme',
    segundos: 10,
    falas: [
      { passo: 0, texto: "Most business owners aren't technical. So we put the whole IT team where they already are: in Telegram. Four agents, one group." },
      { passo: 0, palco: 'Passar a palavra ao David com o olhar. O Enio já tem o painel pronto.' },
    ],
  },

  demo: {
    parte: '6. A prova (demo ao vivo)',
    quem: 'David narra · Enio conduz',
    segundos: 130,
    falas: [
      { passo: 0, palco: 'Enio: tecla D abre o painel por cima do slide; D outra vez volta à lista de passos. Enio não fala. David narra o que se vê, nunca lê o ecrã.' },
      { passo: 0, texto: 'This little app runs on AWS. We simulate the AWS side; everything on Leaseweb is real.' },
      { passo: 1, espera: 5, texto: "First, the migrator reads it and decides where each piece goes: self-hosted on Leaseweb, or a managed European service. The translation is plain code, so it can't invent infrastructure." },
      { passo: 2, palco: 'Um jurado só consegue aprovar se o ID do Telegram dele estiver em TELEGRAM_APROVADORES (o bot ignora os outros). Sem isso, aprova o dono. Se não aprovar em 10 s, aprova o dono.' },
      { passo: 2, espera: 8, texto: "It asks before it touches anything. Only the owner can approve. Today, that's us." },
      { passo: 3, espera: 12, texto: "Data copied. Checksums match. The app's tests pass on both sides." },
      { passo: 4, espera: 8, texto: 'Now our attacker, with permission and only against our own machines, scans the new infrastructure. A database, open to the whole internet.' },
      { passo: 5, palco: 'Aprovar "Fechar". nmap: open passa a filtered. O relógio de exposição para.' },
      { passo: 5, espera: 10, texto: 'The defense agent explains it in plain words. The AI only writes the text. The action comes from a closed list, and a human approves.' },
      { passo: 6, palco: 'O PR vem do migrarCodigo (já ligado no orquestrador). Se não aparecer: dizer só "Closed." e avançar.' },
      { passo: 6, espera: 5, texto: "Closed. And so it doesn't come back on the next deploy, the code migrator opens a pull request that fixes the cause." },
      { passo: 7, espera: 5, texto: "The app's tests run again. The attacker confirms: it can't get in any more." },
      { passo: 8, palco: 'O MOMENTO WOW. O telemóvel vibra: relatório do incidente (um botão Desfazer por passo) e o certificado do Chefe. Silêncio de 2 s. Levantar o telemóvel. Enio: tecla C mostra o certificado no ecrã.' },
      { passo: 8, espera: 6, texto: 'And the owner gets this: a migration certificate. Where every piece of data now lives, proof nothing was lost, what was attacked, and who closed it.' },
      { passo: 8, palco: 'Se um passo não aparecer em 10 s: "We recorded this at two-thirty, just in case." Tecla V. Não depurar em palco.' },
    ],
  },

  tracao: {
    parte: '7. A tração',
    quem: 'Guilherme',
    segundos: 13,
    falas: [
      { passo: 0, palco: 'Antes de falar: confirmar X, T e N no ecrã (tecla E se faltar algum).' },
      { passo: 0, texto: '{x} minutes, from a hyperscaler to European infrastructure: secured, fixed and on the record. Exposed for {t} seconds, not a day. {testes} automated tests. All built today.' },
    ],
  },

  'como-funciona': {
    parte: '8. Como funciona',
    quem: 'Enio Carlos',
    segundos: 15,
    falas: [
      { passo: 0, texto: "Two layers. Your server runs open, self-hosted services in place of AWS. The provider's API handles the firewall: on Leaseweb, revoke closes a port in about three seconds, measured today, and authorize puts it back." },
    ],
  },

  salvaguardas: {
    parte: '9. Salvaguardas',
    quem: 'Enio Carlos',
    segundos: 10,
    falas: [
      { passo: 0, texto: 'The AI writes. The code acts. You approve. Every action keeps its inverse and an audit line. The model runs in the EU.' },
    ],
  },

  'a-seguir': {
    parte: '10. O que vem a seguir',
    quem: 'Guilherme',
    segundos: 10,
    falas: [
      { passo: 0, palco: 'Dizer que ainda não está feito. Hostinger e OVHcloud não funcionam hoje: não dar a entender que sim.' },
      { passo: 0, texto: 'Next, not built yet: the same flow for other providers, or your own machine over SSH, and reports shaped for NIS2 and DORA.' },
    ],
  },

  mercado: {
    parte: '11. O mercado',
    quem: 'Guilherme',
    segundos: 13,
    falas: [
      { passo: 0, texto: "Is there demand? Leaseweb's survey: seventy-three percent would pay more for independence." },
      { passo: 1, texto: "In the Netherlands, eighty-one. The demand is there. What's missing is a safe way out." },
    ],
  },

  fecho: {
    parte: '12. O pedido outra vez e o fecho',
    quem: 'Guilherme',
    segundos: 17,
    falas: [
      { passo: 0, texto: 'So, our ask: make this the safe way in to Leaseweb. Customers arrive already secure.' },
      { passo: 0, texto: 'Leave in minutes. Close in seconds. That is sovereignty you can prove. It is open source, and ready to continue. Thank you.' },
      { passo: 0, palco: 'Parar de falar. Ficar neste slide para as perguntas. Tecla A salta para os anexos.' },
    ],
  },
};
