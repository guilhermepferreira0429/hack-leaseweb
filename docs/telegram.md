# Telegram: aprovar tudo pelo Telegram

Ver também `agentes-telegram.md`: 4 bots (chefe, migrador, atacante, defesa) num grupo "Direção".

Long polling, sem webhook: não precisa de domínio nem HTTPS público.

## Montagem (Carlos, 09:30, cerca de 15 min)

1. No Telegram, falar com `@BotFather` → `/newbot` quatro vezes (chefe, migrador, atacante, defesa) → guardar os tokens em `TELEGRAM_TOKEN_*`. Em cada um, `/setprivacy` → Disable.
   Criar o grupo "Direção", adicionar os 4 bots e o dono.
2. O "dono" da demo envia `/start` ao bot.
3. `curl https://api.telegram.org/bot<TOKEN>/getUpdates` → copiar o `chat.id` do grupo para `TELEGRAM_GRUPO_ID` e o `from.id` do dono para `TELEGRAM_DONO_ID`.
4. Teste com botões:

```bash
curl -s https://api.telegram.org/bot$TELEGRAM_TOKEN_DEFESA/sendMessage \
  -H 'Content-Type: application/json' \
  -d '{"chat_id":'$TELEGRAM_GRUPO_ID',"text":"Teste","reply_markup":{"inline_keyboard":[[{"text":"Aprovar","callback_data":"aprovar:teste"},{"text":"Ignorar","callback_data":"ignorar:teste"}]]}}'
```

## Comportamento

- Cada pedido (migrar ou fechar) chega com título, explicação e botões **Aprovar** / **Ignorar**. `callback_data` = `aprovar:<pedidoId>` ou `ignorar:<pedidoId>`.
- Ao carregar: `answerCallbackQuery` e editar a mensagem com o resultado ("Fechado e confirmado às 14:02").
- Só aceita ordens e botões do `TELEGRAM_DONO_ID`. Ignora os outros.
- Os bots não recebem mensagens de outros bots: a conversa entre agentes passa pelo bus interno e cada bot só publica a sua parte.
- Comandos: `/estado` (o que está pendente e feito), `/desfazer <pedidoId>`.
- Espelhar o ecrã do telemóvel no pitch (ou Telegram Desktop no portátil da apresentação).
