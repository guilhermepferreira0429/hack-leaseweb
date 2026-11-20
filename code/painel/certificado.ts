// GET /certificado: o certificado de migração em página (ideia wow 3, desenho em docs/material/design/web.pen).
// O texto para o Telegram é do chefe (code/chefe/certificado.ts); isto é a versão para o ecrã e para imprimir.
// Só o que está na auditoria do ciclo atual. O que não se mediu não aparece; nada de valores ilustrativos.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { EventoAuditoria, Pedido } from '@mwbe/shared';
import { auditoria, carregarEnv, estado } from '@mwbe/shared';
import { relogioExposicao } from '@mwbe/chefe';
import { cabecalho, escapar, horaLisboa, numero } from './estilo';
import { aprovadoPor, cicloAtual, portasDoCiclo, provas } from './linha-tempo';
import { destinoEscolhido } from './palco';

const CSS = `body{padding:48px 16px;color:#15171C}main{max-width:900px;margin:0 auto;display:flex;flex-direction:column;gap:36px;background:#F5F3EE}
.id{font:14px var(--mono);color:#8B929C;letter-spacing:1px}h1{margin:10px 0;font:400 52px/1.05 var(--serif)}.data{font:15px var(--mono);color:#8B929C}
.resumo{font-size:19px;color:#5F6168;line-height:1.5}
.sec{background:#fff;border-radius:18px;padding:28px;display:flex;flex-direction:column;gap:12px}
.sec h2{margin:0;display:flex;gap:12px;align-items:baseline;font:400 30px var(--serif)}.sec h2 small{font:14px var(--mono);color:#8B929C}
.sec hr{border:0;height:1px;background:#E9F3EC;margin:0}.kv{display:flex;justify-content:space-between;gap:16px;font-size:16px}
.kv span:first-child{color:#5F6168}.kv span:last-child{font:15px var(--mono);text-align:right}.ok{color:#2F7D5B}.bad{color:#C8363B}
.rodape b{font-size:16px}.rodape p{font:13px var(--mono);color:#8B929C;margin:6px 0 0}
@media print{body{padding:0}.sec{break-inside:avoid}}`;

const kv = (k: string, v: string) => `<div class="kv"><span>${escapar(k)}</span><span>${v}</span></div>`;

/** Uma linha de prova com o checksum do próprio passo (nunca o de outro). */
const prova = (ok: boolean | undefined, texto: string) =>
  `<span class="${ok ? 'ok' : 'bad'}">${texto} · checksum ${ok ? 'igual ✓' : 'DIFERENTE ✗'}</span>`;

export function renderizarCertificado(pedidos: Pedido[], todos: EventoAuditoria[], localDados?: string, agora = new Date()): string {
  const eventos = cicloAtual(todos);
  const p = provas(eventos);
  const exp = relogioExposicao(todos, agora);
  const portas = portasDoCiclo(eventos);
  const fechadas = portas.filter((x) => x.estado === 'fechada');
  const abertas = portas.filter((x) => x.estado !== 'fechada');
  const migrou = p.passosMigrados > 0;
  const c = p.checksumPorPasso;
  const tudoBem = migrou && p.checksums === true && abertas.length === 0;
  const onde = escapar(localDados || 'Leaseweb Public Cloud');
  const yyyymmdd = agora.toISOString().slice(0, 10).replace(/-/g, '');
  const hhmm = horaLisboa(agora, false).replace(':', '');

  const dest = destinoEscolhido(eventos);
  const linhaDestino = dest
    ? kv(
        'Destino escolhido',
        `${dest.modo === 'tudo-self-hosted' ? 'tudo self-hosted na VM' : 'o recomendado: Leaseweb gerido onde faz sentido (simulado: os dados correm na VM)'} · ${dest.peloDono ? 'escolha do dono' : 'por omissão'}`,
      )
    : '';
  const servicos = [
    linhaDestino,
    p.objetos !== undefined ? kv('S3 → MinIO', `${onde} · self-hosted`) : '',
    p.linhas !== undefined ? kv('RDS Postgres → Postgres', `${onde} · self-hosted`) : '',
    p.mensagens !== undefined ? kv('SQS → RabbitMQ', `${onde} · self-hosted`) : '',
    p.segredos !== undefined ? kv('Secrets Manager / SSM → OpenBao', `${onde} · self-hosted`) : '',
    p.chaves !== undefined ? kv('ElastiCache Redis → Valkey', `${onde} · self-hosted`) : '',
  ].join('');

  const falhas = portas
    .map((x) => {
      const pedido = pedidos.find((q) => q.id === x.pedidoId);
      const fecho = eventos.findLast((e) => e.pedidoId === x.pedidoId && e.tipo === 'feito');
      const valor =
        x.estado === 'fechada' && fecho
          ? `<span class="ok">fechada às ${horaLisboa(fecho.hora)} · ${escapar(aprovadoPor(eventos, x.pedidoId))}</span>`
          : `<span class="bad">${escapar(x.estado)}</span>`;
      return kv(pedido?.titulo ?? `${x.servico ?? 'porta'} ${x.porta}`, valor);
    })
    .join('');

  return `${cabecalho('Certificado de migração', CSS, true)}<main>
<header><div class="id">CERTIFICADO DE MIGRAÇÃO · CERT-${yyyymmdd}-${hhmm}</div>
<h1>${tudoBem ? 'A migração terminou e ficou segura.' : migrou ? 'A migração terminou. Há pontos por fechar.' : 'Migração ainda por fazer.'}</h1>
<div class="data">${agora.toLocaleDateString('pt-PT', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Lisbon' })} · ${horaLisboa(agora, false)} · ${onde}</div></header>
<div class="resumo">Gerado a partir do registo de auditoria deste ciclo: o que foi copiado, a prova de que nada se perdeu, o que o atacante encontrou, o que a defesa fechou, quem aprovou e como voltar atrás.</div>
${servicos ? `<div class="sec"><h2><small>01</small>Onde estão os dados</h2><hr>${servicos}</div>` : ''}
<div class="sec"><h2><small>02</small>Prova de que nada se perdeu</h2><hr>
${p.objetos !== undefined ? kv('Ficheiros', prova(c.s3, `${numero(p.objetos)} copiados`)) : kv('Ficheiros', '—')}
${p.linhas !== undefined ? kv('Base de dados', prova(c.postgres, `${numero(p.linhas)} linhas em ${p.tabelas} tabelas`)) : ''}
${p.mensagens !== undefined ? kv('Fila', prova(c.fila, `${numero(p.mensagens)} mensagens`)) : ''}
${p.segredos !== undefined ? kv('Segredos', prova(c.segredos, `${numero(p.segredos)} segredos (só a contagem)`)) : ''}
${p.chaves !== undefined ? kv('Cache', prova(c.cache, `${numero(p.chaves)} chaves`)) : ''}
${kv('Testes da app', p.testesAntes === undefined ? '—' : `<span class="${p.testesAntes && p.testesDepois ? 'ok' : 'bad'}">antes ${p.testesAntes ? '✓' : '✗'} · depois ${p.testesDepois ? '✓' : '✗'}</span>`)}</div>
<div class="sec"><h2><small>03</small>Segurança depois da migração</h2><hr>
${kv('Encontrado', portas.length ? `<span class="bad">${portas.length} ${portas.length === 1 ? 'falha' : 'falhas'}</span>` : p.atacou ? '<span class="ok">nada aberto</span>' : '—')}
${falhas}
${exp ? kv('Tempo exposto', `${exp.segundos} s${exp.aindaExposta ? ' (ainda exposta)' : ''}`) : ''}
${p.nmapDepois ? kv('Confirmação de fora (nmap)', `<span class="${p.nmapDepois.estado === 'open' ? 'bad' : 'ok'}">${p.nmapDepois.porta} ${escapar(p.nmapDepois.estado)}${p.nmapDepois.estado === 'open' ? '' : ' ✓'}</span>`) : ''}</div>
<div class="sec"><h2><small>04</small>Como voltar atrás</h2><hr>
${kv('Ações com inverso guardado', String(fechadas.length))}
${fechadas.map((x) => kv('Desfazer', `/desfazer ${escapar(x.pedidoId)}`)).join('')}</div>
<div class="rodape">${localDados ? `<b>Dados em ${onde}.</b>` : ''}<p>Gerado automaticamente a partir de auditoria.jsonl às ${horaLisboa(agora)}.</p></div>
</main></body></html>`;
}

export async function paginaCertificado(req: IncomingMessage, res: ServerResponse): Promise<void> {
  carregarEnv();
  res
    .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    .end(renderizarCertificado(estado.listarPedidos(), auditoria.ler(), process.env.LOCAL_DADOS || undefined));
}
