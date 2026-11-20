// Os slides. Cada slide é uma função (passo, v) que devolve HTML para um palco de 1920x1080.
// `passo` é o clique em que vai (0 a `passos`); `v` são os números ao vivo (n, t, x, testes).
// Para mudar a ordem, troca as entradas em `principais`. Para tirar um slide, apaga a entrada.
// Texto no ecrã: poucas palavras. Quem fala carrega o resto (js/guiao.js).
(function () {
  const ap = (p, n) => `ap${p >= n ? ' on' : ''}`;
  const num = (x, letra) => (x === null || x === undefined || x === '' ? `<span class="falta">${letra}</span>` : String(x));
  const rotulo = (t, cor = 'muted') => `<div class="rotulo ${cor}">${t}</div>`;

  const principais = [
    {
      id: 'abertura',
      titulo: 'Abertura a frio',
      passos: 1,
      html: (p, v) => `
        <div class="lado-a-lado">
          <div class="estat ${ap(p, 1)}">
            ${rotulo('LEASEWEB DIGITAL INDEPENDENCE SURVEY · 2026')}
            <div class="numero gigante verde">11%</div>
            <div class="legenda">could leave their cloud provider<br>in three weeks.</div>
          </div>
          <div class="divisor"></div>
          <div class="estat lateral">
            <div class="ao-vivo lilas"><span class="ponto"></span>LIVE · BAIT VM ON LEASEWEB</div>
            <div class="numero grande lilas">${num(v.n, 'N')}</div>
            <div class="legenda">attempts to break in<br>since 08:00</div>
          </div>
        </div>`,
    },
    {
      id: 'pedido',
      titulo: 'O pedido',
      passos: 0,
      html: () => `
        <div class="centro-v">
          ${rotulo('OUR ASK', 'lilas')}
          <div class="frase-xl">Leave a hyperscaler<br><span class="verde">in minutes, not months.</span></div>
          <div class="sub">Safely. Proven live on Leaseweb, in the next four minutes.</div>
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
        <div class="lado-a-lado">
          <div class="estat">
            ${rotulo('SANS CLOUD SECURITY SURVEY · 2026')}
            <div class="numero gigante lilas">49%</div>
            <div class="legenda">need more than a day to close<br>a critical gap they already know.</div>
          </div>
          <div class="divisor"></div>
          <div class="estat lateral ${ap(p, 1)}">
            ${rotulo('TODAY, LIVE', 'verde')}
            <div class="numero grande verde segundos">Seconds.</div>
            <div class="legenda">watch us close one</div>
          </div>
        </div>`,
    },
    {
      id: 'para-quem',
      titulo: 'Para quem',
      passos: 0,
      html: () => `
        <div class="centro-v">
          ${rotulo("FOR OWNERS WHO AREN'T TECHNICAL", 'lilas')}
          <div class="frase-xl">Your whole IT team,<br>inside Telegram.</div>
          <div class="agentes">
            ${[['Migrator', ''], ['Attacker', 'lilas'], ['Defense', 'verde'], ['Chief', '']]
              .map(([n, c]) => `<span class="agente"><span class="ponto ${c}"></span>${n}</span>`)
              .join('')}
          </div>
        </div>`,
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
          ['Report', 'to the phone'],
        ];
        return `
        <div class="demo">
          <div class="cabeca-demo">
            <div class="ao-vivo verde etiqueta"><span class="ponto"></span>LIVE ON LEASEWEB</div>
            <div class="nota-honesta">AWS side simulated · everything on Leaseweb is real</div>
          </div>
          <ol class="passos-demo">
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
          <div class="titulo">Built today. Measured today.</div>
          <div class="placar">
            <div class="kpi"><div class="numero medio">${num(v.x, 'X')}<small> min</small></div><div class="legenda-p">hyperscaler to Leaseweb</div></div>
            <div class="kpi verde"><div class="numero medio verde">${num(v.t, 'T')}<small> s</small></div><div class="legenda-p">exposed, not a day</div></div>
            <div class="kpi lilas"><div class="numero medio lilas">${num(v.n, 'N')}</div><div class="legenda-p">attacks on the bait</div></div>
            <div class="kpi"><div class="numero medio">${num(v.testes, '?')}</div><div class="legenda-p">automated tests</div></div>
          </div>
          <div class="mono muted">X, T and N come from the live run. Every action is on the record.</div>
        </div>`,
    },
    {
      id: 'como-funciona',
      titulo: 'Como funciona',
      passos: 0,
      html: () => `
        <div class="centro-v">
          <div class="titulo">Four agents. One flow.</div>
          <div class="fluxo">
            ${[
              ['Migrator', 'translates, in code', ''],
              ['Attacker', 'tests the new doors', 'lilas'],
              ['Defense', 'explains, proposes', 'verde'],
              ['You', 'approve in Telegram', 'tu'],
              ['Leaseweb API', 'closes, verifies', 'verde'],
            ]
              .map(([t, d, c]) => `<div class="no ${c}"><div class="t">${t}</div><div class="d">${d}</div></div>`)
              .join('<span class="seta">→</span>')}
          </div>
          <div class="chamadas">
            <div><b class="verde">POST</b> /securityGroups/{id}/revokeFirewallRules <span class="muted">· closes the rule</span></div>
            <div><b class="lilas">POST</b> /securityGroups/{id}/authorizeFirewallRules <span class="muted">· puts it back</span></div>
          </div>
        </div>`,
    },
    {
      id: 'salvaguardas',
      titulo: 'Salvaguardas',
      passos: 0,
      html: () => `
        <div class="lado-a-lado">
          <div class="frase-xl empilhada">AI writes.<br><span class="verde">Code acts.</span><br><span class="lilas">You approve.</span></div>
          <ul class="lista">
            <li>Closed list of actions</li>
            <li>Every action stores its inverse</li>
            <li>Audit: who · when · before · after</li>
            <li>Model runs in the EU</li>
            <li>Attacker only touches our machines</li>
          </ul>
        </div>`,
    },
    {
      id: 'mercado',
      titulo: 'O mercado (73%)',
      passos: 1,
      html: (p) => `
        <div class="lado-a-lado">
          <div class="estat">
            ${rotulo('LEASEWEB DIGITAL INDEPENDENCE SURVEY · 2026')}
            <div class="numero gigante verde">73%</div>
            <div class="legenda">would pay at least 11% more<br>for infrastructure independence.</div>
          </div>
          <div class="divisor"></div>
          <div class="estat lateral ${ap(p, 1)}">
            ${rotulo('IN THE NETHERLANDS', 'lilas')}
            <div class="numero grande lilas">81%</div>
            <div class="legenda">would pay at least 11% more</div>
          </div>
        </div>`,
    },
    {
      id: 'fecho',
      titulo: 'Fecho e pedido',
      passos: 0,
      html: () => `
        <div class="centro-v">
          <div class="sub lilas">Sovereignty without security just moves the problem.</div>
          <div class="frase-xxl">Open source.<br><span class="verde">Ready to continue.</span></div>
          <div class="pedido-final">${rotulo('OUR ASK', 'lilas')}<span>Make this the safe way in to Leaseweb.</span></div>
          <div class="equipa">${window.CONFIG.equipa.join(' · ')}</div>
          <div class="mono muted">${window.CONFIG.repo} · Apache 2.0</div>
        </div>`,
    },
  ];

  const anexo = (codigo, titulo, corpo) => ({ codigo, titulo, html: () => `<div class="anexo">${rotulo('ANNEX ' + codigo, 'lilas')}<div class="titulo">${titulo}</div><div class="corpo-anexo">${corpo}</div></div>` });

  const anexos = [
    {
      id: 'a-api',
      ...anexo('A1', 'Real calls to the Leaseweb API', `
        <div class="codigo">
          <div><b class="verde">POST</b> /securityGroups/{id}/revokeFirewallRules <span class="muted">→ 202</span></div>
          <div><b class="lilas">GET&nbsp;</b> /securityGroups/{id}/firewallRules <span class="muted">until the rule is gone</span></div>
          <div><b class="verde">POST</b> /securityGroups/{id}/authorizeFirewallRules <span class="muted">→ 202</span></div>
          <div><b class="lilas">GET&nbsp;</b> /securityGroups/{id}/firewallRules <span class="muted">until ACTIVE</span></div>
        </div>
        <div class="destaque verde">Every change is read back. A failure is audited and reported.</div>
        <div class="mono muted">Base: api.leaseweb.com/publicCloud/v1 · header X-LSW-Auth</div>`),
    },
    {
      id: 'a-migra',
      ...anexo('A2', 'What migrates today', `
        <div class="tabela-migra">
          ${[['S3', 'MinIO'], ['SQS', 'RabbitMQ'], ['RDS', 'PostgreSQL'], ['ElastiCache', 'Valkey']]
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
  ].map((a) => ({ ...a, passos: 0, anexo: true }));

  window.SLIDES = [...principais, ...anexos];
  window.PRIMEIRO_ANEXO = principais.length;
})();
