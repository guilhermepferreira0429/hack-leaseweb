// O motor do deck: navegação, teclas, vista do apresentador, vista geral, guião, números ao vivo,
// painel por cima, vídeo de recurso e cronómetro. Sem dependências e sem build: abre com duplo clique.
(function () {
  const C = window.CONFIG;
  const S = window.SLIDES;
  const G = window.GUIAO;
  const W = 1920;
  const H = 1080;
  const params = new URLSearchParams(location.search);
  const modo = params.has('apresentador') ? 'apresentador' : params.has('guiao') ? 'guiao' : 'palco';

  // ---------- estado ----------
  const lerValores = () => {
    try {
      return { ...C.aoVivo, ...JSON.parse(localStorage.getItem('pitch-aoVivo') || '{}') };
    } catch {
      return { ...C.aoVivo };
    }
  };
  const estado = { i: 0, p: 0, inicio: null, valores: lerValores() };
  const hash = /^#(\d+)\.(\d+)$/.exec(location.hash);
  if (hash) {
    estado.i = Math.min(S.length - 1, +hash[1]);
    estado.p = Math.min(S[estado.i].passos, +hash[2]);
  }

  const trocar = (s) =>
    String(s).replace(/\{(n|t|x|testes)\}/g, (_, k) => {
      const v = estado.valores[k];
      return v === null || v === undefined || v === '' ? k.toUpperCase() : v;
    });
  const mmss = (seg) => {
    const s = Math.max(0, Math.round(seg));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  };

  // ---------- desenhar um slide ----------
  const numeroDe = (i) => (S[i].anexo ? `annex ${S[i].codigo}` : `${String(i + 1).padStart(2, '0')} / ${String(window.PRIMEIRO_ANEXO).padStart(2, '0')}`);
  const htmlSlide = (i, p) =>
    `<section class="slide${S[i].anexo ? ' e-anexo' : ''}" data-id="${S[i].id}">
      <div class="conteudo">${S[i].html(p, estado.valores)}</div>
      <footer class="rodape"><span>hack-leaseweb</span><span>${numeroDe(i)}</span></footer>
    </section>`;

  // Atualiza o DOM só onde muda, para as transições CSS correrem entre cliques do mesmo slide.
  const morph = (a, b) => {
    if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) return a.replaceWith(b.cloneNode(true));
    if (a.nodeType === 3) {
      if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue;
      return;
    }
    if (a.nodeType !== 1) return;
    for (const { name } of [...a.attributes]) if (!b.hasAttribute(name)) a.removeAttribute(name);
    for (const { name, value } of [...b.attributes]) if (a.getAttribute(name) !== value) a.setAttribute(name, value);
    const ca = [...a.childNodes];
    const cb = [...b.childNodes];
    if (ca.length !== cb.length) {
      a.replaceChildren(...cb.map((n) => n.cloneNode(true)));
      return;
    }
    ca.forEach((n, k) => morph(n, cb[k]));
  };

  const desenhar = (palco, i, p, suave) => {
    const novo = el('div', null, htmlSlide(i, p)).firstElementChild;
    const atual = palco.firstElementChild;
    if (suave && atual && atual.dataset.id === novo.dataset.id) morph(atual, novo);
    else palco.replaceChildren(novo);
  };

  // Um palco de 1920x1080 escalado para caber na caixa.
  const criarPalco = (caixa) => {
    const palco = el('div', 'palco');
    caixa.appendChild(palco);
    const ajustar = () => {
      const r = caixa.getBoundingClientRect();
      const k = Math.min(r.width / W, r.height / H);
      palco.style.transform = `translate(${(r.width - W * k) / 2}px, ${(r.height - H * k) / 2}px) scale(${k})`;
    };
    new ResizeObserver(ajustar).observe(caixa);
    ajustar();
    return palco;
  };

  // ---------- navegação ----------
  let aoMudar = () => {};
  const ir = (i, p = 0) => {
    i = Math.max(0, Math.min(S.length - 1, i));
    estado.i = i;
    estado.p = Math.max(0, Math.min(S[i].passos, p));
    history.replaceState(null, '', `#${estado.i}.${estado.p}`);
    aoMudar(true);
  };
  const acoes = {
    seguinte() {
      if (estado.inicio === null) estado.inicio = Date.now();
      if (estado.p < S[estado.i].passos) {
        estado.p++;
        history.replaceState(null, '', `#${estado.i}.${estado.p}`);
        aoMudar(true);
      } else if (estado.i < S.length - 1) ir(estado.i + 1, 0);
    },
    anterior() {
      if (estado.p > 0) {
        estado.p--;
        history.replaceState(null, '', `#${estado.i}.${estado.p}`);
        aoMudar(true);
      } else if (estado.i > 0) ir(estado.i - 1, S[estado.i - 1].passos);
    },
    slideSeguinte: () => ir(estado.i + 1, 0),
    slideAnterior: () => ir(estado.i - 1, 0),
    inicio: () => ir(0, 0),
    anexos: () => ir(window.PRIMEIRO_ANEXO, 0),
    ir: (i) => ir(i, 0),
    zerarRelogio() {
      estado.inicio = null;
      aoMudar(false);
    },
    arrancarRelogio() {
      estado.inicio = Date.now();
      aoMudar(false);
    },
    valores(v) {
      estado.valores = { ...estado.valores, ...v };
      localStorage.setItem('pitch-aoVivo', JSON.stringify(estado.valores));
      aoMudar(false);
    },
  };

  // ---------- tempo previsto ----------
  const principais = S.slice(0, window.PRIMEIRO_ANEXO);
  const previstoAte = (i) => principais.slice(0, i).reduce((t, s) => t + (G[s.id]?.segundos || 0), 0);

  // ---------- sobreposições (palco) ----------
  const sobre = {};
  const alternar = (nome, criar) => {
    if (sobre[nome]) {
      sobre[nome].remove();
      delete sobre[nome];
      return false;
    }
    sobre[nome] = criar();
    document.body.appendChild(sobre[nome]);
    return true;
  };
  const fecharTudo = () => Object.keys(sobre).forEach((k) => alternar(k));

  const ajuda = () =>
    el(
      'div',
      'sobre ajuda',
      `<div class="caixa-ajuda"><h2>Teclas</h2><table>
      ${[
        ['→ · Espaço · PageDown', 'Avançar um clique'],
        ['← · PageUp', 'Recuar'],
        ['Shift + → / ←', 'Slide seguinte / anterior'],
        ['número + Enter', 'Ir para o slide'],
        ['Home', 'Primeiro slide'],
        ['A', 'Anexos (para as perguntas)'],
        ['O', 'Vista geral'],
        ['P', 'Vista do apresentador (outra janela)'],
        ['G', 'Guião completo, para imprimir'],
        ['E', 'Números ao vivo: N, T, X, testes'],
        ['D', 'Painel ao vivo por cima do slide'],
        ['V', 'Vídeo de recurso'],
        ['B', 'Ecrã preto'],
        ['F', 'Ecrã inteiro'],
        ['T', 'Cronómetro: arrancar de novo (Shift+T zera)'],
        ['H · Esc', 'Esta ajuda / fechar'],
      ]
        .map(([k, d]) => `<tr><td><kbd>${k}</kbd></td><td>${d}</td></tr>`)
        .join('')}</table></div>`,
    );

  const vistaGeral = () => {
    const o = el('div', 'sobre geral');
    const grelha = (de, ate, titulo) => {
      o.appendChild(el('h2', null, titulo));
      const g = el('div', 'grelha');
      for (let i = de; i < ate; i++) {
        const c = el('button', 'miniatura' + (i === estado.i ? ' atual' : ''));
        const caixa = el('div', 'caixa-mini');
        c.appendChild(caixa);
        c.appendChild(el('span', 'nome', `${S[i].anexo ? S[i].codigo : i + 1} · ${S[i].titulo}`));
        g.appendChild(c);
        const palco = criarPalco(caixa);
        palco.innerHTML = htmlSlide(i, S[i].passos);
        c.onclick = () => {
          alternar('geral');
          ir(i, 0);
        };
      }
      o.appendChild(g);
    };
    grelha(0, window.PRIMEIRO_ANEXO, 'Pitch');
    grelha(window.PRIMEIRO_ANEXO, S.length, 'Anexos');
    return o;
  };

  const editor = () => {
    const v = estado.valores;
    const f = el(
      'form',
      'sobre editor',
      `<div class="caixa-editor"><h2>Números ao vivo</h2>
      ${[
        ['n', 'N · tentativas no isco'],
        ['t', 'T · segundos exposto'],
        ['x', 'X · minutos da migração'],
        ['testes', 'Testes automáticos'],
      ]
        .map(([k, l]) => `<label>${l}<input name="${k}" value="${v[k] ?? ''}" autocomplete="off"></label>`)
        .join('')}
      <div class="botoes"><button type="submit">Guardar (Enter)</button><a href="${C.iscoUrl}" target="_blank">abrir /isco</a></div>
      <p class="dica">Fica guardado neste browser e passa para a vista do apresentador. Vazio mostra a letra.</p></div>`,
    );
    f.onsubmit = (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f));
      for (const k in d) d[k] = d[k].trim() === '' ? null : d[k].trim();
      acoes.valores(d);
      alternar('editor');
    };
    setTimeout(() => f.querySelector('input').focus(), 0);
    return f;
  };

  const painel = () => {
    const o = el('div', 'sobre painel-vivo');
    o.appendChild(el('iframe', null)).src = C.painelUrl;
    o.appendChild(el('div', 'etiqueta-painel', `painel ao vivo · ${C.painelUrl} · D fecha`));
    return o;
  };

  const video = () => {
    const o = el('div', 'sobre video');
    const v = el('video');
    v.src = C.videoPlanoB;
    v.controls = true;
    v.autoplay = true;
    v.onended = () => alternar('video');
    v.onerror = () => o.appendChild(el('div', 'erro-video', `Não encontrei ${C.videoPlanoB} ao lado do index.html.`));
    o.appendChild(v);
    return o;
  };

  // ---------- teclado (palco e apresentador) ----------
  let digitos = '';
  let tDigitos;
  const teclado = (enviar) => (e) => {
    if (e.target.closest && e.target.closest('input, textarea')) {
      if (e.key === 'Escape') fecharTudo();
      return;
    }
    const k = e.key;
    if (/^\d$/.test(k)) {
      digitos += k;
      clearTimeout(tDigitos);
      tDigitos = setTimeout(() => (digitos = ''), 1500);
      return;
    }
    if (k === 'Enter' && digitos) {
      enviar('ir', +digitos - 1);
      digitos = '';
      return;
    }
    const mapa = {
      ArrowRight: e.shiftKey ? 'slideSeguinte' : 'seguinte',
      ' ': 'seguinte',
      PageDown: 'seguinte',
      ArrowLeft: e.shiftKey ? 'slideAnterior' : 'anterior',
      PageUp: 'anterior',
      Home: 'inicio',
      a: 'anexos',
      A: 'anexos',
      t: 'arrancarRelogio',
      T: 'zerarRelogio',
    };
    if (mapa[k]) {
      e.preventDefault();
      enviar(mapa[k]);
      return;
    }
    if (modo === 'apresentador') {
      if (k === 'q' || k === 'Q') document.body.classList.toggle('com-perguntas');
      return;
    }
    const s = k.toLowerCase();
    if (s === 'h' || k === '?') alternar('ajuda', ajuda);
    else if (s === 'o') alternar('geral', vistaGeral);
    else if (s === 'e') alternar('editor', editor);
    else if (s === 'd') alternar('painel', painel);
    else if (s === 'v') alternar('video', video);
    else if (s === 'b') document.body.classList.toggle('preto');
    else if (s === 'f') (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {});
    else if (s === 'p') abrirApresentador();
    else if (s === 'g') window.open('index.html?guiao', 'guiao');
    else if (k === 'Escape') {
      fecharTudo();
      document.body.classList.remove('preto');
    }
  };

  // ---------- ligação palco <-> apresentador (postMessage funciona em file://) ----------
  let janelaApresentador = null;
  const enviarEstado = () => janelaApresentador && !janelaApresentador.closed && janelaApresentador.postMessage({ tipo: 'estado', estado }, '*');
  const abrirApresentador = () => {
    janelaApresentador = window.open('index.html?apresentador', 'apresentador', 'width=1400,height=900');
    setTimeout(enviarEstado, 400);
  };

  // ---------- modo palco ----------
  if (modo === 'palco') {
    document.body.classList.add('modo-palco');
    const palco = criarPalco(document.getElementById('ecra'));
    aoMudar = (suave) => {
      if (sobre.geral) alternar('geral');
      desenhar(palco, estado.i, estado.p, suave);
      enviarEstado();
    };
    window.addEventListener('message', (m) => {
      const d = m.data || {};
      if (d.tipo === 'ola') {
        janelaApresentador = m.source;
        enviarEstado();
      } else if (d.tipo === 'cmd' && acoes[d.acao]) acoes[d.acao](d.arg);
    });
    document.addEventListener('keydown', teclado((acao, arg) => acoes[acao](arg)));
    window.addEventListener('hashchange', () => {
      const m = /^#(\d+)\.(\d+)$/.exec(location.hash);
      if (m) ir(+m[1], +m[2]);
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.sobre') && e.button === 0) acoes.seguinte();
    });
    aoMudar(false);
    if (!sessionStorage.getItem('pitch-ajuda-vista')) {
      sessionStorage.setItem('pitch-ajuda-vista', '1');
      document.body.appendChild(el('div', 'dica-inicial', 'H para as teclas · P para a vista do apresentador'));
      setTimeout(() => document.querySelector('.dica-inicial')?.remove(), 4000);
    }
  }

  // ---------- modo apresentador ----------
  if (modo === 'apresentador') {
    document.body.classList.add('modo-apresentador');
    document.getElementById('ecra').remove();
    const raiz = el(
      'div',
      'apresentador',
      `<div class="col-esq"><div class="atual"></div><div class="relogios"><div class="total"></div><div class="slide-t"></div></div></div>
       <div class="col-dir"><div class="proximo-titulo">A seguir</div><div class="proximo"></div><div class="notas"></div><div class="perguntas"></div>
       <div class="atalhos">→ avança · ← recua · Shift+→ slide · A anexos · Q perguntas · T arranca o cronómetro · Shift+T zera</div></div>`,
    );
    document.body.appendChild(raiz);
    const pAtual = criarPalco(raiz.querySelector('.atual'));
    const pProx = criarPalco(raiz.querySelector('.proximo'));
    const notas = raiz.querySelector('.notas');
    const perg = raiz.querySelector('.perguntas');
    const ligado = !!window.opener;
    const enviar = (acao, arg) => (ligado ? window.opener.postMessage({ tipo: 'cmd', acao, arg }, '*') : acoes[acao](arg));
    let entradaSlide = Date.now();
    let ultimo = -1;

    perg.innerHTML =
      '<h3>Perguntas (Q esconde)</h3>' +
      window.PERGUNTAS.map(
        (q, k) =>
          `<div class="pergunta" data-k="${k}"><div class="p">${q.p}</div><div class="r"></div><div class="quem">${q.quem}${q.anexo ? ` · <button data-anexo="${q.anexo}">abrir anexo</button>` : ''}</div></div>`,
      ).join('');
    perg.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-anexo]');
      if (b) enviar('ir', S.findIndex((s) => s.id === b.dataset.anexo));
    });

    aoMudar = () => {
      if (estado.i !== ultimo) {
        entradaSlide = Date.now();
        ultimo = estado.i;
      }
      desenhar(pAtual, estado.i, estado.p, true);
      const [ni, np] = estado.p < S[estado.i].passos ? [estado.i, estado.p + 1] : [Math.min(estado.i + 1, S.length - 1), 0];
      desenhar(pProx, ni, np, false);
      const g = G[S[estado.i].id];
      notas.innerHTML = g
        ? `<div class="cab"><span class="parte">${g.parte}</span><span class="quem">${g.quem}</span><span class="seg">${g.segundos} s · previsto ${mmss(previstoAte(estado.i))}–${mmss(previstoAte(estado.i + 1))}</span></div>` +
          g.falas
            .map((f) => {
              const cls = f.passo === estado.p ? 'agora' : f.passo < estado.p ? 'dito' : '';
              const pal = f.palco ? `<div class="indicacao ${cls}">${trocar(f.palco)}</div>` : '';
              const tx = f.texto ? `<div class="fala ${cls}"><span class="clique">${f.passo}</span>${trocar(f.texto)}${f.espera ? ` <em>(+${f.espera} s)</em>` : ''}</div>` : '';
              return pal + tx;
            })
            .join('')
        : `<div class="cab"><span class="parte">${S[estado.i].anexo ? 'Anexo ' + S[estado.i].codigo : S[estado.i].titulo}</span></div><div class="indicacao">Só nas perguntas. Uma frase, um facto, parar. Shift+→ ou número + Enter para voltar.</div>`;
      perg.querySelectorAll('.pergunta').forEach((d) => (d.querySelector('.r').textContent = trocar(window.PERGUNTAS[+d.dataset.k].r)));
      const agora = notas.querySelector('.agora');
      if (agora) notas.scrollTo({ top: agora.offsetTop - notas.clientHeight / 3, behavior: 'smooth' });
      relogios();
    };
    const relogios = () => {
      const tot = raiz.querySelector('.total');
      const sl = raiz.querySelector('.slide-t');
      if (estado.inicio === null) {
        tot.innerHTML = `<b>0:00</b> <span>de ${mmss(C.alvoSegundos)} · arranca no primeiro clique (ou T)</span>`;
        tot.className = 'total';
      } else {
        const t = (Date.now() - estado.inicio) / 1000;
        const desvio = t - previstoAte(estado.i);
        tot.innerHTML = `<b>${mmss(t)}</b> <span>de ${mmss(C.alvoSegundos)} · ${desvio >= 0 ? '+' : '−'}${mmss(Math.abs(desvio))} face ao previsto</span>`;
        tot.className = 'total' + (t >= C.alvoSegundos ? ' passou' : t >= C.avisoSegundos ? ' aviso' : '');
      }
      sl.textContent = `neste slide: ${mmss((Date.now() - entradaSlide) / 1000)}`;
    };
    setInterval(relogios, 500);
    window.addEventListener('message', (m) => {
      if (m.data?.tipo === 'estado') {
        Object.assign(estado, m.data.estado);
        aoMudar();
      }
    });
    document.addEventListener('keydown', teclado(enviar));
    if (ligado) window.opener.postMessage({ tipo: 'ola' }, '*');
    aoMudar();
  }

  // ---------- modo guião (imprimir) ----------
  if (modo === 'guiao') {
    document.body.classList.add('modo-guiao');
    document.getElementById('ecra').remove();
    let html = `<h1>Guião do pitch · ${mmss(C.alvoSegundos)}</h1><p class="meta">Inglês: o que se diz. Itálico: indicações de palco. Números ao vivo: N=${trocar('{n}')}, T=${trocar('{t}')}, X=${trocar('{x}')}, testes=${trocar('{testes}')}.</p>`;
    principais.forEach((s, i) => {
      const g = G[s.id];
      if (!g) return;
      html += `<section><h2><span>${mmss(previstoAte(i))}–${mmss(previstoAte(i + 1))}</span> ${g.parte} <small>${g.quem} · slide ${i + 1}</small></h2>`;
      html += g.falas.map((f) => (f.palco ? `<p class="indicacao">[${f.passo}] ${trocar(f.palco)}</p>` : '') + (f.texto ? `<p class="fala">[${f.passo}] ${trocar(f.texto)}</p>` : '')).join('');
      html += '</section>';
    });
    html += '<h1>Perguntas</h1>' + window.PERGUNTAS.map((q) => `<p class="fala"><b>${q.p}</b> (${q.quem})<br>${trocar(q.r)}</p>`).join('');
    document.body.appendChild(el('main', 'guiao', html));
  }
})();
