import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { EventoAuditoria, Pedido } from '@mwbe/shared';
import { nomeRelatorioFicheiro, relatorioHtml } from './relatorio-ficheiro';

const em = (s: number) => new Date(Date.UTC(2026, 10, 20, 12, 48, s)).toISOString();
const ev = (pedidoId: string, tipo: string, s: number, extra: Partial<EventoAuditoria> = {}): EventoAuditoria => ({ hora: em(s), pedidoId, tipo, ...extra });
const regra = { id: 'r1', protocol: 'TCP', source: '0.0.0.0/0', startPort: 5432, endPort: 5432 };
const inverso = { tipo: 'criar_regra' as const, securityGroupId: 'sg', regra: { protocol: 'TCP', source: '0.0.0.0/0', startPort: 5432, endPort: 5432 } };
const achado = { id: 'a1', tipo: 'porta-exposta', origem: 'api', alvo: 'vitima', porta: 5432, servico: 'PostgreSQL', severidade: 'alta', detalhe: '' };

const pedidos: Pedido[] = [
  { id: 'm1', titulo: 'Migrate S3', texto: '', acao: { tipo: 'migrar', passo: 's3' }, estado: 'feito' },
  { id: 'd1', titulo: 'PostgreSQL <open> to the whole internet', texto: '', acao: { tipo: 'remover_regra', securityGroupId: 'sg', regra }, estado: 'feito' },
];
const eventos = [
  ev('m1', 'pedido', 0),
  ev('m1', 'feito', 5, { depois: { objetos: 1520, checksumsOk: true, testes: { antes: true, depois: true } } }),
  ev('-', 'infra-no-ar', 6),
  ev('-', 'reconhecimento', 10, { depois: { portas: [{ alvo: 'vitima', porta: 5432, servico: 'PostgreSQL' }] } }),
  ev('d1', 'pedido', 12, { quem: 'defesa', depois: { achado } }),
  ev('d1', 'aprovado', 20, { quem: '42' }),
  ev('d1', 'feito', 42, { quem: 'defesa', inverso }),
  ev('m1', 'migracao-codigo', 50, { depois: { causas: 1, url: 'https://github.com/dono/app/pull/1' } }),
];

describe('chefe/relatorio-ficheiro', () => {
  it('página A4 com o certificado e o incidente, links clicáveis e texto escapado', () => {
    const html = relatorioHtml(eventos, pedidos, { localDados: 'Leaseweb, Amsterdam (NL)', agora: new Date(em(55)) });
    assert.match(html, /^<!doctype html>/);
    assert.match(html, /@page \{ size: A4/);
    assert.match(html, /<h1>MIGRATION CERTIFICATE · CERT-20261120-1248<\/h1>/);
    assert.match(html, /<h2>1\. WHERE THE DATA IS<\/h2>/);
    assert.match(html, /<h2>INCIDENT REPORT<\/h2>/);
    assert.match(html, /<a href="https:\/\/github\.com\/dono\/app\/pull\/1">/);
    assert.ok(!html.includes('<open>'), 'o texto vindo da auditoria é escapado');
    assert.match(html, /&lt;open&gt;/);
    assert.match(html, /Not an official certification/);
  });

  it('nome do ficheiro = id do certificado', () => {
    assert.equal(nomeRelatorioFicheiro(eventos, pedidos, { agora: new Date(em(55)) }), 'CERT-20261120-1248.html');
  });
});
