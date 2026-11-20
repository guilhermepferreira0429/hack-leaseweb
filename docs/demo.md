# Guião da demo (cerca de 90 s, dentro do pitch de 5 min)

1. **Abertura a frio** (sem "olá, somos a equipa X"): "Esta máquina, na cloud da Leaseweb, foi ligada hoje de manhã. Desde então recebeu **N** tentativas de entrada." Mostrar `/isco`.
2. "Esta app corre na AWS." (LocalStack.) No grupo "Direção" do Telegram, o **Migrador** propõe o plano. → Aprovar.
3. O painel mostra os ficheiros copiados, checksums iguais e os testes a passar dos dois lados.
4. O Migrador avisa o **Atacante** no grupo; o Atacante encontra a base de dados aberta a toda a Internet e chama a **Defesa**. `nmap`: `open`.
5. A **Defesa** explica em português simples e propõe **Fechar**. Carregar. O Atacante confirma que já não chega lá e o **Chefe** resume.
6. Novo `nmap`: `filtered`. No painel: linha do tempo, auditoria com o inverso guardado e botão Desfazer.
7. Fecho: "Tudo o que viram foi feito hoje e corre na Leaseweb, com IA de fornecedores europeus. Nada saiu da UE. Migrar sem ficar exposto nem um minuto."

**Números:** só o N medido no dia e os que a demo mostrar. Não inventar países nem estatísticas.

**Se a demo falhar em palco:** "Gravámos às 14:30 por precaução" e passar o vídeo. Não se depura em palco.

## Contar tentativas no isco

```bash
sudo grep -cE "Invalid user|Failed password|Connection closed by authenticating user|Disconnected from invalid user" /var/log/auth.log
sudo grep -oE "from [0-9.]+" /var/log/auth.log | sort -u | wc -l   # IPs distintos
```
