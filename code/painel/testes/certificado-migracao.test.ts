// Certificado do painel com os cinco passos da migração, cada um com o checksum do próprio passo.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { EventoAuditoria } from '@mwbe/shared';
import { renderizarCertificado } from '../certificado';
import { provas } from '../linha-tempo';

const testes = { antes: true, depois: true };
const feito = (s: number, pedidoId: string, depois: object): EventoAuditoria => ({
  hora: `2026-11-20T10:00:${String(s).padStart(2, '0')}Z`,
  pedidoId,
  tipo: 'feito',
  quem: 'migrador',
  depois,
});
const cinco = (cacheOk = true, pgOk = true): EventoAuditoria[] => [
  { hora: '2026-11-20T10:00:00Z', pedidoId: 'm1', tipo: 'pedido', quem: 'migrador' },
  feito(5, 'm1', { passo: 's3', objetos: 1500, checksumsOk: true, testes }),
  feito(6, 'm2', { passo: 'postgres', tabelas: 4, linhas: 17478, checksumsOk: pgOk, testes }),
  feito(7, 'm3', { passo: 'fila', mensagens: 50, checksumsOk: true, testes }),
  feito(8, 'm4', { passo: 'segredos', segredos: 16, checksumsOk: true, testes }),
  feito(9, 'm5', { passo: 'cache', chaves: 594, checksumsOk: cacheOk, testes }),
];
const AGORA = new Date('2026-11-20T10:05:00Z');

describe('painel: certificado com fila, segredos e cache', () => {
  it('checksum por passo, sem misturar passos', () => {
    assert.deepEqual(provas(cinco(false)).checksumPorPasso, { s3: true, postgres: true, fila: true, segredos: true, cache: false });
    assert.deepEqual(provas([feito(5, 'm1', { objetos: 3 })]).checksumPorPasso, {
      s3: true,
      postgres: undefined,
      fila: undefined,
      segredos: undefined,
      cache: undefined,
    });
  });

  it('mostra onde ficou cada serviço e a prova de cada um', () => {
    const html = renderizarCertificado([], cinco(), 'Leaseweb, Frankfurt (DE)', AGORA);
    for (const servico of ['S3 → MinIO', 'RDS Postgres → Postgres', 'SQS → RabbitMQ', 'Secrets Manager / SSM → OpenBao', 'ElastiCache Redis → Valkey']) {
      assert.ok(html.includes(servico), servico);
    }
    assert.match(html, /1\.500 copiados · checksum igual ✓/);
    assert.match(html, /17\.478 linhas em 4 tabelas · checksum igual ✓/);
    assert.match(html, /50 mensagens · checksum igual ✓/);
    assert.match(html, /16 segredos \(só a contagem\) · checksum igual ✓/);
    assert.match(html, /594 chaves · checksum igual ✓/);
    assert.match(html, /A migração terminou e ficou segura\./);
  });

  it('a cache diferente marca só a cache, não os ficheiros', () => {
    const html = renderizarCertificado([], cinco(false), undefined, AGORA);
    assert.match(html, /1\.500 copiados · checksum igual ✓/);
    assert.match(html, /594 chaves · checksum DIFERENTE ✗/);
    assert.match(html, /Há pontos por fechar\./);
  });

  it('a base de dados diferente já não aparece como igual', () => {
    const html = renderizarCertificado([], cinco(true, false), undefined, AGORA);
    assert.match(html, /17\.478 linhas em 4 tabelas · checksum DIFERENTE ✗/);
  });

  it('só a cache migrada conta como migração', () => {
    const html = renderizarCertificado([], [cinco()[0]!, cinco()[5]!], undefined, AGORA);
    assert.doesNotMatch(html, /Migração ainda por fazer/);
    assert.match(html, /ElastiCache Redis → Valkey/);
    assert.doesNotMatch(html, /S3 → MinIO/);
  });
});
