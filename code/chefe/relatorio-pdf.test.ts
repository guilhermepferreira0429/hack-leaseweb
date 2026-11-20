import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { EventoAuditoria, Pedido } from '@mwbe/shared';
import { nomeRelatorioPdf, relatorioPdf } from './relatorio-pdf';

const em = (s: number) => new Date(Date.UTC(2026, 10, 20, 12, 48, s)).toISOString();
const ev = (pedidoId: string, tipo: string, s: number, extra: Partial<EventoAuditoria> = {}): EventoAuditoria => ({ hora: em(s), pedidoId, tipo, ...extra });
const regra = { id: 'r1', protocol: 'TCP', source: '0.0.0.0/0', startPort: 5432, endPort: 5432 };
const inverso = { tipo: 'criar_regra' as const, securityGroupId: 'sg', regra: { protocol: 'TCP', source: '0.0.0.0/0', startPort: 5432, endPort: 5432 } };
const achado = { id: 'a1', tipo: 'porta-exposta', origem: 'api', alvo: 'vitima', porta: 5432, servico: 'PostgreSQL', severidade: 'alta', detalhe: '' };

const pedidos: Pedido[] = [
  { id: 'm1', titulo: 'Migrate S3', texto: '', acao: { tipo: 'migrar', passo: 's3' }, estado: 'feito' },
  { id: 'd1', titulo: 'PostgreSQL open to the whole internet', texto: '', acao: { tipo: 'remover_regra', securityGroupId: 'sg', regra }, estado: 'feito' },
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

const comoTexto = (pdf: Uint8Array) => Buffer.from(pdf).toString('latin1');

describe('chefe/relatorio-pdf', () => {
  it('PDF A4 válido: cabeçalho, xref, startxref e %%EOF', () => {
    const pdf = relatorioPdf(eventos, pedidos, { localDados: 'Leaseweb, Amsterdam (NL)', agora: new Date(em(55)) });
    const s = comoTexto(pdf);
    assert.ok(s.startsWith('%PDF-1.4'), 'começa com o cabeçalho PDF');
    assert.ok(s.trimEnd().endsWith('%%EOF'), 'acaba em %%EOF');
    assert.match(s, /\nxref\n/);
    assert.match(s, /startxref\n\d+\n%%EOF$/);
    assert.match(s, /\/MediaBox \[0 0 595 842\]/);
    assert.match(s, /\/Count \d+/);
  });

  it('o texto do certificado vai dentro do PDF, com os glifos convertidos para Latin-1', () => {
    const s = comoTexto(relatorioPdf(eventos, pedidos, { localDados: 'Leaseweb, Amsterdam (NL)', agora: new Date(em(55)) }));
    assert.ok(s.includes('MIGRATION CERTIFICATE'));
    assert.ok(s.includes('INCIDENT REPORT'));
    assert.ok(s.includes('S3 -> MinIO'), 'a seta → vira ->');
    assert.ok(s.includes('No data left the EU.'));
    assert.ok(!s.includes('→') && !s.includes('✓') && !s.includes('✗'), 'sem setas/vistos fora do Latin-1');
  });

  it('nome do ficheiro = id do certificado em .pdf', () => {
    assert.equal(nomeRelatorioPdf({ agora: new Date(em(55)) }), 'CERT-20261120-1248.pdf');
  });

  it('pagina quando o conteúdo é grande (muitos incidentes geram mais do que uma página)', () => {
    const muitos: EventoAuditoria[] = [...eventos];
    for (let i = 0; i < 40; i++) {
      const a = { ...achado, id: `x${i}` };
      muitos.push(ev(`p${i}`, 'pedido', 12, { quem: 'defesa', depois: { achado: a } }));
      muitos.push(ev(`p${i}`, 'feito', 42, { quem: 'defesa', inverso }));
    }
    const s = comoTexto(relatorioPdf(muitos, pedidos, { agora: new Date(em(55)) }));
    const count = Number(s.match(/\/Count (\d+)/)?.[1] ?? '0');
    assert.ok(count >= 2, `espera várias páginas, teve ${count}`);
  });
});
