// O ecrã /palco em cada fase da demo, com eventos iguais aos da corrida real de 20/11 às 12:35.
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { estadoPalco, fraseIngles, renderizarPalco } from '@mwbe/painel';

const inv = { tipo: 'criar_regra', securityGroupId: 'b5e1687e', regra: { protocol: 'TCP', source: '0.0.0.0/0', startPort: 5432, endPort: 5432 } } as const;
const regra = { id: '7c2462c8', protocol: 'TCP', source: '0.0.0.0/0', startPort: 5432, endPort: 5432 };
const TEXTO = 'A base de dados está aberta a toda a Internet.';
const EV = [
  { hora: '2026-11-20T12:35:00Z', pedidoId: 'm', tipo: 'pedido', quem: 'migrador', depois: { servicos: ['s3', 'postgres', 'fila', 'segredos', 'cache'] } },
  { hora: '2026-11-20T12:35:05Z', pedidoId: 'm', tipo: 'aprovado', quem: '7415744448' },
  { hora: '2026-11-20T12:35:18Z', pedidoId: 'm1', tipo: 'feito', quem: 'migrador', depois: { passo: 's3', objetos: 1520, checksumsOk: true, testes: { antes: true, depois: true } } },
  { hora: '2026-11-20T12:35:18Z', pedidoId: 'm2', tipo: 'feito', quem: 'migrador', depois: { passo: 'postgres', tabelas: 5, linhas: 17518, checksumsOk: true, testes: { antes: true, depois: true } } },
  { hora: '2026-11-20T12:35:18Z', pedidoId: '-', tipo: 'infra-no-ar', quem: 'orquestrador' },
  { hora: '2026-11-20T12:35:20Z', pedidoId: '-', tipo: 'reconhecimento', quem: 'atacante', depois: { alvos: ['198.51.100.7'], portas: [{ alvo: '198.51.100.7', porta: 5432, servico: 'PostgreSQL' }] } },
  { hora: '2026-11-20T12:35:22Z', pedidoId: 'p', tipo: 'pedido', quem: 'defesa', depois: { achado: { alvo: '198.51.100.7', porta: 5432, servico: 'PostgreSQL' }, titulo: 'PostgreSQL visível de fora', texto: TEXTO } },
  { hora: '2026-11-20T12:36:11Z', pedidoId: 'p', tipo: 'aprovado', quem: '7415744448' },
  { hora: '2026-11-20T12:36:12Z', pedidoId: 'p', tipo: 'verificado', quem: 'defesa', depois: { ip: '198.51.100.7', porta: 5432, fase: 'antes', estado: 'open' } },
  { hora: '2026-11-20T12:36:12Z', pedidoId: 'p', tipo: 'a-aplicar', quem: 'defesa', antes: regra, inverso: inv },
  { hora: '2026-11-20T12:36:20Z', pedidoId: 'p', tipo: 'feito', quem: 'defesa', inverso: inv, confirmacao: 'de-fora' },
  { hora: '2026-11-20T12:36:23Z', pedidoId: 'p', tipo: 'verificado', quem: 'defesa', depois: { ip: '198.51.100.7', porta: 5432, fase: 'depois', estado: 'filtered' } },
] as never[];
const ate = (tipo: string, quem?: string) => EV.slice(0, EV.findIndex((e: { tipo: string; quem?: string }) => e.tipo === tipo && (!quem || e.quem === quem)) + 1);

describe('/palco: estado por fase', () => {
  it('antes de tudo: sem fase', () => {
    assert.equal(estadoPalco([], []).fase, undefined);
    assert.match(renderizarPalco([], []), /NOT STARTED/);
  });
  it('a migrar', () => {
    const s = estadoPalco(EV.slice(0, 2), []);
    assert.equal(s.fase, 'migrate');
    assert.match(renderizarPalco([], EV.slice(0, 2)), /MIGRATING/);
  });
  it('o atacante viu a porta: OPEN e relógio a contar', () => {
    const ev = ate('reconhecimento');
    const s = estadoPalco(ev, []);
    assert.deepEqual([s.fase, s.porta?.estado, s.porta?.numero], ['attack', 'open', 5432]);
    const html = renderizarPalco([], ev);
    assert.match(html, /OPEN TO THE INTERNET/);
    assert.match(html, /EXPOSED FOR/);
  });
  it('à espera da pessoa: faixa, texto da IA e QR', () => {
    const ev = ate('pedido', 'defesa');
    const s = estadoPalco(ev, []);
    assert.equal(s.fase, 'approve');
    assert.equal(s.aEsperar?.texto, TEXTO);
    const html = renderizarPalco([], ev, { qr: '<svg id="qr"></svg>' });
    assert.match(html, /Waiting for a human to approve in Telegram/);
    assert.match(html, /written by AI \(text only\)/);
    assert.match(html, /<svg id="qr">/);
    assert.match(html, /<div class="v mau">open<\/div><div class="l">port 5432 seen from outside/);
  });
  it('fechada: CLOSED, relógio parado, provas em números, sem faixa', () => {
    const s = estadoPalco(EV, []);
    assert.deepEqual([s.fase, s.concluido, s.porta?.estado, s.aEsperar, s.aprovadoPorPessoa], ['close', true, 'closed', undefined, true]);
    const html = renderizarPalco([], EV, { qr: '<svg id="qr"></svg>', local: 'Leaseweb, Frankfurt (DE)' });
    assert.match(html, /e-closed">CLOSED/);
    assert.match(html, /WAS EXPOSED FOR<\/div><div class="seg">62 s/);
    assert.match(html, /1,520 ✓/);
    assert.match(html, /17,518 ✓/);
    assert.match(html, />filtered</);
    assert.match(html, /approved by a human/);
    assert.ok(!html.includes('id="qr"'));
    assert.ok(!html.includes('Waiting for a human'));
  });
});

describe('/palco: em inglês', () => {
  it('frases dos agentes e terminal sem português', () => {
    assert.equal(fraseIngles(EV[2]), '1,520 files copied. Checksums match.');
    assert.equal(fraseIngles(EV[5]), 'Open to the whole internet: PostgreSQL 5432.');
    assert.match(renderizarPalco([], EV.slice(0, 4)), /1,520 objects copied · sha256 ✓/);
    const html = renderizarPalco([], EV);
    assert.match(html, /<html lang="en">/);
    assert.match(html, /rule removed · confirmed from outside · undo saved/);
    for (const pt of ['objetos copiados', 'regra removida', 'testes da app', 'inverso guardado']) assert.ok(!html.includes(pt), pt);
    const inicio = renderizarPalco([], EV.slice(0, 4));
    assert.match(inicio, /analyse exemplo-app/);
    assert.match(inicio, /AWS services: S3, Postgres, SQS, Secrets Manager, ElastiCache/);
    assert.match(inicio, /migrate s3 → minio/);
    assert.ok(!/\$<\/i> migrar/.test(inicio));
  });
});

describe('/palco: destino escolhido pelo dono', () => {
  const base = [{ hora: '2026-11-20T14:00:00Z', pedidoId: 'm', tipo: 'pedido', quem: 'migrador', depois: { servicos: ['s3'] } }];
  const omissao = { hora: '2026-11-20T14:00:01Z', pedidoId: '-', tipo: 'decisao-destino', quem: 'migrador', depois: { modo: 'recomendado', porOmissao: true } };
  const self = { hora: '2026-11-20T14:00:02Z', pedidoId: '-', tipo: 'decisao-destino', quem: 'dono', depois: { modo: 'tudo-self-hosted' } };

  it('por omissão o recomendado, com os geridos marcados como simulados', () => {
    const html = renderizarPalco([], [...base, omissao] as never[]);
    assert.match(html, /Leaseweb, managed where it makes sense<span class="tag sim">MANAGED: SIMULATED<\/span>/);
    assert.match(html, /recommended by default/);
  });

  it('o dono escolhe tudo self-hosted: aparece no ecrã, no feed e no certificado', async () => {
    const ev = [...base, omissao, self] as never[];
    const html = renderizarPalco([], ev);
    assert.match(html, /everything self-hosted on the VM/);
    assert.match(html, /owner&#39;s choice|owner's choice/);
    assert.match(html, /Chose everything self-hosted on the VM/);
    const { renderizarCertificado } = await import('@mwbe/painel');
    assert.match(renderizarCertificado([], [...ev, { hora: '2026-11-20T14:00:09Z', pedidoId: 'm', tipo: 'feito', quem: 'migrador', depois: { passo: 's3', objetos: 10, checksumsOk: true } }] as never[]), /tudo self-hosted na VM · escolha do dono/);
  });
});
