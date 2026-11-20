// Provas da migração no painel: os cinco passos (S3, Postgres, fila, segredos, cache), cada um pelo depois.passo.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { EventoAuditoria } from '@mwbe/shared';
import { provas, renderizar } from '../linha-tempo';

const testes = { antes: true, depois: true };
const feito = (s: number, pedidoId: string, depois: object): EventoAuditoria => ({
  hora: `2026-11-20T10:00:${String(s).padStart(2, '0')}Z`,
  pedidoId,
  tipo: 'feito',
  quem: 'migrador',
  depois,
});

const cinco: EventoAuditoria[] = [
  { hora: '2026-11-20T10:00:00Z', pedidoId: 'm1', tipo: 'pedido', quem: 'migrador' },
  feito(5, 'm1', { passo: 's3', objetos: 1500, checksumsOk: true, testes }),
  feito(6, 'm2', { passo: 'postgres', tabelas: 4, linhas: 17478, checksumsOk: true, testes }),
  feito(7, 'm3', { passo: 'fila', mensagens: 50, checksumsOk: true, testes }),
  feito(8, 'm4', { passo: 'segredos', segredos: 16, checksumsOk: true, testes }),
  feito(9, 'm5', { passo: 'cache', chaves: 594, checksumsOk: true, testes }),
];

describe('painel: provas da migração (fila, segredos e cache)', () => {
  it('lê os cinco passos pelo depois.passo', () => {
    const p = provas(cinco);
    assert.equal(p.objetos, 1500);
    assert.equal(p.linhas, 17478);
    assert.equal(p.mensagens, 50);
    assert.equal(p.segredos, 16);
    assert.equal(p.chaves, 594);
    assert.equal(p.passosMigrados, 5);
    assert.equal(p.checksums, true);
    assert.deepEqual([p.testesAntes, p.testesDepois], [true, true]);
  });

  it('um passo com checksum diferente põe a prova toda a ✗', () => {
    const mau = [...cinco.slice(0, -1), feito(9, 'm5', { passo: 'cache', chaves: 594, checksumsOk: false, testes })];
    assert.equal(provas(mau).checksums, false);
  });

  it('eventos antigos, sem passo, continuam a contar pelo campo da prova', () => {
    const p = provas([feito(5, 'm1', { objetos: 12, checksumsOk: true }), feito(6, 'm2', { tabelas: 2, linhas: 30, checksumsOk: true })]);
    assert.deepEqual([p.objetos, p.linhas, p.passosMigrados, p.checksums], [12, 30, 2, true]);
    assert.equal(p.chaves, undefined);
  });

  it('sem migração, nada inventado', () => {
    const p = provas([]);
    assert.deepEqual([p.checksums, p.passosMigrados, p.mensagens], [undefined, 0, undefined]);
  });

  it('o ecrã mostra as três provas novas e a frase certa de cada passo', () => {
    const html = renderizar([], cinco);
    assert.match(html, /Mensagens da fila<\/span><span>50</);
    assert.match(html, /Segredos \(só a contagem\)<\/span><span>16</);
    assert.match(html, /Chaves da cache<\/span><span>594</);
    assert.match(html, /migrador · 5 passos · checksums ✓/);
    assert.match(html, /Fila: 50 mensagens no RabbitMQ\. Checksums iguais\./);
    assert.match(html, /Segredos: 16 no OpenBao\. Checksums iguais\./);
    assert.match(html, /Cache: 594 chaves no Valkey\. Checksums iguais\./);
    assert.doesNotMatch(html, /— ficheiros copiados/, 'a fila e a cache já não aparecem como "— ficheiros"');
  });

  it('só com a cache: a seta e as provas não fingem S3 nem Postgres', () => {
    const html = renderizar([], [cinco[0]!, cinco[5]!]);
    assert.match(html, /migrador · 1 passo · checksums ✓/);
    assert.doesNotMatch(html, /Linhas da base de dados|Mensagens da fila/);
  });
});
