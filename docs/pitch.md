# Pitch (5 minutos no máximo, escrito para 4:30)

O guião que se diz está em **inglês** (há jurados holandeses). As notas de palco estão em português.
Regras do guião: frases curtas, sem siglas por explicar, um número de cada vez. As linhas **Palco:** são
indicações e não se dizem. O relógio é o tempo desde a primeira palavra; quem segura o cronómetro faz sinal
aos **4:00**.

**Um só momento wow:** o telemóvel a vibrar com o relatório no fim do ato 3. Tudo o que vem antes prepara esse
momento; nada depois o tenta superar.

**Números permitidos:** o 11% do estudo da Leaseweb (`docs/research/stats-and-sources.md`), o N do isco e o
relógio de exposição medidos ao vivo. Mais nenhum no palco. O estudo é sobre empresas de 500 a 5 000
pessoas: dizer "companies", nunca "SMEs".

## Decisões em aberto

- [ ] **TODO(David): quem narra e quem conduz a demo.** Proposta: uma pessoa narra de frente para o júri e
  nunca toca no portátil; outra conduz (painel, terminal) e não fala; a terceira segura o telemóvel e o
  cronómetro. Decidir os nomes.
- [ ] **TODO(David): demo ao vivo ou vídeo de recurso.** Proposta: ao vivo, com o vídeo gravado às 14:30 aberto
  noutro separador. Regra de corte: se um passo não aparecer em 10 s, o narrador diz a frase do plano B e o
  condutor passa o vídeo a partir desse ato. Decidir se é ao vivo, vídeo, ou ao vivo com corte.

## Ordem dos slides

Como no esqueleto que já usámos: **slides principais** para os 4:30, depois **anexos** que só se abrem nas
perguntas. O desenho está em `docs/material/design/pitching.pen` (Pencil).

| # | Slide | No ecrã (poucas palavras) | Relógio |
|---|---|---|---|
| 1 | Abertura a frio | `11%` · o N do isco | 0:00–0:25 |
| 2 | A tese | "Migration is when you get breached." | 0:25–0:30 |
| 3 | Demo ao vivo | "Watch the door close." · Migrate → Attack → Defend (o slide sai e entra o painel) | 0:30–2:50 |
| 4 | Como funciona | O diagrama: migrador → atacante → defesa → Telegram → API Leaseweb | 2:50–3:30 |
| 5 | Salvaguardas | "AI writes. Code acts. You approve." | 3:30–3:50 |
| 6 | Encaixe com a Leaseweb | "Leave on your own terms. Safely." | 3:50–4:15 |
| 7 | Equipa e fecho | "Open source. Ready to continue." + link do repo | 4:15–4:30 |

### Anexos (só nas perguntas)

Cada anexo responde a uma pergunta provável em `docs/perguntas-juri.md`. Saltar direto para ele; não percorrer.
No Pencil, os anexos estão na segunda fila, por baixo dos slides principais. A linha de auditoria do A4 é um
exemplo: trocar pela linha real da demo antes do pitch.

| Anexo | Pergunta que o abre | No ecrã |
|---|---|---|
| A1 · A chamada à API | "Is the Leaseweb part real?" / "What if the call fails halfway?" | As duas chamadas, `202`, e o ciclo `CREATING` → `ACTIVE` |
| A2 · O que migra hoje | "Does it work beyond this demo?" | S3 → MinIO, SQS → RabbitMQ, RDS → PostgreSQL; Lambda e IAM "need redesign" |
| A3 · O que a IA faz e não faz | "What does the AI actually decide?" | Explica, classifica, escreve o relatório. Não executa. |
| A4 · Auditoria e inverso | "Audit trail?" | Uma linha de `auditoria.jsonl`: quem, quando, antes, inverso |
| A5 · O atacante tem trela | "Isn't an attacking agent risky?" | `ALVOS_PERMITIDOS`, limite de tentativas, nada destrutivo |
| A6 · Modo noite | "What if nobody answers?" | Medida temporária e reversível, só da lista "segura sem aprovação" |

## Atalhos de palco

Adaptado do esqueleto do deck anterior: cada tecla tem um dono e uma só função.

| Tecla / gesto | Quem | O que faz |
|---|---|---|
| → · Espaço | Condutor | Slide seguinte |
| Alt+Tab | Condutor | Slides ↔ painel (`/` e `/isco`) |
| Saltar para o anexo | Condutor | Abrir o anexo pedido na pergunta (lista acima, de cor) |
| B (ecrã preto) | Condutor | Durante o ato 3, enquanto todos olham para o telemóvel |
| Vídeo de recurso | Condutor | Separador já aberto, posicionado no início de cada ato |
| Telemóvel | Terceira pessoa | Aprovar no grupo "Direção" e levantar o telemóvel quando vibrar |

## Guião

### 1 · Abertura a frio, 0:00–0:25 (slide 1)

**Palco:** sem "olá, somos a equipa X". O slide 1 já está no ecrã quando o júri dá o sinal. Atualizar o N às
15:40 (`docs/demo.md`, "Contar tentativas no isco") e escrevê-lo no slide.

> Only eleven percent of companies could leave their cloud provider in three weeks. That's Leaseweb's own
> survey, this autumn.
>
> This machine is on Leaseweb. It went online at eight this morning. Since then, it has had **N** login
> attempts. Nobody told anyone it exists.

**Palco:** pausa de um segundo. Avançar para o slide 2.

### 2 · A tese, 0:25–0:30 (slide 2)

> Leaving takes months. And migration is when you get breached. So we built an agent that moves you to
> Leaseweb, and defends you while you move.

### 3 · Demo ao vivo, 0:30–2:50 (slide 3, depois o painel)

**Palco:** tudo o que é lento (lançar VMs, subir contentores) já está feito antes do pitch. Em palco só correm a
tradução, o ataque e a resposta. O narrador diz o que se vê; nunca lê o ecrã palavra a palavra.

#### Ato 1 · Migrar, recusando o que é inseguro, 0:30–1:10

**Palco:** Alt+Tab para o painel. No Telegram, o Migrador publica o plano.

> This app runs on AWS. We simulate the AWS side; everything on Leaseweb is real.
>
> The migrator reads the AWS config and translates it. The translation is plain code, not AI, so it can't
> invent infrastructure.
>
> And look what it refuses: a database open to the whole internet. It won't copy that. Secrets are flagged by
> name, never copied by value.

**Palco:** tocar em **Aprovar** no telemóvel. Os ficheiros copiam-se, os checksums batem certo.

#### Ato 2 · O ataque entra, 1:10–1:45

> But every migration opens a temporary door. Here, a weak password left open so the data could move.
>
> Our attacker agent goes for it. It can only touch our own machines, and it's in.

**Palco:** o painel mostra a entrada do atacante. Deixar ver 3 segundos em silêncio.

#### Ato 3 · Detetar, conter, corrigir, acabar, 1:45–2:50

> The defense agent sees it, and explains it in plain words. The AI writes the explanation. It doesn't choose
> the action.
>
> The action comes from a closed list in the code, and a human approves it.

**Palco:** tocar em **Fechar**. A regra sai pela API da Leaseweb; o `nmap` passa de `open` a `filtered`; a
migração acaba. O condutor carrega em **B**. A terceira pessoa levanta o telemóvel.

> The door is closed. The migration finishes. And the owner gets this.

**Palco:** o telemóvel vibra com o relatório do Chefe. **Silêncio de 2 segundos.** É o momento wow.

> Exposed for **T** seconds. In that time, our bait machine got **X** attempts. Fixed, verified, and every step
> can be undone.

**Palco:** T e X vêm do relógio de exposição no painel. Dizer os números do ecrã, nunca arredondar.
**Plano B:** se um passo não aparecer em 10 s: "We recorded this at two-thirty, just in case." Passar o vídeo
desse ato. Não depurar em palco.

### 4 · Como funciona, 2:50–3:50 (slides 4 e 5)

**Palco:** slide 4, o diagrama. Apontar cada caixa uma vez.

> Three agents, one flow. The migrator translates, deterministically. The attacker tests the new
> infrastructure. The defense closes what it finds.
>
> These are two real calls to the Leaseweb API: `revokeFirewallRules` closes the rule, `authorizeFirewallRules`
> puts it back. We read the rule again until Leaseweb confirms it.

**Palco:** slide 5, salvaguardas.

> The AI writes text. Only that. Every action has its inverse stored, and an audit line: who, when, before,
> after. The model runs in the EU, so security data never leaves it.

### 5 · Impacto e fecho, 3:50–4:30 (slides 6 e 7)

**Palco:** slide 6.

> Leaseweb's survey says companies want to leave, and can't. We turn that barrier into an onboarding path:
> customers arrive already secure.
>
> Sovereignty without security just moves the problem. This lets businesses leave on their own terms,
> safely.

**Palco:** slide 7.

> Everything you saw was built today. It's open source, and ready to continue. Thank you.

**Palco:** parar de falar. Ficar no slide 7 para as perguntas.

## Cada critério tem o seu momento

Dão a nota em tempo real, pela ordem do slide deles. Cada critério fica visível antes de passarmos ao seguinte.

| Critério (ordem do slide) | Momento que o ganha | Relógio |
|---|---|---|
| **Inovação** | A tese e o ato 2: migração e defesa no mesmo agente; ninguém protege a janela de migração | 0:25–1:45 |
| **Aplicabilidade** | O 11% do estudo da Leaseweb, o N do isco e a demo a correr na Leaseweb real | 0:00–2:50 |
| **Complexidade técnica (IA + cloud)** | Tradução determinística, IA só a explicar, lista fechada com inverso, modelo na UE, as duas chamadas à API | 2:50–3:50 |
| **Apresentação** | O telemóvel a vibrar, o relógio de exposição e o fecho com o impacto | 2:30–4:30 |

## Ensaio

- Ensaiar para 4:30, com cronómetro. Se passar dos 4:40, cortar falas do bloco 4, nunca da demo.
- 150 palavras por minuto: as falas acima têm cerca de 365 palavras (~2:25), o que deixa ~2:00 para o que
  se vê em silêncio na demo (cópia, ataque, `nmap`, a pausa do telemóvel).
- Antes de subir: N atualizado, vídeo de recurso aberto, telemóvel com som e vibração, grupo "Direção" limpo.

## Perguntas prováveis do júri

Respostas completas em `docs/perguntas-juri.md`. Uma frase, um facto, parar.

| Pergunta | Resposta |
|---|---|
| O que foi feito hoje? | Tudo o que mostrámos: os três agentes, a ligação à API da Leaseweb, a aprovação no Telegram e a auditoria. A experiência vem do nosso trabalho em segurança; o código é de hoje. |
| E se a IA fechar a coisa errada? | A IA não decide nem executa: só escreve a explicação. As ações vêm de uma lista fechada, o dono aprova, o inverso fica guardado e desfaz-se com um clique. |
| Atacar não é perigoso? | Só toca em IPs de uma allowlist, que são máquinas nossas; tentativas limitadas, nada destrutivo, para na primeira entrada. |
| Porque não o GPT? | Os dados de segurança do cliente não devem sair da UE. Usamos fornecedores europeus de inferência. |
| Porque a Leaseweb? | É a vossa tese de soberania. Ajudamos empresas a vir para a vossa cloud sem ficarem expostas. |
| Modelo de negócio? | Estamos a validar. Não inventar números. |
