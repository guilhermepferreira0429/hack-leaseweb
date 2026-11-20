#!/usr/bin/env bash
# Repõe o repo público da app (MIGRADOR_PR_REPO) no estado inicial da demo, entre ensaios.
# Cada "Aprovar PR" faz merge no main desse repo; sem isto, o PR seguinte já não encontra a regra aberta.
#   1. fecha os PR abertos e apaga os ramos migracao/*
#   2. força o main desse repo a voltar ao commit inicial (BASE)
# Só mexe no repo da app da demo, nunca no hack-leaseweb. Precisa de --sim para fazer alguma coisa.
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

if [ -n "$TOKEN" ]; then
  export GH_TOKEN="$TOKEN" GIT_TERMINAL_PROMPT=0 GIT_CONFIG_COUNT=1 \
    GIT_CONFIG_KEY_0="http.https://github.com/.extraheader" \
    GIT_CONFIG_VALUE_0="AUTHORIZATION: basic $(printf 'x-access-token:%s' "$TOKEN" | base64 | tr -d '\n')"
fi

prs=$(gh pr list --repo "$REPO" --state open --json number --jq '.[].number')
ramos=$(gh api "repos/$REPO/branches" --jq '.[].name' | grep '^migracao/' || true)
main=$(gh api "repos/$REPO/commits/main" --jq .sha)
echo "Repo: $REPO"
echo "main agora: $main · inicial: $BASE"
echo "PR abertos: ${prs:-nenhum}"
echo "Ramos migracao/*: ${ramos:-nenhum}"

if [ "${1:-}" != "--sim" ]; then
  echo "Só mostrei. Para repor: bash env/repor-repo-app.sh --sim"
  exit 0
fi

for n in $prs; do gh pr close "$n" --repo "$REPO" --delete-branch >/dev/null && echo "PR #$n fechado"; done
for r in $ramos; do gh api -X DELETE "repos/$REPO/git/refs/heads/$r" >/dev/null 2>&1 && echo "ramo $r apagado" || true; done

if [ "$main" != "$BASE" ]; then
  tmp=$(mktemp -d)
  git clone -q "https://github.com/$REPO.git" "$tmp/app"
  git -C "$tmp/app" push -q --force origin "$BASE:refs/heads/main"
  rm -rf "$tmp"
  echo "main reposto em $BASE"
else
  echo "main já estava no estado inicial"
fi
