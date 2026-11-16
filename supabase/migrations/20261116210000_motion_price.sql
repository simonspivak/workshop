-- Решение Сени 16 ноября: «Перенос движения» стоит как настоящие кредиты kie.
-- kie берёт ≈12,6 кредита за секунду образца; образцы в библиотеке — до 10 с, это ≈126 кредитов.
-- Было 70 ★ при любой длине образца.
update public.price_list set stars = 126
 where action = 'motion' and model = 'kling-2.6/motion-control' and tier = 'base' and stars = 70;
