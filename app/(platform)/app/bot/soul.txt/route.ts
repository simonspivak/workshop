import { soulExportText } from "@/lib/server/bot/export";
import { berlinDate, formatDay } from "@/lib/server/bot/lifetime";
import { loadBotByOwner } from "@/lib/server/bot/store";
import { getUser } from "@/lib/server/dal/auth";
import { appUrl } from "@/lib/server/env";

/*
  GET /app/bot/soul.txt — «Скачать душу»: душа, «Мой текст» и форма заявки одним файлом.
  Только владелец. Работает и после срока жизни бота.
*/

export async function GET() {
  const user = await getUser();
  if (!user) return new Response("Войдите, чтобы продолжить.", { status: 401 });
  const bot = await loadBotByOwner(user.id);
  if (!bot) return new Response("Бота пока нет.", { status: 404 });

  const base = appUrl();
  const text = soulExportText({
    name: bot.name,
    soul: bot.soul,
    knowledge: bot.knowledge,
    knowledgeEnabled: bot.tools.knowledge,
    leadForm: bot.tools.leadForm,
    pageUrl: base ? `${base}/b/${bot.slug}` : null,
    kitUrl: base ? `${base}/bot-kit/README.md` : null,
    exportedOn: formatDay(berlinDate(new Date())),
  });

  return new Response(text, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "content-disposition": `attachment; filename="dusha-${bot.slug}.txt"`,
      "cache-control": "no-store",
    },
  });
}
