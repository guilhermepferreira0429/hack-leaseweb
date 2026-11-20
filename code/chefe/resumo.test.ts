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
    assert.match(texto, /Migração concluída: 12 ficheiros, checksums iguais/);
    assert.match(texto, /1 falha encontrada e fechada em 40 segundos\./);
    assert.match(texto, /inverso guardado/);
  });

  it('várias falhas com estados diferentes e erros', () => {
    const eventos = [ev('a1', 'pedido', 0), ev('a1', 'feito', 65), ev('-', 'erro', 70)];
    const texto = resumir(eventos, [fechar('a1', 'feito'), fechar('a2', 'ignorado'), fechar('a3', 'pendente')]);
    assert.match(texto, /3 falhas encontradas: 1 fechada \(a mais lenta em 1 min 5 s\), 1 ignorada pelo dono, 1 por decidir\./);
    assert.match(texto, /Houve 1 problema pelo caminho/);
  });

  it('migração com base de dados', () => {
    const pg: Pedido = { id: 'p1', titulo: 'bd', texto: '', acao: { tipo: 'migrar', passo: 'postgres' }, estado: 'feito' };
    const texto = resumir([ev('m1', 'feito', 5, { objetos: 3 }), ev('p1', 'feito', 9, { tabelas: 2 })], [migrar('feito'), pg]);
    assert.match(texto, /3 ficheiros, checksums iguais.*Base de dados copiada \(2 tabelas\), também com checksums iguais\./);
  });

  it('migração com filas', () => {
    const fl: Pedido = { id: 'f1', titulo: 'filas', texto: '', acao: { tipo: 'migrar', passo: 'fila' }, estado: 'feito' };
    const texto = resumir([ev('m1', 'feito', 5, { objetos: 3 }), ev('f1', 'feito', 9, { mensagens: 1 })], [migrar('feito'), fl]);
    assert.match(texto, /Filas passadas para RabbitMQ \(1 mensagem\), sem perder mensagens\./);
  });

  it('deteção falhada: não diz que não há portas abertas', () => {
    const erro = ev('-', 'erro', 1, { fase: 'deteção pela API', erro: 'LSW_SG_GERIDOS vazio' });
    const texto = resumir([erro], []);
    assert.match(texto, /não conseguiu verificar os security groups/);
    assert.doesNotMatch(texto, /não encontrou portas abertas/);
  });

  it('sem falhas e migração não aprovada', () => {
    const texto = resumir([], [migrar('ignorado')]);
    assert.match(texto, /Migração não aprovada/);
    assert.match(texto, /A defesa não encontrou portas abertas/);
  });

  it('não inventa números que não estão na auditoria', () => {
    const texto = resumir([], [migrar('feito'), fechar('a1', 'feito')]);
    assert.doesNotMatch(texto, /\d+ ficheiros/);
    assert.match(texto, /1 falha encontrada e fechada\./);
    assert.doesNotMatch(texto, /inverso guardado/, 'sem inverso na auditoria não se promete desfazer');
  });
});

describe('chefe/estadoAtual', () => {
  it('agrupa por estado e lembra o /desfazer', () => {
    const t = estadoAtual([fechar('aaaa1111', 'pendente'), fechar('bbbb2222', 'feito')]);
    assert.match(t, /Por decidir \(1\):\n• aaaa1111/);
    assert.match(t, /Feitos \(1\):\n• bbbb2222/);
    assert.match(t, /\/desfazer <id>/);
  });
  it('sem pedidos', () => {
    assert.equal(estadoAtual([]), 'Ainda não há pedidos.');
  });
});

describe('chefe/duracao', () => {
  it('formata', () => {
    assert.equal(duracao(1000), '1 segundo');
    assert.equal(duracao(40_000), '40 segundos');
    assert.equal(duracao(120_000), '2 minutos');
    assert.equal(duracao(65_000), '1 min 5 s');
  });
});
