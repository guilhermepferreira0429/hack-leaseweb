# Mensagens da demo, passo a passo

Para cada passo: quem fala, a linha **pensar** (painel), a **mensagem** (Telegram, grupo "Direção"), os **botões** e o **terminal** (o que o painel mostra a correr). As variáveis `{...}` vêm do estado e da auditoria. Se um valor não existir, escreve "não medido".

## 0. Abertura (antes da demo)

- **Chefe** · pensar: "A preparar a equipa."
- Mensagem: `Bom dia. Vamos tirar a app {app} da AWS e trazê-la para a Leaseweb, com segurança. Eu aviso em cada passo.`

## 1. Decidir para onde migrar

- **Migrador** · pensar: "A ler a app e a decidir onde fica cada serviço."
- Terminal: `analisar exemplo-app` → lista de serviços encontrados.
- Mensagem:
  ```
  Encontrei {n_servicos} serviços da AWS na app: {lista_servicos}.
  Proposta:
  · {servico_1} → {destino_1} ({self_ou_gerido_1})
  · {servico_2} → {destino_2} ({self_ou_gerido_2})
  · {servico_3} → {destino_3} ({self_ou_gerido_3})
  A VM tem {ram_livre} GB livres. {motivo_regra}
  ```
- Botões: `Aprovar plano` · `Tudo self-hosted` · `Porquê?`

## 2. Confirmação

- **Chefe** · pensar: "À espera da aprovação."
- Depois do toque: `Plano aprovado por {quem} às {hora}. @migrador, avança.`
- **Nota:** é aqui que o júri pode aprovar (QR no ecrã do isco).

## 3. Migrar

- **Migrador** · pensar: "A copiar os dados e a comparar checksums."
- Terminal: `migrar s3 → minio` · contagem a subir · `checksum ✓`
- Mensagem:
  ```
  Migração concluída.
  · Ficheiros: {n_objetos} copiados · checksum {ok_s3}
  · Base de dados: {n_linhas} linhas · checksum {ok_bd}
  · Testes da app: antes {ok_antes} · depois {ok_depois}
  A infraestrutura nova está no ar. @atacante, a tua vez.
  ```

## 4. Atacar

- **Atacante** · pensar: "A ver o que se vê de fora nas nossas máquinas."
- Terminal: `nmap -Pn -p {portas} {ip_vitima}` → `5432/tcp open`
- Mensagem:
  ```
  Encontrei a base de dados nova aberta a toda a Internet (porta {porta}).
  Gravidade: {gravidade}. Qualquer pessoa pode tentar entrar.
  @defesa
  ```

## 5. Defender

- **Defesa** · pensar: "A explicar o risco e a preparar o fecho reversível."
- Mensagem (a IA pode reescrever as 2 primeiras frases; se falhar, fica este texto):
  ```
  A base de dados com os dados da empresa está aberta a toda a Internet.
  Alguém de fora pode tentar adivinhar a palavra-passe e entrar.
  Proponho fechar o acesso de fora e deixar só a vossa app. Guardo como voltar atrás.
  ```
- Botões: `Fechar` · `Ignorar`
- Terminal depois do toque: `leaseweb: remover regra {regra_id} do grupo {sg}` → `estado: ACTIVE` → `nmap: filtered`
- Mensagem depois:
  ```
  Fechado às {hora_fecho} e confirmado. Tempo exposto: {segundos} s.
  Guardei como voltar atrás: /desfazer {pedido_id}
  @atacante, confirma.
  ```
- **Atacante:** `Confirmo. Já não chego lá.`

## 6. Migrar o código

- **Migrador** · pensar: "A corrigir o código para apontar para a Leaseweb e fechar a causa."
- Terminal: `encontrar usos AWS` → `{n_ficheiros} ficheiros` → `testes ✓` → `PR #{numero}`
- Mensagem:
  ```
  Abri o PR #{numero}: {n_ficheiros} ficheiros alterados, testes a passar.
  · A app passa a usar a Leaseweb em vez da AWS.
  · Corrigi a configuração que deixava a base de dados aberta, para não voltar no próximo deploy.
  ```
- Botões: `Aprovar PR` · `Ver alterações`

## 7. Validar tudo

- **Chefe** · pensar: "A confirmar que está tudo de pé."
- Terminal: `testes da app` ✓ · `atacante: nova verificação` → nada aberto
- Mensagem: `Validação final: testes ✓, nada exposto ✓, dados iguais ✓.`

## 8. Relatório

- **Chefe** · pensar: "A escrever o certificado a partir da auditoria."
- Mensagem: o certificado de `docs/certificado-migracao.md`, seguido de:
  ```
  Em {minutos} min saímos da AWS para a Leaseweb, fechámos {n_falhas} falha(s) e corrigimos a causa no código. Nada saiu da UE.
  ```

## Respostas fixas úteis

- Dono pergunta algo fora do estado: `Não tenho essa informação. Escreva /estado para ver o ponto da situação.`
- Pedido ignorado: `Ok, fica como está. Fica registado que decidiu não fechar.`
- Erro da API: `A Leaseweb não respondeu a tempo. Não mudei nada. Vou tentar outra vez.`
