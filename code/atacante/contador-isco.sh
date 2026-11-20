#!/bin/sh
# Contador do isco: quantas tentativas de entrada falharam e de quantos IPs vieram.
# Só lê o auth.log: não escreve, não fecha sessões e não mexe no sistema.
#
# Na VM do isco:
#   sudo ./contador-isco.sh          # conta desde as 08:00 (abertura do pitch)
#   sudo ./contador-isco.sh 09:30    # outra hora de início
# De fora, por SSH (só chave):
#   ssh ubuntu@<isco> 'sudo -n /caminho/contador-isco.sh 08:00'
#
# AUTH_LOGS pode apontar para outros ficheiros (por defeito, auth.log rodado + atual).
# As linhas do demo.md são a base: grep -cE para as falhas e grep -oE para os IPs.
set -eu

desde=${1:-08:00}
logs=${AUTH_LOGS:-/var/log/auth.log.1 /var/log/auth.log}

case "$desde" in
  [0-9][0-9]:[0-9][0-9]) ;;
  *)
    echo "uso: $0 [HH:MM]" >&2
    exit 2
    ;;
esac

# Lê um ficheiro de log. O auth.log é do grupo adm; fora do grupo usa-se sudo sem password.
ler() {
  if [ -r "$1" ]; then
    cat "$1"
  else
    sudo -n cat "$1" 2>/dev/null || true
  fi
}

linhas=$(
  for ficheiro in $logs; do
    [ -e "$ficheiro" ] || continue
    ler "$ficheiro"
  done
)

if [ -z "$linhas" ]; then
  echo "aviso: nenhum auth.log legível ($logs); confirma o sudo -n ou AUTH_LOGS" >&2
fi

# Compara só a hora (HH:MM:SS): no dia da demo interessa "desde as 08:00 de hoje".
filtradas=$(printf '%s\n' "$linhas" | awk -v desde="$desde" '
  {
    if ($1 ~ /^[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T/) hora = substr($1, 12, 8);
    else if ($1 ~ /^[A-Z][a-z][a-z]$/) hora = $3;
    else next;
    if (hora >= desde) print;
  }')

padrao='Invalid user|Failed password|Connection closed by authenticating user|Disconnected from invalid user'

tentativas=$(printf '%s\n' "$filtradas" | grep -cE "$padrao" || true)
ips=$( { printf '%s\n' "$filtradas" | grep -oE 'from [0-9]{1,3}(\.[0-9]{1,3}){3}' || true; } \
  | cut -d' ' -f2 | sort -u | wc -l | tr -d ' ')

echo "Tentativas de entrada falhadas desde as $desde: $tentativas"
echo "IPs de origem distintos: $ips"
