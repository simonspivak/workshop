import { audit } from "@/lib/server/audit";
import { AuthError, getUser, isStaff } from "@/lib/server/dal/auth";
import { getGroup } from "@/lib/server/dal/teacher";
import { groupReportToCsv } from "@/lib/server/group-report-csv";
import { getGroupReport } from "@/lib/server/group-reports";

/*
  GET /teach/groups/[id]/report.csv — отчёт группы в CSV (аудит № 30).
  Только ведущий этой группы или админ. В файле логины и ники учеников, поэтому выгрузка
  пишется в аудит и не кешируется. Файл собирается по запросу и нигде не хранится.
*/

export const maxDuration = 60;

export async function GET(_request: Request, ctx: RouteContext<"/teach/groups/[id]/report.csv">) {
  const user = await getUser();
  if (!user) return new Response("Войдите, чтобы продолжить.", { status: 401 });
  if (!isStaff(user)) return new Response("Это действие вам недоступно.", { status: 403 });

  const { id } = await ctx.params;
  const group = await getGroup(user, id);
  if (!group) return new Response("Не нашли такую группу.", { status: 404 });

  let csv: string;
  let count: number;
  try {
    const report = await getGroupReport(user, group.id);
    csv = groupReportToCsv(report);
    count = report.students.length;
  } catch (error) {
    if (error instanceof AuthError) return new Response("Это действие вам недоступно.", { status: 403 });
    console.error("teach.reportCsv: failed", { error: error instanceof Error ? error.message : String(error) });
    return new Response("Что-то пошло не так. Попробуйте ещё раз.", { status: 500 });
  }

  await audit({ actorId: user.id, action: "group.report_export", targetGroup: group.id, meta: { students: count } });

  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="otchet-${group.code}-${day}.csv"`,
      "cache-control": "no-store",
    },
  });
}
