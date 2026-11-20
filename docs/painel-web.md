# Interface web (painel)

Sim, faz sentido ter uma página: o Telegram é onde o dono decide, o painel é onde o júri **vê** o que está a acontecer. Fica no cérebro, servida pelo `painel/`, projetada durante a demo ao lado do telemóvel espelhado.

Desenho em `docs/material/design/web.pen`. Quem faz: Enio Carlos (com as horas do orquestrador).

## Um só ecrã, 4 zonas (nível A: uma tabela simples também serve)

1. **Topo: relógio de exposição.** Grande: "Exposto 38 s" a contar em direto até a porta fechar; depois fica fixo e verde. Ao lado, "neste tempo o isco recebeu X tentativas". É o número do fecho do pitch.
2. **Esquerda: linha do tempo dos agentes.** Uma linha por evento, com a cor de cada agente: Migrador (azul), Atacante (vermelho), Defesa (verde), Chefe (cinzento). Hora, agente, frase curta. É a mesma conversa do grupo "Direção", em grande.
3. **Centro: a infraestrutura.** Três caixas: "AWS (simulada)", "Leaseweb", "vítima". Setas que acendem quando os dados passam e quando o atacante encontra a porta. A porta 5432 aparece a vermelho "aberta" e passa a verde "fechada".
4. **Direita: provas.**
   - Migração: objetos copiados, checksums iguais (✓), testes antes e depois (✓ ✓).
   - Defesa: `nmap` antes (`open`) e depois (`filtered`), a auditoria com o inverso guardado e o botão **Desfazer**.

## Ecrãs extra (nível B)

- **/isco:** só o contador de tentativas e IPs distintos, para a abertura do pitch.
- **/certificado:** o certificado de migração (ver `ideias-wow.md`), pronto a imprimir.
- **QR code** para o grupo "Direção", para o jurado entrar e aprovar.

## Regras

- Atualiza a cada 2 segundos (ou por SSE). Sem login: corre só no cérebro e a porta do painel só está aberta ao nosso IP.
- Letra grande: é para ser lido num projetor do fundo da sala.
- Fundo escuro, poucas cores, só as dos agentes e verde e vermelho para o estado.
- Nada de números inventados: tudo vem de `estado.json` e de `auditoria.jsonl`.
