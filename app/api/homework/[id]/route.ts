import { authorize } from "@/lib/server/dal/auth";
import { homeworkFailure, pollSubmission } from "@/lib/server/homework/submissions";
import { json } from "@/lib/server/studio";

// Состояние сдачи (владелец или ведущий группы). Незаконченную проверку доводит до конца.
export const maxDuration = 60;

export async function GET(_request: Request, ctx: RouteContext<"/api/homework/[id]">) {
  try {
    const user = await authorize();
    const { id } = await ctx.params;
    const { status, body } = await pollSubmission(user, id);
    return json(body, status);
  } catch (error) {
    return homeworkFailure(error, "poll");
  }
}
