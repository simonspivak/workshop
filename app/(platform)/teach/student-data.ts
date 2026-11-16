"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { AuthError, authorize } from "@/lib/server/dal/auth";
import { assertTeachesStudent } from "@/lib/server/dal/teacher";
import { ConfigError } from "@/lib/server/env";
import { deleteStudentData } from "@/lib/server/student-data";
import type { ActionResult } from "@/lib/platform/messages";

/*
  «Удалить данные ученика» (аудит № 23): только админ, только после того, как он вписал логин
  ученика (или ник, если логина нет). Удаление необратимо — см. lib/server/student-data.ts.
  Журнал (audit_log, строка student.data_delete) пишет SQL, без личных данных.
*/

const schema = z.object({ studentId: z.uuid(), confirm: z.string().trim().max(80) });

export type DeleteStudentDataResult = ActionResult<{ files: number }>;

export async function deleteStudentDataAction(
  _prev: DeleteStudentDataResult | null,
  formData: FormData,
): Promise<DeleteStudentDataResult> {
  try {
    const user = await authorize(["admin"]);
    const parsed = schema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ok: false, error: "invalid_input" };
    const { student } = await assertTeachesStudent(user, parsed.data.studentId);

    const expected = (student.login ?? student.nickname).toLowerCase();
    if (parsed.data.confirm.toLowerCase() !== expected) {
      return { ok: false, error: "delete_confirm", fields: { confirm: "Логин не совпадает." } };
    }

    const result = await deleteStudentData(user.id, student.id);
    if (!result.ok) return { ok: false, error: result.error };
    refresh();
    return { ok: true, files: result.files };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.code };
    if (error instanceof ConfigError) return { ok: false, error: "not_configured" };
    console.error("teach.deleteStudentData: unexpected error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: "server_error" };
  }
}
