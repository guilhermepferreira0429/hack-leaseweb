# Pitch (5 minutos, em inglês; ensaiar para 4:30)

Plano do Guilherme (20/11, 10:57), ajustado ao regulamento e às notas do júri. Slides do David em `material/design/pitching.pen`. Dados com fonte em `research/stats-and-sources.md`: usar no máximo 3 números.

## A história numa frase

Soberania não é só ser europeu, nem só ser seguro. É estar na Europa, seguro, conforme e com controlo, tudo ao mesmo tempo. Nós fazemos as quatro coisas num só fluxo, em minutos, e o dono só precisa do Telegram.

## Estrutura

| Tempo | Parte | O que se diz e mostra |
|---|---|---|
| 0:00–0:20 | **Abertura a frio** | Ecrã do isco: "This machine went online at 8 a.m. It has received **N** login attempts since." Depois: "Leaseweb's own survey this year: only 11% of companies can leave their cloud provider within three weeks." |
| 0:20–0:50 | **A tese: soberania completa** | **Animação de junção:** quatro peças entram e encaixam numa só: *European* · *Secure* · *Compliant* · *In control* → **Sovereign**. Frase: "Being European is not enough. Being secure is not enough. Sovereignty is all of it at once." Um número de apoio: má configuração é a causa principal de incidentes graves na cloud (45%, SANS 2026). |
| 0:50–1:05 | **Para quem** | "Most small business owners are not technical. So we put the whole team in the app they already use: Telegram." Mostrar o grupo "Direção" com os 4 agentes. (Usar um número só se tiver fonte; senão dizer sem número.) |
| 1:05–3:30 | **Demo ao vivo** (painel web + terminal + Telegram) | Os passos abaixo. No ecrã: o painel diz **que agente está a agir e o que está a pensar**; ao lado, o **terminal** mostra os comandos que ele executa; o **Telegram** espelhado ou nas mãos do júri. |
| 3:30–4:05 | **Como funciona** | 20 s de arquitetura: 4 agentes, bus interno, API da Leaseweb (mostrar 2 chamadas reais), IA na UE. Salvaguardas: a IA só escreve, ações de lista fechada, humano aprova, tudo tem inverso e auditoria. "The AWS side is simulated; everything on Leaseweb is real." |
| 4:05–4:40 | **Impacto** | "In **X minutes** we took a company off a hyperscaler, onto European infrastructure, secured it, fixed the cause in code, and produced an audit-ready record." Mostrar o certificado. Ligar à Leaseweb: "This turns the migration barrier in your survey into a way in for new customers." |
| 4:40–5:00 | **Fecho** | "Sovereignty without security just moves the problem. This lets businesses leave on their own terms, safely. It's open source and ready to continue." |

## Os passos da demo (1:05–3:30)

Cada passo aparece no painel com o agente que está a agir, o que está a pensar (1 frase) e os comandos no terminal.

1. **Decidir para onde migrar** (Migrador + decisor): lê a app "AWS", mostra o plano: o que fica em self-hosted na Leaseweb e o que vai para gerido. ~15 s.
2. **Pedir confirmação** no Telegram. **Aqui o júri pode aprovar** (QR no ecrã do isco). Se não der, aprova o dono. ~10 s.
3. **Migrar**: dados copiados, checksums iguais, testes a passar. ~20 s.
4. **Atacar** (Atacante): encontra a porta aberta na infraestrutura nova. `nmap`: open. ~15 s.
5. **Defender** (Defesa): explica, pede aprovação, fecha pela API. `nmap`: filtered. Relógio de exposição para. ~25 s.
6. **Migrar o código** (Migrador de código): abre o PR que muda o endpoint e corrige a causa da porta aberta. ~15 s.
7. **Validar tudo**: testes da app de novo, atacante confirma que já não chega lá. ~10 s.
8. **Relatório**: o Chefe envia o certificado no Telegram; o painel mostra-o. ~15 s.

Total: cerca de 2 min 05 s. Folga de 20 s para o que demorar.

## Regras para caber em 5 minutos

- **Tudo o que é lento faz-se antes:** VMs ligadas, contentores no ar, dados da "AWS" já carregados. Em palco só correm decisão, migração (pequena), ataque, defesa, PR, validação e relatório.
- **Um botão para arrancar a demo** (`npm run demo`). Ninguém escreve comandos em palco.
- **Se um passo falhar:** a narração continua e passa-se ao seguinte; se a demo morrer, vídeo das 14:30.
- **Corte se apertar:** primeiro o passo 6 (fica no slide), depois o 1 (o plano aparece já decidido). Os passos 4 e 5 nunca se cortam.

## Cuidados com as palavras

- **"Regulamentada"**: não dizer que a empresa fica "conforme" ou "certificada". Dizer **"audit-ready record"** ou "registo pronto para auditoria, RGPD e NIS2". O certificado não é uma certificação oficial.
- **"X minutos"**: usar o tempo medido na demo, não um número redondo.
- **Percentagem de donos não técnicos**: só com fonte. Se não houver, a frase funciona sem número.
- **Estudo da Leaseweb**: cobre empresas de 500 a 5.000 trabalhadores, não PME. Dizer "companies".

## Quem fala

- **Guilherme:** abertura, tese, impacto e fecho.
- **David:** narra a demo (Telegram e agentes).
- **Enio Carlos:** "como funciona" (API da Leaseweb, salvaguardas) e conduz a demo no portátil.

## Animação de junção (para o David)

Quatro cartões no estilo Zafe (fundo `#0C1715`, menta `#7DD3A8`, títulos em Instrument Serif): *European*, *Secure*, *Compliant*, *In control*. Entram um a um a partir dos cantos (0,4 s cada), juntam-se ao centro e fundem-se numa só palavra: **Sovereign**. Por baixo, em Geist Mono pequeno: "migrate · secure · fix · prove". Duração total: cerca de 4 s.

## Camada "Shark Tank" (proposta do David, por cima do plano acima)

Não muda os passos da demo nem quem fala. Muda a forma: como no Shark Tank, dizemos **o que pedimos** logo no
início, deixamos o júri **provar o produto**, mostramos **números medidos hoje** como tração e voltamos ao
**pedido** no fim. Adaptado a um hackathon: não pedimos dinheiro nem damos percentagens da empresa.

### As batidas, no tempo do plano acima

| Tempo | Batida Shark Tank | O que muda | Frase (inglês) |
|---|---|---|---|
| 0:00–0:20 | **A entrada** | Igual: isco N + 11% | (como acima) |
| 0:20–0:30 | **O pedido logo à cabeça** | Novo, 10 s, antes da tese | "We're here with one ask: make leaving a hyperscaler a matter of minutes, not months, and safe. In the next four minutes we'll prove it, live, on Leaseweb." |
| 0:30–0:50 | **O problema com números** | A tese das quatro peças, com o número 49% | "Half of companies need more than a day to close a critical gap they already know about. Migration is when those gaps open." |
| 0:50–1:05 | **Para quem** | Igual | (como acima) |
| 1:05–3:20 | **A prova: o júri experimenta** | Igual aos 8 passos. O passo 2 é o "sample" do Shark Tank: um jurado aprova no telemóvel dele | "Go ahead, you're the owner now. Tap approve." |
| 3:20–3:40 | **A tração: o placar de hoje** | Novo slide de números medidos (ver abaixo); tira 15 s ao "como funciona" | "Today: **X** minutes from AWS to Leaseweb. Exposed for **T** seconds, not a day. **179** tests. Every step on the record." |
| 3:40–4:00 | **Como funciona** (curto) | 20 s em vez de 35 s; o resto vai para os anexos | (como acima, só as 2 chamadas e as salvaguardas) |
| 4:00–4:20 | **O mercado** | O número 73% e a frase do co-CEO da Leaseweb | "Seventy-three percent would pay more for independence. In the Netherlands, eighty-one. The demand is there. What's missing is a safe way out." |
| 4:20–4:30 | **O pedido outra vez + fecho** | Fecho de sempre, a fechar o pedido | "So, our ask: let this be the open-source way in to Leaseweb. Customers arrive already secure. Sovereignty without security just moves the problem." |

### Os números (verificados nas fontes a 20/11, 11:06)

Três números de fora no palco, cada um a falar a uma parte do júri, e o resto medido ao vivo.

| Número | Para quem fala | Fonte e cuidado |
|---|---|---|
| **11%** conseguem sair do fornecedor principal em três semanas | Leaseweb (o estudo é deles) | Leaseweb Digital Independence Survey 2026, 800 executivos, EUA e Europa (ITPro, Channel Insider). Empresas de 500 a 5 000 pessoas: dizer "companies". |
| **49%** precisam de mais de 24 h para fechar uma falha crítica que já conhecem | Segurança e setor regulado; contrasta com o nosso **T** em segundos | SANS 2026 Cloud Security Survey (Infosecurity Magazine). Frase da SANS que encaixa: "What makes it persist is not the attacker. It is the distance between finding the gap and fixing it." |
| **73%** pagariam pelo menos 11% mais pela independência (**81%** nos Países Baixos) | Estratégia de produto da Leaseweb; os jurados holandeses | Mesmo estudo da Leaseweb (ITPro). |
| N, T, X minutos, testes | Todos: é a nossa tração | Medidos no dia. Recontar os testes às 15:30 (179 a 20/11 às 11:10, em 16 ficheiros). |

**Proposta:** trocar o 45% da tese (má configuração, SANS) pelo 49% (mais de um dia a fechar). O 45% diz que a
falha existe; o 49% diz que fica aberta, e é isso que o nosso T em segundos desmente. O 45% fica para as perguntas.
Decisão do Guilherme, que fecha a tese.

**De reserva (só nas perguntas):** IBM Cost of a Data Breach 2026 (Ponemon, 602 organizações): custo médio de
$4.99M por fuga; quem usa IA e automação na segurança poupa quase $2M; uma em quatro ainda não usa. 78% das
empresas do estudo da Leaseweb já tomaram medidas para depender menos de um fornecedor. 55% precisam de mais de
três meses (65% nos Países Baixos, média de 4,7 meses).

**Não usar:** os 75% e 38% da OpenText (a página dá 403 e não foi possível confirmar) e o Unit 42 (é de 2021).

### O pedido, em concreto

O Shark Tank vive do pedido. Num hackathon, o pedido é o que queremos que o júri faça com o projeto:

- **À Leaseweb:** usar isto como a porta de entrada de quem sai de um hyperscaler (o mesmo público de MSPs e
  parceiros que o estudo deles aponta).
- **A toda a gente:** é open source e Apache 2.0, pronto a continuar.
- Nunca dizer preços, receitas nem clientes: não os temos.

### A grelha do júri ("the grilling")

No Shark Tank perde-se nas perguntas, não no pitch. Respostas de uma frase em `docs/perguntas-juri.md`; estas são
as perguntas à Shark Tank que lá faltam:

| Pergunta | Resposta (inglês, uma frase) |
|---|---|
| "Why wouldn't Leaseweb just build this?" | "You could, and it's open source so you can start from ours today; what we built is the flow, migrate, attack, fix, prove, in one place." |
| "What's your moat?" | "No moat, on purpose: it's open source; the value is that it runs on your API and makes customers arrive secure." |
| "Does this scale past a demo app?" | "The translation is plain code and tested; today it covers S3, SQS, RDS and ElastiCache, and flags what needs redesign instead of guessing." |
| "Who pays?" | "We haven't validated pricing; the natural buyers are companies leaving a hyperscaler and the partners who migrate them." |
| "Half a day of work, why trust it?" | "Don't trust us, check it: 179 tests, an audit line for every action, and every action can be undone." |
| "What would you do with one more month?" | "More services in the translator, the code-fix PR step finished, and the report shaped for NIS2 and DORA notifications." |
