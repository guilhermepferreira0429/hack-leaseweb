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
            <div ${E(0, 'ao-vivo lilas')}><span class="ponto"></span>ENCOMENDAS LUSAS · BAIT VM ON LEASEWEB</div>
            <div ${E(1, 'numero gigante coral')}>${conta(v.n, 'N', 300)}</div>
            <div ${E(2, 'legenda')}>attempts to break in<br>since 08:00.</div>
            <div ${E(4, 'mono muted nota-isco')}>A server with her new setup · 500 customers, 5,000 orders a year, all on AWS.<br>Nobody told anyone it exists.</div>
          </div>
          <div class="divisor${p >= 1 ? ' cresce' : ''}"></div>
          <div ${ap(p, 1, 'estat inquerito')}>
            ${rotulo('SANS CLOUD SECURITY SURVEY · 2026')}
            <div class="numero-e-pontos">
              <div class="numero grande verde">${p >= 1 ? conta(49) : '49'}<small>%</small></div>
              ${p >= 1 ? pontos(49) : pontos(0)}
            </div>
            <div class="legenda">need more than a day to close<br>a critical gap they know about.</div>
          </div>
        </div>`,
    },
    {
      id: 'problema',
      titulo: 'O problema (49%)',
      passos: 1,
      html: (p) => `
        <div class="problema">
          <div class="problema-cima">
            <div ${E(1, 'numero gigante coral')}>${conta(45, '?', 200)}<small>%</small></div>
            <div class="problema-texto">
              ${rotulo('SANS CLOUD SECURITY SURVEY · 2026', 'muted', E(0))}
              <div ${E(2, 'legenda')}>of cloud incidents start with a misconfiguration.</div>
              <div ${E(3, 'mini-stats')}>
              <div class="mini"><div class="mini-n">49%</div><div class="mini-d">need &gt; 1 day to close a known gap<br><em>SANS 2026</em></div></div>
              <div class="mini"><div class="mini-n">55%</div><div class="mini-d">need &gt; 3 months to leave<br><em>Leaseweb 2026</em></div></div>
            </div>
            </div>
          </div>
          <div class="barras">
            <div ${E(4, 'barra-linha' + recua(p, 1))}>
              <span class="barra-rotulo">Known critical gap</span>
              <div class="barra-pista"><div class="barra coral longa"></div></div>
              <span class="barra-valor coral">&gt; 24 h</span>
            </div>
            <div ${ap(p, 1, 'barra-linha')}>
              <span class="barra-rotulo verde">For Lusas, today</span>
              <div class="barra-pista"><div class="barra verde curta"></div><span class="faisca"></span></div>
              <span class="barra-valor verde">seconds</span>
            </div>
          </div>
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
          <div class="verbos">explain · approve · close · prove</div>
        </div>`;
      },
    },
    {
      id: 'para-quem',
      titulo: 'Para quem',
      passos: 0,
      html: (p, v) => {
        const t = vazio(v.t) ? falta('T') : fmt(v.t);
        const x = vazio(v.x) ? falta('X') : fmt(v.x);
        const av = {
          Migrator: 'avatares/migrator.png',
          Attacker: 'avatares/attacker.png',
          Defender: 'avatares/defender.png',
          Orchestrator: 'avatares/orchestrator.png',
        };
        const msgs = [
          ['Migrator', 'azul', '5 services found.\nProposal: MinIO, PostgreSQL, RabbitMQ, OpenBao and Valkey. All self-hosted.', 'Approve plan'],
          ['Attacker', 'coral', 'The new database is open to the whole internet (port 5432).\nSeverity: high. Anyone can try to get in. @Defender', ''],
          ['Defender', 'verde', 'Your customer database is open to the whole internet. Someone outside can guess the password and get in.\nI propose closing outside access. Undo is saved.', 'Close'],
          ['Defender', 'verde', `Closed and confirmed. Time exposed: ${t} seconds.\nUndo saved: /desfazer`, ''],
          ['Orchestrator', '', `In ${x} min we moved from AWS to Leaseweb, closed one issue and fixed the cause. Nothing left the EU.`, ''],
        ];
        return `
        <div class="lado-a-lado para-quem">
          <div class="pq-texto">
            ${rotulo("FOR ANA, WHO ISN'T TECHNICAL", 'lilas', E(0))}
            <div ${E(1, 'frase-xl')}>Your whole<br>IT team,<br><span class="verde">inside Telegram.</span></div>
          </div>
          <div ${E(2, 'telemovel')}>
            <div class="tl-cab"><img class="tl-avatar-img" src="avatares/board.png" alt="Board"><div><b>Board</b><small>5 members · you</small></div></div>
            <div class="tl-conversa">
              ${msgs
                .map(
                  ([quem, cor, texto, botao], i) => `
                <div class="tl-msg" style="--m:${i}">
                  <div class="tl-quem">${av[quem] ? `<img class="tl-mini" src="${av[quem]}" alt="">` : '<span class="tl-mini dv">DV</span>'}<b class="${cor}">${quem}</b></div>
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
          ['Decide', 'what moves, and what opens'],
          ['Approve', 'you are the owner'],
          ['Migrate', 'the window opens'],
          ['Attack', 'we find the open door'],
          ['Defend', 'AI explains, you close'],
          ['Fix the cause', 'the door stays shut'],
          ['Validate', 'the attacker checks again'],
          ['Certificate', 'the proof, on your phone'],
        ];
        return `
        <div class="demo">
          <div class="cabeca-demo">
            <div ${E(0, 'ao-vivo verde etiqueta')}><span class="ponto"></span>ENCOMENDAS LUSAS · LIVE ON LEASEWEB</div>
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
          <div ${E(1, 'demo-link')}>Live panel · ${window.CONFIG?.painelUrl ?? ''} · press D</div>
        </div>`;
      },
    },
    {
      id: 'como-funciona',
      titulo: 'Como funciona',
      passos: 0,
      html: () => `
        <div class="centro-v">
          <div ${E(0, 'titulo')}>Four agents. One flow.</div>
          <div class="fluxo escada seis">
            ${[
              ['Migrator', 'translates, in code', 'azul', 'migrator'],
              ['Attacker', 'tests the new doors', 'coral', 'attacker'],
              ['Defender', 'explains, proposes', 'verde', 'defender'],
              ['Orchestrator', 'coordinates, reports', 'chf', 'orchestrator'],
              ['You', 'approve in Telegram', 'tu', ''],
              ['Leaseweb API', 'closes, verifies', 'verde', ''],
            ]
              .map(
                ([t, d, c, a]) =>
                  `<div class="no ${c}">${a ? `<img class="no-av" src="avatares/${a}.png" alt="">` : t === 'You' ? '<span class="no-av dv">DV</span>' : '<span class="no-av api">API</span>'}<div class="t">${t}</div><div class="d">${d}</div></div>`,
              )
              .join('<span class="seta">→</span>')}
          </div>
          <div class="camadas">
            <div ${E(10, 'camada')}><span class="rotulo">AI · EUROPEAN INFERENCE</span><span>Explains in plain words. Never picks the action, never runs a command.</span></div>
            <div ${E(11, 'camada')}><span class="rotulo verde">ACTIONS · CLOSED LIST</span><span class="mono"><b class="verde">One call</b> closes a door. <b class="azul">The inverse</b> opens it again. Every line audited.</span></div>
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
            <li>Models run on European inference</li>
            <li>Attacker only touches our machines</li>
          </ul>
        </div>`,
    },
    {
      id: 'tracao',
      titulo: 'Tração de hoje',
      passos: 0,
      html: (p, v) => `
        <div class="centro-v">
          <div ${E(0, 'titulo')}>Encomendas Lusas, measured today.</div>
          <div class="placar escada">
            <div class="kpi verde"><div class="numero medio verde">${conta(v.t, 'T', 400)}<small> s</small></div><div class="legenda-p">exposed. Not a day.</div></div>
            <div class="kpi coral"><div class="numero medio coral">${conta(v.n, 'N', 500)}</div><div class="legenda-p">attacks on the bait</div></div>
            <div class="kpi"><div class="numero medio">${conta(v.testes, '?', 600)}</div><div class="legenda-p">automated tests</div></div>
            <div class="kpi"><div class="numero medio">${conta(v.x, 'X', 700)}<small> min</small></div><div class="legenda-p">the move, as context</div></div>
          </div>
          <div ${E(7, 'mono muted')}>All measured today, in one run. Every action is on the record.</div>
        </div>`,
    },
    {
      id: 'antes-depois',
      titulo: 'Antes e depois',
      passos: 0,
      html: (p, v) => {
        const t = vazio(v.t) ? falta('T') : fmt(v.t);
        const x = vazio(v.x) ? falta('X') : fmt(v.x);
        return `
        <div class="centro-v bd">
          <div class="bd-cab">
            <div class="rotulo">ENCOMENDAS LUSAS · TIME · COST · RISK</div>
            <div ${E(0, 'titulo')}>Before. After.</div>
          </div>
          <div class="bd-grelha">
            <div ${E(1, 'bd-col antes')}>
              <div class="bd-k">BEFORE</div>
              <div class="bd-linha"><span class="bd-num">&gt; 24 h</span><small>to close a critical gap · 49%</small></div>
              <div class="bd-linha"><span class="bd-num">45%</span><small>of incidents start with misconfiguration</small></div>
              <div class="bd-linha"><span class="bd-num">$4.99M</span><small>average breach cost · IBM 2026</small></div>
            </div>
            <div class="bd-seta">→</div>
            <div ${E(3, 'bd-col depois')}>
              <div class="bd-k">AFTER</div>
              <div class="bd-linha"><span class="bd-num">${t} s</span><small>to close · measured today</small></div>
              <div class="bd-linha"><span class="bd-num">${conta(v.testes, '?', 200)}</span><small>tests on the record · audit-ready</small></div>
              <div class="bd-linha"><span class="bd-num">1 API call</span><small>to undo · open source</small></div>
            </div>
          </div>
          <div ${E(6, 'bd-nota')}>A breach costs $4.99M on average; closing this gap costs one API call. <span class="verde">Every action is on the record.</span></div>
        </div>`;
      },
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
            <div ${E(2, 'legenda')}>would pay at least 11% more<br>for control over their own infrastructure.</div>
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
          <div ${E(0, 'sub lilas')}>Your security team, inside Telegram.</div>
          <div class="frase-xxl">
            <div ${E(2)}>AI explains. You approve.</div>
            <div ${E(4, 'verde sublinha')}>Closed in seconds.</div>
          </div>
          <div ${E(8, 'pedido-final')}>${rotulo('OUR ASK', 'lilas')}<span>Make this the safe way in to Leaseweb.</span></div>
          <div ${E(10, 'equipa')}>${window.CONFIG.equipa.join(' · ')}</div>
          <div ${E(11, 'mono muted')}>${window.CONFIG.repo} · Apache 2.0</div>
        </div>`,
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
        <div class="mono muted">European inference (TensorX, sference) · 20 s timeout · fixed text if the model fails</div>`),
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
          <li>At most 5 password attempts per round; then it switches tool</li>
          <li>Stops at the first entry: writes nothing, no sudo</li>
          <li>Any other target is refused and logged</li>
        </ul>`),
    },
    {
      id: 'a-noite',
      ...anexo('A6', 'Night mode: nobody answers', `
        <div class="fluxo">
          <div class="no"><div class="t">Critical finding</div><div class="d">owner silent for 5 min</div></div><span class="seta">→</span>
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
    {
      id: 'a-qa',
      ...anexo('A9', 'Every question, one answer', `
        <div class="qa-scroll">
          <div class="qa-grelha">
            ${(window.PERGUNTAS ?? []).map(
              (q) => `<div class="qa-item"><div class="qa-p">${q.p}</div><div class="qa-r">${q.r.replace('{testes}', String(window.CONFIG?.aoVivo?.testes ?? '?'))}</div><div class="qa-quem">${q.quem}</div></div>`,
            ).join('')}
          </div>
        </div>
        <div class="qa-nota mono muted"><span>Sources: README.md · A1–A8 for the deep dives.</span><span class="qa-hint">↓ scroll</span></div>`),
    },
  ].map((a) => ({ ...a, passos: 0, anexo: true }));

  window.SLIDES = [...principais, ...anexos];
  window.PRIMEIRO_ANEXO = principais.length;
})();
