// Ecrã da demo v2: cadeia dos agentes, serviços, logs ao vivo (e variante Code) e o download do relatório.
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, describe, it } from 'node:test';
import type { EventoAuditoria, Pedido } from '@mwbe/shared';
import { cadeia, cicloTerminado, iniciarPainel, logs, renderizarV2, servicos } from '@mwbe/painel';

const t = (s: number) => `2026-11-20T12:47:${String(s).padStart(2, '0')}Z`;
const ev = (s: number, pedidoId: string, tipo: string, quem: string, extra: Partial<EventoAuditoria> = {}): EventoAuditoria =>
  ({ hora: t(s), pedidoId, tipo, quem, ...extra }) as EventoAuditoria;
const testes = { antes: true, depois: true };
const regra = { id: 'r1', protocol: 'TCP', source: '0.0.0.0/0', startPort: 5432, endPort: 5432 };
const inverso = { tipo: 'criar_regra', securityGroupId: 'sg-1', regra: { protocol: 'TCP', source: '0.0.0.0/0', startPort: 5432, endPort: 5432 } } as const;

const plano = [
  ev(1, '-', 'pensar', 'migrador', { depois: { passo: 'plano', texto: 'Reading the app and deciding where each service goes.' } }),
  ev(2, 'm1', 'pedido', 'migrador', { depois: { passos: ['s3', 'postgres', 'cache'] } }),
  ev(3, 'm1', 'aprovado', 'telegram'),
];
const migrado = [
  ...plano,
  ev(4, 'm2', 'pedido', 'migrador', { depois: { passo: 'postgres', plano: 'm1' } }),
  ev(5, 'm3', 'pedido', 'migrador', { depois: { passo: 'cache', plano: 'm1' } }),
  ev(6, 'm1', 'feito', 'migrador', { depois: { passo: 's3', objetos: 1520, checksumsOk: true, testes } }),
  ev(6, 'm2', 'feito', 'migrador', { depois: { passo: 'postgres', tabelas: 4, linhas: 17478, checksumsOk: true, testes } }),
  ev(6, 'm3', 'feito', 'migrador', { depois: { passo: 'cache', chaves: 594, checksumsOk: true, testes } }),
];
const ciclo = [
  ...migrado,
  ev(7, '-', 'infra-no-ar', 'orquestrador'),
  ev(8, '-', 'reconhecimento', 'atacante', { depois: { alvos: ['198.51.100.7'], portas: [{ alvo: '198.51.100.7', porta: 5432, servico: 'PostgreSQL' }] } }),
  ev(9, '-', 'pensar', 'defesa', { depois: { passo: 'defender', texto: 'Explaining the risk and preparing a reversible fix.' } }),
  ev(10, 'p1', 'pedido', 'defesa', { depois: { achado: { alvo: '198.51.100.7', porta: 5432, servico: 'PostgreSQL' }, titulo: 'PostgreSQL open to the whole internet' } }),
  ev(20, 'p1', 'aprovado', 'telegram'),
  ev(21, 'p1', 'verificado', 'defesa', { depois: { ip: '198.51.100.7', porta: 5432, fase: 'antes', estado: 'open' } }),
  ev(22, 'p1', 'a-aplicar', 'defesa', { antes: regra, inverso }),
  ev(30, 'p1', 'feito', 'defesa', { inverso }),
  ev(33, 'p1', 'verificado', 'defesa', { depois: { ip: '198.51.100.7', porta: 5432, fase: 'depois', estado: 'filtered' } }),
];
const pedidos: Pedido[] = [{ id: 'p1', titulo: 'PostgreSQL open to the whole internet', texto: '', estado: 'feito', acao: { tipo: 'remover_regra', securityGroupId: 'sg-1', regra } }];

describe('painel v2: cadeia dos agentes', () => {
  it('o plano e o fecho mostram o resultado no próprio passo, sem linhas de aprovação soltas', () => {
    const c = cadeia(ciclo);
    const planoP = c.find((p) => p.botao === 'Approve plan')!;
    assert.match(planoP.mensagem, /Migration plan for 3 AWS services/);
    assert.equal(planoP.pensar, 'Reading the app and deciding where each service goes.');
    assert.match(planoP.resultado!.texto, /✓ Approved by owner/);
    const fecho = c.find((p) => p.botao === 'Close')!;
    assert.equal(fecho.agente, 'defesa');
    assert.match(fecho.resultado!.texto, /✓ Closed \d\d:\d\d:\d\d · verified from outside: filtered ✓/);
    assert.ok(!c.some((p) => p.agente === 'dono'), 'as aprovações já estão nos pedidos');
  });

  it('pedido da defesa ainda por decidir fica à espera do dono', () => {
    const c = cadeia(ciclo.slice(0, ciclo.findIndex((e) => e.tipo === 'aprovado' && e.pedidoId === 'p1')));
    assert.match(c.at(-1)!.resultado!.texto, /waiting for the owner/);
  });
});

describe('painel v2: serviços', () => {
  it('QUEUED antes da aprovação; depois o 1.º MIGRATING e os outros quando nasce o pedido deles', () => {
    assert.deepEqual(servicos(plano.slice(0, 2)).map((s) => s.estado), ['queued', 'queued', 'queued']);
    assert.deepEqual(servicos(plano).map((s) => s.estado), ['migrating', 'queued', 'queued']);
    assert.deepEqual(servicos(migrado.slice(0, 4)).map((s) => s.estado), ['migrating', 'migrating', 'queued']);
  });

  it('DONE com a prova medida de cada passo; checksum diferente fica marcado', () => {
    const s = servicos(migrado);
    assert.deepEqual(s.map((x) => x.estado), ['done', 'done', 'done']);
    assert.equal(s[0]!.prova, '1,520 files · sha256 ✓');
    assert.equal(s[1]!.prova, '17,478 rows · 4 tables · sha256 ✓');
    assert.equal(s[2]!.prova, '594 keys · sha256 ✓');
    const mau = servicos([...plano, ev(6, 'm1', 'feito', 'migrador', { depois: { passo: 's3', objetos: 3, checksumsOk: false } })]);
    assert.equal(mau[0]!.checksumOk, false);
  });

  it('um erro num passo marca-o FAILED', () => {
    assert.equal(servicos([...plano, ev(6, 'm1', 'erro', 'migrador', { depois: { passo: 's3', erro: 'x' } })])[0]!.estado, 'failed');
  });
});

describe('painel v2: logs ao vivo', () => {
  it('a auditoria como log, em inglês, sem IPs', () => {
    const texto = logs(ciclo).map((l) => l.texto).join('\n');
    assert.match(texto, /\[migrator\] s3 1,520 files · sha256 ✓/);
    assert.match(texto, /\[migrator\] tests before ✓ after ✓/);
    assert.match(texto, /\[attacker\] tcp 5432 open postgresql/);
    assert.match(texto, /\[defense\] revoke TCP 5432 from 0\.0\.0\.0\/0/);
    assert.match(texto, /\[defense\] nmap :5432 filtered ✓/);
    assert.ok(!texto.includes('198.51.100.7'), 'os IPs não vão para o ecrã');
  });

  it('segredos: só a contagem', () => {
    const [l] = logs([ev(6, 'm9', 'feito', 'migrador', { depois: { passo: 'segredos', segredos: 16, checksumsOk: true } })]);
    assert.equal(l!.texto, '[migrator] segredos 16 secrets · values never shown · sha256 ✓');
  });
});

describe('painel v2: ecrã', () => {
  it('três colunas, relógio, vítima CLOSED, download e Undo só com token', () => {
    const html = renderizarV2(pedidos, ciclo, { token: 'tk', local: 'Leaseweb Amsterdam, NL', agora: new Date(t(40)) });
    for (const s of ['AGENT CHAIN', 'DEFENSE · THINKING NOW', 'SERVICES', 'LIVE LOGS', 'VICTIM VM', 'Download report (PDF)', 'href="/relatorio.pdf"', 'Undo last action'])
      assert.ok(html.includes(s), s);
    // Toggle Simples/Técnico: os dois botões e o glossário inlined para o browser.
    for (const s of ['class="modo"', 'data-m="simples"', 'data-m="tecnico"', 'painel-modo', '"MinIO":"object storage"'])
      assert.ok(html.includes(s), s);
    assert.match(html, /class="p p-closed">CLOSED</);
    assert.match(html, /AWS \(sim\) → Leaseweb Amsterdam, NL/);
    assert.match(html, /handoff → DEFENSE/);
    assert.ok(!renderizarV2(pedidos, ciclo).includes('Undo last action'), 'sem PAINEL_TOKEN não há botão');
  });

  it('variante Code: ficheiros do PR e o cartão com o URL', () => {
    const codigo = ev(50, '-', 'migracao-codigo', 'migrador', {
      depois: { ficheiros: ['leaseweb.env.example', 'src/armazenamento.ts'], ramo: 'migrador/leaseweb-x-1', url: 'https://github.com/o/r/pull/1' },
    });
    const html = renderizarV2(pedidos, [...ciclo, codigo]);
    assert.match(html, /leaseweb\.env\.example<\/b> · changed/);
    assert.match(html, /PR · Point the app to Leaseweb/);
    assert.match(html, /https:\/\/github\.com\/o\/r\/pull\/1/);
    assert.match(html, /class="aba code on">CODE/);
  });

  it('colunas com scroll próprio, tabs clicáveis e a rota do serviço por baixo dos números', () => {
    const html = renderizarV2(pedidos, ciclo);
    for (const id of ['rolo-cadeia', 'rolo-servicos', 'rolo-logs']) assert.match(html, new RegExp(`class="[^"]*rolo" id="${id}"`), id);
    assert.match(html, /\.rolo\{[^}]*overflow-y:auto/);
    for (const a of ['migrador', 'atacante', 'defesa', 'codigo', 'todos']) assert.match(html, new RegExp(`<button type="button" data-a="${a}" class="aba`), a);
    assert.match(html, /id="rolo-logs" data-ativo="defesa"/);
    assert.match(html, /class="ln[^"]*" data-a="migrador"/);
    assert.match(html, /<span>17,478 rows · 4 tables · sha256 ✓<\/span><small class="rota">AWS \(sim\) → Leaseweb<\/small>/);
    assert.ok(!html.includes('Cycle complete'), 'ainda não acabou');
  });

  it('"Cycle complete ✓" com a hora quando o ciclo tem o evento ciclo-terminado', () => {
    const fim = ev(45, '-', 'ciclo-terminado', 'orquestrador');
    const html = renderizarV2(pedidos, [...ciclo, fim]);
    assert.match(html, /id="ciclo-completo">Cycle complete ✓ \d\d:\d\d:\d\d</);
    assert.match(cadeia([...ciclo, fim]).at(-1)!.mensagem, /^Cycle complete ✓/);
    assert.equal(logs([fim])[0]!.texto, '[chief] cycle complete ✓');
    // O fim do ciclo anterior não conta quando já começou outro.
    assert.equal(cicloTerminado([...ciclo, fim, ev(50, 'm9', 'pedido', 'migrador', { depois: { passos: ['s3'] } })]), undefined);
    assert.equal(cicloTerminado([...ciclo, fim, ev(50, '-', 'infra-no-ar', 'orquestrador')]), undefined);
    assert.equal(cicloTerminado([...ciclo, fim, ev(50, 'p1', 'desfeito', 'defesa')]), fim);
  });

  it('escapa o que vem da auditoria', () => {
    const mau = [...plano, ev(10, 'p2', 'pedido', 'defesa', { depois: { titulo: '<script>alert(1)</script>' } })];
    const html = renderizarV2([], mau);
    assert.ok(!html.includes('<script>alert(1)'));
    assert.ok(html.includes('&#60;script&#62;'));
  });
});

describe('painel v2: rotas', () => {
  const srv = iniciarPainel(0, { host: '127.0.0.1', desfazer: async () => {} });
  after(() => srv.close());
  const base = async () => {
    if (!srv.listening) await new Promise((ok) => srv.once('listening', ok));
    return `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  };

  it('/ é o v2, /v1 foi removido e /relatorio.pdf vem como ficheiro PDF', async () => {
    const b = await base();
    assert.match(await (await fetch(`${b}/`)).text(), /AGENT CHAIN/);
    assert.equal((await fetch(`${b}/v1`)).status, 404, 'o ecrã antigo /v1 foi removido');
    const r = await fetch(`${b}/relatorio.pdf`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-disposition') ?? '', /^attachment; filename="[\w.-]+\.pdf"$/);
    assert.equal(r.headers.get('content-type'), 'application/pdf');
    assert.equal(Buffer.from(await r.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
    assert.equal((await fetch(`${b}/relatorio.html`)).status, 404, 'o HTML deixou de existir');
  });
});
