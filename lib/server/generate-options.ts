import "server-only";
import { isStaff, type SessionUser } from "@/lib/server/dal/auth";
import { isGatewayModel } from "@/lib/server/gateway";
import { canUse, listModels, LONG_TEXT_TOKENS } from "@/lib/server/prices";
import type { GenerateAction, GenerateActionOption } from "@/lib/platform/generation-types";
import type { LessonAiAction, LessonView } from "@/lib/platform/lesson-types";

/*
  Кнопки ИИ-действий урока: цена и доступ — из прайса (canUse), а не из JSON урока.
  Недоступное действие показывается выключенным с причиной (модели Google для младших,
  только 18+, нужна отметка согласия, пауза группы, пустая библиотека движений).
  Ведущему и админу — все модели шлюза бесплатно и выбор модели (демо-режим, spec §7).
*/

const LONG_TEXT_STARS = 3;
const LONG_TEXT_MAX_TOKENS = 2000;

export type ActionContext = { motionLibraryEmpty: boolean };

export async function describeAction(
  user: SessionUser,
  ai: LessonAiAction,
  context: ActionContext,
): Promise<GenerateActionOption | null> {
  if (ai.type === "montage") return null;
  const action: GenerateAction = ai.type;
  const long = action === "text" && ai.stars >= LONG_TEXT_STARS;
  const options = { maxTokens: long ? LONG_TEXT_MAX_TOKENS : LONG_TEXT_TOKENS, duration: 5 };

  const decision = await canUse(user, action, ai.model, options);
  const staff = isStaff(user);
  const models = staff
    ? (await listModels(user, action, options))
        .filter((m) => m.available && isGatewayModel(action, m.model))
        .map((m) => ({ model: m.model, label: m.label ?? m.model, stars: m.stars }))
    : [];

  let reason: GenerateActionOption["reason"] = decision.ok ? null : decision.reason;
  if (!reason && !isGatewayModel(action, ai.model)) reason = "unknown_model";
  if (!reason && !staff && user.group?.paused) reason = "group_paused";
  if (!reason && action === "motion" && decision.ok && decision.libraryOnly && !staff && context.motionLibraryEmpty) {
    reason = "library_empty";
  }

  const longVideo = action === "video" && decision.ok ? await canUse(user, "video", ai.model, { duration: 10 }) : null;

  return {
    key: `${action}:${ai.model}:${long ? "long" : "base"}`,
    action,
    model: ai.model,
    modelLabel: (decision.ok ? decision.label : null) ?? ai.model,
    stars: decision.ok ? decision.stars : ai.stars,
    longStars: longVideo?.ok ? longVideo.stars : null,
    long,
    available: reason === null,
    reason,
    models,
  };
}

/** Кнопки для каждого задания урока: { [taskId]: options }. Одинаковые действия склеиваются. */
export async function describeLessonActions(
  user: SessionUser,
  lesson: LessonView,
  context: ActionContext,
): Promise<Record<string, GenerateActionOption[]>> {
  const entries = await Promise.all(
    lesson.tasks.map(async (task) => {
      const described = await Promise.all(task.aiActions.map((ai) => describeAction(user, ai, context)));
      const unique = new Map<string, GenerateActionOption>();
      for (const option of described) if (option && !unique.has(option.key)) unique.set(option.key, option);
      return [task.id, [...unique.values()]] as [string, GenerateActionOption[]];
    }),
  );
  return Object.fromEntries(entries);
}
