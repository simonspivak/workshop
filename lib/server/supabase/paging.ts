/*
  Постраничное чтение через PostgREST. Сервер отдаёт не больше Max Rows строк за запрос
  (в проекте 1000) и молча обрезает остальное. Поэтому идём страницами и сдвигаемся на число
  строк, которое реально пришло, а останавливаемся только на пустой странице: так чтение
  не зависит от того, какое значение Max Rows стоит в настройках (аудит № 42).
  Растущие таблицы (журнал звёзд, задачи, прогресс) лучше суммировать в SQL — см.
  supabase/migrations/20261116170000_teacher_aggregates.sql.
*/

export const PAGE_SIZE = 1000;
export const MAX_ROWS = 50_000;

type Page<T> = PromiseLike<{ data: T[] | null; error: { code?: string } | null }>;

/** load(from, to) — запрос с .order(...) и .range(from, to). op — имя для текста ошибки. */
export async function fetchAll<T>(
  load: (from: number, to: number) => Page<T>,
  op: string,
  { pageSize = PAGE_SIZE, maxRows = MAX_ROWS }: { pageSize?: number; maxRows?: number } = {},
): Promise<T[]> {
  const rows: T[] = [];
  while (rows.length < maxRows) {
    const from = rows.length;
    const { data, error } = await load(from, from + pageSize - 1);
    if (error) throw new Error(`${op} failed (${error.code})`);
    if (!data || data.length === 0) break;
    rows.push(...data);
  }
  return rows;
}
