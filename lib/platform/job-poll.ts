import type { JobAction, JobStatus } from "@/lib/platform/generation-types";

/*
  Расписание опроса задач генерации — чистые функции без ввода-вывода (docs/platform/spec.md §3.1).

  Сервер (GET /api/jobs/[id]): каждый вопрос шлюзу о статусе — платный запуск n8n, поэтому
  шлюз спрашиваем не чаще, чем позволяет таблица GATEWAY_SCHEDULE для этого действия и возраста
  задачи (возраст — от submitted_at). Опрос, пришедший раньше, отвечает из базы.

  Браузер (useLiveJob): пауза между опросами растёт с возрастом задачи, у медленных задач она
  длиннее с самого начала; плюс случайный разброс, чтобы карточки не опрашивали сервер хором,
  и замедление, когда на странице много незавершённых карточек.
*/

const SECOND = 1_000;
const MINUTE = 60 * SECOND;

export type JobPollClass = "fast" | "music" | "video" | "lipsync";

export function jobPollClass(action: JobAction): JobPollClass {
  switch (action) {
    case "video":
    case "motion":
      return "video";
    case "lipsync":
      return "lipsync";
    case "music":
      return "music";
    default:
      return "fast"; // image, image_edit, voice (text и montage шлюз не опрашивают)
  }
}

/** Ступень расписания: пока возраст задачи меньше untilMs, шаг — everySec. */
type Step = { untilMs: number; everySec: number };
type GatewaySchedule = { firstCheckSec: number; steps: Step[] };

/**
 * Серверная таблица: первая проверка статуса не раньше firstCheckSec после отправки,
 * дальше — не чаще шага ступени. Последняя ступень действует без ограничения по возрасту.
 */
export const GATEWAY_SCHEDULE: Record<JobPollClass, GatewaySchedule> = {
  fast: { firstCheckSec: 5, steps: [{ untilMs: 1 * MINUTE, everySec: 5 }, { untilMs: 3 * MINUTE, everySec: 10 }, { untilMs: Infinity, everySec: 20 }] },
  music: { firstCheckSec: 20, steps: [{ untilMs: 3 * MINUTE, everySec: 10 }, { untilMs: Infinity, everySec: 20 }] },
  video: {
    firstCheckSec: 30,
    steps: [{ untilMs: 3 * MINUTE, everySec: 10 }, { untilMs: 6 * MINUTE, everySec: 20 }, { untilMs: Infinity, everySec: 30 }],
  },
  lipsync: { firstCheckSec: 60, steps: [{ untilMs: 5 * MINUTE, everySec: 15 }, { untilMs: Infinity, everySec: 30 }] },
};

function stepFor(steps: Step[], ageMs: number): number {
  return (steps.find((step) => ageMs < step.untilMs) ?? steps[steps.length - 1]).everySec;
}

/**
 * Минимальная пауза (секунды) между проверками статуса у шлюза для задачи этого действия и возраста.
 * Пока задача моложе firstCheckSec, возвращает firstCheckSec: mark_job_submitted ставит
 * last_polled_at = submitted_at, поэтому claim_job_poll не пропустит проверку раньше срока.
 */
export function gatewayPollIntervalSec(action: JobAction, ageMs: number): number {
  const schedule = GATEWAY_SCHEDULE[jobPollClass(action)];
  const age = Math.max(0, ageMs);
  return age < schedule.firstCheckSec * SECOND ? schedule.firstCheckSec : stepFor(schedule.steps, age);
}

/**
 * Пора ли спрашивать шлюз — предварительная проверка по уже прочитанной строке, чтобы не звать
 * RPC claim_job_poll впустую. Последнее слово всё равно за claim_job_poll (атомарно, по часам базы);
 * допуск в секунду — на расхождение часов, лишнего запуска он не даёт.
 */
export function isGatewayCheckDue(lastPolledAt: string | null, intervalSec: number, now: number): boolean {
  if (!lastPolledAt) return true;
  const last = Date.parse(lastPolledAt);
  if (Number.isNaN(last)) return true;
  return now - last >= intervalSec * SECOND - SECOND;
}

// ---------- браузер ----------

/** Сколько запросов делает одна карточка, прежде чем остановиться и показать «Обновить». */
export const CLIENT_MAX_POLLS = 90;
/** Подряд столько ответов 401/403/404 — опрос останавливается (сессия, права, задачи нет). */
export const CLIENT_STOP_AFTER_REJECTS = 2;
/**
 * Вкладка в фоне опрашивает редко, но не молчит: иначе готовый результат ждёт, пока ученик
 * вернётся на вкладку (задачу двигает только опрос), и «видео крутится 20 минут».
 */
export const CLIENT_HIDDEN_MIN_MS = 45 * SECOND;

/** Пауза с учётом видимости вкладки: в фоне — не чаще CLIENT_HIDDEN_MIN_MS. */
export function withVisibility(delayMs: number, visible: boolean): number {
  return visible ? delayMs : Math.max(delayMs, CLIENT_HIDDEN_MIN_MS);
}
/** queued дольше этого — шлюз не подтвердил задачу (ответ неизвестен), ждём возврата. */
export const UNCERTAIN_AFTER_MS = 20 * SECOND;

const CLIENT_STEPS: Record<"fast" | "slow", Step[]> = {
  fast: [{ untilMs: 1 * MINUTE, everySec: 5 }, { untilMs: 3 * MINUTE, everySec: 10 }, { untilMs: Infinity, everySec: 20 }],
  slow: [{ untilMs: 3 * MINUTE, everySec: 10 }, { untilMs: 6 * MINUTE, everySec: 20 }, { untilMs: Infinity, everySec: 30 }],
};
const STORING_MAX_SEC = 5; // копирование занимает секунды — результат показываем сразу
const UNCERTAIN_SEC = 15; // до возврата сервер ничего не делает, кроме проверки возраста
const ERROR_BACKOFF_MAX_MS = 60 * SECOND;
const JITTER = 0.2; // +0…20 %
const CROWD_FREE = 3; // столько карточек опрашивают без замедления
const CROWD_STEP = 0.25; // каждая следующая — +25 % к паузе
const CROWD_MAX = 3; // но не больше чем втрое

export type ClientPollInput = {
  action: JobAction;
  status: JobStatus;
  /** возраст задачи по часам браузера (от createdAt) */
  ageMs: number;
  /** подряд неудачных ответов 5xx / сети */
  errors?: number;
  /** незавершённых карточек на странице, включая эту */
  crowd?: number;
  /** 0…1, по умолчанию Math.random() */
  random?: number;
};

export function clientPollClass(action: JobAction): "fast" | "slow" {
  return jobPollClass(action) === "fast" ? "fast" : "slow";
}

/** Множитель паузы за «толпу» незавершённых карточек на странице. */
export function crowdFactor(crowd: number): number {
  return Math.min(CROWD_MAX, 1 + CROWD_STEP * Math.max(0, crowd - CROWD_FREE));
}

/** Пауза без разброса и множителей: по классу действия, статусу и возрасту. */
export function clientBaseDelayMs(action: JobAction, status: JobStatus, ageMs: number): number {
  const age = Math.max(0, ageMs);
  if (status === "queued" && age > UNCERTAIN_AFTER_MS) return UNCERTAIN_SEC * SECOND;
  const every = stepFor(CLIENT_STEPS[clientPollClass(action)], age);
  return (status === "storing" ? Math.min(every, STORING_MAX_SEC) : every) * SECOND;
}

/** Пауза перед следующим опросом карточки. */
export function clientPollDelayMs(input: ClientPollInput): number {
  const random = input.random ?? Math.random();
  const errors = Math.max(0, input.errors ?? 0);
  let delay = clientBaseDelayMs(input.action, input.status, input.ageMs) * crowdFactor(input.crowd ?? 1);
  if (errors > 0) delay = Math.min(ERROR_BACKOFF_MAX_MS, delay * 2 ** errors);
  return Math.round(delay * (1 + JITTER * random));
}

/**
 * Пауза перед первым опросом после появления карточки (или возвращения на вкладку).
 * Только что созданная быстрая задача — через 1,5 с; медленная — по своей ступени;
 * старая — по своей ступени. Разброс растёт с числом карточек, чтобы галерея не стреляла пачкой.
 */
export function clientFirstDelayMs(input: Omit<ClientPollInput, "errors">): number {
  const random = input.random ?? Math.random();
  const crowd = Math.max(1, input.crowd ?? 1);
  const fresh = input.status === "queued" && input.ageMs < UNCERTAIN_AFTER_MS && clientPollClass(input.action) === "fast";
  const base = fresh ? 1_500 : Math.min(clientBaseDelayMs(input.action, input.status, input.ageMs), 10 * SECOND);
  return Math.round(base + random * Math.min(crowd, 24) * 250);
}
