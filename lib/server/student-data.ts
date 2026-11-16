import "server-only";
import { deleteWebhook } from "@/lib/server/bot/telegram";
import { decryptSecret } from "@/lib/server/crypto";
import { MEDIA_BUCKET } from "@/lib/server/jobs";
import { forgetSignedUrls } from "@/lib/server/storage";
import { createAdminClient } from "@/lib/server/supabase/admin";
import { fetchAll } from "@/lib/server/supabase/paging";

/*
  «Удалить данные ученика» (аудит № 23, SEC-04). Только админ, только по кнопке с подтверждением
  (app/(platform)/teach/student-data.ts); автоматически аккаунты учеников не удаляются.

  Порядок:
    1. Файлы Storage ученика: пути из его задач (storage_path, extra_paths) и домашек плюс всё,
       что лежит в его папках {id}/ и {id}/homework/ (на случай брошенных загрузок). Только пути
       внутри папки ученика — библиотеку курса и чужие файлы не трогаем. Удаляем через Storage API
       пачками по 100. Если хоть одна пачка не удалилась — дальше не идём: строки в базе остаются,
       кнопку можно нажать ещё раз (уже удалённые файлы повторно не мешают).
    2. Вебхук Telegram его бота снимаем (если подключён), чтобы Telegram не стучался в пустоту.
    3. SQL delete_student_data (миграция 20261116190000_privacy): проверка «админ и ученик»,
       одна строка audit_log без личных данных, вычистка логина из прошлых записей журнала и
       удаление аккаунта каскадом (профиль, кошелёк, журнал звёзд, задачи, тесты, прогресс,
       домашки, бот с перепиской и заявками).
    4. Если у базы нет прав на auth.users — вход удаляется через Auth Admin API.
*/

/** Сколько страниц листинга папки читаем (по 1000 объектов): больше у ученика не бывает. */
const MAX_LIST_PAGES = 10;
const LIST_PAGE = 1000;
const REMOVE_CHUNK = 100;

export type DeleteStudentResult =
  | { ok: true; files: number; jobs: number; homework: number; botMessages: number; botLeads: number }
  | { ok: false; error: "forbidden" | "not_found" | "delete_files_failed" | "delete_login_failed" };

/** Путь лежит в папке ученика (и не уходит из неё через «..»). */
export function isStudentPath(userId: string, path: string): boolean {
  return path.startsWith(`${userId}/`) && !path.split("/").includes("..") && path.length <= 300;
}

/** Все пути ученика без повторов, только из его папки. */
export function studentPaths(
  userId: string,
  jobs: { storage_path: string | null; extra_paths: string[] | null }[],
  homework: { storage_path: string | null }[],
  listed: string[],
): string[] {
  const all = [
    ...jobs.flatMap((j) => (j.storage_path ? [j.storage_path, ...(j.extra_paths ?? [])] : (j.extra_paths ?? []))),
    ...homework.map((h) => h.storage_path),
    ...listed,
  ];
  return [...new Set(all.filter((p): p is string => typeof p === "string" && isStudentPath(userId, p)))];
}

async function listFolder(folder: string): Promise<string[]> {
  const bucket = createAdminClient().storage.from(MEDIA_BUCKET);
  const paths: string[] = [];
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const { data, error } = await bucket.list(folder, { limit: LIST_PAGE, offset: page * LIST_PAGE });
    if (error) throw new Error("studentData.list failed");
    const items = data ?? [];
    // у папок id нет — их содержимое читаем отдельно (homework)
    for (const item of items) if (item.id) paths.push(`${folder}/${item.name}`);
    if (items.length < LIST_PAGE) break;
  }
  return paths;
}

async function collectPaths(userId: string): Promise<string[]> {
  const admin = createAdminClient();
  const [jobs, homework, own, homeworkFolder] = await Promise.all([
    fetchAll<{ storage_path: string | null; extra_paths: string[] | null }>(
      (from, to) =>
        admin.from("jobs").select("storage_path, extra_paths").eq("user_id", userId).order("id").range(from, to),
      "studentData.jobs",
    ),
    fetchAll<{ storage_path: string | null }>(
      (from, to) =>
        admin.from("homework_submissions").select("storage_path").eq("user_id", userId).order("id").range(from, to),
      "studentData.homework",
    ),
    listFolder(userId),
    listFolder(`${userId}/homework`),
  ]);
  return studentPaths(userId, jobs, homework, [...own, ...homeworkFolder]);
}

/** Снять вебхук Telegram бота ученика. Не вышло — не страшно: бота в базе не станет, вебхук ответит 404. */
async function retireStudentTelegram(userId: string): Promise<void> {
  const { data } = await createAdminClient()
    .from("bots")
    .select("id, telegram_token_ciphertext, telegram_token_iv, telegram_token_tag")
    .eq("owner_id", userId)
    .maybeSingle();
  if (!data?.telegram_token_ciphertext || !data.telegram_token_iv || !data.telegram_token_tag) return;
  try {
    const token = decryptSecret({
      ciphertext: data.telegram_token_ciphertext,
      iv: data.telegram_token_iv,
      tag: data.telegram_token_tag,
    });
    const removed = await deleteWebhook(token);
    if (!removed.ok) console.error("studentData: deleteWebhook failed", { bot: data.id });
  } catch (error) {
    console.error("studentData: deleteWebhook threw", { bot: data.id, error: String(error) });
  }
}

/**
 * Удалить ученика и все его данные. Вызывать только из Server Action админа после подтверждения.
 * SQL ещё раз проверяет, что actorId — админ, а studentId — ученик.
 */
export async function deleteStudentData(actorId: string, studentId: string): Promise<DeleteStudentResult> {
  const admin = createAdminClient();
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id, role")
    .eq("id", studentId)
    .maybeSingle();
  if (profileError) throw new Error(`studentData.profile failed (${profileError.code})`);
  if (!profile) return { ok: false, error: "not_found" };
  if (profile.role !== "student") return { ok: false, error: "forbidden" };

  const paths = await collectPaths(studentId);
  for (let i = 0; i < paths.length; i += REMOVE_CHUNK) {
    const { error } = await admin.storage.from(MEDIA_BUCKET).remove(paths.slice(i, i + REMOVE_CHUNK));
    if (error) {
      console.error("studentData: storage remove failed", { done: i, total: paths.length });
      return { ok: false, error: "delete_files_failed" };
    }
  }
  forgetSignedUrls(paths);

  await retireStudentTelegram(studentId);

  const { data, error } = await admin.rpc("delete_student_data", {
    p_actor: actorId,
    p_user: studentId,
    p_files: paths.length,
  });
  if (error?.message === "forbidden") return { ok: false, error: "forbidden" };
  if (error?.message === "user_not_found") return { ok: false, error: "not_found" };
  if (error) throw new Error(`studentData.delete failed (${error.code})`);
  const row = data?.[0];

  if (!row?.auth_deleted) {
    const { error: authError } = await admin.auth.admin.deleteUser(studentId);
    if (authError && authError.status !== 404) {
      console.error("studentData: auth deleteUser failed", { status: authError.status });
      return { ok: false, error: "delete_login_failed" };
    }
  }

  return {
    ok: true,
    files: paths.length,
    jobs: Number(row?.jobs ?? 0),
    homework: Number(row?.homework ?? 0),
    botMessages: Number(row?.bot_messages ?? 0),
    botLeads: Number(row?.bot_leads ?? 0),
  };
}
