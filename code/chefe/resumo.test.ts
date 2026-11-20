import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { EventoAuditoria, Pedido } from '@mwbe/shared';
import { duracao, estadoAtual, resumir } from './resumo';

const regra = { id: 'r1', protocol: 'TCP', source: '0.0.0.0/0', startPort: 5432, endPort: 5432 };
const fechar = (id: string, estado: Pedido['estado']): Pedido => ({
  id,
  titulo: `PostgreSQL aberto a toda a internet (${id})`,
  texto: '…',
  acao: { tipo: 'remover_regra', securityGroupId: 'sg', regra },
  estado,
});
const migrar = (estado: Pedido['estado']): Pedido => ({
  id: 'm1',
  titulo: 'Migrar S3',
  texto: '…',
  acao: { tipo: 'migrar', passo: 's3' },
  estado,
});
const ev = (pedidoId: string, tipo: string, segundo: number, depois?: unknown): EventoAuditoria => ({
  hora: new Date(Date.UTC(2026, 10, 20, 14, 0, segundo)).toISOString(),
  pedidoId,
  tipo,
  depois,
});

describe('chefe/resumir', () => {
  it('fluxo da demo: migração feita e uma falha fechada, com tempos reais', () => {
    const fecho = { ...ev('a1', 'feito', 50), inverso: { tipo: 'criar_regra' as const, securityGroupId: 'sg', regra: { protocol: 'TCP', source: '0.0.0.0/0', startPort: 5432, endPort: 5432 } } };
    const eventos = [ev('m1', 'pedido', 0), ev('m1', 'feito', 5, { objetos: 12, checksumsOk: true }), ev('a1', 'pedido', 10), ev('a1', 'aprovado', 30), fecho];
    const texto = resumir(eventos, [migrar('feito'), fechar('a1', 'feito')]);
    assert.match(texto, /Migration complete: 12 files, checksums match/);
    assert.match(texto, /1 issue found and closed 40 seconds after defense asked\./);
    assert.match(texto, /inverse stored/);
  });

  it('várias falhas com estados diferentes e erros', () => {
    const eventos = [ev('a1', 'pedido', 0), ev('a1', 'feito', 65), ev('-', 'erro', 70)];
    const texto = resumir(eventos, [fechar('a1', 'feito'), fechar('a2', 'ignorado'), fechar('a3', 'pendente')]);
    assert.match(texto, /3 issues found: 1 closed \(the slowest 1 min 5 s after the request\), 1 ignored by the owner, 1 awaiting a decision\./);
    assert.match(texto, /There was 1 problem along the way/);
  });

  it('migração com base de dados', () => {
    const pg: Pedido = { id: 'p1', titulo: 'bd', texto: '', acao: { tipo: 'migrar', passo: 'postgres' }, estado: 'feito' };
    const texto = resumir([ev('m1', 'feito', 5, { objetos: 3 }), ev('p1', 'feito', 9, { tabelas: 2 })], [migrar('feito'), pg]);
    assert.match(texto, /3 files, checksums match.*Database copied \(2 tables\), checksums also match\./);
  });

  it('modo noite: diz que foi o modo noite, não uma pessoa', () => {
    const noite = { ...ev('a1', 'aprovado', 20), quem: 'modo-noite' };
    const texto = resumir([noite, ev('a1', 'feito', 25)], [fechar('a1', 'feito')]);
    assert.match(texto, /One issue was closed by night mode, with no answer from the owner: only known IPs get in, and \/undo puts it back\./);
    assert.doesNotMatch(resumir([ev('a1', 'aprovado', 20), ev('a1', 'feito', 25)], [fechar('a1', 'feito')]), /night mode/);
  });

  it('migração com segredos e cache (OpenBao e Valkey)', () => {
    const sg: Pedido = { id: 's1', titulo: 'segredos', texto: '', acao: { tipo: 'migrar', passo: 'segredos' }, estado: 'feito' };
    const ch: Pedido = { id: 'c1', titulo: 'cache', texto: '', acao: { tipo: 'migrar', passo: 'cache' }, estado: 'feito' };
    const texto = resumir([ev('m1', 'feito', 5, { objetos: 3 }), ev('s1', 'feito', 9, { segredos: 16 }), ev('c1', 'feito', 9, { chaves: 594 })], [migrar('feito'), sg, ch]);
    assert.match(texto, /Secrets moved to OpenBao \(16 secrets\), never shown in plain text\. Cache moved to Valkey \(594 keys\)\./);
  });

  it('migração com filas', () => {
    const fl: Pedido = { id: 'f1', titulo: 'filas', texto: '', acao: { tipo: 'migrar', passo: 'fila' }, estado: 'feito' };
    const texto = resumir([ev('m1', 'feito', 5, { objetos: 3 }), ev('f1', 'feito', 9, { mensagens: 1 })], [migrar('feito'), fl]);
    assert.match(texto, /Queues moved to RabbitMQ \(1 message\), no messages lost\./);
  });

  it('deteção falhada: não diz que não há portas abertas', () => {
    for (const fase of ['API detection', 'deteção pela API']) {
      const erro = ev('-', 'erro', 1, { fase, erro: 'LSW_SG_GERIDOS vazio' });
      const texto = resumir([erro], []);
      assert.match(texto, /could not check the security groups/);
      assert.doesNotMatch(texto, /found no ports open/);
    }
  });

  it('sem falhas e migração não aprovada', () => {
    const texto = resumir([], [migrar('ignorado')]);
    assert.match(texto, /Migration not approved/);
    assert.match(texto, /Defense found no ports open/);
  });

  it('não inventa números que não estão na auditoria', () => {
    const texto = resumir([], [migrar('feito'), fechar('a1', 'feito')]);
    assert.doesNotMatch(texto, /\d+ files/);
    assert.match(texto, /1 issue found and closed\./);
    assert.doesNotMatch(texto, /inverse stored/, 'sem inverso na auditoria não se promete desfazer');
  });
});

describe('chefe/estadoAtual', () => {
  it('agrupa por estado e lembra o /undo', () => {
    const t = estadoAtual([fechar('aaaa1111', 'pendente'), fechar('bbbb2222', 'feito')]);
    assert.match(t, /Awaiting a decision \(1\):\n• aaaa1111/);
    assert.match(t, /Done \(1\):\n• bbbb2222/);
    assert.match(t, /\/undo <id>/);
  });
  it('sem pedidos', () => {
    assert.equal(estadoAtual([]), 'No requests yet.');
  });
});

describe('chefe/duracao', () => {
  it('formata', () => {
    assert.equal(duracao(1000), '1 second');
    assert.equal(duracao(40_000), '40 seconds');
    assert.equal(duracao(120_000), '2 minutes');
    assert.equal(duracao(65_000), '1 min 5 s');
  });
});
