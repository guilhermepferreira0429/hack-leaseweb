import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { EventoAuditoria, Pedido } from '@mwbe/shared';
import { certificado, relogioExposicao } from './certificado';

const regra = { id: 'r1', protocol: 'TCP', source: '0.0.0.0/0', startPort: 5432, endPort: 5432 };
const inverso = { tipo: 'criar_regra' as const, securityGroupId: 'sg', regra: { protocol: 'TCP', source: '0.0.0.0/0', startPort: 5432, endPort: 5432 } };
const em = (s: number) => new Date(Date.UTC(2026, 10, 20, 14, 0, s)).toISOString();
const ev = (pedidoId: string, tipo: string, s: number, extra: Partial<EventoAuditoria> = {}): EventoAuditoria => ({ hora: em(s), pedidoId, tipo, ...extra });

const migrar: Pedido = { id: 'm1', titulo: 'Migrar S3', texto: '', acao: { tipo: 'migrar', passo: 's3' }, estado: 'feito' };
const fechar: Pedido = { id: 'a1', titulo: 'PostgreSQL aberto a toda a internet', texto: '', acao: { tipo: 'remover_regra', securityGroupId: 'sg', regra }, estado: 'feito' };

const demo = [
  ev('m1', 'pedido', 0),
  ev('m1', 'feito', 5, { depois: { objetos: 20, checksumsOk: true, testes: { antes: true, depois: true } } }),
  ev('-', 'infra-no-ar', 6),
  ev('-', 'reconhecimento', 10, { depois: { achados: 1, portas: [{ alvo: '203.0.113.10', porta: 5432, servico: 'PostgreSQL' }] } }),
  ev('a1', 'pedido', 12),
  ev('a1', 'aprovado', 30, { quem: '42' }),
  ev('a1', 'a-aplicar', 31, { inverso }),
  ev('a1', 'feito', 44, { inverso }),
];

describe('chefe/relogioExposicao', () => {
  it('da infraestrutura no ar ao primeiro fecho confirmado', () => {
    assert.deepEqual(relogioExposicao(demo), { inicio: em(6), fim: em(44), segundos: 38, aindaExposta: false });
  });
  it('ainda exposta: conta até agora', () => {
    const r = relogioExposicao(demo.slice(0, 6), new Date(em(26)));
    assert.equal(r?.aindaExposta, true);
    assert.equal(r?.segundos, 20);
  });
  it('auditoria com dois ciclos (o painel lê o dia inteiro): o relógio usa o último', () => {
    const ensaio = [ev('-', 'infra-no-ar', 0), ev('z9', 'feito', 3, { inverso })];
    const segundo = demo.map((e) => ({ ...e, hora: new Date(Date.parse(e.hora) + 3600_000).toISOString() }));
    const r = relogioExposicao([...ensaio, ...segundo]);
    assert.equal(r?.segundos, 38);
    assert.equal(r?.inicio, segundo.find((e) => e.tipo === 'infra-no-ar')!.hora);
  });

  it('sem infraestrutura no ar não há relógio', () => {
    assert.equal(relogioExposicao([ev('a1', 'feito', 1, { inverso })]), undefined);
  });
  it('o a-aplicar (inverso guardado antes de mexer) não conta como fecho', () => {
    assert.equal(relogioExposicao(demo.slice(0, 7), new Date(em(40)))?.aindaExposta, true);
  });
});

describe('chefe/certificado (modelo de docs/certificado-migracao.md)', () => {
  const LOCAL = 'Leaseweb, Frankfurt (DE)';
  const pg: Pedido = { id: 'p1', titulo: 'Migrar Postgres', texto: '', acao: { tipo: 'migrar', passo: 'postgres' }, estado: 'feito' };
  const fl: Pedido = { id: 'f1', titulo: 'Migrar SQS', texto: '', acao: { tipo: 'migrar', passo: 'fila' }, estado: 'feito' };
  const sg: Pedido = { id: 's1', titulo: 'Migrar segredos', texto: '', acao: { tipo: 'migrar', passo: 'segredos' }, estado: 'feito' };
  const ch: Pedido = { id: 'c1', titulo: 'Migrar cache', texto: '', acao: { tipo: 'migrar', passo: 'cache' }, estado: 'feito' };
  const completo = [
    ...demo,
    ev('p1', 'feito', 5, { depois: { tabelas: 5, linhas: 17498, checksumsOk: true } }),
    ev('f1', 'feito', 5, { depois: { mensagens: 50, checksumsOk: true } }),
    ev('s1', 'feito', 5, { depois: { segredos: 16, checksumsOk: true } }),
    ev('c1', 'feito', 5, { depois: { chaves: 594, checksumsOk: true } }),
    ev('a1', 'confirmacao-atacante', 46, { depois: { chega: false } }),
    ev('m1', 'migracao-codigo', 50, { depois: { causas: 1, url: 'https://github.com/dono/app/pull/7' } }),
  ];

  it('as 4 secções, com id CERT-AAAAMMDD-HHMM e só números medidos', () => {
    const t = certificado(completo, [migrar, pg, fl, sg, ch, fechar], LOCAL, new Date(em(50)));
    assert.match(t, /^CERTIFICADO DE MIGRAÇÃO · CERT-20261120-1400\n20\/11\/2026 14:00 · Leaseweb, Frankfurt \(DE\)\n/);
    assert.match(t, /RESUMO\nMigrámos 5 serviços da AWS para Leaseweb, Frankfurt \(DE\), com a impressão digital dos dados igual dos dois lados\. O atacante encontrou 1 porta aberta e foi fechada com aprovação\. Exposição: 38 segundos\./);
    assert.match(t, /1\. ONDE ESTÃO OS DADOS\n· S3 → MinIO · Leaseweb, Frankfurt \(DE\) · self-hosted\n· RDS PostgreSQL → PostgreSQL/);
    assert.match(t, /· ElastiCache Redis → Valkey · Leaseweb, Frankfurt \(DE\) · self-hosted/);
    assert.match(t, /2\. PROVA DE QUE NADA SE PERDEU\n· Ficheiros: 20 copiados · checksum ✓\n· Base de dados: 17498 linhas em 5 tabelas · checksum ✓\n· Filas: 50 mensagens passadas · checksum ✓\n· Segredos: 16 passados, sem nunca mostrar um valor · checksum ✓\n· Cache: 594 chaves copiadas · checksum ✓\n· Testes da app: antes ✓ · depois ✓/);
    assert.match(t, /3\. SEGURANÇA DEPOIS DA MIGRAÇÃO\n· Encontrado: 1 falha: PostgreSQL 5432\n· PostgreSQL aberto a toda a internet → fechada às 14:00, aprovado por uma pessoa, no Telegram\n· Tempo exposto: 38 segundos\n· Confirmação do atacante: já não chega lá ✓\n· Causa corrigida no código/);
    assert.match(t, /4\. COMO VOLTAR ATRÁS\n· 1 ação guardada com o inverso · desfazer: \/desfazer a1/);
    assert.match(t, /Destino dos dados: Leaseweb, Frankfurt \(DE\)\. Gerado automaticamente a partir do registo de auditoria/);
    assert.match(t, /Nenhum dado saiu da UE\. Destino dos dados: Leaseweb, Frankfurt \(DE\)\./, 'destino num país da UE');
    assert.doesNotMatch(t, /203\.0\.113\.10/, 'o certificado não precisa do IP');
  });

  it('"Nenhum dado saiu da UE" só com um destino num país da UE', () => {
    const fora = certificado(completo, [migrar, pg, fl, sg, ch, fechar], 'Leaseweb, Singapura (SG)', new Date(em(50)));
    assert.doesNotMatch(fora, /Nenhum dado saiu da UE/);
    const semLocal = certificado(completo, [migrar, pg, fl, sg, ch, fechar], undefined, new Date(em(50)));
    assert.doesNotMatch(semLocal, /Nenhum dado saiu da UE/);
  });

  it('o que falta sai "não medido"; não inventa o local', () => {
    const t = certificado([ev('m1', 'feito', 5, { depois: { checksumsOk: true } })], [migrar], undefined, new Date(em(50)));
    assert.match(t, /^CERTIFICADO DE MIGRAÇÃO · CERT-\d{8}-\d{4}\n\S+ \S+ · não medido\n/);
    assert.match(t, /· Ficheiros: não medido copiados · checksum ✓/);
    assert.match(t, /· Testes da app: antes não medido · depois não medido/);
    assert.match(t, /· Encontrado: não medido/);
    assert.match(t, /· Confirmação do atacante: não medido/);
  });

  it('checksum diferente: ✗ em destaque e o aviso de migração incompleta', () => {
    const t = certificado([...completo, ev('f1', 'feito', 49, { depois: { mensagens: 50, checksumsOk: false } })], [migrar, pg, fl, sg, ch, fechar], LOCAL, new Date(em(50)));
    assert.match(t, /· Filas: 50 mensagens passadas · checksum ✗/);
    assert.match(t, /✗ ATENÇÃO: há um checksum diferente\. A migração não está completa\./);
    assert.match(t, /mas há pelo menos um checksum diferente/);
  });

  it('reconhecimento: usa o mais recente', () => {
    const velho = ev('-', 'reconhecimento', 1, { depois: { portas: [{ alvo: '198.51.100.7', porta: 22, servico: 'SSH' }] } });
    const t = certificado([velho, ...demo], [migrar, fechar], undefined, new Date(em(50)));
    assert.match(t, /· Encontrado: 1 falha: PostgreSQL 5432/);
    assert.doesNotMatch(t, /SSH 22/);
  });

  it('modo noite: o fecho diz modo noite, não "uma pessoa"', () => {
    const noite = demo.map((e) => (e.tipo === 'aprovado' ? { ...e, quem: 'modo-noite' } : e));
    const t = certificado(noite, [migrar, fechar], undefined, new Date(em(50)));
    assert.match(t, /aprovado por modo noite \(sem resposta do dono\), só os IPs conhecidos entram/);
    assert.doesNotMatch(t, /uma pessoa/);
  });

  it('migração não aprovada e sem ataque', () => {
    const t = certificado([], [{ ...migrar, estado: 'ignorado' }], LOCAL, new Date(em(50)));
    assert.match(t, /· S3 → MinIO · Leaseweb, Frankfurt \(DE\) · self-hosted · não aprovado/);
    assert.match(t, /A migração não ficou concluída\./);
    assert.match(t, /4\. COMO VOLTAR ATRÁS\n· Nenhuma ação com inverso neste ciclo/);
  });
});
