// Os slides. Cada slide é uma função (passo, v) que devolve HTML para um palco de 1920x1080.
// `passo` é o clique em que vai (0 a `passos`); `v` são os números ao vivo (n, t, x, testes).
// Para mudar a ordem, troca as entradas em `principais`. Para tirar um slide, apaga a entrada.
//
// Movimento (estilos/slides.css):
//   E(d)        entra a subir quando o slide aparece; d é a ordem (cada unidade = 90 ms de atraso).
//   ap(p, n)    aparece no clique n (e fica).
//   recua(p, n) escurece a partir do clique n, para dar palco ao que entra.
//   conta(v)    número que conta de 0 até v quando fica visível.
//   escada      numa lista: cada filho entra a seguir ao anterior.
//   pontos()    grelha de 100 pontos que se acendem um a um.
(function () {
  const E = (d, cls = '') => `class="e ${cls}" style="--d:${d}"`;
  const ap = (p, n, cls = '') => `class="ap ${cls}${p >= n ? ' on' : ''}"`;
  const recua = (p, n) => (p >= n ? ' recua' : '');
  const falta = (letra) => `<span class="falta">${letra}</span>`;
  const vazio = (x) => x === null || x === undefined || x === '';
  const fmt = (x) => (/^\d{4,}$/.test(String(x)) ? Number(x).toLocaleString('en') : String(x));
  const conta = (x, letra = '?', atraso = 0) =>
    vazio(x) ? falta(letra) : /^\d+$/.test(String(x)) ? `<span class="conta" data-valor="${x}" data-atraso="${atraso}">${fmt(x)}</span>` : fmt(x);
  const rotulo = (t, cor = 'muted', extra = '') => `<div class="rotulo ${cor}" ${extra}>${t}</div>`;
  // Grelha de 100 pontos: os primeiros `verdes` acendem a verde, os `lilases` seguintes a lilás.
  const pontos = (verdes, lilases = 0) =>
    `<div class="pontos">${Array.from({ length: 100 }, (_, i) => `<i class="pt${i < verdes ? ' aceso' : i < verdes + lilases ? ' aceso lilas' : ''}" style="--i:${i}"></i>`).join('')}</div>`;

  const principais = [
    {
      id: 'abertura',
      titulo: 'Abertura a frio',
      passos: 1,
      html: (p, v) => `
        <div class="lado-a-lado abertura">
          <div class="estat isco${recua(p, 1)}">
            <div ${E(0, 'ao-vivo lilas')}><span class="ponto"></span>LIVE · BAIT VM ON LEASEWEB</div>
            <div ${E(1, 'numero gigante coral')}>${conta(v.n, 'N', 300)}</div>
            <div ${E(2, 'legenda')}>attempts to break in<br>since 08:00.</div>
            <div ${E(4, 'mono muted nota-isco')}>Nobody told anyone it exists.</div>
          </div>
          <div class="divisor${p >= 1 ? ' cresce' : ''}"></div>
          <div ${ap(p, 1, 'estat inquerito')}>
            ${rotulo('LEASEWEB DIGITAL INDEPENDENCE SURVEY · 2026')}
            <div class="numero-e-pontos">
              <div class="numero grande verde">${p >= 1 ? conta(11) : '11'}<small>%</small></div>
              ${p >= 1 ? pontos(11) : pontos(0)}
            </div>
            <div class="legenda">could leave their cloud provider<br>in three weeks.</div>
          </div>
        </div>`,
    },
    {
      id: 'pedido',
      titulo: 'O pedido',
      passos: 0,
      html: () => `
        <div class="centro-v">
          ${rotulo('OUR ASK', 'lilas', E(0))}
          <div class="frase-xl">
            <div ${E(1)}>Leave a hyperscaler</div>
            <div ${E(2)}><span class="verde">in minutes,</span> <span class="riscado">not months.</span></div>
          </div>
          <div ${E(7, 'sub')}>Safely. Proven live on Leaseweb, in the next four minutes.</div>
        </div>`,
    },
    {
      id: 'soberania',
      titulo: 'Soberania completa',
      passos: 4,
      html: (p) => {
        const pecas = ['European', 'Secure', 'Compliant', 'In control'];
        return `
        <div class="soberania${p >= 4 ? ' junta' : ''}">
          <div class="pilha">
            <div class="pecas">
              ${pecas.map((t, i) => `<div class="peca canto-${i}${p >= i ? ' on' : ''}">${t}</div>`).join('<span class="mais">+</span>')}
            </div>
            <div class="resultado"><span class="soberano">Sovereign.</span></div>
          </div>
          <div class="verbos">migrate · secure · fix · prove</div>
        </div>`;
      },
    },
    {
      id: 'problema',
      titulo: 'O problema (49%)',
      passos: 1,
      html: (p) => `
        <div class="problema">
          <div class="problema-cima">
            <div ${E(1, 'numero gigante coral')}>${conta(49, '?', 200)}<small>%</small></div>
            <div class="problema-texto">
              ${rotulo('SANS CLOUD SECURITY SURVEY · 2026', 'muted', E(0))}
              <div ${E(2, 'legenda')}>of companies need more than a day to close a critical gap they already know about.</div>
            </div>
          </div>
          <div class="barras">
            <div ${E(4, 'barra-linha' + recua(p, 1))}>
              <span class="barra-rotulo">Known critical gap</span>
              <div class="barra-pista"><div class="barra coral longa"></div></div>
              <span class="barra-valor coral">&gt; 24 h</span>
            </div>
            <div ${ap(p, 1, 'barra-linha')}>
              <span class="barra-rotulo verde">Today, live</span>
              <div class="barra-pista"><div class="barra verde curta"></div><span class="faisca"></span></div>
              <span class="barra-valor verde">seconds</span>
            </div>
          </div>
        </div>`,
    },
    {
      id: 'para-quem',
      titulo: 'Para quem',
      passos: 0,
      html: () => {
        const msgs = [
          ['Migrator', 'azul', 'I found 3 AWS services in the app: S3, Postgres, SQS.\nProposal: MinIO, PostgreSQL and RabbitMQ, all self-hosted.', 'Approve plan'],
          ['Attacker', 'coral', 'The new database is open to the whole internet (port 5432).\nSeverity: high. Anyone can try to get in. @defesa', ''],
          ['Defense', 'verde', 'Your customer database is open to the whole internet. Someone outside can guess the password and get in.\nI propose closing outside access. Undo is saved.', 'Close'],
          ['Defense', 'verde', 'Closed and confirmed. Time exposed: T seconds.\nUndo saved: /desfazer', ''],
          ['Chief', '', 'In X min we moved from AWS to Leaseweb, closed one issue and fixed the cause. Nothing left the EU.', ''],
        ];
        return `
        <div class="lado-a-lado para-quem">
          <div class="pq-texto">
            ${rotulo("FOR OWNERS WHO AREN'T TECHNICAL", 'lilas', E(0))}
            <div ${E(1, 'frase-xl')}>Your whole<br>IT team,<br><span class="verde">inside Telegram.</span></div>
          </div>
          <div ${E(2, 'telemovel')}>
            <div class="tl-cab"><span class="tl-avatar">D</span><div><b>Direção</b><small>4 agents · you</small></div></div>
            <div class="tl-conversa">
              ${msgs
                .map(
                  ([quem, cor, texto, botao], i) => `
                <div class="tl-msg" style="--m:${i}">
                  <b class="${cor}">${quem}</b>
                  <span>${texto}</span>
                  ${botao ? `<span class="tl-botoes"><em class="tl-botao">${botao}</em><em class="tl-botao">Ignore</em></span>` : ''}
                </div>`,
                )
                .join('')}
            </div>
          </div>
        </div>`;
      },
    },
    {
      id: 'demo',
      titulo: 'Demo ao vivo',
      passos: 8,
      html: (p) => {
        const passos = [
          ['Decide', 'where each piece goes'],
          ['Approve', 'you are the owner'],
          ['Migrate', 'checksums match'],
          ['Attack', 'our machines only'],
          ['Defend', 'explain, approve, close'],
          ['Fix the cause', 'a pull request'],
          ['Validate', 'tests and attacker'],
          ['Certificate', 'audit-ready, to the phone'],
        ];
        return `
        <div class="demo">
          <div class="cabeca-demo">
            <div ${E(0, 'ao-vivo verde etiqueta')}><span class="ponto"></span>LIVE ON LEASEWEB</div>
            <div ${E(1, 'nota-honesta')}>AWS side simulated · everything on Leaseweb is real</div>
          </div>
          <div ${E(1, 'progresso')}><div class="progresso-barra" style="--k:${Math.min(p, 8) / 8}"></div></div>
          <ol class="passos-demo escada">
            ${passos
              .map(([t, d], i) => {
                const k = i + 1;
                const estado = p > k ? 'feito' : p === k ? 'agora' : '';
                return `<li class="${estado}"><span class="k">${String(k).padStart(2, '0')}</span><span class="t">${t}</span><span class="d">${d}</span></li>`;
              })
              .join('')}
          </ol>
        </div>`;
      },
    },
    {
      id: 'tracao',
      titulo: 'Tração de hoje',
      passos: 0,
      html: (p, v) => `
        <div class="centro-v">
          <div ${E(0, 'titulo')}>Built today. Measured today.</div>
          <div class="placar escada">
            <div class="kpi"><div class="numero medio">${conta(v.x, 'X', 400)}<small> min</small></div><div class="legenda-p">from a hyperscaler to Leaseweb</div></div>
            <div class="kpi verde"><div class="numero medio verde">${conta(v.t, 'T', 500)}<small> s</small></div><div class="legenda-p">exposed. Not a day.</div></div>
            <div class="kpi coral"><div class="numero medio coral">${conta(v.n, 'N', 600)}</div><div class="legenda-p">attacks on the bait</div></div>
            <div class="kpi"><div class="numero medio">${conta(v.testes, '?', 700)}</div><div class="legenda-p">automated tests</div></div>
          </div>
          <div ${E(7, 'mono muted')}>X, T and N come from the live run. Every action is on the record.</div>
        </div>`,
    },
    {
      id: 'como-funciona',
      titulo: 'Como funciona',
      passos: 0,
      html: () => `
        <div class="centro-v">
          <div ${E(0, 'titulo')}>Four agents. One flow.</div>
          <div class="fluxo escada">
            ${[
              ['Migrator', 'translates, in code', 'azul'],
              ['Attacker', 'tests the new doors', 'coral'],
              ['Defense', 'explains, proposes', 'verde'],
              ['You', 'approve in Telegram', 'tu'],
              ['Leaseweb API', 'closes, verifies', 'verde'],
            ]
              .map(([t, d, c]) => `<div class="no ${c}"><div class="t">${t}</div><div class="d">${d}</div></div>`)
              .join('<span class="seta">→</span>')}
          </div>
          <div class="camadas">
            <div ${E(10, 'camada')}><span class="rotulo">YOUR SERVER · SELF-HOSTED</span><span>MinIO · PostgreSQL · RabbitMQ · OpenBao · Valkey</span></div>
            <div ${E(11, 'camada')}><span class="rotulo verde">PROVIDER · LEASEWEB API</span><span class="mono"><b class="verde">One call</b> closes a door. <b class="azul">One call</b> opens it again. Seconds, measured today.</span></div>
          </div>
        </div>`,
    },
    {
      id: 'salvaguardas',
      titulo: 'Salvaguardas',
      passos: 0,
      html: () => `
        <div class="lado-a-lado">
          <div class="frase-xl empilhada">
            <div ${E(0)}>AI writes.</div>
            <div ${E(2, 'verde')}>Code acts.</div>
            <div ${E(4, 'lilas')}>You approve.</div>
          </div>
          <ul class="lista escada atrasada">
            <li>Closed list of actions</li>
            <li>Every action stores its inverse</li>
            <li>Audit: who · when · before · after</li>
            <li>Model runs in the EU</li>
            <li>Attacker only touches our machines</li>
          </ul>
        </div>`,
    },
    {
      id: 'a-seguir',
      titulo: 'O que vem a seguir',
      passos: 0,
      html: () => `
        <div class="centro-v">
          ${rotulo('NEXT · NOT BUILT YET', 'lilas', E(0))}
          <div ${E(1, 'titulo')}>Same flow. Any provider.</div>
          <div class="proximos escada atrasada">
            <div class="proximo-item"><div class="t">More providers</div><div class="d">Hostinger, OVHcloud: one adapter each, same operations</div></div>
            <div class="proximo-item"><div class="t">Your own machine</div><div class="d">over SSH, everything self-hosted, host firewall</div></div>
            <div class="proximo-item"><div class="t">Regulated reports</div><div class="d">the record shaped for NIS2 and DORA notifications</div></div>
          </div>
        </div>`,
    },
    {
      id: 'mercado',
      titulo: 'O mercado (73%)',
      passos: 1,
      html: (p) => `
        <div class="lado-a-lado mercado">
          <div class="estat">
            ${rotulo('LEASEWEB DIGITAL INDEPENDENCE SURVEY · 2026', 'muted', E(0))}
            <div ${E(1, 'numero gigante verde')}>${conta(73, '?', 200)}<small>%</small></div>
            <div ${E(2, 'legenda')}>would pay at least 11% more<br>for infrastructure independence.</div>
            <div ${ap(p, 1, 'nl')}><span class="numero medio lilas">${p >= 1 ? conta(81) : '81'}<small>%</small></span><span class="legenda-p">in the Netherlands</span></div>
          </div>
          <div ${E(2)}>${pontos(73, p >= 1 ? 8 : 0)}</div>
        </div>`,
    },
    {
      id: 'fecho',
      titulo: 'Fecho e pedido',
      passos: 0,
      html: () => `
        <div class="centro-v fecho">
          <div ${E(0, 'sub lilas')}>The safe way out of a hyperscaler.</div>
          <div class="frase-xxl">
            <div ${E(2)}>Leave in minutes.</div>
            <div ${E(4, 'verde sublinha')}>Close in seconds.</div>
          </div>
          <div ${E(8, 'pedido-final')}>${rotulo('OUR ASK', 'lilas')}<span>Make this the safe way in to Leaseweb.</span></div>
          <div ${E(10, 'equipa')}>${window.CONFIG.equipa.join(' · ')}</div>
          <div ${E(11, 'mono muted')}>${window.CONFIG.repo} · Apache 2.0</div>
        </div>`,
    },
    {
      id: 'ao-vivo',
      titulo: 'O percurso completo (replay)',
      passos: 0,
      html: (p, v) => {
        const ev = (quem, cor, hora, texto, atraso) => `
          <div class="lv-ev lv-in" style="--t:${atraso}">
            <i class="lv-dot ${cor}"></i>
            <div class="lv-ev-cab"><b class="${cor}">${quem}</b><span class="lv-hora">${hora}</span></div>
            <div class="lv-ev-txt">${texto}</div>
          </div>`;
        const t = vazio(v.t) ? falta('T') : fmt(v.t);
        const x = vazio(v.x) ? falta('X') : fmt(v.x);
        return `
        <div class="lv">
          <div class="lv-topo">
            <div class="lv-marca">
              <div class="rotulo">INFRAHACK · LEASEWEB · TODAY</div>
              <div class="lv-titulo">The whole run,<br><span class="verde">as it happened.</span></div>
              <div class="lv-sub">${conta(v.n, 'N', 0)} attempts on the bait · nothing left the EU.</div>
            </div>
            <div class="lv-relogio">
              <div class="rotulo">TIME EXPOSED</div>
              <div class="lv-segundos">${conta(v.t, 'T', 200)}<small>s</small></div>
              <div class="lv-estado lv-in" style="--t:5.1">closed by the owner</div>
            </div>
          </div>
          <div class="lv-corpo">
            <div class="lv-col lv-timeline">
              <div class="lv-cab"><span class="rotulo">AGENTS · DIREÇÃO</span><span class="mono muted">Telegram</span></div>
              <div class="lv-eventos">
                ${ev('Migrator', 'azul', '14:28', 'I found 3 AWS services. Proposal: MinIO, PostgreSQL, RabbitMQ.', 0.4)}
                ${ev('You', 'muted', '14:29', 'Plan approved. @migrador, go ahead.', 1.3)}
                ${ev('Migrator', 'azul', '14:30', 'Migration complete. Checksums match. Tests pass.', 2.2)}
                ${ev('Attacker', 'coral', '14:31', 'Database open to the internet (port 5432). Severity: high. @defesa', 3.1)}
                ${ev('Defense', 'verde', '14:31', 'I propose closing outside access. Undo saved.', 4.0)}
                ${ev('Defense', 'verde', '14:32', `Closed and confirmed. Time exposed: ${t} s.`, 4.9)}
                ${ev('Migrator', 'azul', '14:33', 'PR opened: fixed the cause. Tests pass.', 5.8)}
                ${ev('Chief', 'muted', '14:34', `In ${x} min: off AWS, on Leaseweb, one issue closed. Nothing left the EU.`, 6.7)}
              </div>
            </div>
            <div class="lv-col lv-infra">
              <div class="lv-cab"><span class="rotulo">INFRASTRUCTURE</span><span class="mono muted">Frankfurt</span></div>
              <div class="lv-infra-corpo">
                <div class="lv-infra-box lv-in" style="--t:0.8">
                  <div class="lv-infra-k">AWS · SIMULATED</div>
                  <div class="lv-infra-t">exemplo-app</div>
                  <div class="lv-infra-d">S3 · Postgres · SQS</div>
                </div>
                <div class="lv-seta lv-in" style="--t:1.5">↓ 1,220 objects · checksums ✓</div>
                <div class="lv-infra-box leaseweb lv-in" style="--t:2.2">
                  <div class="lv-infra-k">LEASEWEB · FRANKFURT</div>
                  <div class="lv-infra-t">your server</div>
                  <div class="lv-infra-d">MinIO · PostgreSQL · RabbitMQ</div>
                </div>
                <div class="lv-seta coral lv-in" style="--t:3.1">↓ nmap · 5432 open</div>
                <div class="lv-infra-box vitima lv-in" style="--t:3.8">
                  <div class="lv-infra-k">VICTIM · PORT 5432</div>
                  <div class="lv-infra-t">postgres</div>
                  <div class="lv-infra-d"><span class="coral">open</span> <span class="lv-in" style="--t:5.2">→ <span class="verde">filtered</span></span></div>
                </div>
              </div>
            </div>
            <div class="lv-col lv-provas">
              <div class="lv-cab"><span class="rotulo">PROOFS</span><span class="mono muted">audit log</span></div>
              <div class="lv-prova lv-in" style="--t:2.6"><span>Files</span><b class="verde">1,220 · checksums ✓</b></div>
              <div class="lv-prova lv-in" style="--t:2.8"><span>Database</span><b class="verde">5,620 rows · checksums ✓</b></div>
              <div class="lv-prova lv-in" style="--t:3.0"><span>Tests</span><b class="verde">${conta(v.testes, '?', 0)} pass</b></div>
              <div class="lv-prova lv-in" style="--t:4.4"><span>nmap before</span><b class="coral">5432 open</b></div>
              <div class="lv-prova lv-in" style="--t:5.2"><span>nmap after</span><b class="verde">filtered</b></div>
              <div class="lv-prova lv-in" style="--t:5.4"><span>Approved by</span><b>you</b></div>
              <div class="lv-prova lv-in" style="--t:5.6"><span>Undo</span><b class="mono">/desfazer</b></div>
              <div class="lv-prova lv-in" style="--t:5.8"><span>Time exposed</span><b class="verde">${t} s</b></div>
              <div class="lv-cert lv-in" style="--t:7.2">
                <div class="lv-cert-k">AUDIT-READY RECORD</div>
                <div class="lv-cert-t">Migration certificate</div>
                <div class="lv-cert-d">Where the data lives, proof nothing was lost, who closed what.</div>
              </div>
            </div>
          </div>
          <div class="lv-nota">SCRIPTED REPLAY · VALUES FROM THE AUDIT LOG</div>
        </div>`;
      },
    },
  ];

  const anexo = (codigo, titulo, corpo) => ({
    codigo,
    titulo,
    html: () => `<div class="anexo">${rotulo('ANNEX ' + codigo, 'lilas', E(0))}<div ${E(1, 'titulo')}>${titulo}</div><div class="corpo-anexo escada">${corpo}</div></div>`,
  });

  const anexos = [
    {
      id: 'a-api',
      ...anexo('A1', 'Real calls to the Leaseweb API', `
        <div class="codigo">
          <div><b class="verde">POST</b> /securityGroups/{id}/revokeFirewallRules <span class="muted">→ 202</span></div>
          <div class="muted">&nbsp;&nbsp;&nbsp;&nbsp; port filtered from outside in ~3 s · rule DELETING in the API ~39 s</div>
          <div><b class="verde">POST</b> /securityGroups/{id}/authorizeFirewallRules <span class="muted">→ 202</span></div>
          <div class="muted">&nbsp;&nbsp;&nbsp;&nbsp; CREATING → ACTIVE in ~7 s</div>
        </div>
        <div class="destaque verde">Measured today. We confirm the close from outside, with nmap, not just the API.</div>
        <div class="mono muted">api.leaseweb.com/publicCloud/v1 · Frankfurt (eu-central-1) · the account's Default group starts open to all ports</div>`),
    },
    {
      id: 'a-migra',
      ...anexo('A2', 'What migrates today', `
        <div class="tabela-migra">
          ${[['S3', 'MinIO'], ['SQS', 'RabbitMQ'], ['RDS', 'PostgreSQL'], ['ElastiCache', 'Valkey'], ['Secrets Manager', 'OpenBao']]
            .map(([a, b]) => `<div class="de">${a}</div><div class="seta verde">→</div><div class="para">${b}</div>`)
            .join('')}
          <div class="de">Lambda · IAM</div><div class="seta lilas">→</div><div class="para lilas">flagged: needs redesign</div>
        </div>`),
    },
    {
      id: 'a-ia',
      ...anexo('A3', "What the AI does, and doesn't", `
        <div class="duas-colunas">
          <div>${rotulo('DOES', 'verde')}<ul class="lista simples"><li>Explains in plain words</li><li>Classifies the risk</li><li>Writes the report</li></ul></div>
          <div>${rotulo('NEVER', 'lilas')}<ul class="lista simples muted"><li>Runs a command</li><li>Picks the action</li><li>Sees a secret's value</li></ul></div>
        </div>
        <div class="mono muted">20 s timeout · fixed text if the model fails · the demo never waits for the AI</div>`),
    },
    {
      id: 'a-auditoria',
      ...anexo('A4', 'Every action, on the record', `
        <div class="codigo cartao">
          <div class="muted">auditoria.jsonl · example</div>
          ${[['hora', '15:52:07'], ['tipo', 'fechar'], ['quem', 'owner (Telegram)'], ['antes', '5432/tcp from 0.0.0.0/0'], ['inverso', 'authorizeFirewallRules']]
            .map(([k, val]) => `<div><span class="lilas chave">${k}</span> <span class="${k === 'inverso' ? 'verde' : ''}">${val}</span></div>`)
            .join('')}
        </div>
        <div class="destaque verde">Who, when, before, and how to undo it. One click.</div>`),
    },
    {
      id: 'a-atacante',
      ...anexo('A5', 'The attacker is on a leash', `
        <ul class="lista">
          <li>Only our own machines (ALVOS_PERMITIDOS), with permission</li>
          <li>At most 20 password attempts</li>
          <li>Stops at the first entry: writes nothing, no sudo</li>
          <li>Any other target is refused and logged</li>
        </ul>`),
    },
    {
      id: 'a-noite',
      ...anexo('A6', 'Night mode: nobody answers', `
        <div class="fluxo">
          <div class="no"><div class="t">Critical finding</div><div class="d">owner silent for N min</div></div><span class="seta">→</span>
          <div class="no verde"><div class="t">Temporary measure</div><div class="d">port open to known IPs only</div></div><span class="seta">→</span>
          <div class="no lilas"><div class="t">Owner warned</div><div class="d">in Telegram, with undo</div></div>
        </div>
        <div class="destaque">Only actions marked safe without approval. Reversible. Off unless configured.</div>`),
    },
    {
      id: 'a-encaixe',
      ...anexo('A7', 'Leave on your own terms. Safely.', `
        <div class="antes-depois">
          <div class="caixa">${rotulo('TODAY')}<div class="muted">Months to leave</div><div class="muted">Temporary doors left open</div><div class="muted">Alerts nobody reads</div></div>
          <div class="seta verde">→</div>
          <div class="caixa cheia">${rotulo('WITH US', 'verde')}<div>Migrated, with proof</div><div>Doors closed as they open</div><div>Customers arrive secure</div></div>
        </div>
        <div class="mono lilas">Independent · Privately owned · Sovereign-by-design</div>`),
    },
    {
      id: 'a-certificado',
      ...anexo('A8', 'The migration certificate', `
        <div class="certificado">
          <div class="cert-cab"><span class="mono">CERT-YYYYMMDD-HHMM</span><span class="muted">Leaseweb Public Cloud · Frankfurt</span></div>
          <div class="cert-titulo">The migration finished, and it is secure.</div>
          <div class="cert-grelha">
            <div><b>1 · Where the data lives</b><span>each AWS service → its new home, provider, country, self-hosted or managed</span></div>
            <div><b>2 · Proof nothing was lost</b><span>files and rows copied, checksums, app tests before and after</span></div>
            <div><b>3 · Security after the move</b><span>what was found, closed at what time, by whom, seconds exposed</span></div>
            <div><b>4 · How to undo</b><span>actions with a stored inverse, one tap each</span></div>
          </div>
        </div>
        <div class="mono muted">An audit-ready record, not an official certification. Every field comes from the logs.</div>`),
    },
  ].map((a) => ({ ...a, passos: 0, anexo: true }));

  window.SLIDES = [...principais, ...anexos];
  window.PRIMEIRO_ANEXO = principais.length;
})();
