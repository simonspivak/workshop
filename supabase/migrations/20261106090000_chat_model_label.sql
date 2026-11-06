-- Чат учеников: если Claude Haiku на kie перегружен, платформа отвечает запасной моделью
-- (Kimi K3, затем GPT 6 Luna — lib/server/gateway.ts). Подпись на кнопке чата — честная.
update public.price_list
   set label = 'Claude Haiku или Kimi K3, до 800 токенов'
 where action = 'text' and model = 'claude-haiku-5-5' and tier = 'base';

update public.price_list
   set label = 'Claude Haiku или Kimi K3, длинный ответ'
 where action = 'text' and model = 'claude-haiku-5-5' and tier = 'long';
