# Telegram: aprovar tudo pelo Telegram

Long polling, sem webhook: não precisa de domínio nem HTTPS público.

## Montagem (Carlos, 09:30, cerca de 15 min)

1. No Telegram, falar com `@BotFather` → `/newbot` → guardar o token em `TELEGRAM_BOT_TOKEN`.
2. O "dono" da demo envia `/start` ao bot.
3. `curl https://api.telegram.org/bot<TOKEN>/getUpdates` → copiar `message.chat.id` para `TELEGRAM_CHAT_ID`.
4. Teste com botões:

```bash
curl -s https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage \
  -H 'Content-Type: application/json' \
  -d '{"chat_id":'$TELEGRAM_CHAT_ID',"text":"Teste","reply_markup":{"inline_keyboard":[[{"text":"Aprovar","callback_data":"aprovar:teste"},{"text":"Ignorar","callback_data":"ignorar:teste"}]]}}'
```

## Comportamento

- Cada pedido (migrar ou fechar) chega com título, explicação e botões **Aprovar** / **Ignorar**. `callback_data` = `aprovar:<pedidoId>` ou `ignorar:<pedidoId>`.
- Ao carregar: `answerCallbackQuery` e editar a mensagem com o resultado ("Fechado e confirmado às 14:02").
- Só aceita respostas do `TELEGRAM_CHAT_ID` configurado. Ignora os outros.
- Comandos: `/estado` (o que está pendente e feito), `/desfazer <pedidoId>`.
- Espelhar o ecrã do telemóvel no pitch (ou Telegram Desktop no portátil da apresentação).
