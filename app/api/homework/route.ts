import { authorize } from "@/lib/server/dal/auth";
import { createSubmission, createSubmissionSchema, homeworkFailure } from "@/lib/server/homework/submissions";
import { isSameOrigin, json, readJson } from "@/lib/server/studio";

// Сдать домашку: файл → строка uploading + подписанная ссылка на загрузку в Storage;
// текст или ссылка → строка submitted и проверка моделью сразу (ответ не позже ~45 с).
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    if (!isSameOrigin(request)) return json({ ok: false, error: "forbidden" }, 403);
    const user = await authorize();
    const parsed = createSubmissionSchema.safeParse(await readJson(request, 96 * 1024));
    if (!parsed.success) return json({ ok: false, error: "invalid_input" }, 400);
    const { status, body } = await createSubmission(user, parsed.data);
    return json(body, status);
  } catch (error) {
    return homeworkFailure(error, "create");
  }
}
