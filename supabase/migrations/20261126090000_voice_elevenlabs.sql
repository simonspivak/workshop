-- Вторая модель озвучки: ElevenLabs V3 (решение Сени 26 ноября: Gemini TTS у kie лежал весь день 25 ноября).
-- Эмоции задают тегами в тексте реплики: [excitedly], [whispers]. Не модель Google — доступна всем возрастам.
-- kie берёт 14 кредитов за 1000 знаков: реплика урока (до 220 знаков) ≈ 3 кредита, потолок ученика
-- (600 знаков) ≈ 8,4 кредита. Цена одна — 5 ★. Gemini TTS остаётся запасной за 2 ★.
insert into public.price_list (action, model, tier, stars, access, library_only, position, label, kie_credits)
select 'voice', 'elevenlabs/text-to-dialogue-v3', 'base', 5, 'all', false, 5, 'ElevenLabs V3', 4
 where not exists (
   select 1 from public.price_list
    where action = 'voice' and model = 'elevenlabs/text-to-dialogue-v3' and tier = 'base'
 );
