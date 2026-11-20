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
