// Tradutor determinístico: Terraform da AWS (sintaxe JSON) -> plano Leaseweb. Só plano (dry-run): não chama nenhuma API.
// Porta de segurança: 0.0.0.0/0 em portas sensíveis não se copia; segredos são sinalizados por nome e linha, nunca pelo valor.
import type {
  ItemCriar,
  ItemRecusar,
  ItemSinalizar,
  OpcoesTraducao,
  PlanoTraducao,
  TerraformJson,
} from './tipos';
import {
  IMAGENS,
  LOCK_IN,
  NOTA_IMAGEM,
  NOTA_REGIAO,
  NOMES_REGIAO,
  NOTA_TIPO,
  PORTAS_ADMIN,
  PORTAS_SENSIVEIS,
  REDE,
  REGIAO_DESTINO,
  REGIOES_UE,
  SUBSTITUICOES,
  TIPOS,
} from './tabelas';
import {
  eLiteral,
  limparUserData,
  linhasSshComSenha,
  nomeSensivel,
  procurarSegredos,
  segredosNasTags,
} from './segredos';

/** Valor posto no pedido quando o tradutor não sabe decidir sozinho. */
export const POR_ESCOLHER = 'POR_ESCOLHER';

type Bloco = Record<string, unknown>;
type RegraLsw = { protocol: string; startPort?: number; endPort?: number; source: string };

const MUNDO = new Set(['0.0.0.0/0', '::/0']);

/** Terraform JSON aceita um bloco como objeto ou como lista de objetos. */
function blocos(v: unknown): Bloco[] {
  if (Array.isArray(v)) return v.filter((x): x is Bloco => typeof x === 'object' && x !== null);
  return typeof v === 'object' && v !== null ? [v as Bloco] : [];
}

function lista(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function texto(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function numero(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

/** Linha (1..n) de uma chave no ficheiro, seguindo o caminho de chaves. Só funciona se recebermos o texto. */
function linhaNoFicheiro(fonte: string | undefined, caminho: string[]): number | undefined {
  if (!fonte) return undefined;
  const linhas = fonte.split(/\r?\n/);
  let i = 0;
  for (const chave of caminho) {
    const alvo = JSON.stringify(chave);
    while (i < linhas.length && !linhas[i]!.includes(alvo)) i++;
    if (i >= linhas.length) return undefined;
  }
  return i + 1;
}

/** ADMIN_IP aceite: IPv4/IPv6, com ou sem prefixo, e estreito (pelo menos /24 em IPv4, /48 em IPv6). */
export function normalizarAdminIp(bruto: string | undefined): { cidr?: string; problema?: string } {
  const v = (bruto ?? '').trim();
  if (!v) return {};
  const [ip, prefixoTexto] = v.split('/');
  const v6 = ip!.includes(':');
  const ipValido = v6
    ? /^[0-9a-f:]+$/i.test(ip!)
    : /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(ip!) && ip!.split('.').every((p) => Number(p) <= 255);
  const prefixo = prefixoTexto === undefined ? (v6 ? 128 : 32) : Number(prefixoTexto);
  if (!ipValido || !Number.isInteger(prefixo)) return { problema: 'ADMIN_IP não é um IP válido.' };
  if (prefixo < (v6 ? 48 : 24) || MUNDO.has(`${ip}/${prefixo}`))
    return { problema: 'ADMIN_IP é uma rede demasiado larga; tem de ser o teu IP (ou no máximo um /24).' };
  return { cidr: `${ip}/${prefixo}` };
}

/** CIDR literal IPv4 ou IPv6 (o que a regra da Leaseweb aceita em `source`). */
function eCidr(v: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.test(v) || /^[0-9a-f:]+\/\d{1,3}$/i.test(v);
}

function regiaoDaZona(zona: string): string {
  return zona.replace(/[a-z]$/, '');
}

const REF_RECURSO = /^\$\{(aws_[a-z0-9_]+)\.([A-Za-z0-9_-]+)\.id\}$/;
const REF_AMI = /^\$\{data\.aws_ami\.([A-Za-z0-9_-]+)\.id\}$/;
const REF_VAR = /^\$\{var\.([A-Za-z0-9_-]+)\}$/;

const PRIVADA = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

export function traduzir(tf: string | TerraformJson, opcoes: OpcoesTraducao = {}): PlanoTraducao {
  const fonte = typeof tf === 'string' ? tf : undefined;
  const raiz: TerraformJson = typeof tf === 'string' ? (JSON.parse(tf) as TerraformJson) : tf;
  const recursos = raiz.resource ?? {};

  const plano: PlanoTraducao = { regiaoDestino: REGIAO_DESTINO, criar: [], substituir: [], sinalizar: [], recusar: [] };
  /** Valores secretos encontrados: só para a verificação final de fugas. Nunca saem daqui. */
  const valoresSecretos: string[] = [];

  const resolver = (v: unknown): unknown => {
    const m = typeof v === 'string' ? REF_VAR.exec(v) : null;
    return m ? raiz.variable?.[m[1]!]?.default : v;
  };
  const sinalizar = (item: ItemSinalizar) => {
    if (!plano.sinalizar.some((s) => s.origem === item.origem && s.titulo === item.titulo)) plano.sinalizar.push(item);
  };

  const admin = normalizarAdminIp(opcoes.adminIp ?? process.env.ADMIN_IP);
  if (admin.problema)
    sinalizar({
      origem: '.env',
      assunto: 'admin-ip',
      titulo: 'ADMIN_IP inválido',
      porque: admin.problema,
      oQueFazer: 'Põe no .env o IP de onde administras (ex.: o teu IP público /32).',
    });

  // Região de origem: a do provider, ou a da primeira zona de uma instância.
  const provider = blocos((raiz.provider as Bloco | undefined)?.aws).find((p) => !p.alias);
  const regiaoProvider = texto(resolver(provider?.region));
  const verRegiao = (regiao: string | undefined, origem: string) => {
    if (!regiao || !eLiteral(regiao)) return;
    plano.regiaoOrigem ??= regiao;
    if (!REGIOES_UE.has(regiao))
      sinalizar({
        origem,
        assunto: 'regiao',
        titulo: `região ${regiao} fora da UE`,
        porque: `Os dados estão em ${regiao}, fora da União Europeia. Mudar para a Leaseweb em Amesterdão é uma decisão de soberania.`,
        oQueFazer: 'Confirma com quem decide (dados pessoais, contratos) antes de migrar.',
      });
  };
  verRegiao(regiaoProvider, 'provider.aws');

  // Segredos em atributos de topo (ex.: password de uma base de dados) e nas tags, em qualquer recurso.
  const verSegredosDoRecurso = (tipo: string, nome: string, corpo: Bloco) => {
    const origem = `${tipo}.${nome}`;
    for (const [atributo, valor] of Object.entries(corpo)) {
      if (atributo === 'user_data' || atributo === 'tags' || typeof valor !== 'string') continue;
      if (!nomeSensivel(atributo) || !eLiteral(valor)) continue;
      valoresSecretos.push(valor);
      plano.recusar.push({
        tipo: 'segredo',
        origem,
        onde: 'atributo',
        nome: atributo,
        linha: linhaNoFicheiro(fonte, ['resource', tipo, nome, atributo]),
        porque: 'Segredo escrito no Terraform. Não se copia; cria-se um novo no destino, guardado fora do código.',
      });
    }
    const tags = corpo.tags;
    if (typeof tags === 'object' && tags !== null) {
      for (const s of segredosNasTags(tags as Bloco)) {
        valoresSecretos.push(s.valor);
        plano.recusar.push({
          tipo: 'segredo',
          origem,
          onde: 'tags',
          nome: s.nome,
          linha: linhaNoFicheiro(fonte, ['resource', tipo, nome, 'tags', s.nome]),
          porque: 'Segredo numa tag. As tags não passam para a Leaseweb e este valor não se copia.',
        });
      }
    }
  };

  // --- 1. Grupos de segurança -------------------------------------------------------------------------------
  const regrasPorGrupo = new Map<string, { regras: RegraLsw[]; notas: Set<string> }>();
  const grupoId = (nome: string) => `{securityGroupId:aws_security_group.${nome}}`;

  const traduzirEntrada = (grupo: string, origem: string, regra: Bloco) => {
    const alvo = regrasPorGrupo.get(grupo);
    if (!alvo) return;
    const proto = String(regra.protocol ?? 'tcp').toLowerCase();
    const de = numero(regra.from_port) ?? 0;
    const ate = numero(regra.to_port) ?? de;
    // Cada origem resolve-se (${var.x}) e tem de ser um CIDR literal; o que não for, sinaliza-se e não vira regra.
    const fontes: string[] = [];
    const porResolver: string[] = [];
    for (const atributo of [regra.cidr_blocks, regra.ipv6_cidr_blocks]) {
      if (atributo === undefined) continue;
      const valor = resolver(atributo);
      if (!Array.isArray(valor)) {
        porResolver.push(String(atributo));
        continue;
      }
      for (const elemento of valor) {
        const cidr = resolver(elemento);
        if (typeof cidr === 'string' && eCidr(cidr)) fontes.push(cidr);
        else porResolver.push(String(elemento));
      }
    }
    for (const ref of porResolver)
      sinalizar({
        origem,
        assunto: 'desconhecido',
        titulo: `origem ${ref} por resolver`,
        porque: `A origem "${ref}" não é um endereço (CIDR) que eu consiga ler, por isso não criei a regra.`,
        oQueFazer: 'Escreve a origem como CIDR no Terraform (ou dá um valor por omissão à variável) e volta a traduzir.',
      });

    if (regra.security_groups || regra.source_security_group_id || regra.self === true)
      sinalizar({
        origem,
        assunto: 'rede',
        titulo: 'regra que aponta para outro grupo',
        porque: 'Na AWS esta regra aceita tráfego de outro grupo de segurança. Na Leaseweb as regras só aceitam endereços (CIDR).',
        oQueFazer: 'Troca pela rede privada ou pelo IP das máquinas que precisam de falar entre si.',
      });

    // Protocolos: "-1"/"all" = tudo -> TCP e UDP em todas as portas.
    const protocolos: { protocol: string; inicio: number; fim: number }[] =
      proto === '-1' || proto === 'all'
        ? [
            { protocol: 'TCP', inicio: 1, fim: 65535 },
            { protocol: 'UDP', inicio: 1, fim: 65535 },
          ]
        : proto === 'tcp' || proto === '6'
          ? [{ protocol: 'TCP', inicio: de, fim: ate }]
          : proto === 'udp' || proto === '17'
            ? [{ protocol: 'UDP', inicio: de, fim: ate }]
            : proto === 'icmp' || proto === '1'
              ? [{ protocol: 'ICMP', inicio: -1, fim: -1 }]
              : [];
    if (protocolos.length === 0) {
      sinalizar({
        origem,
        assunto: 'desconhecido',
        titulo: `protocolo ${proto}`,
        porque: `Não sei traduzir o protocolo "${proto}".`,
        oQueFazer: 'Revê esta regra à mão.',
      });
      return;
    }

    for (const source of fontes) {
      if (PRIVADA.test(source))
        sinalizar({
          origem,
          assunto: 'rede',
          titulo: `rede privada ${source}`,
          porque: `A origem ${source} é uma rede privada da VPC da AWS, que não existe na Leaseweb.`,
          oQueFazer: 'Troca pela rede privada do destino ou pelo IP das máquinas certas.',
        });
      for (const p of protocolos) {
        if (p.protocol === 'ICMP') {
          alvo.regras.push({ protocol: 'ICMP', source });
          alvo.notas.add('ICMP: confirmar icmpType/icmpCode na referência.');
          continue;
        }
        const sensiveis = Object.keys(PORTAS_SENSIVEIS)
          .map(Number)
          .filter((porta) => porta >= p.inicio && porta <= p.fim);
        if (!MUNDO.has(source) || sensiveis.length === 0) {
          alvo.regras.push({ protocol: p.protocol, startPort: p.inicio, endPort: p.fim, source });
          continue;
        }
        const soAdmin = p.inicio === p.fim && PORTAS_ADMIN.has(p.inicio);
        const destino = !soAdmin ? 'nao-existe' : admin.cidr ? 'so-admin' : 'admin-ip-em-falta';
        const nomes = sensiveis.map((porta) => `${PORTAS_SENSIVEIS[porta]} (${porta})`).join(', ');
        const recusa: ItemRecusar = {
          tipo: 'porta-aberta',
          origem,
          protocolo: p.protocol,
          inicio: p.inicio,
          fim: p.fim,
          fonte: source,
          portasSensiveis: sensiveis,
          destino,
          porque:
            destino === 'so-admin'
              ? `${nomes} estava aberto a toda a Internet. No destino só aceita o ADMIN_IP.`
              : destino === 'admin-ip-em-falta'
                ? `${nomes} estava aberto a toda a Internet. Fica fechado até pores o ADMIN_IP no .env.`
                : `${nomes} estava aberto a toda a Internet. No destino não fica exposto; para administrar usa um túnel SSH.${
                    p.inicio !== p.fim
                      ? ` A regra abria o intervalo ${p.inicio}-${p.fim} inteiro, por isso as outras portas${
                          p.inicio <= 443 && p.fim >= 80 ? ' (também as web, 80 e 443)' : ''
                        } ficam de fora; recria à parte só as de que precisas.`
                      : ''
                  }`,
        };
        plano.recusar.push(recusa);
        if (destino === 'so-admin') {
          alvo.regras.push({ protocol: p.protocol, startPort: p.inicio, endPort: p.fim, source: admin.cidr! });
          alvo.notas.add(`Porta ${p.inicio}: só o ADMIN_IP do .env, em vez de ${source}.`);
        }
      }
    }
  };

  for (const [nome, corpoBruto] of Object.entries(recursos.aws_security_group ?? {})) {
    const corpo = blocos(corpoBruto)[0] ?? {};
    const origem = `aws_security_group.${nome}`;
    const nomeGrupo = texto(resolver(corpo.name)) ?? nome;
    regrasPorGrupo.set(nome, { regras: [], notas: new Set() });
    plano.criar.push({
      origem,
      acao: 'criar-grupo',
      descricao: `grupo de segurança ${nomeGrupo}`,
      pedido: { metodo: 'POST', caminho: '/securityGroups', corpo: { name: nomeGrupo } },
      notas: ['Um grupo Leaseweb por grupo AWS.'],
    });
    for (const regra of blocos(corpo.ingress)) traduzirEntrada(nome, origem, regra);
    if (blocos(corpo.egress).length > 0) sinalizarSaida(origem);
    verSegredosDoRecurso('aws_security_group', nome, corpo);
  }
  for (const [nome, corpoBruto] of Object.entries(recursos.aws_security_group_rule ?? {})) {
    const corpo = blocos(corpoBruto)[0] ?? {};
    const origem = `aws_security_group_rule.${nome}`;
    const ref = REF_RECURSO.exec(String(corpo.security_group_id ?? ''));
    if (!ref || ref[1] !== 'aws_security_group' || !regrasPorGrupo.has(ref[2]!)) {
      sinalizar({
        origem,
        assunto: 'desconhecido',
        titulo: 'regra de um grupo que não está neste ficheiro',
        porque: 'Esta regra pertence a um grupo de segurança que não encontrei aqui.',
        oQueFazer: 'Junta o grupo ao Terraform ou revê a regra à mão.',
      });
      continue;
    }
    if (corpo.type === 'egress') sinalizarSaida(origem);
    else traduzirEntrada(ref[2]!, origem, corpo);
  }
  for (const [nome, { regras, notas }] of regrasPorGrupo) {
    if (regras.length === 0) continue;
    const unicas = [...new Map(regras.map((r) => [JSON.stringify(r), r])).values()];
    plano.criar.push({
      origem: `aws_security_group.${nome}`,
      acao: 'autorizar-regras',
      descricao: `${unicas.length} regra(s) de entrada no grupo ${nome}`,
      pedido: {
        metodo: 'POST',
        caminho: `/securityGroups/${grupoId(nome)}/authorizeFirewallRules`,
        corpo: { rules: unicas },
      },
      notas: ['Uma regra Leaseweb por CIDR. Só entrada: a Leaseweb não tem direção nas regras.', ...notas],
    });
  }

  function sinalizarSaida(origem: string) {
    sinalizar({
      origem,
      assunto: 'egress',
      titulo: 'regras de saída',
      porque: 'As regras da Leaseweb são só de entrada: a saída não é filtrada pelo grupo de segurança.',
      oQueFazer: 'Se precisares de limitar a saída, faz isso na própria VM (nftables).',
    });
  }

  // --- 2. Instâncias ----------------------------------------------------------------------------------------
  const ligacoes: ItemCriar[] = [];
  for (const [nome, corpoBruto] of Object.entries(recursos.aws_instance ?? {})) {
    const corpo = blocos(corpoBruto)[0] ?? {};
    const origem = `aws_instance.${nome}`;
    const notas: string[] = [];

    // Tipo
    const tipoAws = texto(resolver(corpo.instance_type)) ?? '';
    const tipo = TIPOS[tipoAws];
    let tipoLsw: string;
    if (tipo) {
      tipoLsw = tipo.lsw;
      notas.push(`${tipoAws} -> ${tipo.lsw} (${tipo.vcpu} vCPU, ${tipo.ramGb} GB). ${NOTA_TIPO}`);
    } else {
      tipoLsw = tipoAws && eLiteral(tipoAws) ? `lsw.${tipoAws}` : POR_ESCOLHER;
      sinalizar({
        origem,
        assunto: 'tipo',
        titulo: `tipo ${tipoAws || 'desconhecido'}`,
        porque: `O tipo ${tipoAws || '(vazio)'} não está na tabela do tradutor; ${tipoLsw} pode não existir.`,
        oQueFazer: 'Escolhe o mais próximo em vCPU e RAM com GET /instanceTypes?region=eu-west-3.',
      });
    }

    // Imagem
    let imageId = POR_ESCOLHER;
    let so: string | undefined;
    const ami = texto(corpo.ami) ?? '';
    const refAmi = REF_AMI.exec(ami);
    const dadosAmi = refAmi ? blocos(raiz.data?.aws_ami?.[refAmi[1]!])[0] : undefined;
    const propria = dadosAmi && Array.isArray(dadosAmi.owners) && dadosAmi.owners.includes('self');
    if (dadosAmi && !propria) {
      const nomesAmi = [
        texto(dadosAmi.name_regex) ?? '',
        ...blocos(dadosAmi.filter)
          .filter((f) => f.name === 'name')
          .flatMap((f) => (Array.isArray(f.values) ? f.values.map(String) : [])),
      ].join(' ');
      const imagem = IMAGENS.find((i) => i.padrao.test(nomesAmi));
      if (imagem) {
        imageId = imagem.imageId;
        so = imagem.so;
        notas.push(`${imagem.so} -> ${imagem.imageId}. ${NOTA_IMAGEM}`);
      }
    }
    if (imageId === POR_ESCOLHER)
      sinalizar({
        origem,
        assunto: 'ami-custom',
        titulo: `imagem ${nome}`,
        porque: refAmi
          ? 'A imagem é própria ou de um SO que não está na tabela; uma AMI não passa para a Leaseweb.'
          : 'A imagem é uma AMI pelo id: não sei o SO e uma AMI própria não passa para a Leaseweb.',
        oQueFazer: 'Reconstrói a partir de uma imagem base (GET /images) mais cloud-init.',
      });

    // Região
    const zona = texto(resolver(corpo.availability_zone));
    const regiao = zona && eLiteral(zona) ? regiaoDaZona(zona) : regiaoProvider;
    verRegiao(regiao, origem);
    notas.push(NOTA_REGIAO);

    // Disco
    const disco = numero(blocos(corpo.root_block_device)[0]?.volume_size);
    if (disco === undefined) notas.push('Disco: a AWS não o indicava; 50 GB como no exemplo da referência.');
    notas.push('contractType HOURLY: confirmar o valor aceite pela API.');

    // user_data: procura segredos e copia sem eles
    let userData = texto(corpo.user_data);
    const base64 = texto(corpo.user_data_base64);
    if (userData === undefined && base64 && eLiteral(base64)) userData = Buffer.from(base64, 'base64').toString('utf8');
    let cloudInit: string | undefined;
    if (userData !== undefined && eLiteral(userData)) {
      const { segredos, linhasARemover } = procurarSegredos(userData);
      for (const s of segredos) {
        valoresSecretos.push(s.valor);
        plano.recusar.push({
          tipo: 'segredo',
          origem,
          onde: 'user_data',
          nome: s.nome,
          linha: s.linha,
          porque: 'Segredo no script de arranque. A linha não se copia; cria-se uma credencial nova no destino.',
        });
      }
      cloudInit = limparUserData(userData, segredos, linhasARemover);
      notas.push('cloud-init: confirmar na referência o nome do campo (userData) e se vai em base64.');
      const senhaSsh = linhasSshComSenha(userData);
      if (senhaSsh.length > 0)
        sinalizar({
          origem,
          assunto: 'ssh',
          titulo: 'SSH por senha',
          porque: `O script de arranque liga o login SSH por senha (linha ${senhaSsh.join(', ')}).`,
          oQueFazer: 'No destino o SSH fica só com chave: muda para PasswordAuthentication no.',
        });
    } else if (userData !== undefined || base64 !== undefined) {
      sinalizar({
        origem,
        assunto: 'desconhecido',
        titulo: 'user_data vindo de fora',
        porque: 'O script de arranque vem de uma variável ou ficheiro que não li, por isso não o verifiquei.',
        oQueFazer: 'Passa o script ao tradutor para ser verificado antes de o copiar.',
      });
    }

    const keyName = texto(corpo.key_name);
    if (keyName)
      sinalizar({
        origem,
        assunto: 'ssh',
        titulo: `chave SSH ${keyName}`,
        porque: `A instância usa o par de chaves "${keyName}" da AWS, que não passa para a Leaseweb.`,
        oQueFazer: 'Põe a chave pública no cloud-init do destino.',
      });

    verSegredosDoRecurso('aws_instance', nome, corpo);

    plano.criar.push({
      origem,
      acao: 'criar-instancia',
      descricao: `servidor ${tipoAws || '?'}${regiao ? ` (${NOMES_REGIAO[regiao] ?? regiao})` : ''} → ${tipoLsw} em Amesterdão${so ? `, ${so}` : ''}`,
      pedido: {
        metodo: 'POST',
        caminho: '/instances',
        corpo: {
          region: REGIAO_DESTINO,
          type: tipoLsw,
          imageId,
          contractType: 'HOURLY',
          rootDiskSize: disco ?? 50,
          rootDiskStorageType: 'CENTRAL',
          reference: nome,
        },
      },
      notas,
      ...(cloudInit !== undefined ? { cloudInit } : {}),
    });

    const grupos = [...lista(corpo.vpc_security_group_ids), ...lista(corpo.security_groups)]
      .map((g) => REF_RECURSO.exec(String(g)))
      .filter((m): m is RegExpExecArray => m !== null && m[1] === 'aws_security_group' && regrasPorGrupo.has(m[2]!))
      .map((m) => grupoId(m[2]!));
    if (grupos.length > 0)
      ligacoes.push({
        origem,
        acao: 'ligar-grupos',
        descricao: `ligar o servidor ${nome} aos grupos de segurança`,
        pedido: {
          metodo: 'POST',
          caminho: `/instances/{instanceId:aws_instance.${nome}}/attachSecurityGroups`,
          corpo: { securityGroupIds: grupos },
        },
        notas: ['Ligar antes de pôr a app no ar; numa instância já a correr pode ser preciso parar e arrancar.'],
      });
  }
  plano.criar.push(...ligacoes);

  // --- 3. O resto: substituir, sinalizar ----------------------------------------------------------------------
  for (const [tipo, porNome] of Object.entries(recursos)) {
    if (tipo === 'aws_security_group' || tipo === 'aws_security_group_rule' || tipo === 'aws_instance') continue;
    for (const [nome, corpoBruto] of Object.entries(porNome ?? {})) {
      const corpo = blocos(corpoBruto)[0] ?? {};
      const origem = `${tipo}.${nome}`;
      verSegredosDoRecurso(tipo, nome, corpo);

      const opcoesSub = SUBSTITUICOES[tipo];
      const lockIn = LOCK_IN.find((l) => tipo.startsWith(l.prefixo));
      if (opcoesSub) {
        const motor = String(resolver(corpo.engine) ?? '').toLowerCase();
        const escolha = opcoesSub.find((o) => !o.motor || o.motor.test(motor));
        if (escolha) {
          plano.substituir.push({ origem, ...omitirMotor(escolha) });
          if (corpo.publicly_accessible === true)
            sinalizar({
              origem,
              assunto: 'rede',
              titulo: `${escolha.servicoAws} público`,
              porque: 'Na AWS esta base de dados aceitava ligações de fora.',
              oQueFazer: 'No destino fica só na rede privada; a app liga-se por lá.',
            });
        } else
          sinalizar({
            origem,
            assunto: 'lock-in',
            titulo: `${tipo} ${motor || ''}`.trim(),
            porque: `O motor "${motor || '?'}" não tem alternativa aberta na tabela do tradutor.`,
            oQueFazer: 'Precisa de uma decisão: manter, trocar de motor ou serviço gerido.',
          });
      } else if (tipo.startsWith('aws_iam_')) {
        sinalizar({
          origem,
          assunto: 'iam',
          titulo: `IAM ${nome}`,
          porque: 'Utilizadores, papéis e chaves da AWS não têm equivalente e não se copiam credenciais.',
          oQueFazer: 'Cria utilizadores e chaves novos no destino, só com o acesso de que precisam.',
        });
      } else if (lockIn) {
        sinalizar({
          origem,
          assunto: 'lock-in',
          titulo: `${lockIn.nome} ${nome}`,
          porque: `${lockIn.nome} é um serviço só da AWS: isto é o lock-in. Precisa de redesenho, não de migração.`,
          oQueFazer: `Alternativa aberta: ${lockIn.alternativa}.`,
        });
      } else if (REDE.includes(tipo)) {
        sinalizar({
          origem,
          assunto: 'rede',
          titulo: `rede ${tipo.replace('aws_', '')}`,
          porque: 'A rede da VPC não se copia: na Leaseweb cada instância tem um IPv4 público e grupos de segurança.',
          oQueFazer: 'Nada a fazer para a demo; numa migração real, desenhar a rede privada do destino.',
        });
      } else if (tipo === 'aws_key_pair') {
        sinalizar({
          origem,
          assunto: 'ssh',
          titulo: `chave SSH ${nome}`,
          porque: 'Os pares de chaves da AWS não passam para a Leaseweb.',
          oQueFazer: 'Põe a chave pública no cloud-init do destino.',
        });
      } else {
        sinalizar({
          origem,
          assunto: 'desconhecido',
          titulo: tipo,
          porque: `Não sei traduzir ${tipo}.`,
          oQueFazer: 'Fica para revisão humana.',
        });
      }
    }
  }

  garantirSemSegredos(plano, valoresSecretos);
  return plano;
}

function omitirMotor<T extends { motor?: RegExp }>(o: T): Omit<T, 'motor'> {
  const { motor: _motor, ...resto } = o;
  return resto;
}

/**
 * Última barreira: se algum valor secreto aparecer no plano serializado, não há plano.
 * A mensagem de erro nunca leva o valor. Valores muito curtos (< 4) não se procuram, para não dar falsos alarmes.
 */
function garantirSemSegredos(plano: PlanoTraducao, valores: string[]): void {
  const serializado = JSON.stringify(plano);
  if (valores.some((v) => v.length >= 4 && serializado.includes(v)))
    throw new Error('tradutor: um valor secreto ia aparecer no plano; o plano não foi gerado.');
}
