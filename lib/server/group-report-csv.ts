import "server-only";
import { escapeCell } from "@/lib/server/bot/csv";
import type { GroupReport } from "@/lib/server/group-reports";

/*
  Отчёт группы в CSV для ведущего (аудит № 30). Как выгрузка заявок бота (lib/server/bot/csv.ts):
  разделитель «;» и BOM — файл сразу открывается колонками в Excel с русской локалью;
  значения, похожие на формулы, экранируются. Файл собирается по запросу и никуда не сохраняется.
  Шаги — числом в своей колонке («из N» в заголовке): «3/6» Excel превратил бы в дату.
*/

export function groupReportToCsv(report: GroupReport): string {
  const header = [
    "Ник",
    "Логин",
    "Баланс, ★",
    "Потрачено сегодня, ★",
    "Потрачено всего, ★",
    "Генераций",
    "Возвратов",
    "Ответов бота",
    ...report.lessons.flatMap((lesson) => [`Урок ${lesson.n}: шагов из ${lesson.steps}`, `Урок ${lesson.n}: тест`]),
  ];
  const rows = report.students.map((s) => [
    s.nickname,
    s.login ?? "",
    String(s.balance),
    String(s.spent.today),
    String(s.spent.total),
    String(s.spent.generations),
    String(s.spent.refunds),
    String(s.spent.botReplies),
    ...report.lessons.flatMap((lesson) => {
      const quiz = s.quiz[lesson.id];
      return [String(s.progress[lesson.id] ?? 0), quiz ? `${quiz.score} из ${quiz.maxScore}` : ""];
    }),
  ]);
  return "﻿" + [header, ...rows].map((row) => row.map(escapeCell).join(";")).join("\r\n") + "\r\n";
}
