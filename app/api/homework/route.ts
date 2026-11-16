import { authorize } from "@/lib/server/dal/auth";
import { createSubmission, createSubmissionSchema, homeworkFailure } from "@/lib/server/homework/submissions";
import { isSameOrigin, json, readJson } from "@/lib/server/studio";

// Сдать домашку: файл → строка uploading + подписанная ссылка на загрузку в Storage;
// текст или ссылка → строка submitted и проверка моделью сразу (ответ не позже ~45 с).
export const maxDuration = 60;

// Текст или комментарий до 100 000 знаков: кириллица в UTF-8 — 2 байта на знак (~200 КБ),
// переносы строк и кавычки в JSON — ещё по 2 байта. 640 КБ — с запасом на оба поля и список результатов.
const MAX_BODY_BYTES = 640 * 1024;

export async function POST(request: Request) {
  try {
    if (!isSameOrigin(request)) return json({ ok: false, error: "forbidden" }, 403);
    const user = await authorize();
    const parsed = createSubmissionSchema.safeParse(await readJson(request, MAX_BODY_BYTES));
    if (!parsed.success) return json({ ok: false, error: "invalid_input" }, 400);
    const { status, body } = await createSubmission(user, parsed.data);
    return json(body, status);
  } catch (error) {
    return homeworkFailure(error, "create");
  }
}
