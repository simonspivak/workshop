"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { AuthError, authorize, STAFF_ROLES } from "@/lib/server/dal/auth";
import { ConfigError } from "@/lib/server/env";
import { setTeacherGrade } from "@/lib/server/homework/submissions";
import { MAX_HOMEWORK_NOTE } from "@/lib/platform/homework-types";

export type GradeActionResult = { ok: true } | { ok: false; error: string };

const schema = z.object({
  submissionId: z.uuid(),
  score: z.coerce.number().int().min(1).max(10),
  comment: z.string().max(MAX_HOMEWORK_NOTE).transform((value) => value.trim()),
});

/** Оценка ведущего (1–10) и комментарий к сдаче. Только ведущий этой группы или админ; пишет audit_log. */
export async function gradeHomework(_prev: GradeActionResult | null, formData: FormData): Promise<GradeActionResult> {
  try {
    const user = await authorize(STAFF_ROLES);
    const parsed = schema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      const scoreIssue = parsed.error.issues.some((issue) => issue.path[0] === "score");
      return { ok: false, error: scoreIssue ? "teacher_score_required" : "invalid_input" };
    }
    const result = await setTeacherGrade(user, parsed.data.submissionId, { score: parsed.data.score, comment: parsed.data.comment });
    if (!result.ok) return { ok: false, error: result.error };
    refresh();
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.code };
    if (error instanceof ConfigError) return { ok: false, error: "not_configured" };
    console.error("teach.gradeHomework: unexpected error", { error: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: "server_error" };
  }
}
