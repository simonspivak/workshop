import { authorize } from "@/lib/server/dal/auth";
import { createMontageUpload, isSameOrigin, json, readJson, saveRequestSchema, studioFailure } from "@/lib/server/studio";

// Сохранить монтаж в галерею: задача montage (0★) + подписанная ссылка на загрузку mp4 в Storage.
// С dryRun: true — только проверка текстов (название, ники, субтитры) до монтажа.
export async function POST(request: Request) {
  try {
    if (!isSameOrigin(request)) return json({ ok: false, error: "forbidden" }, 403);
    const user = await authorize();
    const parsed = saveRequestSchema.safeParse(await readJson(request));
    if (!parsed.success) return json({ ok: false, error: "invalid_input" }, 400);
    const { status, body } = await createMontageUpload(user, parsed.data);
    return json(body, status);
  } catch (error) {
    return studioFailure(error, "save");
  }
}
