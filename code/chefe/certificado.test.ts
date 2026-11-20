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

describe('chefe/certificado', () => {
  it('fluxo da demo: dados, prova, ataque, fecho com aprovação humana e exposição', () => {
    const t = certificado(demo, [migrar, fechar], 'Leaseweb, Amesterdão (NL)', new Date(em(50)));
    assert.match(t, /^Certificado de migração · /);
    assert.match(t, /MinIO, em Leaseweb, Amesterdão \(NL\)/);
    assert.match(t, /20 ficheiros copiados, impressão digital \(sha256\) igual dos dois lados; os mesmos testes da app passam antes e depois/);
    assert.match(t, /1 porta aberta: PostgreSQL 5432 \(203\.0\.113\.10\)/);
    assert.match(t, /Fechado: PostgreSQL aberto a toda a internet, às \d\d:\d\d, aprovado por uma pessoa às \d\d:\d\d; inverso guardado/);
    assert.match(t, /Exposição: 38 segundos/);
    assert.match(t, /cada porta fechada tem o inverso guardado/);
    assert.doesNotMatch(t, /\b42\b/, 'não mostra ids do Telegram');
  });

  it('não inventa o local nem números que não foram medidos', () => {
    const t = certificado([ev('m1', 'feito', 5, { depois: { checksumsOk: true } })], [migrar], undefined, new Date(em(9)));
    assert.match(t, /Dados: ficheiros do S3 passados para MinIO\./);
    assert.match(t, /Prova: Ficheiros copiados/);
    assert.doesNotMatch(t, /Exposição|Ataque/);
    assert.doesNotMatch(t, /inverso/, 'sem inverso guardado não se promete desfazer');
  });

  it('reconhecimento: usa o mais recente', () => {
    const velho = ev('-', 'reconhecimento', 1, { depois: { portas: [{ alvo: '198.51.100.7', porta: 22, servico: 'SSH' }] } });
    const t = certificado([velho, ...demo], [migrar, fechar], undefined, new Date(em(50)));
    assert.match(t, /PostgreSQL 5432/);
    assert.doesNotMatch(t, /198.51.100.7/);
  });

  it('base de dados migrada (nível B) aparece com a prova por tabela', () => {
    const pg: Pedido = { id: 'p1', titulo: 'Copiar a base de dados', texto: '', acao: { tipo: 'migrar', passo: 'postgres' }, estado: 'feito' };
    const eventos = [...demo, ev('p1', 'feito', 48, { depois: { tabelas: 1, linhas: 20, checksumsOk: true } })];
    const t = certificado(eventos, [migrar, pg, fechar], undefined, new Date(em(50)));
    assert.match(t, /Base de dados: 1 tabela e 20 linhas copiadas para PostgreSQL; contagem e sha256 iguais em cada tabela\./);
    assert.match(t, /20 ficheiros copiados/, 'o S3 continua a ser o primeiro passo');
  });

  it('filas migradas (SQS -> RabbitMQ) aparecem com a contagem e o sha256', () => {
    const fl: Pedido = { id: 'f1', titulo: 'Passar as filas', texto: '', acao: { tipo: 'migrar', passo: 'fila' }, estado: 'feito' };
    const eventos = [...demo, ev('f1', 'feito', 49, { depois: { mensagens: 5, checksumsOk: true } })];
    const t = certificado(eventos, [migrar, fl, fechar], 'Leaseweb, Amesterdão (NL)', new Date(em(50)));
    assert.match(t, /Filas: 5 mensagens passadas do SQS para RabbitMQ, em Leaseweb, Amesterdão \(NL\); contagem e sha256 iguais\./);
    const recusada = certificado(eventos, [migrar, { ...fl, estado: 'ignorado' }, fechar], undefined, new Date(em(50)));
    assert.doesNotMatch(recusada, /Filas:/, 'sem aprovação não se diz que as filas passaram');
  });

  it('migração não aprovada', () => {
    assert.match(certificado([], [{ ...migrar, estado: 'ignorado' }]), /Migração: não aprovada/);
  });
});
