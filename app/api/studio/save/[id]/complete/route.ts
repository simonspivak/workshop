import { z } from "zod";
import { authorize } from "@/lib/server/dal/auth";
import { finishMontageUpload, isSameOrigin, json, readJson, studioFailure } from "@/lib/server/studio";

const bodySchema = z.object({ abort: z.boolean().optional() }).nullable();

// Загрузка монтажа закончена: проверить файл в Storage (есть, mp4, ≤ 50 МБ) и отметить задачу готовой.
// { abort: true } — загрузку отменили: задача закрывается, файл удаляется.
export async function POST(request: Request, ctx: RouteContext<"/api/studio/save/[id]/complete">) {
  try {
    if (!isSameOrigin(request)) return json({ ok: false, error: "forbidden" }, 403);
    const user = await authorize();
    const { id } = await ctx.params;
    const jobId = z.uuid().safeParse(id);
    const body = bodySchema.safeParse(await readJson(request, 1024));
    if (!jobId.success || !body.success) return json({ ok: false, error: "invalid_input" }, 400);
    const { status, body: response } = await finishMontageUpload(user, jobId.data, body.data?.abort === true);
    return json(response, status);
  } catch (error) {
    return studioFailure(error, "complete");
  }
}
