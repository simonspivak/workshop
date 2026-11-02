import { audit } from "@/lib/server/audit";
import { leadsToCsv } from "@/lib/server/bot/csv";
import { getMyBotSummary, listMyLeads } from "@/lib/server/bot/dal";
import { getUser } from "@/lib/server/dal/auth";

/*
  GET /app/bot/leads.csv — заявки бота текущего пользователя в CSV.
  Только владелец (сессия), только свой бот. Выгрузка личных данных пишется в аудит.
*/

export async function GET() {
  const user = await getUser();
  if (!user) return new Response("Войдите, чтобы продолжить.", { status: 401 });

  const [summary, result] = await Promise.all([getMyBotSummary(user), listMyLeads(user)]);
  if (!summary || !result) return new Response("Бота пока нет.", { status: 404 });

  const csv = leadsToCsv(
    result.leads.map((lead) => ({ createdAt: lead.createdAt, channel: lead.channel, data: lead.data })),
    result.form?.fields.map((f) => f.label) ?? [],
  );
  await audit({
    actorId: user.id,
    action: "bot.leads_export",
    targetUser: user.id,
    targetGroup: user.group?.id,
    meta: { bot: summary.id, count: result.leads.length },
  });

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="zayavki-${summary.slug}.csv"`,
      "cache-control": "no-store",
    },
  });
}
