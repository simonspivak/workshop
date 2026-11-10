import { z } from "zod";
import { authorize } from "@/lib/server/dal/auth";
import { completeSubmission, homeworkFailure } from "@/lib/server/homework/submissions";
import { isSameOrigin, json, readJson } from "@/lib/server/studio";

const bodySchema = z.object({ abort: z.boolean().optional() }).nullable();

// Загрузка файла домашки закончена: проверить файл в Storage и запустить проверку моделью.
// { abort: true } — загрузку отменили: файл удаляется, строка уходит в историю.
export const maxDuration = 60;

export async function POST(request: Request, ctx: RouteContext<"/api/homework/[id]/complete">) {
  try {
    if (!isSameOrigin(request)) return json({ ok: false, error: "forbidden" }, 403);
    const user = await authorize();
    const { id } = await ctx.params;
    const body = bodySchema.safeParse(await readJson(request, 1024));
    if (!z.uuid().safeParse(id).success || !body.success) return json({ ok: false, error: "invalid_input" }, 400);
    const { status, body: response } = await completeSubmission(user, id, body.data?.abort === true);
    return json(response, status);
  } catch (error) {
    return homeworkFailure(error, "complete");
  }
}
