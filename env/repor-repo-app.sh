#!/usr/bin/env bash
# Repõe o repo público da app (MIGRADOR_PR_REPO) no estado inicial da demo, entre ensaios.
# Cada "Aprovar PR" faz merge no main desse repo; sem isto, o PR seguinte já não encontra a regra aberta.
#   1. fecha os PR abertos e apaga os ramos migracao/*
#   2. força o main desse repo a voltar ao commit inicial (BASE)
# Só mexe no repo da app da demo, nunca no hack-leaseweb. Precisa de --sim para fazer alguma coisa.
# Sem o gh: usa a API REST do GitHub (node + fetch) com GITHUB_TOKEN_EXEMPLO, e o git para o push --force.
# Uso: bash env/repor-repo-app.sh [--sim]
set -euo pipefail
cd "$(dirname "$0")/.."

REPO="${MIGRADOR_PR_REPO:-$(grep -E '^MIGRADOR_PR_REPO=' .env 2>/dev/null | cut -d= -f2- | tr -d '"' || true)}"
REPO="${REPO:-guilhermepferreira0429/hack-leaseweb-exemplo-app}"
# Commit inicial: cópia da exemplo-app com infra/main.tf.json (a regra 5432 aberta ao mundo).
BASE="${REPO_APP_BASE:-b8017c36f4647cd50944fd4d8564a99c0f7d48af}"
TOKEN="${GITHUB_TOKEN_EXEMPLO:-$(grep -E '^GITHUB_TOKEN_EXEMPLO=' .env 2>/dev/null | cut -d= -f2- | tr -d '"' || true)}"

case "$REPO" in
  */hack-leaseweb) echo "Recusado: $REPO é o repo do projeto, não o da app." >&2; exit 1 ;;
esac
if [ -z "$TOKEN" ]; then
  echo "Falta GITHUB_TOKEN_EXEMPLO no .env (token só para o repo da app)." >&2
  exit 1
fi

# A parte da API corre em node (fetch), para não depender do gh nem do jq na VM. O token vai por variável de ambiente.
REPO="$REPO" BASE="$BASE" TOKEN="$TOKEN" SIM="${1:-}" node --input-type=module -e '
const { REPO, BASE, TOKEN, SIM } = process.env;
const api = async (metodo, caminho, corpo) => {
  const r = await fetch(`https://api.github.com/repos/${REPO}${caminho}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "repor-repo-app" },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  if (!r.ok && r.status !== 404 && r.status !== 422) throw new Error(`${metodo} ${caminho}: HTTP ${r.status}`);
  return r.status === 204 ? null : r.json().catch(() => null);
};
const prs = ((await api("GET", "/pulls?state=open&per_page=100")) ?? []).map((p) => p.number);
const ramos = ((await api("GET", "/branches?per_page=100")) ?? []).map((b) => b.name).filter((n) => n.startsWith("migracao/"));
const main = (await api("GET", "/commits/main"))?.sha;
console.log(`Repo: ${REPO}`);
console.log(`main agora: ${main} · inicial: ${BASE}`);
console.log(`PR abertos: ${prs.join(" ") || "nenhum"}`);
console.log(`Ramos migracao/*: ${ramos.join(" ") || "nenhum"}`);
if (SIM !== "--sim") {
  console.log("Só mostrei. Para repor: bash env/repor-repo-app.sh --sim");
  process.exit(0);
}
for (const n of prs) { await api("PATCH", `/pulls/${n}`, { state: "closed" }); console.log(`PR #${n} fechado`); }
for (const r of ramos) { await api("DELETE", `/git/refs/heads/${r}`); console.log(`ramo ${r} apagado`); }
// main: força para o BASE pela API (PATCH da ref com force), sem clonar.
if (main !== BASE) {
  await api("PATCH", "/git/refs/heads/main", { sha: BASE, force: true });
  const agora = (await api("GET", "/commits/main"))?.sha;
  if (agora !== BASE) throw new Error(`main ficou em ${agora}, não em ${BASE}`);
  console.log(`main reposto em ${BASE}`);
} else {
  console.log("main já estava no estado inicial");
}
'
