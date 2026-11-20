// "Corrigir a causa": a defesa fecha a porta pela API, mas se o Terraform continuar a abri-la ao mundo,
// ela volta no próximo deploy. Esta função corrige o main.tf.json: nas portas sensíveis, tira 0.0.0.0/0 e ::/0
// e deixa entrar só a app, de preferência pelo grupo de segurança da app (sgApp) e, sem ele, pela subrede da app
// (redeApp), nunca pela VPC inteira. Função pura: não lê nem escreve ficheiros. O resto do texto fica igual,
// byte a byte, e uma 2.ª corrida não muda nada.
import { PORTAS_SENSIVEIS } from './tabelas';

export type Correcao = {
  recurso: string;
  porta: number;
  antes: string;
  /** A referência ao grupo da app, a subrede da app, ou "(retirada)" quando a origem saiu sem substituta. */
  depois: string;
  via: 'sgApp' | 'redeApp';
};

export type OpcoesCorrecao = {
  /** Grupo de segurança da app: nome do recurso ("app") ou a referência ("${aws_security_group.app.id}"). Preferido. */
  sgApp?: string;
  /** Subrede (CIDR IPv4, /24 ou mais estreita) da app, ex.: 10.0.1.0/24. Usada sem sgApp. */
  redeApp?: string;
  /** Subrede IPv6 da app (só com redeApp). Sem ela, as origens ::/0 são retiradas. */
  redeApp6?: string;
};

export type ResultadoCorrecao = {
  depois: string;
  corrigidas: Correcao[];
  /** Regras abertas que não se corrigiram sozinhas (origem por variável, ou sem forma segura de juntar o grupo). */
  porResolver: { recurso: string; porta: number; referencia: string }[];
};

const MUNDO = new Set(['0.0.0.0/0', '::/0']);
const SENSIVEIS = Object.keys(PORTAS_SENSIVEIS).map(Number);
const IPV4 = /^(\d{1,3}\.){3}\d{1,3}\/(\d{1,2})$/;
const IPV6 = /^[0-9a-f:]+\/(\d{1,3})$/i;

// --- Leitor de JSON com posições ------------------------------------------------------------------------------
type Obj = { tipo: 'obj'; inicio: number; fim: number; campos: Map<string, No>; chaves: Map<string, number> };
type Arr = { tipo: 'arr'; inicio: number; fim: number; itens: No[] };
type No = Obj | Arr | { tipo: 'str'; inicio: number; fim: number; valor: string } | { tipo: 'outro'; inicio: number; fim: number; valor: unknown };

function lerJson(texto: string): No {
  let i = 0;
  const espacos = () => {
    while (i < texto.length && ' \t\r\n'.includes(texto[i]!)) i++;
  };
  const valor = (): No => {
    espacos();
    const inicio = i;
    const c = texto[i];
    if (c === '{') {
      i++;
      const obj: Obj = { tipo: 'obj', inicio, fim: 0, campos: new Map(), chaves: new Map() };
      espacos();
      if (texto[i] === '}') return { ...obj, fim: ++i };
      for (;;) {
        const chave = valor();
        if (chave.tipo !== 'str') throw new Error('JSON inválido: chave sem aspas');
        espacos();
        i++; // ':'
        obj.chaves.set(chave.valor, chave.inicio);
        obj.campos.set(chave.valor, valor());
        espacos();
        if (texto[i++] === '}') return { ...obj, fim: i };
      }
    }
    if (c === '[') {
      i++;
      const itens: No[] = [];
      espacos();
      if (texto[i] === ']') return { tipo: 'arr', inicio, fim: ++i, itens };
      for (;;) {
        itens.push(valor());
        espacos();
        if (texto[i++] === ']') return { tipo: 'arr', inicio, fim: i, itens };
      }
    }
    if (c === '"') {
      i++;
      while (texto[i] !== '"') i += texto[i] === '\\' ? 2 : 1;
      i++;
      return { tipo: 'str', inicio, fim: i, valor: JSON.parse(texto.slice(inicio, i)) as string };
    }
    const m = /^(-?\d+(\.\d+)?([eE][+-]?\d+)?|true|false|null)/.exec(texto.slice(i));
    if (!m) throw new Error(`JSON inválido na posição ${i}`);
    i += m[0].length;
    return { tipo: 'outro', inicio, fim: i, valor: JSON.parse(m[0]) };
  };
  return valor();
}

function blocos(no: No | undefined): Obj[] {
  if (!no) return [];
  if (no.tipo === 'obj') return [no];
  if (no.tipo === 'arr') return no.itens.filter((x): x is Obj => x.tipo === 'obj');
  return [];
}

function simples(no: No | undefined): unknown {
  return no && (no.tipo === 'str' || no.tipo === 'outro') ? no.valor : undefined;
}

/** Portas sensíveis que a regra abre (vazio se não abre nenhuma, ou se é ICMP). */
function portasSensiveisDaRegra(regra: Obj): number[] {
  const proto = String(simples(regra.campos.get('protocol')) ?? 'tcp').toLowerCase();
  if (proto === 'icmp' || proto === '1' || proto === 'icmpv6' || proto === '58') return [];
  if (proto === '-1' || proto === 'all') return SENSIVEIS;
  const de = Number(simples(regra.campos.get('from_port')) ?? 0);
  const ate = Number(simples(regra.campos.get('to_port')) ?? de);
  return SENSIVEIS.filter((p) => p >= de && p <= ate);
}

type Edicao = { inicio: number; fim: number; texto: string };

/** Separador entre membros deste objeto (ex.: ",\n          "), para inserir um campo com a mesma formatação. */
function separadorDeMembros(texto: string, obj: Obj): string {
  const posicoes = [...obj.chaves.values()].sort((a, b) => a - b);
  for (let k = 1; k < posicoes.length; k++) {
    const antes = texto.slice(0, posicoes[k]);
    const virgula = antes.lastIndexOf(',');
    if (virgula >= 0) return texto.slice(virgula, posicoes[k]);
  }
  return ', ';
}

/** Intervalos de texto a apagar para tirar os itens `retirar` de uma lista, sem tocar no resto da formatação. */
function retiradas(lista: Arr, retirar: number[]): Edicao[] {
  if (retirar.length === 0) return [];
  const itens = lista.itens;
  if (retirar.length === itens.length) return [{ inicio: lista.inicio + 1, fim: lista.fim - 1, texto: '' }];
  const fora = new Set(retirar);
  let primeiroQueFica = 0;
  while (fora.has(primeiroQueFica)) primeiroQueFica++;
  const cortes: Edicao[] = [];
  if (primeiroQueFica > 0) cortes.push({ inicio: itens[0]!.inicio, fim: itens[primeiroQueFica]!.inicio, texto: '' });
  for (const k of retirar) if (k > primeiroQueFica) cortes.push({ inicio: itens[k - 1]!.fim, fim: itens[k]!.fim, texto: '' });
  return cortes;
}

function validar(opcoes: OpcoesCorrecao): { refSg?: string; redeApp?: string; redeApp6?: string } {
  const sg = opcoes.sgApp?.trim();
  let refSg: string | undefined;
  if (sg) {
    if (/^[A-Za-z0-9_-]+$/.test(sg)) refSg = `\${aws_security_group.${sg}.id}`;
    else if (/^\$\{aws_security_group\.[A-Za-z0-9_-]+\.id\}$/.test(sg)) refSg = sg;
    else throw new Error('corrigirRegrasAbertas: sgApp tem de ser o nome do grupo da app ou ${aws_security_group.<nome>.id}.');
  }
  const redeApp = opcoes.redeApp?.trim() || undefined;
  if (redeApp !== undefined) {
    const m = IPV4.exec(redeApp);
    if (!m || Number(m[2]) < 24 || Number(m[2]) > 32)
      throw new Error('corrigirRegrasAbertas: redeApp tem de ser a subrede da app (CIDR IPv4 /24 ou mais estreito), nunca a VPC inteira.');
  }
  const redeApp6 = opcoes.redeApp6?.trim() || undefined;
  if (redeApp6 !== undefined) {
    const m = IPV6.exec(redeApp6);
    if (!m || Number(m[1]) < 48) throw new Error('corrigirRegrasAbertas: redeApp6 tem de ser a subrede IPv6 da app (/48 ou mais estreita).');
  }
  if (!refSg && !redeApp) throw new Error('corrigirRegrasAbertas: indica o grupo da app (sgApp) ou a subrede da app (redeApp).');
  return { refSg, redeApp, redeApp6 };
}

// --- A correção -------------------------------------------------------------------------------------------------
export function corrigirRegrasAbertas(textoTf: string, opcoes: OpcoesCorrecao): ResultadoCorrecao {
  const validado = validar(opcoes);
  let refSg = validado.refSg;
  const { redeApp, redeApp6 } = validado;
  JSON.parse(textoTf); // falha cedo se o ficheiro não for JSON válido
  const raiz = lerJson(textoTf);
  const recursos = raiz.tipo === 'obj' ? raiz.campos.get('resource') : undefined;
  const porTipo = (tipo: string) => (recursos?.tipo === 'obj' ? recursos.campos.get(tipo) : undefined);

  // O grupo da app tem de existir neste ficheiro; senão a referência ficava partida e usa-se a subrede.
  const nomesGrupos = new Set(blocos(porTipo('aws_security_group')).flatMap((g) => [...g.campos.keys()]));
  const nomeSg = refSg ? /^\$\{aws_security_group\.([A-Za-z0-9_-]+)\.id\}$/.exec(refSg)![1]! : undefined;
  if (nomeSg && !nomesGrupos.has(nomeSg)) {
    if (!redeApp) throw new Error(`corrigirRegrasAbertas: o grupo aws_security_group.${nomeSg} não está no ficheiro e não há redeApp.`);
    refSg = undefined;
  }

  const edicoes: Edicao[] = [];
  const corrigidas: Correcao[] = [];
  const porResolver: ResultadoCorrecao['porResolver'] = [];

  /** Origens ao mundo de uma regra, por campo; as referências a variáveis vão para porResolver. */
  const abertas = (recurso: string, porta: number, regra: Obj) => {
    const r: { campo: 'cidr_blocks' | 'ipv6_cidr_blocks'; lista: Arr; indices: number[] }[] = [];
    for (const campo of ['cidr_blocks', 'ipv6_cidr_blocks'] as const) {
      const lista = regra.campos.get(campo);
      if (lista?.tipo === 'str') porResolver.push({ recurso, porta, referencia: lista.valor });
      if (lista?.tipo !== 'arr') continue;
      const indices: number[] = [];
      lista.itens.forEach((item, k) => {
        if (item.tipo !== 'str') return;
        if (item.valor.includes('${')) porResolver.push({ recurso, porta, referencia: item.valor });
        else if (MUNDO.has(item.valor)) indices.push(k);
      });
      if (indices.length > 0) r.push({ campo, lista, indices });
    }
    return r;
  };

  /** Sem grupo: troca pela subrede da app (IPv6: pela subrede IPv6 ou retira). */
  const porRede = (recurso: string, porta: number, alvo: ReturnType<typeof abertas>) => {
    for (const { campo, lista, indices } of alvo) {
      const nova = campo === 'ipv6_cidr_blocks' ? redeApp6 : redeApp;
      const retirar: number[] = [];
      for (const k of indices) {
        const item = lista.itens[k] as Extract<No, { tipo: 'str' }>;
        if (nova) edicoes.push({ inicio: item.inicio, fim: item.fim, texto: JSON.stringify(nova) });
        else retirar.push(k);
        corrigidas.push({ recurso, porta, antes: item.valor, depois: nova ?? '(retirada)', via: 'redeApp' });
      }
      edicoes.push(...retiradas(lista, retirar));
    }
  };

  /** Retira as origens ao mundo e regista a correção pelo grupo da app. */
  const retirarMundo = (recurso: string, porta: number, alvo: ReturnType<typeof abertas>) => {
    for (const { lista, indices } of alvo) {
      edicoes.push(...retiradas(lista, indices));
      for (const k of indices)
        corrigidas.push({ recurso, porta, antes: (lista.itens[k] as Extract<No, { tipo: 'str' }>).valor, depois: refSg!, via: 'sgApp' });
    }
  };

  // Regras dentro de aws_security_group: ingress { cidr_blocks, security_groups }.
  const tratarIngress = (recurso: string, regra: Obj) => {
    const sensiveis = portasSensiveisDaRegra(regra);
    if (sensiveis.length === 0) return;
    const porta = sensiveis[0]!;
    const alvo = abertas(recurso, porta, regra);
    if (alvo.length === 0) return;
    const grupos = regra.campos.get('security_groups');
    if (refSg && (grupos === undefined || grupos.tipo === 'arr')) {
      retirarMundo(recurso, porta, alvo);
      if (grupos === undefined) {
        const cidr = regra.campos.get('cidr_blocks') ?? regra.campos.get('ipv6_cidr_blocks')!;
        const sep = separadorDeMembros(textoTf, regra);
        edicoes.push({ inicio: cidr.fim, fim: cidr.fim, texto: `${sep}"security_groups": [${JSON.stringify(refSg)}]` });
      } else if (!(grupos as Arr).itens.some((g) => g.tipo === 'str' && g.valor === refSg)) {
        const g = grupos as Arr;
        const ultimo = g.itens.at(-1);
        edicoes.push(
          ultimo
            ? { inicio: ultimo.fim, fim: ultimo.fim, texto: `, ${JSON.stringify(refSg)}` }
            : { inicio: g.inicio + 1, fim: g.inicio + 1, texto: JSON.stringify(refSg) },
        );
      }
    } else if (redeApp) porRede(recurso, porta, alvo);
    else porResolver.push({ recurso, porta, referencia: 'security_groups não é uma lista: junta o grupo da app à mão' });
  };

  // aws_security_group_rule: o Terraform não deixa juntar cidr_blocks e source_security_group_id na mesma regra.
  const tratarRegraSolta = (recurso: string, regra: Obj) => {
    const sensiveis = portasSensiveisDaRegra(regra);
    if (sensiveis.length === 0) return;
    const porta = sensiveis[0]!;
    const alvo = abertas(recurso, porta, regra);
    if (alvo.length === 0) return;
    const soMundo = alvo.every(({ lista, indices }) => indices.length === lista.itens.length);
    const outrosCampos = ['cidr_blocks', 'ipv6_cidr_blocks'].filter(
      (c) => regra.campos.has(c) && !alvo.some((a) => a.campo === c),
    );
    if (refSg && soMundo && outrosCampos.length === 0 && !regra.campos.has('source_security_group_id')) {
      // Troca o primeiro campo (chave e valor) por source_security_group_id e apaga os outros.
      const [primeiro, ...resto] = alvo;
      edicoes.push({
        inicio: regra.chaves.get(primeiro!.campo)!,
        fim: primeiro!.lista.fim,
        texto: `"source_security_group_id": ${JSON.stringify(refSg)}`,
      });
      for (const r of resto) {
        const inicioChave = regra.chaves.get(r.campo)!;
        const antes = textoTf.lastIndexOf(',', inicioChave);
        edicoes.push({ inicio: antes, fim: r.lista.fim, texto: '' });
      }
      for (const { lista, indices } of alvo)
        for (const k of indices)
          corrigidas.push({ recurso, porta, antes: (lista.itens[k] as Extract<No, { tipo: 'str' }>).valor, depois: refSg, via: 'sgApp' });
    } else if (redeApp) porRede(recurso, porta, alvo);
    else porResolver.push({ recurso, porta, referencia: 'regra com outras origens: o grupo da app não se junta sozinho' });
  };

  for (const grupo of blocos(porTipo('aws_security_group')))
    for (const [nome, corpo] of grupo.campos)
      for (const sg of blocos(corpo)) for (const regra of blocos(sg.campos.get('ingress'))) tratarIngress(`aws_security_group.${nome}`, regra);
  for (const grupo of blocos(porTipo('aws_security_group_rule')))
    for (const [nome, corpo] of grupo.campos)
      for (const regra of blocos(corpo))
        if (simples(regra.campos.get('type')) === 'ingress') tratarRegraSolta(`aws_security_group_rule.${nome}`, regra);

  let depois = textoTf;
  for (const e of edicoes.sort((a, b) => b.inicio - a.inicio || b.fim - a.fim)) depois = depois.slice(0, e.inicio) + e.texto + depois.slice(e.fim);
  JSON.parse(depois); // nunca devolve um ficheiro estragado
  return { depois, corrigidas, porResolver };
}
