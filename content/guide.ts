// ─────────────────────────────────────────────────────────────
//  КИНОШПАРГАЛКА: СВЕТ, КАДР, КАМЕРА
//  Методичка для учеников после урока 2 (/app/guide).
//  Страница только показывает эти данные. Меняйте текст в кавычках.
//  Английские фразы в { en: "…" } получают кнопку «копировать».
//  Правила курса: без слова на «Библ…», у ИИ «характер», без реальных людей,
//  примеры только дружелюбные (праздники, еда, события центра).
// ─────────────────────────────────────────────────────────────

/** Ячейка таблицы: русский текст или английская фраза с кнопкой копирования. */
export type GuideCell = string | { en: string };

export type GuideTable = {
  /** Подпись таблицы для экранных чтецов и печати. */
  caption: string;
  columns: string[];
  /** Первая ячейка каждой строки — заголовок строки (<th scope="row">). */
  rows: GuideCell[][];
};

export type GuideStep = { title: string; text: string; en?: string };

export type GuideResource = {
  name: string;
  url: string;
  what: string;
  cost: string;
  note?: string;
};

export type GuideRecipe = {
  title: string;
  /** Что даёт рецепт — одна строка по-русски. */
  gives: string;
  prompt: string;
};

export type GuideBlock =
  | { kind: "text"; text: string }
  | { kind: "note"; title?: string; text: string; tone?: "info" | "warn" }
  | { kind: "steps"; title: string; steps: GuideStep[] }
  | { kind: "example"; title: string; text: string; en: string }
  | { kind: "table"; table: GuideTable }
  | { kind: "rules"; items: GuideStep[] }
  | { kind: "checklist"; items: string[] }
  | { kind: "resources"; items: GuideResource[] }
  | { kind: "recipes"; title: string; items: GuideRecipe[] };

export type GuideSection = {
  /** Якорь раздела: /app/guide#light */
  id: string;
  title: string;
  /** Короткая строка для оглавления. */
  short: string;
  blocks: GuideBlock[];
};

export const guideMeta = {
  title: "Киношпаргалка: свет, кадр, камера",
  eyebrow: "Методичка · уроки 2 и 3",
  lead:
    "Свет, планы, ракурсы и движение камеры — коротко и с готовыми английскими фразами. " +
    "Нажми на фразу, чтобы скопировать её в промпт.",
};

export const guideSections: GuideSection[] = [
  {
    id: "formula",
    title: "Формула промпта",
    short: "Формула промпта для кадра и для видео",
    blocks: [
      {
        kind: "note",
        title: "Думай по-русски, пиши по-английски",
        text:
          "Nano Banana, Seedance и Kling учились в основном на английских подписях к картинкам и видео. " +
          "Слова про свет и камеру они понимают по-английски точнее. Поэтому идею и раскадровку держи по-русски, " +
          "а в промпт клади английский текст. Можно попросить ИИ в чате перевести твой блок — как в задании 1 урока 2.",
      },
      {
        kind: "note",
        title: "Кадр — это поза, видео — это движение",
        text:
          "Кадр — неподвижная картинка и первый кадр клипа. В нём пиши позу: «стоит вполоборота», «держит книгу». " +
          "Движение героя и движение камеры уходят в промпт видео: «поворачивается к камере», «камера медленно наезжает».",
      },
      {
        kind: "steps",
        title: "Формула промпта для кадра",
        steps: [
          { title: "Кто в кадре", text: "Имя героя и 3–4 главные черты. Каждый раз одинаково.", en: "Ari, a cheerful cartoon boy with a small blue kippah" },
          { title: "Что делает", text: "Поза и эмоция. Без движения.", en: "sits on a stool, smiling at the viewer" },
          { title: "План", text: "Как близко: общий, по пояс, крупный.", en: "medium shot" },
          { title: "Ракурс", text: "Откуда смотрит камера: на уровне глаз, сверху, снизу.", en: "eye level" },
          { title: "Объектив", text: "Широкий угол, обычный, телеобъектив, размытый фон.", en: "35mm lens, shallow depth of field" },
          { title: "Свет", text: "Откуда и какой: тёплый от свечей, дневной мягкий.", en: "warm candlelight from the left" },
          { title: "Цвет и настроение", text: "2–3 цвета и одно слово про настроение.", en: "deep blue and warm gold, cozy mood" },
          { title: "Стиль", text: "Один на весь ролик.", en: "3D animated film style" },
          { title: "Что не меняется", text: "Герой как на листе, формат, без текста.", en: "the character exactly as on the sheet, vertical 9:16, no text" },
        ],
      },
      {
        kind: "example",
        title: "Пример кадра",
        text: "Рассказчик Ари перед ханукальной историей. Лист персонажа приложен в «Правке картинки».",
        en:
          "ONE single scene, not a reference sheet. Ari, a cheerful cartoon boy storyteller with curly brown hair, " +
          "a small blue kippah, round glasses and a yellow scarf, sits on a wooden stool holding an open storybook " +
          "and smiles warmly at the viewer. Medium shot, eye level, 35mm lens, shallow depth of field. Warm candlelight " +
          "from a Hanukkah menorah on the left, blue evening twilight outside the window. Color palette: deep blue, " +
          "warm gold and cream, cozy mood. 3D animated film style. The character exactly as on the sheet. Vertical 9:16, no text.",
      },
      {
        kind: "steps",
        title: "Формула промпта для видео (режим «Из кадра»)",
        steps: [
          { title: "Герой и одно действие", text: "Одно простое движение за 5 секунд. Начинается из позы кадра.", en: "Ari slowly closes the storybook and looks up" },
          { title: "Одно движение камеры", text: "Ровно одно: статика, наезд, отъезд, панорама…", en: "slow push-in" },
          { title: "Темп", text: "Медленно и плавно — так меньше ошибок.", en: "slow and smooth" },
          { title: "Живые детали", text: "Что ещё шевелится: огоньки, пар, снег.", en: "candle flames flicker gently" },
          { title: "Что не меняется", text: "План, свет и стиль уже в кадре. Не переписывай их по-другому — иначе модель «переснимет» сцену.", en: "keep the character, outfit, place and style exactly as in the frame" },
          { title: "Один план, без слов", text: "Один непрерывный кадр, рот закрыт, без текста.", en: "one continuous 5-second shot, mouth closed, no talking, no text" },
        ],
      },
      {
        kind: "example",
        title: "Пример видео",
        text: "Клип из кадра с Ари: книга закрывается, камера подъезжает к лицу.",
        en:
          "Animate this frame. Ari slowly closes the storybook, looks up and smiles at the viewer. Slow push-in from " +
          "medium shot to close-up. Candle flames flicker gently, the warm light stays the same. One continuous 5-second " +
          "shot, slow and smooth. His mouth stays closed, no talking. Keep Ari, his outfit, the room and the style exactly " +
          "as in the frame. No text, no subtitles.",
      },
    ],
  },
  {
    id: "light",
    title: "Свет",
    short: "20 видов света и их настроение",
    blocks: [
      {
        kind: "text",
        text:
          "Свет решает настроение раньше, чем зритель разглядит героя. Выбери один свет на сцену и держи его во всех кадрах этой сцены.",
      },
      {
        kind: "table",
        table: {
          caption: "Виды света",
          columns: ["Свет", "Что делает с настроением", "Когда брать", "Фраза для промпта"],
          rows: [
            ["Тёплый", "Уют, радость, дом", "Праздник, кухня, вечер с семьёй", { en: "warm cozy lighting, soft orange glow" }],
            ["Холодный", "Спокойствие, свежесть, порядок", "Зима, раннее утро, студия новостей", { en: "cool bluish lighting, crisp clean light" }],
            ["Дневной мягкий", "Естественно и легко", "Двор центра днём, репортаж", { en: "soft natural daylight, overcast sky, gentle shadows" }],
            ["Золотой час", "Тепло и мечтательно, «как в кино»", "Прогулка, финал, приглашение", { en: "golden hour sunlight, low warm sun, long soft shadows" }],
            ["Синий час, сумерки", "Тишина, ожидание чуда", "Перед праздником, зажигаются огни", { en: "blue hour twilight, deep blue sky, warm lights in the windows" }],
            ["Ночной", "Тихо и загадочно", "Ночная улица, свечи в окне", { en: "calm night scene, soft moonlight and warm street lamps" }],
            ["Контровой: силуэт, ореол", "Эффектно и торжественно", "Герой на фоне окна или заката, финал", { en: "backlit, glowing rim light around the hair and shoulders" }],
            ["Боковой", "Объём и характер", "Портрет, серьёзный момент", { en: "soft side lighting from the left, half of the face in gentle shadow" }],
            ["Верхний", "Свет сцены, «софит»", "Выступление, лампа над столом", { en: "top light from a single lamp above the table" }],
            ["Нижний", "Необычно. Легко делает лицо страшным", "Только мягкий и тёплый: рассказ у свечей", { en: "soft warm glow from candles below the face" }],
            ["Свечи, огонь", "Тепло, праздник, традиция", "Ханука, свечи на столе", { en: "warm flickering candlelight, glow of Hanukkah candles" }],
            ["Неон", "Молодо, современно, энергично", "«770 NEWS», вечеринка центра", { en: "colorful neon signs, pink and teal glow" }],
            ["Красный цветной", "Энергия, внимание, праздник", "Акцент, сцена, яркая реклама", { en: "red colored stage light, warm red glow" }],
            ["Синий цветной", "Спокойно, ночь, мечта", "Студия, вечерний рассказ", { en: "blue colored light, cool blue glow" }],
            ["Жёсткий", "Бодро, контрастно, чёткие тени", "Солнечный день, динамичная реклама", { en: "hard direct sunlight, crisp sharp shadows" }],
            ["Мягкий", "Нежно и дружелюбно", "Портрет, интервью, детский герой", { en: "soft diffused light, gentle shadows" }],
            ["Туман и лучи", "Волшебство, торжественность", "Утро в зале, свет из окна", { en: "light haze, visible rays of light through the window" }],
            ["High-key", "Светло, легко, позитивно", "Реклама, кухня, детская тема", { en: "high-key lighting, bright and airy, almost no shadows" }],
            ["Low-key", "Серьёзно, загадочно", "Вечерний рассказ, кульминация", { en: "low-key lighting, dark background, one soft light on the face" }],
            ["Студийный", "Аккуратно, «как в новостях»", "Ведущий «770 NEWS»", { en: "professional three-point studio lighting, soft key light" }],
          ],
        },
      },
    ],
  },
  {
    id: "shots",
    title: "Планы",
    short: "Крупность: от дальнего до детали",
    blocks: [
      {
        kind: "text",
        text:
          "План — это насколько близко камера к герою. Соседние клипы снимай разными планами: общий → средний → крупный. Так ролик выглядит смонтированным, а не «одним и тем же».",
      },
      {
        kind: "table",
        table: {
          caption: "Планы (крупность)",
          columns: ["План", "Что видно", "Зачем", "Фраза для промпта"],
          rows: [
            ["Дальний", "Герой маленький, вокруг большое место", "Показать, где мы: улица, двор, зал", { en: "extreme wide shot, a tiny figure in a big space" }],
            ["Общий", "Герой целиком, с головы до ног, и место", "Первая сцена, движение всем телом", { en: "wide shot, full body visible from head to toe" }],
            ["Средне-общий, по колено", "От колен и выше", "Разговор, жесты, двое рядом", { en: "medium wide shot, framed from the knees up" }],
            ["Средний, по пояс", "От пояса и выше", "Ведущий, рассказ с жестами", { en: "medium shot, framed from the waist up" }],
            ["Портрет, по грудь", "Голова и плечи", "Реплика, эмоция", { en: "medium close-up, head and shoulders" }],
            ["Крупный", "Лицо целиком", "Реакция, улыбка, финал", { en: "close-up of the face" }],
            ["Деталь, макро", "Один предмет или его часть", "Свеча, латкес, руки с книгой — переходы", { en: "extreme close-up, macro detail of a lit candle" }],
            ["Через плечо", "Спина героя у камеры, впереди собеседник", "Диалог, интервью", { en: "over-the-shoulder shot" }],
            ["Глазами героя (POV)", "То, что видит герой, иногда его руки", "Вовлечь зрителя в сцену", { en: "first-person point of view shot" }],
            ["Двое в кадре", "Два героя рядом", "Дружба, ведущий и гость", { en: "two-shot, two characters side by side" }],
          ],
        },
      },
      {
        kind: "note",
        text: "Руки и пальцы ломаются чаще всего. Если руки не нужны — бери портрет или крупный план.",
      },
    ],
  },
  {
    id: "angles",
    title: "Ракурсы и объективы",
    short: "Откуда смотрит камера и через какой объектив",
    blocks: [
      {
        kind: "table",
        table: {
          caption: "Ракурсы и объективы",
          columns: ["Ракурс или объектив", "Как выглядит", "Зачем", "Фраза для промпта"],
          rows: [
            ["На уровне глаз", "Как в жизни", "Большинство сцен, ведущий", { en: "eye-level shot" }],
            ["Сверху", "Камера чуть выше и смотрит вниз, герой кажется меньше", "Мило и уютно", { en: "high-angle shot, looking down at the character" }],
            ["С высоты птичьего полёта", "Высоко над местом, как с дрона", "Двор, улица, площадь праздника", { en: "aerial bird's-eye view from high above" }],
            ["Строго сверху вниз", "Камера смотрит прямо вниз", "Праздничный стол, рецепт, раскладка", { en: "top-down overhead shot, flat lay" }],
            ["Снизу", "Герой выше и сильнее", "Момент гордости, выход на сцену", { en: "low-angle shot, looking up at the character" }],
            ["Голландский угол", "Кадр наклонён", "Суета, «всё вверх дном», шутка", { en: "Dutch angle, tilted frame" }],
            ["Fish-eye", "Круглый выгнутый кадр, нос большой", "Смешной крупный план, клип", { en: "fish-eye lens, ultra-wide distorted view" }],
            ["Широкий угол", "Много места, глубокая перспектива", "Интерьер, двор, общий план", { en: "wide-angle lens, 24mm, deep perspective" }],
            ["Обычный объектив", "Как видит глаз", "Средний план, портрет", { en: "50mm lens, natural perspective" }],
            ["Телеобъектив, сжатие", "Фон близко и большой, всё «плоско»", "Герой на фоне огней или здания", { en: "telephoto lens, 135mm, compressed background" }],
            ["Малая глубина резкости, боке", "Герой резкий, фон размыт в кружочки", "Портрет, огоньки ханукии", { en: "shallow depth of field, soft bokeh lights in the background" }],
            ["Макро", "Очень близко к мелочи", "Сахар на пончике, пламя свечи", { en: "macro lens, extreme close-up" }],
          ],
        },
      },
    ],
  },
  {
    id: "camera",
    title: "Движение камеры",
    short: "Какие движения ИИ-клип выдерживает",
    blocks: [
      {
        kind: "note",
        tone: "warn",
        title: "Правило 5 секунд",
        text:
          "Один клип — один план. Одно движение камеры, медленно. Не пиши «then», «cut to» и две сцены подряд: внутри 5 секунд получится склейка или каша. " +
          "Нужна энергия — делай её на монтаже: короткие клипы и смена планов.",
      },
      {
        kind: "table",
        table: {
          caption: "Движение камеры",
          columns: ["Движение", "Что происходит", "Для чего", "Фраза для промпта", "В 5-секундном клипе"],
          rows: [
            ["Статика", "Камера стоит", "Реплика, жест, лицо", { en: "static camera, locked-off shot" }, "Надёжно"],
            ["Наезд", "Камера медленно приближается", "Внимание, эмоция: «вот главное»", { en: "slow push-in toward the character" }, "Надёжно"],
            ["Отъезд", "Камера удаляется, открывается место", "Финал: «смотрите, сколько нас»", { en: "slow pull-back revealing the room" }, "Надёжно"],
            ["Панорама", "Камера поворачивается влево-вправо на месте", "Показать зал или стол", { en: "slow pan from left to right" }, "Надёжно"],
            ["Наклон", "Камера поворачивается вверх-вниз на месте", "От свечей к окну, от ног к лицу", { en: "slow tilt up from the candles to the window" }, "Обычно хорошо"],
            ["Плавное", "Камера едет мягко, как на стабилизаторе", "Почти любая сцена", { en: "smooth stabilized camera movement" }, "Надёжно"],
            ["Прерывистое, рывками", "Резкий поворот, толчки", "Энергичный клип", { en: "quick whip pan" }, "Часто ломается — лучше рывок на монтаже"],
            ["Тревеллинг, следование", "Камера едет рядом или за героем", "Герой идёт по двору", { en: "tracking shot, the camera follows the character from behind" }, "Осторожно: ноги и фон плывут"],
            ["Облёт", "Камера едет по дуге вокруг героя", "Эффектно показать героя", { en: "slow orbit around the character, half circle" }, "Осторожно: не больше полукруга"],
            ["Кран вверх", "Камера поднимается над сценой", "Начало или финал", { en: "slow crane up, rising above the scene" }, "Осторожно"],
            ["Кран вниз", "Камера опускается к героям", "Начало сцены сверху", { en: "slow crane down toward the characters" }, "Осторожно"],
            ["Ручная камера", "Лёгкое покачивание, «репортаж»", "Живой репортаж «770 NEWS»", { en: "handheld camera, slight natural shake" }, "Осторожно: легко дёргается"],
            ["Зум", "Объектив приближает, камера стоит", "Комичный акцент", { en: "slow zoom in on the face" }, "Надёжно, если медленно"],
            ["Dolly-zoom", "Фон «растягивается», герой того же размера", "Момент удивления", { en: "dolly zoom effect" }, "Часто ломается"],
            ["Слоу-мо", "Всё замедляется", "Снег, пар, подброшенный пончик", { en: "slow motion" }, "Хорошо для простых вещей"],
            ["Таймлапс", "Время бежит быстро", "День → вечер, плывут облака", { en: "time-lapse, clouds moving fast" }, "Осторожно: без людей в кадре"],
          ],
        },
      },
    ],
  },
  {
    id: "composition",
    title: "Композиция и цвет",
    short: "8 правил красивого кадра",
    blocks: [
      {
        kind: "rules",
        items: [
          { title: "Правило третей", text: "Раздели кадр на 3×3. Героя ставь на линию или пересечение, а не ровно в центр. Ведущий новостей — исключение: ему идёт центр.", en: "rule of thirds composition, the character on the left third" },
          { title: "Ведущие линии", text: "Дорожка, стол, гирлянда ведут взгляд к герою.", en: "leading lines toward the character" },
          { title: "Воздух по взгляду", text: "Оставь больше места туда, куда смотрит или идёт герой.", en: "the character looks to the right, with open space on the right" },
          { title: "Один главный объект", text: "В кадре один центр внимания. Остальное тише и размыто.", en: "one clear subject, simple uncluttered background" },
          { title: "2–3 цвета на ролик", text: "Выбери палитру и повторяй её во всех промптах.", en: "color palette: deep blue, warm gold and cream" },
          { title: "Повтор цвета героя", text: "Фирменный цвет героя появляется в фоне: шарф жёлтый — и свечи жёлтые.", en: "yellow accents in the background that match the character's scarf" },
          { title: "Чистый фон", text: "Меньше мелочей — меньше ошибок у модели.", en: "clean simple background" },
          { title: "Передний план", text: "Что-то близко к камере даёт глубину: размытая свеча, край стола.", en: "blurred foreground element for depth" },
        ],
      },
    ],
  },
  {
    id: "cinema",
    title: "Как сделать ролик похожим на кино",
    short: "Чек-лист ролика на 30–60 секунд",
    blocks: [
      {
        kind: "checklist",
        items: [
          "Один стиль на все клипы: одна и та же фраза стиля в каждом промпте.",
          "Лист персонажа прикладываешь к каждому кадру. Имя и 3–4 черты героя — в каждом промпте.",
          "Планы меняются: общий → средний → крупный. Два соседних клипа не одного плана.",
          "В каждом клипе одно действие героя и одно движение камеры.",
          "Первые 2 секунды цепляют: яркий кадр, движение, вопрос или неожиданная деталь.",
          "Свет и палитра одни во всей сцене, пока по сюжету не сменится время суток.",
          "Голос, музыку, субтитры и надписи добавляешь в «Студии» на монтаже, а не в клипе.",
          "Кадры урока 2 тоже работают: их можно поставить сценами-картинками по 5 секунд.",
          "Финал: крупный план или отъезд, приглашение или название и метка «Сделано с ИИ».",
          "Посмотри ролик без звука. Понятно, что происходит? Тогда всё в порядке.",
        ],
      },
    ],
  },
  {
    id: "fixes",
    title: "Частые ошибки и как чинить",
    short: "Что сломалось → что делать",
    blocks: [
      {
        kind: "table",
        table: {
          caption: "Частые ошибки",
          columns: ["Что не так", "Почему", "Как чинить", "Фраза для промпта"],
          rows: [
            ["Герой меняется от кадра к кадру", "Модель каждый раз рисует героя заново", "Прикладывай лист персонажа, повторяй имя и 3–4 черты. Правь кадр в «Правке картинки», а не новой генерацией", { en: "the character exactly as on the sheet: same face, hairstyle, outfit and colors" }],
            ["Лишние пальцы, лишние люди", "Руки и толпа — слабое место моделей", "Проще поза: руки держат предмет или не видны. Меньше людей в кадре", { en: "one character only, no extra people, hands relaxed" }],
            ["Текст в кадре превращается в кашу", "Модели плохо пишут буквы, особенно по-русски", "Убери текст из промпта. Название и субтитры — в «Студии»", { en: "no text, no letters, no signs" }],
            ["Камера дёргается", "Два движения сразу или слишком быстро", "Одно движение и слово «медленно». Не нужно движение — статика", { en: "one slow smooth camera movement" }],
            ["Слишком темно", "Ночь или low-key без источника света", "Добавь источник, который освещает лицо", { en: "a warm lamp lights the character's face, bright and clear" }],
            ["«Пластиковая» картинка", "Всё слишком гладкое и блестящее", "Назови материалы, мягкий свет и лёгкое зерно", { en: "matte natural textures, soft light, subtle film grain" }],
            ["Герой шевелит губами", "Модель пытается «говорить»", "Реплики озвучиваем отдельно, на уроке 3", { en: "mouth closed, no talking" }],
            ["В клипе две сцены и склейка", "В промпте несколько действий подряд", "Одно действие на клип. Остальное — следующим клипом", { en: "one continuous shot, no cuts" }],
            ["Вместо сцены снова сетка видов", "Модель повторяет приложенный лист", "Напомни, что нужна одна сцена", { en: "ONE single scene, not a reference sheet" }],
          ],
        },
      },
    ],
  },
  {
    id: "inspiration",
    title: "Где брать вдохновение",
    short: "Базы кадров и палитр",
    blocks: [
      {
        kind: "note",
        tone: "warn",
        title: "Только как образец",
        text:
          "Эти сайты — образцы света, цвета и композиции. Мы не копируем кадры, лица реальных актёров и логотипы. " +
          "Посмотрел, понял, как поставлен свет, — и описал это своими словами для своего героя. " +
          "В базах кадров из кино встречаются сцены из фильмов для взрослых: младше 18 — смотри вместе с ведущим и ищи по мирным словам («kitchen», «candles», «festival»).",
      },
      {
        kind: "resources",
        items: [
          {
            name: "ShotDeck",
            url: "https://shotdeck.com",
            what: "Большая база кадров из фильмов. Поиск по свету, цвету, плану и ракурсу.",
            cost: "Платно, есть годовой план и скидка студентам. По словам ведущего, бывает пробный период около 2 недель — проверь на сайте.",
            note: "Приложение для iPhone — 17+.",
          },
          {
            name: "FILMGRAB",
            url: "https://film-grab.com",
            what: "Тысячи фильмов кадрами. Поиск по фильму, режиссёру, оператору и формату кадра.",
            cost: "Бесплатно.",
          },
          {
            name: "Flim",
            url: "https://flim.ai",
            what: "Поиск кадров из кино, сериалов и клипов по словам; доски с подборками.",
            cost: "Есть бесплатный план с ограничениями; скачивание в хорошем качестве — платно.",
          },
          {
            name: "Eyecannndy",
            url: "https://eyecannndy.com",
            what: "Библиотека коротких GIF с приёмами камеры: наезд, панорама, облёт, параллакс. Видно, как движение выглядит.",
            cost: "Бесплатно.",
          },
          {
            name: "Frame Set",
            url: "https://frameset.app",
            what: "Кадры и движения из рекламы, клипов и фильмов с удобными фильтрами.",
            cost: "Платная подписка.",
          },
          {
            name: "Pinterest",
            url: "https://www.pinterest.com",
            what: "Доска настроения: собери 10–15 картинок со светом и цветом для своего ролика.",
            cost: "Бесплатно.",
            note: "С 13 лет, до 18 — с разрешения родителей.",
          },
          {
            name: "Adobe Color",
            url: "https://color.adobe.com",
            what: "Палитры: подбери 2–3 цвета ролика или вытащи палитру из картинки.",
            cost: "Бесплатно; чтобы сохранять палитры, нужен аккаунт Adobe.",
          },
        ],
      },
      {
        kind: "text",
        text: "Цены и условия сервисов меняются. Перед регистрацией загляни на сайт.",
      },
    ],
  },
  {
    id: "recipes",
    title: "10 готовых рецептов",
    short: "5 кадров и 5 клипов — копируй и меняй",
    blocks: [
      {
        kind: "text",
        text:
          "Каждый рецепт — целый промпт. Скопируй его и поменяй героя, место и цвета на свои. Видео-рецепты идут парами к кадрам: сначала кадр, потом клип «Из кадра».",
      },
      {
        kind: "recipes",
        title: "Кадры",
        items: [
          {
            title: "Кадр 1. Ханукальный стол сверху",
            gives: "Праздничный стол строго сверху — заставка или переход между сценами.",
            prompt:
              "Top-down overhead shot of a festive Hanukkah table: a lit menorah, golden potato latkes, sufganiyot with powdered sugar, " +
              "blue and white napkins. Warm candlelight, soft shadows. Color palette: deep blue, warm gold and cream. " +
              "Cozy 3D animated film style. No people, no hands. Vertical 9:16, no text.",
          },
          {
            title: "Кадр 2. Рассказчик у окна",
            gives: "Портрет героя-рассказчика: тёплый свет свечей и синие сумерки за окном.",
            prompt:
              "Medium close-up of Ari, a cheerful cartoon boy storyteller with curly brown hair, a small blue kippah, round glasses " +
              "and a yellow scarf, sitting by a window and looking at the viewer with a gentle smile. Eye level, 50mm lens, " +
              "shallow depth of field. Warm candlelight from the left, blue hour twilight outside the window. " +
              "3D animated film style. Vertical 9:16, no text.",
          },
          {
            title: "Кадр 3. Студия «770 NEWS»",
            gives: "Выдуманный ведущий за столом новостей, аккуратный студийный свет.",
            prompt:
              "Medium shot of Mark, a friendly cartoon news presenter with a short black beard, round glasses, a dark blue blazer " +
              "and an orange scarf, standing behind a modern news desk with his hands resting on it. Eye level, symmetrical " +
              "composition. Professional three-point studio lighting, soft blue and warm orange accents, blurred screens in the " +
              "background. 3D animated style. Vertical 9:16, no text, no logos.",
          },
          {
            title: "Кадр 4. Двор центра в праздник",
            gives: "Открывающий общий план мероприятия в золотой час.",
            prompt:
              "Wide shot of a community centre courtyard decorated for a festival: string lights, a long table with food, " +
              "a few small cartoon figures chatting in the background. Golden hour sunlight, long soft shadows, warm joyful mood. " +
              "The string lights lead the eye toward the entrance. Illustrated storybook style. Vertical 9:16, no text.",
          },
          {
            title: "Кадр 5. Латкес на сковороде",
            gives: "Макро-деталь еды — вкусный переход или крючок в первые 2 секунды.",
            prompt:
              "Macro shot of golden potato latkes in a frying pan, tiny drops of oil shining, a little steam rising. " +
              "Soft side lighting, warm kitchen light, dark soft background, shallow depth of field with creamy bokeh. " +
              "Realistic food photography. Vertical 9:16, no text.",
          },
        ],
      },
      {
        kind: "recipes",
        title: "Клипы (режим «Из кадра»)",
        items: [
          {
            title: "Клип 1. Огоньки над столом",
            gives: "К кадру 1: свечи мерцают, камера мягко опускается к столу.",
            prompt:
              "Animate this frame. The candle flames on the menorah flicker gently and a little steam rises from the latkes. " +
              "The camera slowly moves down toward the table. Nothing else moves. One continuous 5-second shot, slow and smooth. " +
              "Keep the table, food, colors and style exactly as in the frame. No people, no hands, no text.",
          },
          {
            title: "Клип 2. Наезд на рассказчика",
            gives: "К кадру 2: герой поворачивается к зрителю, камера подъезжает ближе.",
            prompt:
              "Animate this frame. Ari slowly turns his head from the window to the viewer and smiles warmly. Slow push-in " +
              "to a close-up. Candle flames flicker gently, the light stays warm and soft. One continuous 5-second shot. " +
              "His mouth stays closed, no talking. Keep Ari, his outfit, the room and the style exactly as in the frame. " +
              "No text, no subtitles.",
          },
          {
            title: "Клип 3. Ведущий начинает выпуск",
            gives: "К кадру 3: кивок ведущего, камера стоит — удобно наложить реплику.",
            prompt:
              "Animate this frame. Mark looks up from the desk, nods once and gives a friendly smile. Static camera, " +
              "locked-off shot. The screens in the background glow softly. One continuous 5-second shot. His mouth stays closed, " +
              "no talking. Keep Mark, the desk, the studio and the style exactly as in the frame. No text, no logos, no subtitles.",
          },
          {
            title: "Клип 4. Кран над праздником",
            gives: "К кадру 4: камера поднимается и показывает весь двор — хороший финал.",
            prompt:
              "Animate this frame. The string lights twinkle softly and the small figures in the background move calmly. " +
              "The camera slowly rises up, revealing the whole decorated courtyard. The golden hour light stays the same. " +
              "One continuous 5-second shot. Keep the place, colors and style exactly as in the frame. No new people, no text.",
          },
          {
            title: "Клип 5. Слоу-мо на сковороде",
            gives: "К кадру 5: масло шипит, пар поднимается, всё в замедлении.",
            prompt:
              "Animate this frame. The latkes sizzle gently, tiny oil bubbles pop around the edges and steam rises slowly. " +
              "Slow motion, static camera, macro close-up. One continuous 5-second shot. Keep the pan, the food, the light " +
              "and the style exactly as in the frame. No hands, no people, no text.",
          },
        ],
      },
    ],
  },
];
