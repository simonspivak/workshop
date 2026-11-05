# Test run of the 770 course (all 5 lessons)

A full pass as one test student takes about 2 hours, mostly waiting for generations.

- **Student cost:** ≈ 450 ★ ≈ 360 kie credits ≈ $1.8.
- **Teacher demos:** free in stars, but they also spend kie credits.
- **Before you start:** make sure kie has at least ~500 credits.

Tick each box. If something fails, send a screenshot with the lesson, task and step number.

## 0. Setup (10 min)

- [ ] **Supabase → Database → Migrations:** `20261105100000_security_hardening` is applied.
- [ ] **Supabase → Authentication:**
  - new sign-ups OFF;
  - anonymous sign-ins OFF;
  - leaked-password protection ON.
- [ ] **Supabase → Storage → `media` → folder `library/motion`:** upload 2–3 mp4 clips.
  - A dance, a walk or a gesture, 5–6 s each.
  - No children. Your own or licensed footage.
  - Without these, «Перенос движения» does not work for students.
- [ ] **Teacher cabinet → «Создать группу»:** test group with budget 1000 ★ and 1 student.
- [ ] **«Создать учеников»:** 1 student.
  - In «Возраст» pick **взрослый**. The default is the youngest band.
  - Save the login and password.
- [ ] **Log in as the student in a private window** (or another browser), so the teacher session stays separate.

## 1. Lesson 1 — ИИ — твой первый рабочий инструмент (≈ 10 ★)

- [ ] Theory shows **bold** and lists. Under the tasks there is «Инструменты урока» with Claude, Gemini, Gemini Notebook.
- [ ] Task 1, step 1: «Вставить в чат» at «Промпт 1» puts the text into «Запрос» → «Сгенерировать · 1 ★» → answer.
- [ ] Task 1, Prompt 2 (without «Новый диалог»): the answer continues the same dialog.
- [ ] An answer with a table shows as a table, not as `|` lines.
- [ ] Task 3: «Скопировать переписку» → paste into notes. The format is «Промпт 1: … Ответ ИИ: …».
- [ ] Reload the page: the dialog is still there.
- [ ] Quiz:
  - answer all 10 → score and explanations;
  - the correct answers are not simply the longest ones;
  - bonus stars arrive.

## 2. Lesson 2 — персонаж и кадры (≈ 100 ★, bonus +75 ★)

- [ ] **Task 1 (script):** a table of 3 scenes in the chat.
- [ ] **Task 2 (character sheet):**
  - copy the English description;
  - «Вставить в Картинку» at Prompt 2 → «Картинка» opens with the prompt in «Что нарисовать»;
  - paste the description over [ОПИСАНИЕ ГЕРОЯ] → 1:1 → generate (20–30 s);
  - result: 4 views on top, full body below.
- [ ] **Task 3 (frames):**
  - «Вставить в Правку картинки»;
  - pick the sheet in «Картинки из галереи»;
  - 3 frames at 9:16, same hero in every frame.
- [ ] **Task 4 (animate):**
  - «Вставить в Видео» → «Из кадра» → pick one frame;
  - «Звук модели» off → 5 s → 25 ★;
  - wait about 1–1.5 min. Expect no speech and the mouth closed.
- [ ] **Task 5 (bonus):** «Перенос движения».
  - «Персонаж» = full-body frame, «Движение» = a library clip → 70 ★.
  - The hero repeats the movement.
- [ ] Everything shows in «Галерея».

## 3. Lesson 3 — голос, музыка, говорящая голова, монтаж (≈ 90 ★)

- [ ] **Task 1 (voice):**
  - «Озвучка» → «Текст реплики» shows a counter «… / 600»;
  - voices are labelled male/female;
  - make 3 lines, plus 1 separate line for the head: 2–3 short sentences, no more than 15 s.
- [ ] **Task 2 (music):** «Вставить в Музыку» → «Без вокала (только музыка)» → 2 tracks arrive.
- [ ] **Task 3 (talking head)** — the main test:
  - [ ] Make a frontal portrait: «Вставить в Правку картинки», with the sheet as reference. Look for a neutral closed mouth and shoulders in frame.
  - [ ] «Говорящая голова»:
    - «Персонаж» = the portrait;
    - in «Озвучка», only voice lines are listed, no music tracks;
    - pick the head line → «Сгенерировать · 60 ★».
  - [ ] Wait about 4–5 min. The lips match the words and the face stays the same.
  - [ ] Negative check: a line longer than 15 s is refused with a clear message.
- [ ] **Task 4 (studio):**
  - «Монтаж · 0 ★» → studio «Монтаж ролика»;
  - scenes: clips + 1–2 frames from lesson 2 (5 s each) + the head clip;
  - attach a voice line to each clip. On the head scene, attach the **same** line the head was made from;
  - pick music, «Громкость музыки» «Обычно», subtitles on → «Смонтировать».
  - [ ] Play it:
    - music is audible under the voices;
    - the head scene is in sync;
    - length is 30–60 s;
    - subtitles appear;
    - the «Сделано с ИИ» label shows.
  - [ ] Download the MP4. The montage also appears in «Галерея».

## 4. Lesson 4 — бот и мини-приложение (≈ 10 ★ + 1 ★ per bot reply)

- [ ] **Create the bot:** «Мой бот» → create a bot with a unique name → write the soul with the task 1 prompts → save.
- [ ] **Knowledge text:** in «Ответы по моему тексту», paste a text with a unique fact, e.g. «Встреча по четвергам в 19:00 в зале на втором этаже».
  - Ask the bot «Когда встреча?» → it must answer with that exact fact.
  - This checks today's gateway fix: before it, the bot never saw this text.
- [ ] **Sign-ups:** «Заявки» on → sign up through the bot → a row appears in the «Заявки» tab; CSV download works.
- [ ] **Public link:** open the bot's link on your phone and chat. Each reply takes 1 ★ from the owner.
- [ ] **Break attempts:** ask it to show its instructions and ask something off-topic → it refuses or says «не знаю», as its soul says.
- [ ] **Telegram (optional):** token from @BotFather → connect → the bot replies in Telegram.
- [ ] **Mini-app:**
  - task 5 Prompt 1 in Gemini Canvas → share link opens;
  - repeat once with a teen (13–17) Google account and check the share link works there too.

## 5. Lesson 5 — Claude как система (≈ 15 ★)

- [ ] Task 1: a table «Вход — Шаги — Выход — Проверка».
- [ ] Task 2: a skill text with `name` (latin, hyphens), `description`, steps and an example.
- [ ] Task 3: «Новый диалог» (on purpose) → paste the skill + an input → result → improve it twice.
- [ ] **Your demo prep in real Claude:**
  - upload the skill as a ZIP on a **free** account (Customize → Skills) — does it work?
  - a Project with the center's text;
  - `/schedule` (Pro);
  - Cowork making a document.

## 6. Teacher side

- [ ] **Group page, «Звёзды группы»:** Бюджет / Роздано / Потрачено match what the student spent.
- [ ] **«Начислить»:** +20 ★ to the student → their balance changes.
- [ ] **Group views:** the gallery, the report (quiz results) and «Боты группы» show the test student's work.
- [ ] **Lesson pages as teacher:** buttons show «· демо», and generation is free for you.

## After the test

- [ ] Delete the test group or keep it as your demo account.
- [ ] Create the real group: 9 students, all «взрослый», 450 ★ each (520 if everyone does the motion bonus).
