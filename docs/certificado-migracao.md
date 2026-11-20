# Certificado de migração (ideia 3, nível B)

O que o Chefe envia no Telegram e o painel mostra em `/certificado` no fim da demo. Quem implementa: Guilherme (chefe e orquestrador). Desenho em `material/design/web.pen`, frame "Certificado de migração".

> **Nota de implementação (20/11):** o certificado real é gerado em inglês e o resumo é montado a partir dos campos medidos; a IA não escreve o certificado (`code/chefe/certificado.ts`). O modelo abaixo é o desenho original.

## Fonte dos dados

Tudo vem de ficheiros que já existem. **Nada é escrito à mão nem inventado pela IA.**

| Campo                                            | De onde vem                                                                       |
| ------------------------------------------------ | --------------------------------------------------------------------------------- |
| Identificador e hora                             | Gerado pelo orquestrador no fim (`CERT-AAAAMMDD-HHMM`)                            |
| Serviços migrados                                | Resultado do `migrador` (`analisar` + `migrarS3` + …)                             |
| Onde ficou cada dado                             | Região da instância na API da Leaseweb (`GET /instances`) e fornecedor do decisor |
| Objetos e linhas copiados                        | Resultado do `migrador`                                                           |
| Checksums antes e depois                         | Resultado do `migrador` vs `exemplo-app/seed/esperado.json`                       |
| Testes antes e depois                            | `migrador/verificar.ts`                                                           |
| O que o atacante encontrou                       | `auditoria.jsonl`, eventos do atacante                                            |
| O que a defesa fechou, quem aprovou, a que horas | `auditoria.jsonl`, eventos da defesa                                              |
| Tempo de exposição                               | Relógio de exposição (hora do fim da migração → hora do fecho confirmado)         |
| Ações reversíveis guardadas                      | `auditoria.jsonl`, campo `inverso`                                                |

A IA só pode escrever o parágrafo "Resumo" no topo, a partir destes dados, com no máximo 3 frases.

## Modelo (texto do Telegram)

```
CERTIFICADO DE MIGRAÇÃO · {id}
{data} {hora} · Leaseweb Public Cloud, {região}

RESUMO
{3 frases da IA a partir dos dados abaixo}

1. ONDE ESTÃO OS DADOS
{para cada serviço}
· {serviço AWS} → {destino} · {fornecedor}, {país} · {self-hosted | gerido}

2. PROVA DE QUE NADA SE PERDEU
· Ficheiros: {n} copiados · checksum {igual ✓ | diferente ✗}
· Base de dados: {n} linhas em {t} tabelas · checksum {✓ | ✗}
· Testes da app: antes {✓} · depois {✓}

3. SEGURANÇA DEPOIS DA MIGRAÇÃO
· Encontrado: {n} falha(s), {gravidade}
· {para cada falha} {serviço} porta {p} aberta a toda a Internet → fechada às {hora}, aprovado por {quem}
· Tempo exposto: {s} segundos
· Confirmação do atacante: {já não chega lá ✓}

4. COMO VOLTAR ATRÁS
· {n} ações guardadas com o inverso · desfazer: /undo {pedidoId}

Nenhum dado saiu da UE. Gerado automaticamente a partir do registo de auditoria.
```

## Regras

- Se algum campo faltar, escreve "não medido". Nunca inventa.
- Se um checksum não bater, o certificado diz ✗ em destaque e o Chefe avisa que a migração não está completa.
- Não contém segredos nem dados pessoais da app, só contagens e hashes.
- Para o RGPD e a NIS2 serve como registo; não é uma certificação oficial. Não lhe chamar "certificação".
