# Тренды ИИ-контента и применения ИИ: осень 2026

**Дата среза:** 1 ноября 2026.
**Для кого:** Сеня Спивак, курс «ИИ-старт» (молодёжный клуб, Молдова, 14–35 лет) и личный бренд.
**Аудитории:** (1) креаторы контента; (2) образование: агенты и промпты; (3) автоматизация и заработок: агенты, Telegram, продажи.

## Как читать этот отчёт

Метки достоверности у фактов:

- **[проверено]** — первоисточник (сайт или блог компании, текст закона, официальная документация) или несколько независимых источников без противоречий.
- **[вторично]** — блог вендора, агрегатор API или пересказ в СМИ. Скорее всего верно, но цифры могут быть устаревшими или «рекламными».
- **[не проверено]** — один слабый источник, или источники противоречат друг другу. Перед использованием на сайте или в уроке нужно перепроверить.

**Ограничения этого ресерча.** В этой среде закрыт доступ к `kie.ai`, `docs.kie.ai`, `api.kie.ai` и `reddit.com`, а WebFetch не работает почти ни для каких сайтов. Поэтому:

- всё о моделях и ценах kie.ai взято из **снимков каталога kie, которые лежат в открытых репозиториях GitHub** (они перечислены в разделе 3) и из поисковых выдержек, а не с самого kie.ai;
- о том, «что реально используют блогеры», у меня есть в основном вендорские блоги, YouTube-туториалы и пересказы. Прямых выборок с Reddit нет. Где опора слабая, это помечено.

**Цены kie.ai** везде пересчитаны по курсу из контекста проекта: **1 кредит kie ≈ $0,005** (200 кредитов = $1). Это совпадает со снимком каталога от 04.10.2026 ([yan-labs/yan-skills, kie-models.md](https://raw.githubusercontent.com/yan-labs/yan-skills/HEAD/rankup/references/integrations/kie-models.md)).

---

## 1. Коротко: 12 главных выводов

1. **Консистентный ИИ-персонаж стал стандартом.** Цепочка «character sheet → сцены по референсам → анимация → голос» теперь делается за вечер. Nano Banana Pro держит до 14 референсов и до 5 людей ([eWeek](https://www.eweek.com/news/google-nano-banana-pro-release/)), а у вышедшей 06.10.2026 Nano Banana 2.1 те же 14 референсов при цене примерно вдвое ниже ([TechNews.tw](https://technews.tw/2026/10/07/google-nano-banana-2-1/)). **[проверено]**
2. **Motion control — главный «вирусный» видеоинструмент года.** Kling 3.0 Motion Control переносит движения с твоего видео на картинку персонажа. На kie он стоит около $0,10 за секунду, так что 10-секундный ролик обходится примерно в $1. **[вторично]**
3. **Видео перешло к «референсам вместо промптов».** Это Seedance 2.0/2.5, Kling 3.0 Omni, Kling 4.0 (до 10 ключевых кадров и 15 референсов, вышел 15.10.2026: [Yahoo Finance / пресс-релиз Kling](https://finance.yahoo.com/technology/ai/articles/kling-ai-launches-kling-4-105300062.html)), Wan 2.7 R2V и Veo 3.1 R2V. **[проверено]**
4. **Дешёвые модели сильно подешевели.** MiniMax H3 (Hailuo 3) стоит около $0,04/с, Seedance 2.0 Mini около $0,04/с при 720p (по акции), Wan 3.0 около $0,04/с при 480p. Генерация видео для подростков в бюджет клуба теперь реальна. **[вторично]**
5. **Говорящий аватар почти бесплатен.** InfiniteTalk на kie стоит около $0,015/с при 480p, то есть 30 секунд выходят примерно в $0,45. **[вторично]**
6. **Музыка легализуется.** Suno v6 (09.09.2026) обучен на лицензированных каталогах Warner, BMG и Believe, а старые модели Suno выводит из оборота ([Suno](https://suno.com/blog/introducing-v6), [Tech Insider](https://tech-insider.org/suno-v6-launch-warner-bmg-believe-2026/)). Новые условия Suno с 03.09.2026: с 13 лет, до 18 лет — с согласия родителей ([Suno Terms](https://suno.com/legal/terms)). **[проверено]**
7. **Платформы ввели правила для ИИ-контента.** С 31.08.2026 в Instagram есть ярлык «AI-generated profile»: аккаунты ИИ-персонажей без него теряют охват ([TechCrunch](https://techcrunch.com/2026/08/31/instagram-puts-new-limits-on-undisclosed-ai-profiles/)). YouTube 16.07.2026 уточнил, что шаблонный «AI slop» не монетизируется ([TechCrunch](https://techcrunch.com/2026/07/20/youtube-clarifies-policies-around-ai-slop-and-upsetting-videos/)). В ЕС с 02.08.2026 действует статья 50 AI Act: дипфейки обязательно маркируются ([artificialintelligenceact.eu](https://artificialintelligenceact.eu/?p=6131)). **[проверено]**
8. **Вирусный формат осени — ИИ-микродрамы.** Это мыльные оперы про фрукты и предметы и пародии на реалити («Fruit Love Island»): серии по 30–60 секунд с клиффхэнгером ([CGTN, 20.03.2026](https://news.cgtn.com/news/2026-03-20/AI-Influence-Pet-and-fruit-microdramas-take-the-internet-by-storm-1LEUvn7BBOE/share_amp.html), [C21Media](https://www.c21media.net/news/fruit-love-island-takes-social-media-by-storm-as-ai-microdramas-set-to-surge/)). Для подростков это идеально: нет реальных лиц, есть сюжет и юмор. **[проверено]**
9. **Вайбкодинг для подростков упирается в возраст.** Google AI Studio и Gemini API доступны только с 18 лет ([Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms)), Claude тоже 18+. Для 14–17 лет нужен свой «песочный» конструктор на платформе курса или инструменты 13+ (например, Replit с согласия родителей). **[проверено]** для Google и Anthropic, **[вторично]** для Replit.
10. **Telegram стал платформой для ИИ-ботов.** С 07.05.2026 есть «гостевые» ИИ-боты (их можно упомянуть в любом чате), общение бот-с-ботом и стриминг ответов ([Telegram](https://telegram.org/blog/ai-bot-revolution-11-new-features)). Встроенная монетизация каналов: 50% выручки от рекламы, Stars, платные посты и подписки ([Telegram](https://telegram.org/blog/monetization-for-channels)). **[проверено]**
11. **n8n — агентный хаб.** MCP работает в обе стороны: агенты n8n вызывают внешние MCP-серверы, а workflow n8n сами становятся инструментами для внешних агентов ([Infralovers](https://www.infralovers.com/blog/2026-03-09-n8n-agentic-mcp-hub/)). В инстансе Сени MCP-сервер n8n уже предлагает инструменты для «первоклассных» Agents. **[вторично]**
12. **Для образования: тьютор-режимы и «контекст вместо промпта».** Study mode в ChatGPT, Guided Learning в Gemini, Learning mode в Claude и NotebookLM с ответами по своим материалам. Промпт-инжиниринг вырос в «context engineering» и переносимые «навыки» агентов (SKILL.md). **[вторично]**

---

## 2. Что изменилось за 2026 год (хронология)

| Дата | Событие | Почему важно для курса | Источник |
|---|---|---|---|
| 20.11.2025 | Nano Banana Pro (Gemini 3 Pro Image): 14 референсов, до 5 людей, 2K/4K, SynthID | Основа консистентных персонажей | [eWeek](https://www.eweek.com/news/google-nano-banana-pro-release/) |
| Январь 2026 | Скандал с Grok: дипфейки «раздевания», в том числе несовершеннолетних. 12.01 Ofcom начал расследование, 26.01 Еврокомиссия открыла дело | Модели Grok **не включать** в безопасный режим | [Al Jazeera](https://www.aljazeera.com/news/2026/1/26/eu-launches-probe-into-grok-ai-feature-creating-deepfakes-of-women-minors), [CMS Law](https://cms.law/en/gbr/legal-updates/grok-in-deep-trouble-over-deepfakes-what-ofcom-s-recent-investigation-means-for-online-platforms) |
| 20.01.2026 | OpenAI: определение возраста в ChatGPT, при сомнении включается режим «до 18» | Тренд «по умолчанию безопасно» | [Help Net Security](https://www.helpnetsecurity.com/2026/01/21/chatgpt-age-prediction-teen-safety/) |
| Февраль 2026 | Kling 3.0 (даты в источниках расходятся). Seedance 2.0 (12.02). Disney и студии против Seedance, ByteDance отключает загрузку реальных лиц | Реальные лица как референс блокируются платформами | [Videomaker](https://www.videomaker.com/news/bytedance-agrees-to-restrict-seedance-after-disney-threatens-legal-action/), [Atlas Cloud](https://www.atlascloud.ai/blog/guides/seedream-seedance-mv-workflow) |
| 05.03.2026 | Kling Motion Control 3.0: стабильнее лицо и мимика | Главный инструмент «танцев персонажей» | [Kling, гид](https://kling.ai/quickstart/motion-control-user-guide), [Higgsfield](https://higgsfield.ai/blog/kling-motion-control-3) |
| 26.03.2026 | Suno v5.5: Voices (свой голос), Custom Models, My Taste | Клонирование **своего** певческого голоса | [Suno](https://suno.com/release-notes/introducing-v5-5-voices-custom-models-and-my-taste) |
| 26.04.2026 | Приложение Sora закрыто, API Sora — до сентября 2026 | Sora в курсе больше не нужна | [Qustodio](https://www.qustodio.com/en/blog/is-sora-2-safe-for-kids/) |
| 07.05.2026 | Telegram: гостевые ИИ-боты, бот-к-боту, стриминг, авто-ответы от имени пользователя | Боты для воркшопов 3–4 | [Telegram](https://telegram.org/blog/ai-bot-revolution-11-new-features) |
| 19.05.2026 | Google I/O: Gemini Omni Flash, видео с правками в диалоге. Veo 4 не объявлен | Veo 3.1 остаётся актуальной моделью Google | [Atlas Cloud](https://www.atlascloud.ai/blog/ai-updates/google-gemini-omni-conversational-video-editing), [PixVerse](https://pixverse.ai/en/blog/veo-4-release) |
| 23.06.2026 | Seedream 5.0 Pro (Lite вышел в феврале) | Дешёвое и точное редактирование картинок | [Coverr](https://coverr.co/es/blog/seedream-5-0-pro-ai-image-model-2026), [OpenRouter](https://openrouter.ai/bytedance-seed/seedream-5-0-pro-20260812) |
| 16.07.2026 | YouTube уточнил понятие «inauthentic content»: шаблонный, шокирующий контент и ИИ-персоны на чувствительные темы не монетизируются | Нужен «авторский» ИИ-контент, а не конвейер | [TechCrunch](https://techcrunch.com/2026/07/20/youtube-clarifies-policies-around-ai-slop-and-upsetting-videos/) |
| 31.07.2026 | Seedance 2.5: до 30 с, до 50 референсов | Длинные сюжетные сцены | [Tosea](https://tosea.ai/blog/seedance-2-5-bytedance-ai-video-model-guide), [AIReiter](https://aireiter.com/zh/blog/seedance-2-5) |
| 02.08.2026 | EU AI Act, статья 50: маркировка дипфейков и ИИ-текстов «для информирования общества» | Касается Сени в Германии и всего, что публикуется в ЕС | [SRD Rechtsanwälte](https://www.srd-rechtsanwaelte.de/en/blog/deepfake-labelling-under-the-ai-act-what-the-new-eu-guidance-clarifies), [Lewis Silkin](https://www.lewissilkin.com/insights/2026/07/31/the-new-ai-labelling-rules-for-deployers-in-the-advertising-supply-chain) |
| Август 2026 | ChatGPT for Teens: глобальный запуск | Подростковые режимы стали нормой | [TechRepublic](https://techrepublic.com/article/news-chatgpt-teens-safety-gaps/) |
| 31.08.2026 | Instagram: ярлык «AI-generated profile», без него охват режется | Обязателен для ИИ-инфлюенсеров | [TechCrunch](https://techcrunch.com/2026/08/31/instagram-puts-new-limits-on-undisclosed-ai-profiles/) |
| 03.09.2026 | Suno: новые условия, 13+ и согласие родителей до 18 | Suno легально подходит подросткам | [Suno Terms](https://suno.com/legal/terms), [ConductAtlas](https://conductatlas.com/change/2026-09-04-suno-suno-terms-of-service-4871/) |
| 09.09.2026 | Suno v6, v6-wild, v6-mini на лицензированных данных | Меньше юридических рисков для брендов | [Suno](https://suno.com/blog/introducing-v6) |
| 06.10.2026 | Nano Banana 2.1: 14 референсов, 1K/2K/4K, примерно вдвое дешевле. Nano Banana 2 в API Google выводится 29.10.2026 | Проверить, на что kie теперь маршрутизирует `nano-banana-2` | [TechNews.tw](https://technews.tw/2026/10/07/google-nano-banana-2-1/), [Artlist](https://artlist.io/blog/nano-banana-2-1-what-changed/) |
| 08.10.2026 | Дания вносит закон о защите лица и голоса от дипфейков (план: начало 2027) | Этика клонирования голоса | [Euronews](https://www.euronews.com/2026/10/08/denmark-introduces-a-bill-protecting-peoples-faces-and-voices-from-deepfakes) |
| 15.10.2026 | Kling 4.0 глобально: 30 с, до 10 ключевых кадров, Omni Reference до 15, MCP и CLI | Топ-качество для бренда Сени | [пресс-релиз](https://finance.yahoo.com/technology/ai/articles/kling-ai-launches-kling-4-105300062.html), [Atlas Cloud](https://www.atlascloud.ai/blog/tips/kling-4-flash-vs-full) |
| 22.10.2026 | Agent Skills (SKILL.md) передаются в Agentic AI Foundation (Linux Foundation) | «Навыки» агентов как открытый стандарт | [i-SCOOP](https://www.i-scoop.eu/agent-skills-agentic-ai-foundation/) **[вторично]** |

---

## 3. Модели kie.ai и цены: рабочая таблица

**Откуда данные.** kie.ai из этой среды недоступен. Использованы три независимых снимка:

- **A.** Каталог Market (122 модели) — [mvanhorn/printing-press-library, MODELS.md](https://raw.githubusercontent.com/mvanhorn/printing-press-library/HEAD/library/ai/kie/docs/MODELS.md). Это снимок docs.kie.ai, дата в файле не указана.
- **B.** Модели и цены от **04.10.2026** — [yan-labs/yan-skills, kie-models.md](https://raw.githubusercontent.com/yan-labs/yan-skills/HEAD/rankup/references/integrations/kie-models.md). Часть цен акционные, действовали до 07.10.2026.
- **C.** Цены kie из каталога genspend.io от **26.10.2026** — [nodetool, genspend-pricing.json](https://raw.githubusercontent.com/nodetool-ai/nodetool/HEAD/packages/model-pricing/src/generated/genspend-pricing.json).
- Отдельно — спецификация `kling-3.0/motion-control` ([ComfyUI-Kie-API](https://raw.githubusercontent.com/gateway/ComfyUI-Kie-API/HEAD/web/docs/KIE_Kling3_Motion_I2V_Spec.md)) и цена Kling 4.0 из контекста проекта.

Все цены — **[вторично]**, перед запуском курса их нужно сверить в личном кабинете kie. Колонка «★» — предложение: **1 звезда = 1 кредит kie**, тогда 1000★ ≈ $5.

### 3.1. Картинки (за одно изображение)

| Модель | id на kie | $ | ★ | Для чего | Подросткам |
|---|---|---|---|---|---|
| Z-Image | `z-image` | 0,004 | ~1 | Черновики, массовые варианты | Да |
| Nano Banana 2 Lite | `nano-banana-2-lite` | 0,02 | 4 | Быстрые сцены | Да |
| Nano Banana (2.5 Flash Image) | `google/nano-banana`, `-edit` | 0,02 | 4 | Простое редактирование | Да |
| Seedream 5.0 Lite | `seedream/5-lite-text-to-image`, `-image-to-image` | 0,0275 | 5–6 | Редактирование, текст на картинке | Да |
| GPT Image 2 / 2.5 | `gpt-image-2-*`, `gpt-image-2-5-flare-*` | 0,03 (1K); 2K = 10★, 4K = 16★ (снимок B) | 6 | Инфографика, карусели, прозрачный фон | Да |
| Seedream 4.5 Edit | `seedream/4.5-edit` | 0,0325 | 6–7 | Мульти-референс до 14 картинок | Да |
| Seedream 5.0 Pro | `seedream/5-pro-*` | 0,035 | 7 | Точные правки, компоновка | Да |
| Nano Banana 2 | `nano-banana-2` | 0,04 (1K) | 8 / 12 / 18 (1K/2K/4K) | Сцены по референсам персонажа (до 14 референсов в ноде ComfyUI) | Да |
| **Nano Banana Pro** | `nano-banana-pro` | **0,09** | 18 | **Character sheet**, сложные сцены, текст | Да |
| Ideogram Character | `ideogram/character`, `-edit`, `-remix` | нет данных | — | Персонаж по одному фото | Да, только вымышленный |
| Grok Imagine Image 2.0 | `grok-imagine-image-2-0/*` | 0,02 | 4 | — | **Нет** (см. раздел 5.6) |
| Утилиты | `recraft/remove-background`, `recraft/crisp-upscale`, `topaz/image-upscale` | нет данных | — | Убрать фон, апскейл | Да |

### 3.2. Видео

| Модель | id на kie | Цена (снимок) | 10 с ≈ ★ | Сильная сторона | Подросткам |
|---|---|---|---|---|---|
| Grok Imagine Video 1.5 | `grok-imagine-video-1-5-preview` | ~$0,0225/с | ~45 | Самое дешёвое | **Нет** |
| MiniMax H3 (Hailuo 3) | `minimax-h3/*` (есть reference-to-video) | $0,04/с (C) | ~80 | Дёшево, до 9 референсов | Да |
| Seedance 2.0 Mini | `bytedance/seedance-2-mini` | 480p: 38★, 720p: 82★ за 10 с (B, **акция до 07.10**) | 40–80 | Персонажи и питомцы, до 9 референсов, звук | Да (без реальных лиц) |
| Wan 3.0 | `wan/3-0-video` | 80 / 160 / 320★ за 10 с (480/720/1080p) (B) | 80–320 | До 10 референсов, до 30 с | Да |
| Kling 3.0 | `kling-3.0/video` | std: 140★ за 10 с без звука, 200★ со звуком; pro: 180 / 270★ (B); $0,07/с (C) | 140–270 | До 3 «элементов»-персонажей, мульти-шот | Да |
| Wan 2.7 (i2v / r2v / t2v / videoedit) | `wan/2-7-*` | $0,08/с (C) | ~160 | Референсы и видео-правки | Да |
| Kling 3.0 Turbo | `kling/v3-turbo-*` | $0,09/с (C) | ~180 | Быстрый Kling | Да |
| **Kling 3.0 Motion Control** | `kling-3.0/motion-control` | **$0,10/с** (C), 720p | **~200** | **Перенос движения** с видео на персонажа | Да, с ограничениями |
| Kling 2.6 Motion Control | `kling-2.6/motion-control` | на kie нет данных; у реселлеров ~$0,064/с за 720p **[не проверено]** | ~130 | Перенос движения, дешевле | Да, с ограничениями |
| Wan 2.2 Animate Move / Replace | `wan/2-2-animate-move`, `wan/2-2-animate-replace` | на kie нет данных; у других ~$0,20 за запуск **[не проверено]** | ? | Анимация персонажа и **замена** персонажа в видео | Move — да; Replace — только вымышленные персонажи |
| HappyHorse 1.1 (Alibaba) | `happyhorse-1-1/*` | $0,1125/с (C) | ~225 | Референсы | Да |
| PixVerse V6 | `pixverse-v6/*` | 720p: 81★ без звука, 108★ со звуком за 10 с (B) | 80–110 | Fusion / R2V, переходы между кадрами | Да |
| Seedance 2.0 | `bytedance/seedance-2` | 720p: 410★ за 10 с (= $0,205/с); 480p: 190★; 1080p: 1020★ (B, C) | 190–1020 | Лучший reference-to-video по бенчмаркам | Да (без реальных лиц) |
| Seedance 2.5 | `bytedance/seedance-2-5` | 480p: 280★, 720p: 630★, 1080p: 1580★ за 10 с (B) | 280–1580 | До 30 с, много референсов | Дорого для курса |
| Veo 3.1 (отдельный API) | `veo-3-1` | Lite: 30★ за 8 с 720p; Fast: 60★; Quality ≈ $1,25 за ролик (B, C) | 30–250 | Звук и диалоги из коробки | Да |
| Gemini Omni Video | `gemini-omni-video` | ~126★ (720/1080p), 4K 210★ (B; единица в снимке неоднозначна) | ~126 | Правки видео диалогом | Да |
| **Kling 4.0** keyframe-to-video 1080p | (по контексту проекта) | **42,5★/с = $0,2125/с** | 425 | До 10 ключевых кадров, 30 с | Только бренд Сени |

### 3.3. Говорящие аватары, lip-sync и аудио

| Модель | id на kie | Цена | Пример | Подросткам |
|---|---|---|---|---|
| **InfiniteTalk** (фото + аудио → говорящее видео) | `infinitalk/from-audio` (480p/720p) | 480p: **$0,015/с** (C); 720p: ~$0,06/с ([Breakingac, дек. 2025](https://breakingac.com/news/2025/dec/05/how-to-choose-the-most-cost-effective-infinite-talk-api-the-efficient-solution-provided-by-kieai/)) | 30 с ≈ 90★ (480p) | Да, только вымышленные лица |
| Kling AI Avatar Standard / Pro | `kling/ai-avatar-standard`, `kling/ai-avatar-pro` | на kie нет данных; у других $0,044–0,115/с ([PiAPI](https://piapi.ai/en/blogs/kling-ai-avatar-guide-standard-vs-pro), [Runware](https://runware.ai/models/klingai-avatar-2-0-standard)) | — | Да, только вымышленные |
| OmniHuman 1.5 | `omnihuman-1-5` | нет данных | — | Да, только вымышленные |
| Lip-sync поверх готового видео | `volcengine/video-to-video-lip-sync` | нет данных | — | С осторожностью |
| Wan 2.2 Speech-to-Video | `wan/2-2-a14b-speech-to-video-turbo` | нет данных | — | Да |
| ElevenLabs TTS Multilingual v2 | `elevenlabs/text-to-speech-multilingual-v2` | $60 за 1 млн символов (C) = **12★ за 1000 символов** | Озвучка Reels на 60 с ≈ 10–12★ | Да, стоковые голоса |
| ElevenLabs Turbo 2.5, Dialogue v3, Audio Isolation | `elevenlabs/text-to-speech-turbo-2-5`, `elevenlabs/text-to-dialogue-v3`, `elevenlabs/audio-isolation` | нет данных | — | Да |
| Gemini 3.1 Flash TTS | `google/gemini-3-1-flash-tts` | нет данных | — | Да |
| **Клонирование голоса** | **в каталоге Market kie его нет** | — | — | Не делать (см. тренд 6) |
| Suno (отдельный API kie) | генерация, extend, стемы | генерация (2 трека) ≈ $0,06 **[не проверено]**; extend 12★, стемы 10★ ([Apiframe](https://apiframe.ai/blog/ai-music-api-pricing-2026)) | Песня ≈ 12★ | Да (13+, согласие родителей) |

### 3.4. Что это значит для бюджета клуба

- **1000★ на человека = $5. На 15 человек = $75**, это укладывается в 100–150 € и оставляет запас на демо Сени и повторные генерации.
- Примерный «рюкзак» участника на 1000★:
  - ~15 картинок (100–250★);
  - 1 motion control на 5–10 с (100–200★);
  - 1 говорящий персонаж на 20–30 с (60–90★);
  - 2–3 песни (25–40★);
  - 3–4 видеоклипа по 5 с на дешёвых моделях (120–160★);
  - озвучка и LLM-запросы (50–100★).

  Итого 500–850★, остаток идёт на повторы.
- Важные условия kie для платформы ([документация kie, «Getting Started»](https://docs.kie.ai/1973359m0.md); выдержка из поиска, **[вторично]**):
  - у ключа есть **лимиты в час, в день и на весь срок, а также белый список IP**;
  - в документации есть код ошибки 433 «Sub-key usage exceeds limit», значит есть **суб-ключи со своим лимитом** ([зеркало документации kie](https://github.com/hassanvfx/kie-api-python));
  - ссылки на результаты временные (обычно около 24 часов, точный срок не подтверждён), поэтому файлы нужно сразу копировать в своё хранилище ([yan-labs, kie.md](https://raw.githubusercontent.com/yan-labs/yan-skills/HEAD/rankup/references/integrations/kie.md)).

---

## 4. Аудитория 1: креаторы контента

### Что реально используют (сигналы, а не рейтинг)

Повторяющиеся связки в туториалах и разборах 2026 года **[вторично]**:

- **Nano Banana Pro → Kling (motion control) → ElevenLabs → CapCut**: ИИ-инфлюенсеры ([YouTube-туториал](https://www.youtube.com/watch?v=kRCtWzc3B9w)).
- **Seedance для коротких «геройских» планов + Kling для длинных связок** ([AI Vid Pipeline](https://aividpipeline.com/blog/seedance-vs-kling)).
- **Suno → вокальный стем → lip-sync в Seedance или Kling → CapCut**: клипы ([Oakgen](https://oakgen.ai/blog/ai-lipsync-music-memes-seedance), [Atlas Cloud](https://www.atlascloud.ai/blog/guides/seedream-seedance-mv-workflow)).
- Агрегаторы «всё в одном» (Higgsfield, Dreamina/CapCut, Krea, OpenArt) с теми же моделями внутри. Higgsfield 03.10.2026 пересобрал студию AI Influencer, у него есть «Soul ID»: лицо, обученное на 20–80 картинках ([Aiidelist](https://aiidelist.com/blog/higgsfield-ai-influencer), [Higgsfield](https://higgsfield.ai/blog/sould-id-best-character-consistency)).

Почти все источники — вендоры, которые продают доступ к этим моделям. Прямых данных о том, что используют «топ-блогеры», в открытом доступе нет.

---

### Тренд 1. ИИ-персонажи и ИИ-инфлюенсеры

**Что это.** Вымышленный персонаж с устойчивой внешностью (лицо, причёска, одежда, стиль), который «ведёт» Instagram, TikTok или Telegram: посты, Reels, сторис, коллаборации с брендами. В 2026 это прежде всего **жанр**, где ценится характер и сюжет, а не «я настоящий человек»: Instagram с 31.08.2026 режет охват неотмеченным ИИ-профилям ([TechCrunch](https://techcrunch.com/2026/08/31/instagram-puts-new-limits-on-undisclosed-ai-profiles/), [MediaPost](https://www.mediapost.com/publications/article/417580/)). **[проверено]**

**Пайплайн «персонаж за вечер»:**

1. **Паспорт персонажа (LLM).** Имя, возраст (для подростковой группы — вымышленный, условно «вне возраста» или животное), 5–7 неизменных черт (форма лица, цвет глаз, причёска, фирменная вещь, палитра), характер, «голос» постов. Совет из гидов: зафиксировать 5–7 неизменных черт до генерации ([Selfielab](https://selfielabstudio.com/blog/nano-banana-pro-perfect-character-consistency-guide-20260212)). **[вторично]**
2. **Базовый портрет.** Nano Banana 2 или Seedream 5 Lite: 4–8 вариантов, выбираем один (30–60★).
3. **Character sheet.** Nano Banana Pro: «model sheet: фас, 3/4, профиль, спина + 6 эмоций, нейтральный фон, одинаковый свет» (18★ за лист, 2–3 попытки) ([InVideo FAQ](https://invideo.io/faq/how-do-you-create-a-character-reference-sheet-using-nano/)).
4. **Сцены.** Nano Banana 2 / 2.1 или Seedream 4.5/5 Edit с character sheet как референсом: «персонаж в кафе / на концерте / с продуктом бренда». У Nano Banana Pro и 2.1 до 14 референсов ([eWeek](https://www.eweek.com/news/google-nano-banana-pro-release/), [Artlist](https://artlist.io/blog/nano-banana-2-1-what-changed/)).
5. **Анимация.** Тренд 3 (motion control) или тренд 4 (reference-to-video).
6. **Голос.** Тренд 6: стоковый или дизайнерский голос, не клон чужого.
7. **Монтаж и публикация.** CapCut: субтитры, музыка. В профиле ставится ярлык «AI-generated profile», в постах — AI-метка.

**Модели на kie:** `nano-banana-pro`, `nano-banana-2`, `seedream/5-lite-*`, `seedream/4.5-edit`, `ideogram/character`, затем видео из 3.2.

**Стоимость одного результата:** character sheet + 5 сцен ≈ 60–110★ ($0,3–0,55). С Reels на 10 с через motion control ≈ 260–310★ ($1,3–1,6).

**Подросткам 14–17 — да, если:**

- персонаж **вымышленный и стилизованный** (3D-мультяшный, аниме, пластилин, животное, предмет), без фотореализма «как человек»;
- **не используются** фото себя, одноклассников и знаменитостей: в безопасном режиме платформа блокирует загрузку фото людей как референса;
- никакой сексуализации, «взрослых» тем и «идеального тела». Instagram для подростков по умолчанию держит контент на уровне PG-13 ([TechCrunch](https://techcrunch.com/2025/10/14/instagram-defaults-to-pg-13-content-for-teens-adds-more-parental-controls/));
- публикация — только в общий аккаунт клуба, который ведёт взрослый, с ярлыком «AI-generated».

---

### Тренд 2. Редактирование изображений как «фотостудия»

**Что это.** Вместо генерации «с нуля» — правки текстом: поменять одежду, фон, свет, ракурс; соединить персонажа и продукт; сделать карусель или постер с читаемым текстом. Лидеры — Nano Banana Pro / 2.1, Seedream 5.0 Pro Edit (до 10–14 референсов, сильный текст в картинке: [OpenRouter](https://openrouter.ai/bytedance-seed/seedream-5-0-pro-20260812), [Atlas Cloud](https://www.atlascloud.ai/es/models/bytedance/seedream-v5.0-pro/edit)) и GPT Image 2/2.5 (прозрачный фон, маски: [ComfyUI-Kie-API](https://raw.githubusercontent.com/gateway/ComfyUI-Kie-API/HEAD/README.md)). **[вторично]**

**Пайплайн «предметная съёмка для малого бизнеса»:**

1. Фото товара на телефон.
2. `recraft/remove-background`.
3. Seedream 5 Pro или Nano Banana 2: «товар на мраморном столе, утренний свет, 3 варианта».
4. GPT Image 2.5: карусель из 5 слайдов с заголовками.
5. `topaz/image-upscale` при необходимости.

**Стоимость:** 5–10 картинок ≈ 40–90★ ($0,2–0,45).

**Подросткам — да.** Это лучший безопасный формат: предметы, еда, свои рисунки, мерч клуба. Правки фото реальных людей в безопасном режиме запрещены.

---

### Тренд 3. Motion transfer / motion control

**Что это.** Берёшь **видео-«драйвер»** (танец, жест, походка, мимика) и **картинку персонажа**. Модель переносит движение на персонажа. Отсюда волна «танцующих» котов, бабушек, фруктов и маскотов в Reels. Текстом хореографию надёжно не опишешь, поэтому трендовые танцы делают именно через референс-видео ([Kling, блог](https://kling.ai/blog/ai-motion-transfer-video-tutorial), [Kapwing](https://www.kapwing.com/resources/how-to-make-ai-dancing-videos-with-dance-video-library/)). **[проверено]**

**Инструменты осени 2026:**

- **Kling 3.0 Motion Control.** Относительно 2.6 стабильнее лицо и мимика на сложных, многоракурсных и длинных движениях ([Kling, гид](https://kling.ai/quickstart/motion-control-user-guide)). На kie: модель `kling-3.0/motion-control`, вход `input_urls` (1 картинка) + `video_urls` (1 видео), `character_orientation`: `image` (видео до 10 с) или `video` (до 30 с), `mode`: 720p или 1080p ([спецификация](https://raw.githubusercontent.com/gateway/ComfyUI-Kie-API/HEAD/web/docs/KIE_Kling3_Motion_I2V_Spec.md)). **[вторично]**
- **Kling 2.6 Motion Control** — дешевле, хорошо переносит тело, иногда «плывёт» лицо ([Framia](https://framia.converge.ai/blog/kling-motion-control/)).
- **Wan 2.2 Animate** (открытые веса, Apache 2.0). *Move* анимирует персонажа по видео, *Replace* **заменяет** человека в видео на персонажа с подгонкой света ([arXiv 2509.14055](https://arxiv.org/abs/2509.14055v1), [ComfyUI](https://comfy.org/workflows/use-cases/ai-character-replacement/)). На kie: `wan/2-2-animate-move`, `wan/2-2-animate-replace`. **[проверено]** для модели, **[не проверено]** для цены.
- **Seedance 2.0 / 2.5 с видео-референсом.** Видео задаёт движение и камеру, картинки — внешность ([InVideo](https://invideo.io/faq/how-do-you-use-seedance-20-reference-to-video-for/)).
- Вне kie: Higgsfield «Genjutsu» и motion control в Higgsfield, библиотека танцев в Kling.

**Пайплайн «танцующий маскот»:**

1. Персонаж из тренда 1, в полный рост, руки и ноги видны, фон простой.
2. Видео-драйвер на 5–10 с. Танец снимается на телефон: один человек, полный рост, контрастная одежда, неподвижная камера. Либо берётся из библиотеки разрешённых клипов.
3. `kling-3.0/motion-control`, orientation `video`, 720p. Промпт: «No distortion, the character's movements are consistent with the video».
4. Проверка рук, пальцев и лица. При необходимости 1 повтор.
5. CapCut: трендовый звук (из библиотеки CapCut или TikTok), подписи, AI-метка.

**Стоимость:** 5 с ≈ 100★ ($0,5), 10 с ≈ 200★ ($1). С одним повтором — до 400★.

**Подросткам — да, с адаптацией:**

- видео-драйвер для младших — **из библиотеки клипов, которые записал Сеня или взрослые**, или собственный танец, но только с согласием родителей: видео содержит лицо и тело ребёнка и уходит третьей стороне (kie и Kling);
- на выходе — **только вымышленный персонаж**. *Replace* реальных людей на чужих видео (одноклассник, учитель, блогер) запрещён: это прямой путь к дипфейк-буллингу.

---

### Тренд 4. Reference-to-video и мульти-шот истории

**Что это.** Модель получает несколько картинок (персонажи, локация, предмет), иногда видео и аудио, и снимает сцену, где все они узнаваемы.

- **Seedance 2.0** — первое место по всем пяти осям reference-to-video в собственной статье ByteDance ([arXiv 2604.14148](https://arxiv.org/pdf/2604.14148)). Слабое место — 3 и больше персонажей в кадре ([MindStudio](https://www.mindstudio.ai/blog/what-is-seedance-2-video-model)).
- **Kling 4.0** — 30 с, до 10 ключевых кадров, Omni Reference до 15 референсов. API на старте не было ([Atlas Cloud](https://www.atlascloud.ai/blog/tips/kling-4-flash-vs-full), [Runtimewire](https://runtimewire.com/es/article/kling-ai-kling-4-mcp-cli-availability)), но по контексту проекта на kie уже есть keyframe-to-video. **[проверено]** для функций, **[вторично]** для доступа через API.

**Пайплайн «серия из 3 сцен» (рекомендация гидов: [InVideo](https://invideo.io/faq/how-do-you-use-seedance-20-reference-to-video-for/), [Magic Hour](https://magichour.ai/blog/seedance-20-reference-guide)):**

1. LLM пишет сценарий: 3 сцены по 5 с, крючок в первой секунде, клиффхэнгер в конце.
2. Фиксируются character sheet + «location plate» (картинка локации).
3. Каждая сцена: R2V-модель (`bytedance/seedance-2-mini`, `minimax-h3/reference-to-video`, `wan/2-7-r2v`, `kling-3.0/video` с elements) с референсами `@Image1`, `@Image2`.
4. Связка сцен: последний кадр предыдущей сцены идёт как первый или видео-референс следующей.
5. Монтаж: CapCut.

**Стоимость:** 3 × 5 с на дешёвых моделях ≈ 120–130★ ($0,6). На Seedance 2.0 720p ≈ 615★ ($3,1). На Kling 4.0 1080p ≈ 640★ ($3,2).

**Подросткам — да:** дешёвые модели, вымышленные персонажи. Seedance сама блокирует реальные лица как референс ([The Daily Star](https://www.thedailystar.net/tech-startup/news/bytedance-acknowledges-disney-copyright-allegations-its-ai-tool-4107441)). Чужие франшизы (Disney, аниме, игровые персонажи) лучше не брать: это и вопрос авторского права, и фильтры моделей ([MindStudio](https://www.mindstudio.ai/blog/seedance-2-0-content-restrictions-workarounds)).

---

### Тренд 5. Lip-sync и говорящие аватары

**Что это.** Фото или картинка + аудио → говорящее (поющее) видео. Три класса:

- **«говорящее фото»** — InfiniteTalk, Kling AI Avatar, OmniHuman 1.5;
- **lip-sync поверх готового видео** — `volcengine/video-to-video-lip-sync`, Kling Lipsync;
- **студийные аватары** — HeyGen, Synthesia: для переводов и корпоративного обучения ([Pixverse, обзор](https://pixverse.ai/en/blog/best-ai-avatar-video-generator-2026)).

По тесту PiAPI (сам продаёт обе модели, так что оценка не нейтральная) Kling Avatar точнее в губах и эмоциях, а OmniHuman 1.5 стабильнее в движении и идентичности ([PiAPI](https://piapi.ai/en/blogs/omnihuman-1-5-vs-kling-ai-avatar)). **[вторично]**

**Пайплайн «персонаж-ведущий»:**

1. LLM: текст на 20–40 с, разговорный, с крючком.
2. TTS `elevenlabs/text-to-speech-multilingual-v2` со стоковым голосом (≈5★).
3. Портрет персонажа анфас, рот закрыт, нейтральный фон.
4. `infinitalk/from-audio`, 480p (черновик) или 720p (чистовик).
5. CapCut: субтитры, B-roll из тренда 2.

Длинный текст лучше резать на куски по 15–20 с: на длинной дорожке lip-sync плывёт ([Cliprise](https://www.cliprise.app/learn/guides/getting-started/ai-avatar-video-generator-complete-guide-2026)).

**Стоимость:** 30 с при 480p ≈ 90★ + 5★ ($0,48). При 720p ≈ 360★ ($1,8).

**Подросткам — да, только вымышленные лица.** Говорящий «учитель» или «одноклассник», сделанный из фото, — классический сценарий травли и мошенничества. В безопасном режиме платформа принимает только картинки, сгенерированные внутри самой платформы, а не загруженные фото.

---

### Тренд 6. Голос: озвучка, диалоги, клонирование и этика

**Что это.** TTS высокого качества: ElevenLabs v3 / Multilingual v2, Gemini 3.1 Flash TTS. Многоголосые диалоги (`text-to-dialogue-v3`). Дизайн голоса по описанию. **Клонирование** голоса по образцу.

**Правила 2026 года:**

- **ElevenLabs:** профессиональный клон голоса (PVC) можно сделать **только из своего голоса и в своём аккаунте**, даже при письменном согласии другого человека нельзя. Клон реального человека без согласия запрещён, голоса знаменитостей блокируются ([Terms.law](https://terms.law/ai-output-rights/elevenlabs/), [ConductAtlas](https://conductatlas.com/platform/elevenlabs/elevenlabs-usage-policy/voice-cloning-without-consent-prohibition/)). **[вторично]**
- **Suno Voices:** голосовая модель — только из собственного голоса ([ConductAtlas](https://conductatlas.com/platform/suno/suno-terms-of-service/voice-model-must-be-own-voice-only/)). **[вторично]**
- **ЕС:** с 02.08.2026 реалистичный ИИ-звук или видео с реальным человеком (дипфейк) нужно **маркировать**, даже без злого умысла. Штрафы до €15 млн или 3% оборота ([Didit](https://didit.me/blog/eu-ai-act-deepfake-labelling-2026/), [SRD](https://www.srd-rechtsanwaelte.de/en/blog/labelling-requirements-ai-act-deepfakes)). **[проверено]**
- **Дания** (законопроект от 08.10.2026): лицо, голос и движения человека защищаются как объект авторского права, есть право требовать удаления ([Euronews](https://www.euronews.com/2026/10/08/denmark-introduces-a-bill-protecting-peoples-faces-and-voices-from-deepfakes)). **[проверено]**

**Пайплайн «озвучка Reels»:**

1. Текст.
2. Стоковый голос или «дизайн голоса».
3. TTS.
4. `elevenlabs/audio-isolation` для чистки своих записей.

**Стоимость:** ~12★ за 1000 символов, то есть минута речи ≈ 10–12★.

**Подросткам: озвучка — да, клонирование — нет.** На kie клонирования нет, и это удобно: на платформе его просто не будет. Для урока этики можно показать демо, где Сеня клонирует свой голос со своего аккаунта, и разобрать мошенничество «мама, я попал в беду».

---

### Тренд 7. Музыка: Suno v6 и клипы

**Что это.** Песня по тексту и стилю за минуту, стемы, продление, свой голос (v5.5 Voices). v6 обучен на лицензированных данных, а v6-mini доступна всем ([Suno](https://suno.com/blog/introducing-v6), [AImusicpreneur](https://www.aimusicpreneur.com/ai-tools-news/suno-v6-v6-wild-v6-mini-launch/)). **[проверено]**

**Пайплайн «гимн клуба + клип»:**

1. LLM: текст песни про клуб (куплет, припев).
2. Suno: стиль и текст, 2 варианта (≈12★).
3. Стем вокала.
4. Lip-sync персонажа на вокальный стем (InfiniteTalk или Seedance с аудио), полный микс кладётся поверх ([Oakgen](https://oakgen.ai/blog/ai-lipsync-music-memes-seedance)).
5. 3–4 перебивки из тренда 4.
6. CapCut.

**Стоимость:** ≈ 110–250★ ($0,55–1,25).

**Подросткам — да:** 13+, с согласия родителей ([Suno Terms](https://suno.com/legal/terms)). Нельзя: «в стиле [имя артиста]» с имитацией голоса, тексты с травлей. Коммерческие права на треки через API-посредника (kie) **не подтверждены**, поэтому для коммерции Сене нужен свой платный тариф Suno.

---

### Тренд 8. Монтаж: CapCut и Descript

- **CapCut** — стандарт для Reels и Shorts у подростков. В 2026 в него встроен Seedance 2.0 (AI Video, Video Studio) ([CapCut Newsroom](https://www.capcut.com/newsroom/dreamina-seedance-2)), а по данным трекеров ещё ИИ-помощник монтажа Edit Pilot ([Hooked](https://www.hooked.so/guides/capcut-updates)). Возраст: 13+, до 18 лет с согласия родителей (условия от 15.04.2026, по [eSafety](https://esafety.gov.au/key-topics/esafety-guide/capcut) и [CapCut](https://www.capcut.com/de-de/help/is-capcut-appropriate-for-kids)). **[проверено]**
- **Descript** — монтаж «как в документе». С 2026 его агент Underlord «смотрит» видео ([Descript, 18.06.2026](https://www.descript.com/blog/article/underlord-ai-can-watch-videos)), есть API и вызов из Claude и ChatGPT ([CreateWith](https://www.createwith.com/tool/descript/updates/descript-underlord-brings-natural-language-video-editing-to-automated-workflows)). Подходит для нарезок воркшопов Сени, а не подросткам. **[вторично]**

**Пайплайн монтажа Reels за 15 минут:**

1. Хук 0–1,5 с: самый странный или смешной кадр в начале.
2. Субтитры авто.
3. Трендовый звук.
4. Темп: смена кадра каждые 1–2 с.
5. Обложка.
6. AI-метка.

Данные viral.app по 3,3 млн видео: посты с более чем 5 хэштегами почти исчезли, длина роликов стабильна ([viral.app](https://viral.app/blog/insights/short-form-video-trends)). **[вторично]**

---

### Тренд 9. Вирусные форматы Reels и Shorts (осень 2026)

| Формат | Что это | Почему работает | Модели на kie | ★ за ролик | Подросткам |
|---|---|---|---|---|---|
| **ИИ-микродрамы про фрукты и еду** («Fruit Love Island», «цитрусовая мелодрама») | Серии по 30–60 с, мелодрама, клиффхэнгер | Узнаваемый жанр + абсурд. Аккаунт набрал 2,2 млн подписчиков за 27 видео ([SocialPeta](https://socialpeta.com/en/blog/short-drama-weekly-ranking-43k-titles-compete-as-ai-dramas-rise-and-fruit-themed-melodramas-expand-globally), [CGTN](https://news.cgtn.com/news/2026-03-20/AI-Influence-Pet-and-fruit-microdramas-take-the-internet-by-storm-1LEUvn7BBOE/share_amp.html)) | Nano Banana 2, MiniMax H3 / Seedance Mini, TTS-диалоги | 150–250 | **Идеально** |
| **Говорящие предметы и еда** | Предмет «объясняет», «жалуется», «спорит» | Простой и обучающий формат ([AITuber](https://aituber.app/blog/talking-food-fruit-videos/)) | Nano Banana 2 + InfiniteTalk | 60–100 | Да |
| **«Italian brainrot»** и гибридные существа | Абсурдные мемные существа с псевдо-итальянским закадром | Мемность, ремиксы ([OpusClip](https://www.opus.pro/blog/viral-ai-video-styles-2026)) | Любая i2v + TTS | 60–120 | Да (следить за грубостью) |
| **Фото-в-видео шаблоны** (танцующий питомец, «плачущий» тренд, смена образа, ремейк мема) | 1–2 фото → вертикальный ролик по шаблону | Низкий порог, легко повторить ([Videosi, 21.10.2026](https://videosi.io/trending)) | Motion control, i2v | 50–200 | Только питомцы, рисунки, персонажи |
| **Танцы персонажей** | Тренд 3 | Трендовый звук + неожиданный «исполнитель» | `kling-3.0/motion-control` | 100–200 | Да, с библиотекой драйверов |
| **«Повседневность в стиле Ghibli» и уютная анимация** | Тёплые сцены быта | Высокая доля сохранений ([OpusClip](https://www.opus.pro/blog/viral-ai-video-styles-2026)) | Nano Banana, Wan, Kling | 60–150 | Да, но без копирования чужого стиля один в один |
| **Аудио-реактивные визуалы под трендовый звук** | Картинка «пульсирует» в такт | Хорошо работает со звуковыми трендами | Seedance (beat-sync), CapCut | 50–150 | Да |
| **Обучающие «объясняшки» персонажа** | Маскот за 30 с объясняет тему | Сохранения, репосты в чаты | InfiniteTalk + B-roll | 90–150 | Да |

**Правила платформ, которые влияют на формат:**

- **YouTube:** шаблонный повторяющийся ИИ-контент, «шокирующий» контент и ИИ-персоны на чувствительные темы не монетизируются; правила применяются ко всему каналу ([TechCrunch](https://techcrunch.com/2026/07/20/youtube-clarifies-policies-around-ai-slop-and-upsetting-videos/), [AIR Media-Tech](https://air.io/en/monetization/youtube-monetization-policy-changes-2026-a-complete-dated-timeline)).
- **TikTok:** метка AIGC; автоматическая маркировка по C2PA; у пользователей есть ползунок «сколько ИИ-контента показывать» в «Manage Topics» ([Daily Mirror LK](https://www.dailymirror.lk/print/business-news/TikTok-announces-updates-designed-to-increase-transparency-around-AIGC/273-327699)).
- **Instagram:** ярлык «AI-generated profile» для ИИ-персон; простые ИИ-правки ярлыка не требуют ([TechRepublic](https://techrepublic.com/article/news-instagram-ai-generated-profile-label-recommendations/)).

**Вывод:** выигрывает **серийность с характером и авторской идеей**, а не конвейер одинаковых роликов.

---

### Тренд 10. ИИ-UGC и контент для брендов

**Что это.** Ролики «как будто снял покупатель», предметные фото, карусели, ИИ-персонаж как амбассадор. Инструменты: Arcads, Creatify, HeyGen или своя сборка на kie. Цена за ролик у сервисов — $1,65–11 ([Creatify](https://creatify.ai/blog/the-8-best-ai-ugc-ad-tools-in-2026), [Arcads, Yespress](https://yespress.io/arcads)). С учётом брака (до 85% роликов отбраковывается) реальная цена за ролик, который можно запускать, выходит $30–150 ([InVideo](https://invideo.io/faq/what-is-the-best-ai-tool-for-producing-ugc-ads-cheaply/)). **[вторично]**

**Пайплайн «пакет для кафе или магазина»:**

1. Бриф (LLM-анкета).
2. 10 предметных фото (тренд 2).
3. 3 Reels (тренды 3–5) с персонажем-маскотом.
4. 5 подписей и 1 карусель.
5. Сдача заказчику через Telegram-бот.

**Себестоимость на kie** ≈ 500–900★ ($2,5–4,5). Продажная цена на рынке — от десятков до сотен евро (оценка).

**Подросткам:** как учебный кейс — да, для вымышленного или реального местного бренда (с разрешения владельца). Коммерческие заказы — только через взрослых.

---

## 5. Аудитория 2: образование — агенты и промпты

### 5.1. Тьютор-режимы вместо «дай ответ»

ChatGPT study mode, Gemini Guided Learning и Claude Learning mode ведут ученика вопросами, шагами и мини-тестами, а не выдают ответ сразу ([Dupple](https://dupple.com/learn/best-ai-education-tools), [Beginners in AI](https://beginnersinai.org/best-ai-for-studying/)). **[вторично]**

**Применение на курсе:** такой же «режим тьютора» встраивается в LLM-помощника платформы через системный промпт «не давай готовый ответ, задай 1 наводящий вопрос, проверь понимание». Модель — через kie (например Gemini или Claude по API), ключ на бэкенде.

### 5.2. NotebookLM и обучение по своим материалам

NotebookLM отвечает по загруженным источникам со ссылками. Ученики в Google Classroom могут собирать свои блокноты с 27.04.2026, но **только 18+ и только в вузах** ([Workspace Updates](https://workspaceupdates.googleblog.com/2026/04/students-can-now-create-personal-class-notebooks-with-NotebookLM-in-Google-Classroom.html?hl=de)). Новые форматы (кинематографичные Video Overviews, инфографика, слайды) с марта 2026 открыты только 18+, а карточки и квизы — всем ([Workspace Updates, 20.03.2026](https://workspaceupdates.googleblog.com/2026/03/new-ways-to-customize-and-interact-with-your-content-in-NotebookLM.html?hl=tr_TR)). **[проверено]**

**Для курса:** Сеня делает NotebookLM по материалам урока сам и показывает его, а участникам 18+ даёт ссылку. На своей платформе — простой RAG «спроси урок».

### 5.3. От промптов к контексту и «навыкам»

- **Context engineering:** сменили фокус с «волшебной фразы» на сборку контекста — что написать, что выбрать, что сжать, что изолировать (Write / Select / Compress / Isolate, по LangChain). Лучшие бесплатные гайды — от Anthropic и LangChain ([Scrimba](https://scrimba.com/articles/best-context-engineering-courses-and-tutorials-2026/)). **[вторично]**
- **Agent Skills (SKILL.md):** переносимые «инструкции-навыки» для агентов. Открытый стандарт с 18.12.2025, около 40 поддерживающих платформ к июню 2026; Codex, Copilot и Antigravity читают один формат ([Noqta](https://www.noqta.tn/en/news/skill-md-open-standard-30-ai-coding-tools-adoption-2026), [i-SCOOP](https://www.i-scoop.eu/agent-skills-agentic-ai-foundation/)). **[вторично]**
- **Gems и Opal (Google):** no-code мини-приложения из цепочки промптов прямо в Gemini; Gems можно назначать в Classroom ([TechCrunch](https://techcrunch.com/2025/12/17/googles-vibe-coding-tool-opal-comes-to-gemini), [Teaching Channel](https://www.teachingchannel.com/k12-hub/blog/top-teacher-tech-tools-for-2026/)). **[вторично]**

**Готовый шаблон промпта для подростков (карточка «РЦКОФП»):**

```
Роль: ты — {кто}.
Цель: мне нужно {что получить}.
Контекст: {для кого, где будет использовано, что уже есть}.
Ограничения: {длина, стиль, чего НЕ делать}.
Формат: {список / таблица / 3 варианта / JSON}.
Пример: {образец хорошего результата}.
Проверка: в конце задай мне 1 вопрос, если что-то неясно.
```

Для визуальных моделей та же логика превращается в карточку «Субъект — Действие — Место — Свет — Камера — Стиль — Запреты».

### 5.4. Агенты в обучении

Тренд: учитель становится «оркестратором», а агенты проверяют задания, подбирают упражнения и сигналят, кто застрял ([AI Indigo](https://aiindigo.com/blog/how-ai-is-transforming-education-in-2026-15)). **[вторично, прогнозный]**

**Для платформы курса:**

- тесты с автопроверкой (закрытые вопросы — кодом; открытые — LLM с рубрикой и обязательным показом рубрики ученику);
- «агент-наставник» в каждом уроке, который знает только материалы этого урока;
- агент-модератор для промптов генераций в безопасном режиме.

### 5.5. Вайбкодинг как учебный формат

| Инструмент | Что умеет в 2026 | Возраст | Для курса |
|---|---|---|---|
| **Google AI Studio (Build)** | Full-stack приложения, ключ Gemini как **серверный секрет**, Node.js-сервер, Firestore и Firebase Auth, деплой в Cloud Run без карты ([Google](https://ai.google.dev/gemini-api/docs/aistudio-build-mode), [Codelab](https://codelabs.developers.google.com/deploy-from-aistudio-to-run)) | **18+** ([Gemini API Terms](https://ai.google.dev/gemini-api/terms)) | Демо Сени; самостоятельно — только участники 18+ |
| Google Antigravity | Агентная IDE Google: несколько агентов параллельно, проверка приложения в браузере (обзоры 2026, например [Trio](https://trio.dev/vibe-coding-tools/)) **[вторично]** | вероятно 18+, как у других инструментов Google для разработчиков **[не проверено]** | Для 18+ |
| Lovable | Самый доступный конструктор приложений для не-программистов, со своим хостингом ([Fuzen](https://www.fuzen.io/posts/best-vibe-coding-tools-2026)); в обзорах отмечают минусы: безопасность и привязку к платформе **[вторично]** | **не проверено** | Демо |
| v0 (Vercel) | Компоненты и страницы на React + shadcn/ui + Tailwind, бэкенд — вручную ([MorphLLM](https://www.morphllm.com/best-vibe-coding-tools)) **[вторично]** | **не проверено** | Демо |
| Cursor / Claude Code | Профессиональные агентные инструменты в своём репозитории | Claude — 18+ ([ConductAtlas](https://conductatlas.com/platform/anthropic/claudeai-terms-of-service/minimum-age-and-coppa-compliance)) | Только для Сени и 18+ |
| Replit | Агент + хостинг | 13+, до 18 с согласия родителей (по трекеру условий от 05.08.2026: [ConductAtlas](https://conductatlas.com/change/2026-08-05-replit-replit-terms-of-service-4185/)) **[вторично]** | Вариант для 14–17 |

**Вывод для воркшопа 3:** программа сейчас обещает «вайбкодинг в Google AI Studio». Для подростков 14–17 это нарушение условий Google. Варианты:

- (a) Сеня ведёт AI Studio на своём экране, а группы диктуют промпты;
- (b) встроенный в платформу «конструктор бота» (шаблон + промпт-поля + серверный LLM через kie);
- (c) Replit с согласием родителей.

Лучше всего (a) + (b).

### 5.6. Безопасность подростков: что изменилось

- OpenAI: определение возраста (с 20.01.2026), при сомнении — опыт «до 18»; родительский контроль для 13–17 лет ([Help Net Security](https://www.helpnetsecurity.com/2026/01/21/chatgpt-age-prediction-teen-safety/), [NBC](https://www.nbcnewyork.com/news/national-international/chatgpt-new-parental-controls/6397845/)). **[проверено]**
- Meta: подростковые аккаунты Instagram на уровне PG-13, такие же правила для ИИ-чатов, родители могут отключить ИИ-персонажей ([TechCrunch](https://techcrunch.com/2025/10/14/instagram-defaults-to-pg-13-content-for-teens-adds-more-parental-controls/)). **[проверено]**
- Grok: расследования в ЕС, Великобритании и Ирландии из-за сексуализированных дипфейков, в том числе детей ([Al Jazeera](https://www.aljazeera.com/news/2026/1/26/eu-launches-probe-into-grok-ai-feature-creating-deepfakes-of-women-minors)). **Вывод:** модели `grok-imagine-*` в безопасный режим не включать. **[проверено]**
- Telegram: в ЕС, Великобритании и Австралии **до 18 лет создавать аккаунт нельзя** (с 07.01.2026 добавлена Австралия) ([Open Terms Archive](https://opentermsarchive.org/en/memos/telegram-expands-its-age-eligibility-requirement-to-australian-users/), [ConductAtlas](https://conductatlas.com/platform/telegram/telegram-terms-of-service/age-restriction-for-eu-uk-and-australia/)). Молдова не в ЕС; правило для неё **не проверено**. Для младших нужен веб-вариант без обязательного Telegram. **[вторично]**
- Gemini app: 13+ (в части стран 18+); переписки до 18 лет не идут в обучение моделей ([KidsAITools](https://www.kidsaitools.com/en/articles/is-gemini-safe-for-kids), [ConductAtlas](https://conductatlas.com/platform/google-gemini/gemini-apps-privacy-notice/age-restrictions-and-minor-protections/)). **[вторично]**

---

## 6. Аудитория 3: автоматизация и заработок

### 6.1. n8n как агентный хаб

**Что это.** Агент в n8n (LLM + инструменты + память) + MCP в обе стороны: агенты вызывают внешние MCP-серверы, а workflow n8n отдаются наружу как MCP-инструменты для Claude и других агентов. С весны 2026 через MCP можно ещё и **собирать workflow из описания** ([Infralovers](https://www.infralovers.com/blog/2026-03-09-n8n-agentic-mcp-hub/), [Growwstacks](https://growwstacks.com/blog/n8n-mcp-update-changes-everything/)). Номера версий в источниках расходятся. **[вторично]**

**Связка, которая уже есть у Сени:** n8n cloud + ключ kie + nano-banana. Расширение:

- одна под-workflow «генерация на kie» (createTask → ожидание по webhook или опросу recordInfo → сохранение результата) переиспользуется для любых моделей;
- её вызывает и бот, и платформа, и Claude по MCP.

**Шаблоны-основы:**

- [n8n.io #17875](https://n8n.io/workflows/17875): AI-новости с Hacker News → пересказ на русском через OpenRouter → Telegram;
- [n8n.io #19894](https://n8n.io/workflows/19894-qualify-inbound-leads-with-openai-google-sheets-and-telegram-alerts/): квалификация лидов (HOT / WARM / COLD) → Google Sheets → уведомление в Telegram;
- [Growwstacks](https://www.growwstacks.com/workflows/customer-support-and-lead-collection-chatbot-with-rag-gpt-4o-sheets-and-telegram): Telegram-бот поддержки + сбор лидов в Sheets.

### 6.2. Telegram в 2026: что нового для ботов и денег

- **Гостевые ИИ-боты:** бота можно упомянуть в любом чате, даже если его там нет. **Бот-к-боту:** боты отвечают друг другу (включается флагом). **Стриминг ответов** для всех ботов. **Автоответы:** пользователь может подключить бота отвечать от своего имени ([Telegram, 07.05.2026](https://telegram.org/blog/ai-bot-revolution-11-new-features)). **[проверено]**
- **Managed Bots:** бот может создавать других ботов и управлять ими. Это основа «конструктора ботов» для учеников ([ForkLog](https://forklog.com/en/telegram-introduces-ai-agent-builder/?hl=en-us)). **[вторично]**
- **Деньги:**
  - **50% выручки от официальной рекламы** в публичных каналах (от 1000 подписчиков);
  - **Stars** для цифровых товаров;
  - платные посты, реакции-звёзды, **платные подписки**;
  - вывод через Fragment и TON ([Telegram](https://telegram.org/blog/monetization-for-channels), [Telegram Stars](https://telegram.org/blog/telegram-stars), [Afaqs](https://afaqs.com/news/digital/telegram-introduces-paid-subscriptions-and-star-reactions-to-enhance-creator-revenue)). Комиссии по Stars в источниках расходятся. **[проверено]** для механик, **[не проверено]** для комиссий.

### 6.3. Telegram-бот для продаж: пайплайн воронки

```
Reels / пост (крючок + «напиши боту слово ХОЧУ»)
  → бот: приветствие + лид-магнит (мини-генерация / квиз / чек-лист)
  → квалификация: 3–5 вопросов (кто ты, задача, сроки, бюджет)
  → LLM-скоринг HOT / WARM / COLD → запись в CRM (Google Sheets / n8n Data Table / Notion)
  → HOT: кнопка «выбрать время» (Google Calendar) + уведомление Сене
  → WARM: цепочка 3 сообщения за 7 дней (кейсы, отзыв, оффер)
  → оплата: ссылка на счёт / Stars (для цифровых товаров) → доступ к платформе
```

**Модели и стоимость:** LLM-ответы стоят доли цента. Генерация-подарок (картинка Nano Banana 2) — 8★. Себестоимость воронки на 100 лидов — несколько долларов (оценка). Самое дорогое здесь — время на тексты и контент.

**Подросткам:** на воркшопе 4 собирают **развлекательный** бот (квиз «какой ты фрукт из нашей драмы» + генерация открытки) и таблицу «лидов». Реальные платежи и персональные данные посторонних — нет.

### 6.4. ИИ-новостной канал (основа для «Сияй-сияй»)

**Пайплайн:**

1. **Сбор (n8n Schedule, 2–3 раза в день).** RSS официальных блогов (Google, OpenAI, Anthropic, Kling, ByteDance Seed, Suno), The Decoder, TechCrunch AI, Hugging Face blog, а также публичные Telegram-каналы через веб-превью `t.me/s/<канал>` или RSS-мост. Читать чужие каналы через Bot API нельзя: нужен либо RSS-мост, либо пользовательский клиент MTProto, а это серая зона условий Telegram.
2. **Дедупликация и фильтр.** LLM ставит оценку «интересно для креаторов и бизнеса» от 0 до 10.
3. **Пересказ на русском.** Своими словами, 400–700 знаков, «что это → зачем тебе → как попробовать», ссылка на источник. Целые посты и чужие медиа не копируются.
4. **Обложка.** Nano Banana 2 или GPT Image 2.5 в фирменном стиле канала (8★).
5. **Модерация.** Сеня получает черновик в личку с кнопками «Опубликовать / Править / Отклонить». Человеческая проверка — это и качество, и юридический плюс: по статье 50(4) AI Act ИИ-текст о делах, важных для общества, не нужно помечать, если он прошёл человеческую редакторскую проверку и есть ответственный редактор ([artificialintelligenceact.eu](https://artificialintelligenceact.eu/?p=6131), [Sza](https://www.sza.de/en/thinktank/ai-labelling)). **[проверено]**
6. **Публикация и аналитика.** Раз в неделю — дайджест и 1 Reels «новость недели» через говорящего маскота.

**Русскоязычные ИИ-каналы как ориентир и источники** (статистику проверить вручную): «Denis Sexy IT», «эйай ньюз», «GPTMain News», «Machinelearning», «Марти | Нейросети» ([Timeweb](https://timeweb.com/ru/community/articles/top-10-telegram-kanalov-po-neyrosetyam), [Kod.ru](https://kod.ru/top-10-kanalov-pro-it-v-telegram/), [Tproger](https://tproger.ru/articles/7-rossijskih-telegram-kanalov-pro-ii-i-promting)). **[вторично]**

**Стоимость в месяц:** ~60–90 постов × (LLM + обложка 8★) ≈ 600–900★ ($3–4,5) + n8n.

### 6.5. Заработок: что реально, а что хайп

- **Реально:**
  - пакеты контента для малого бизнеса (тренд 10);
  - Telegram-боты «запись + FAQ + квалификация» для локальных услуг;
  - ИИ-фотосессии товаров;
  - нарезка и монтаж видео для экспертов;
  - обучение команд (это сильная сторона Сени).
- **Хайп:** «ИИ-инфлюенсер приносит миллионы». Проверяемых данных о доходах ИИ-персонажей в 2026 нет; таблицы «сколько заработаешь за 3/6/12 месяцев» — оценки продавцов курсов ([CreatorFlow](https://creatorflow.so/blog/how-ai-influencers-make-money/)). **[проверено, что данных нет]**

---

## 7. Безопасная адаптация для 14–17: общий чек-лист для платформы

Это не архитектура (её разбирают отдельно), а требования, которые вытекают из трендов.

1. **Ключ kie только на сервере.** Отдельный суб-ключ для курса с лимитом в день и на весь срок и белым списком IP сервера ([kie docs](https://docs.kie.ai/1973359m0.md)). Свой учёт звёзд: «резерв → списание по факту `creditsConsumed` → возврат при ошибке» ([yan-labs, kie.md](https://raw.githubusercontent.com/yan-labs/yan-skills/HEAD/rankup/references/integrations/kie.md)).
2. **Белый список моделей по режимам.** Безопасный режим — без `grok-imagine-*`, без `wan/2-2-animate-replace` с загруженным видео и без `volcengine/video-to-video-lip-sync` поверх чужих видео.
3. **Запрет загрузки фото людей** в безопасном режиме. Референсы — только картинки, созданные на платформе, или проверенная библиотека: драйверы движений, фоны, предметы.
4. **Модерация промптов.** LLM-фильтр + стоп-лист: имена реальных людей и знаменитостей, «реалистичное фото», сексуализация, насилие, буллинг. Отказ сопровождается объяснением «почему» — это часть урока.
5. **Видимая метка «Сделано ИИ»** на всех видео и картинках, которые скачиваются с платформы. Это соответствует логике статьи 50 AI Act и правилам Instagram и TikTok.
6. **Без клонирования голоса.** Только стоковые и «дизайнерские» голоса.
7. **Публикация только через общий аккаунт клуба**, без личных аккаунтов участников.
8. **Согласие родителей** — одна форма на курс: Suno 13+ с согласием, CapCut 13+ с согласием, запись своего видео-драйвера.
9. **Результаты kie сразу копируются в своё хранилище**, у исходников короткий срок хранения.
10. **Логи генераций** доступны Сене: кто, что и когда сгенерировал. Это защита и от злоупотреблений, и от споров о звёздах.

---

## 8. Топ-7 пайплайнов для курса

Привязка к четырём воркшопам; стоимость в звёздах (1★ = 1 кредит kie ≈ $0,005).

### П1. «Промпт-тренажёр и личный учебный агент» (воркшоп 1)

- **Шаги:**
  1. Карточка промпта РЦКОФП (раздел 5.3).
  2. Одна и та же задача тремя промптами: плохой, средний, хороший. Сравнение.
  3. Свой «агент-помощник по учёбе»: системный промпт в режиме тьютора.
  4. Проверка: агент задаёт вопросы по теме.
- **Модели:** LLM через kie (Gemini или Claude по API) на бэкенде платформы.
- **Стоимость:** ~20–50★ на человека.
- **Подросткам:** да. Именно поэтому LLM работает через платформу, а не через личные аккаунты Claude (18+).

### П2. «Персонаж клуба по character sheet» (воркшоп 2)

- **Шаги:**
  1. Паспорт персонажа (LLM).
  2. 4 варианта на Nano Banana 2.
  3. Character sheet на Nano Banana Pro.
  4. 3 сцены по референсу.
  5. Пост с ярлыком AI.
- **Модели:** `nano-banana-2` или `seedream/5-lite-*` → `nano-banana-pro` → `nano-banana-2`.
- **Стоимость:** ≈ 60–110★.
- **Подросткам:** да, персонажи стилизованные; загрузка фото людей отключена.

### П3. «Танцующий персонаж» — motion control (воркшоп 2)

- **Шаги:**
  1. Персонаж в полный рост (из П2).
  2. Драйвер на 5 с из библиотеки клуба (или свой с согласием родителей).
  3. `kling-3.0/motion-control`, 720p.
  4. CapCut: трендовый звук и подписи.
- **Модели:** `kling-3.0/motion-control`; дешевле — `kling-2.6/motion-control` (цену проверить).
- **Стоимость:** ≈ 100★ за 5 с (+ 1 повтор = 200★).
- **Подросткам:** да; *Replace* реальных людей запрещён.

### П4. «Говорящий маскот-ведущий» (воркшоп 2)

- **Шаги:**
  1. Сценарий на 20–30 с (LLM).
  2. TTS со стоковым голосом.
  3. `infinitalk/from-audio` на портрете персонажа.
  4. Субтитры и B-roll.
- **Модели:** `elevenlabs/text-to-speech-multilingual-v2` → `infinitalk/from-audio` (480p).
- **Стоимость:** ≈ 70–100★.
- **Подросткам:** да, только сгенерированные лица.

### П5. «ИИ-микродрама из 3 серий + саундтрек» (воркшопы 2 и 4)

- **Шаги:**
  1. Мини-группа пишет «фруктовую мыльную оперу» (LLM помогает с клиффхэнгером).
  2. Персонажи-фрукты (Nano Banana 2).
  3. 3 сцены по 5 с.
  4. Диалоги в TTS (2 голоса).
  5. Саундтрек в Suno.
  6. Монтаж в CapCut.
  7. Показ в конце занятия.
- **Модели:** `nano-banana-2` → `minimax-h3/reference-to-video` или `bytedance/seedance-2-mini` (720p) → TTS → Suno.
- **Стоимость:** ≈ 170–250★ на группу из 3–4 человек.
- **Подросткам:** **лучший формат курса** — смешно, вирусно, без реальных лиц, работа в команде.

### П6. «Свой Telegram-бот с ИИ» (воркшоп 3)

- **Шаги:**
  1. Сеня показывает вайбкодинг в Google AI Studio на своём экране (серверные секреты, Firebase).
  2. Участники собирают своего бота в «конструкторе» платформы: имя, характер (системный промпт), 3 команды, одна из которых — генерация картинки.
  3. Бот работает через бэкенд платформы, ключи у участников не появляются.
  4. Для 18+: репозиторий на GitHub и деплой на Vercel как бонус.
- **Модели:** LLM + `nano-banana-2-lite` или `z-image` для картинок в боте.
- **Стоимость:** ≈ 50–100★.
- **Подросткам:** да, в конструкторе. Google AI Studio и Claude — только демо (18+). Telegram в ЕС до 18 лет запрещён, поэтому для Молдовы правило нужно проверить и предусмотреть веб-чат как замену.

### П7. «Мини-воронка: Reels → канал → бот → CRM» (воркшоп 4)

- **Шаги:**
  1. Reels персонажа или микродрамы с призывом «напиши боту ФРУКТ».
  2. Telegram-канал проекта (учебный).
  3. Развлекательный бот: квиз «какой ты фрукт» + открытка-генерация.
  4. Ответы пишутся в Google Sheets или Data Table в n8n как «CRM».
  5. Разбор: где реклама, где Stars, где платная подписка, как это превращается в заработок.
- **Модели:** готовые ассеты П2–П5 + LLM + `nano-banana-2-lite`.
- **Стоимость:** ≈ 50–150★.
- **Подросткам:** да, без настоящих платежей и чужих персональных данных.

**Итого на участника:** ≈ 500–900★, лимит 1000★ разумен.

---

## 9. Топ-5 идей «машины контента» для бренда Сени

### 1. «Сияй-сияй» — ИИ-новости на русском с редактором-человеком

- **Пайплайн:** раздел 6.4 — n8n (RSS и каналы) → скоринг → пересказ → обложка → **одобрение Сени кнопкой** → пост.
- **Ритм:** пятничный дайджест и одни «Reels недели» через маскота.
- **Плюсы:** регулярность без ручного труда; юридически чище, потому что есть человеческая редактура.
- **Деньги:** при 1000+ подписчиков — реклама Telegram (50%); затем платная подписка «промпты недели».
- **Себестоимость:** ~$3–5 в месяц на генерации.

### 2. Цифровой двойник Сени на четырёх языках (RU / EN / DE / UA)

- **Пайплайн:** один сценарий → LLM-перевод и адаптация → **свой** голос (клон PVC в собственном аккаунте ElevenLabs — разрешённый случай) → аватар (Kling Avatar Pro или InfiniteTalk 720p, или HeyGen для переводов) → видео для сайта и соцсетей.
- **Метка:** обязательно «ИИ-аватар» (статья 50 AI Act).
- **Себестоимость:** ≈ 30 с × 4 языка ≈ $3–8.
- **Зачем:** сайт на четырёх языках получает видео без четырёх съёмок.

### 3. Фабрика нарезок с воркшопов

- **Пайплайн:** запись Zoom (с согласия участников, лица — только с разрешения) → транскрипт → агент выбирает 5 «золотых» моментов → Descript (Underlord) или CapCut → вертикальные клипы с субтитрами на четырёх языках → сайт (раздел «видео-нарезки работ»), Reels, Shorts, LinkedIn.
- **Отдельная серия:** «до/после» работ участников, где показывается ИИ-контент, а не дети.
- **Зачем:** главный актив Сени — живые воркшопы, и машина превращает каждый в 5–10 единиц контента.

### 4. Маскот бренда и ИИ-сериал «Сияйка объясняет ИИ»

- **Пайплайн:** персонаж-маскот (П2) → еженедельная серия на 30–45 с: маскот объясняет один инструмент (InfiniteTalk) + танцевальные и трендовые эпизоды на движениях Сени (П3) + раз в месяц «кинематографичная» серия на Kling 4.0 или Seedance 2.0 (опыт Machine Cinema).
- **Каналы:** кросс-пост в Instagram, TikTok, YouTube и Telegram.
- **Метка:** ярлык «AI-generated» на контенте маскота. Сам Сеня остаётся реальным лицом бренда.
- **Себестоимость:** ≈ $2–5 за серию, за флагманскую — $5–15.

### 5. B2B-контент и бот-диагностика для Mittelstand

- **Пайплайн:**
  1. Обезличенные кейсы 48 компаний → LLM → посты и карусели для LinkedIn и Instagram (GPT Image 2.5 или Nano Banana Pro для инфографики с текстом на немецком и английском).
  2. Telegram-бот или веб-бот «Какая автоматизация нужна вашей компании?»: 7 вопросов → LLM-отчёт на одну страницу (PDF) → запись в CRM (n8n) → слот в Google Calendar.
  3. Раз в неделю — «разбор автоматизации» в формате короткого видео.
- **Зачем:** самый прямой путь к деньгам — корпоративные группы по цифровой трансформации.

---

## 10. Риски

- **Цены kie нестабильны.** В снимке от 04.10.2026 часть цен (Seedance Mini и Fast) — акция до 07.10; после неё цена «не опубликована». Курс нужно планировать с запасом в 30–50% и пересчётом звёзд перед стартом.
- **Модели исчезают и меняются.** Nano Banana 2 в API Google выводится 29.10.2026, Sora закрыта, Suno выводит старые модели. Белый список моделей на платформе нужно делать **настраиваемым** (в `content/config.ts` или в базе), а не зашитым в код.
- **Возрастные ограничения:** Google AI Studio и Gemini API 18+, Claude 18+, Telegram до 18 в ЕС запрещён, NotebookLM ограничен 18+ для новых функций. Обещания на сайте («вайбкодинг в AI Studio» для всех) стоит переформулировать.
- **Дипфейки и буллинг** — главный риск с подростками: motion control, lip-sync и *Replace* на фото одноклассников. Нужны технический запрет и урок этики.
- **Права на музыку и стили.** Коммерческие права на треки Suno через посредника не подтверждены. Копирование стиля чужих франшиз попадает под фильтры моделей и создаёт юридические риски.
- **Платформенные санкции:** неотмеченный ИИ-профиль в Instagram теряет охват; конвейерный «slop» на YouTube не монетизируется.
- **Данные детей у третьих сторон.** Видео-драйверы и голоса уходят в kie и дальше к провайдеру модели (Kling, ByteDance). Нужны согласие родителей и минимизация загрузок.
- **Достоверность этого отчёта:** kie.ai и Reddit были недоступны; часть цифр — из вендорских блогов.

---

## 11. Решения и данные, которые может дать только Сеня

1. **Курс звёзд:** 1★ = 1 кредит kie (≈ $0,005) или с наценкой и резервом? Оставить ли 1000★ на человека и резерв ~$25–50 на свои демо?
2. **Возрастная политика:** пускать ли 14–15-летних в motion control со своим видео (с согласием родителей) или только с библиотекой клипов Сени?
3. **Воркшоп 3:** готов ли Сеня заменить «вайбкодинг в AI Studio для всех» на «демо Сени + конструктор ботов на платформе»? Нужен ли вариант с Replit (13+ с согласием)?
4. **Telegram для молдавских подростков:** проверить условия Telegram для Молдовы и решить, нужен ли веб-чат на платформе вместо бота для младших.
5. **Клонировать ли свой голос и делать ли аватар-двойника** для бренда? Это согласие Сени и вопрос стиля бренда.
6. **Источники для «Сияй-сияй»:** список любимых каналов и сайтов Сени, тон канала, частота, кто нажимает «Опубликовать».
7. **Higgsfield или ElevenLabs напрямую** для бренда (в окружении Сени эти коннекторы уже подключены) или всё через kie?
8. **Лицензия Suno:** нужен ли свой тариф Pro или Premier для коммерческого использования треков в бренде?
9. **Доступ к kie:** разрешить хосты `kie.ai` и `docs.kie.ai` в сетевых настройках следующей сессии, чтобы снять актуальный прайс через публичный эндпоинт `POST https://api.kie.ai/client/v1/model-pricing/page` и проверить модели (Kling 4.0, Nano Banana 2.1, Suno v6) напрямую.

---

## 12. Основные источники

**Каталоги и цены kie.ai (снимки на GitHub):**

- [mvanhorn/printing-press-library — каталог Market kie (122 модели)](https://raw.githubusercontent.com/mvanhorn/printing-press-library/HEAD/library/ai/kie/docs/MODELS.md)
- [yan-labs/yan-skills — модели и цены kie от 04.10.2026](https://raw.githubusercontent.com/yan-labs/yan-skills/HEAD/rankup/references/integrations/kie-models.md) и [заметки по интеграции](https://raw.githubusercontent.com/yan-labs/yan-skills/HEAD/rankup/references/integrations/kie.md)
- [nodetool — genspend-pricing.json (цены от 26.10.2026)](https://raw.githubusercontent.com/nodetool-ai/nodetool/HEAD/packages/model-pricing/src/generated/genspend-pricing.json)
- [ComfyUI-Kie-API — README](https://raw.githubusercontent.com/gateway/ComfyUI-Kie-API/HEAD/README.md) и [спецификация Kling 3.0 Motion Control](https://raw.githubusercontent.com/gateway/ComfyUI-Kie-API/HEAD/web/docs/KIE_Kling3_Motion_I2V_Spec.md)
- [kie docs — Getting Started (лимиты ключа, белый список IP)](https://docs.kie.ai/1973359m0.md)

**Модели:**

- Nano Banana Pro: [eWeek](https://www.eweek.com/news/google-nano-banana-pro-release/); Nano Banana 2.1: [TechNews.tw](https://technews.tw/2026/10/07/google-nano-banana-2-1/), [Artlist](https://artlist.io/blog/nano-banana-2-1-what-changed/)
- Seedream 5.0: [OpenRouter](https://openrouter.ai/bytedance-seed/seedream-5-0-pro-20260812), [MindStudio](https://www.mindstudio.ai/models/seedream-v5-0-lite)
- Kling 4.0: [пресс-релиз](https://finance.yahoo.com/technology/ai/articles/kling-ai-launches-kling-4-105300062.html), [Atlas Cloud](https://www.atlascloud.ai/blog/tips/kling-4-flash-vs-full); Kling Motion Control: [Kling, гид](https://kling.ai/quickstart/motion-control-user-guide), [Kling, блог](https://kling.ai/blog/ai-motion-transfer-video-tutorial)
- Seedance 2.0: [arXiv 2604.14148](https://arxiv.org/pdf/2604.14148); Seedance 2.5: [Tosea](https://tosea.ai/blog/seedance-2-5-bytedance-ai-video-model-guide); ограничения: [Videomaker](https://www.videomaker.com/news/bytedance-agrees-to-restrict-seedance-after-disney-threatens-legal-action/)
- Wan-Animate: [arXiv 2509.14055](https://arxiv.org/abs/2509.14055v1), [ComfyUI](https://comfy.org/workflows/use-cases/ai-character-replacement/)
- Veo и Gemini Omni: [PixVerse — Veo 4](https://pixverse.ai/en/blog/veo-4-release), [Atlas Cloud — Gemini Omni](https://www.atlascloud.ai/blog/ai-updates/google-gemini-omni-conversational-video-editing)
- Sora закрыта: [Qustodio](https://www.qustodio.com/en/blog/is-sora-2-safe-for-kids/)
- Аватары: [PiAPI](https://piapi.ai/en/blogs/omnihuman-1-5-vs-kling-ai-avatar), [Pixverse — обзор](https://pixverse.ai/en/blog/best-ai-avatar-video-generator-2026)
- Suno: [v6](https://suno.com/blog/introducing-v6), [v5.5](https://suno.com/release-notes/introducing-v5-5-voices-custom-models-and-my-taste), [Terms](https://suno.com/legal/terms)
- Монтаж: [CapCut × Seedance](https://www.capcut.com/newsroom/dreamina-seedance-2), [Descript Underlord](https://www.descript.com/blog/article/underlord-ai-can-watch-videos)

**Платформы и право:**

- Instagram: [TechCrunch — ярлык AI-generated profile](https://techcrunch.com/2026/08/31/instagram-puts-new-limits-on-undisclosed-ai-profiles/), [TechCrunch — PG-13](https://techcrunch.com/2025/10/14/instagram-defaults-to-pg-13-content-for-teens-adds-more-parental-controls/)
- YouTube: [TechCrunch](https://techcrunch.com/2026/07/20/youtube-clarifies-policies-around-ai-slop-and-upsetting-videos/)
- TikTok AIGC: [Daily Mirror LK](https://www.dailymirror.lk/print/business-news/TikTok-announces-updates-designed-to-increase-transparency-around-AIGC/273-327699)
- EU AI Act, статья 50: [artificialintelligenceact.eu](https://artificialintelligenceact.eu/?p=6131), [SRD](https://www.srd-rechtsanwaelte.de/en/blog/deepfake-labelling-under-the-ai-act-what-the-new-eu-guidance-clarifies), [Lewis Silkin](https://www.lewissilkin.com/insights/2026/07/31/the-new-ai-labelling-rules-for-deployers-in-the-advertising-supply-chain)
- Дания: [Euronews](https://www.euronews.com/2026/10/08/denmark-introduces-a-bill-protecting-peoples-faces-and-voices-from-deepfakes)
- Grok: [Al Jazeera](https://www.aljazeera.com/news/2026/1/26/eu-launches-probe-into-grok-ai-feature-creating-deepfakes-of-women-minors)
- ElevenLabs и согласие: [Terms.law](https://terms.law/ai-output-rights/elevenlabs/), [ConductAtlas](https://conductatlas.com/platform/elevenlabs/elevenlabs-usage-policy/voice-cloning-without-consent-prohibition/)

**Образование и вайбкодинг:**

- [Google AI Studio Build](https://ai.google.dev/gemini-api/docs/aistudio-build-mode), [Gemini API Terms (18+)](https://ai.google.dev/gemini-api/terms)
- NotebookLM: [Workspace Updates, апрель 2026](https://workspaceupdates.googleblog.com/2026/04/students-can-now-create-personal-class-notebooks-with-NotebookLM-in-Google-Classroom.html?hl=de), [Workspace Updates, март 2026](https://workspaceupdates.googleblog.com/2026/03/new-ways-to-customize-and-interact-with-your-content-in-NotebookLM.html?hl=tr_TR)
- OpenAI, возраст: [Help Net Security](https://www.helpnetsecurity.com/2026/01/21/chatgpt-age-prediction-teen-safety/); Claude 18+: [ConductAtlas](https://conductatlas.com/platform/anthropic/claudeai-terms-of-service/minimum-age-and-coppa-compliance)
- Agent Skills: [Noqta](https://www.noqta.tn/en/news/skill-md-open-standard-30-ai-coding-tools-adoption-2026); context engineering: [Scrimba](https://scrimba.com/articles/best-context-engineering-courses-and-tutorials-2026/)
- Вайбкодинг: [MorphLLM](https://www.morphllm.com/best-vibe-coding-tools), [Replit, возраст](https://conductatlas.com/change/2026-08-05-replit-replit-terms-of-service-4185/)

**Автоматизация и Telegram:**

- Telegram: [ИИ-боты, 07.05.2026](https://telegram.org/blog/ai-bot-revolution-11-new-features), [монетизация каналов](https://telegram.org/blog/monetization-for-channels), [Stars](https://telegram.org/blog/telegram-stars), [возраст в ЕС](https://opentermsarchive.org/en/memos/telegram-expands-its-age-eligibility-requirement-to-australian-users/)
- n8n: [Infralovers — MCP-хаб](https://www.infralovers.com/blog/2026-03-09-n8n-agentic-mcp-hub/), шаблоны [#17875](https://n8n.io/workflows/17875) и [#19894](https://n8n.io/workflows/19894-qualify-inbound-leads-with-openai-google-sheets-and-telegram-alerts/)

**Форматы:**

- [OpusClip — 17 стилей](https://www.opus.pro/blog/viral-ai-video-styles-2026), [Videosi — тренды недели](https://videosi.io/trending), [viral.app — 3,3 млн видео](https://viral.app/blog/insights/short-form-video-trends), [CGTN — микродрамы](https://news.cgtn.com/news/2026-03-20/AI-Influence-Pet-and-fruit-microdramas-take-the-internet-by-storm-1LEUvn7BBOE/share_amp.html), [SocialPeta](https://socialpeta.com/en/blog/short-drama-weekly-ranking-43k-titles-compete-as-ai-dramas-rise-and-fruit-themed-melodramas-expand-globally)
