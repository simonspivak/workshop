-- Решение Сени 10 ноября: чат учеников и боты отвечают Kimi K3 (Haiku на kie нестабилен).
-- Цена та же: 1★ (обычный ответ) и 3★ (длинный). Подпись кнопки — честная.
update public.price_list set label = 'Kimi K3, до 800 токенов'
 where action = 'text' and model = 'claude-haiku-5-5' and tier = 'base';
update public.price_list set label = 'Kimi K3, длинный ответ'
 where action = 'text' and model = 'claude-haiku-5-5' and tier = 'long';
