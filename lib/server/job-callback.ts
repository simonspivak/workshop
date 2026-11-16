import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { appUrl, gatewayConfig, supabaseSecretConfig } from "@/lib/server/env";
import { advanceJob, loadJob } from "@/lib/server/job-progress";
import type { JobAction } from "@/lib/platform/generation-types";

/*
  Обратный вызов «задача готова» (docs/kie-gateway.md, «Обратный вызов», docs/platform/spec.md §3.1).

  При создании задачи платформа отдаёт шлюзу callbackUrl:
    <APP_URL>/api/jobs/callback?job=<id задачи платформы>&sig=<HMAC-SHA256(id), hex>
  Шлюз передаёт его kie (поле callBackUrl), kie зовёт адрес, когда задача закончилась.

  Вызов — только сигнал «проверь эту задачу сейчас». Тело запроса не читаем: результат берём,
  как и при опросе, у шлюза (status), поэтому утёкший адрес не может подсунуть чужие ссылки.
  Подпись привязана к одной задаче и ничего, кроме внеочередной проверки этой задачи, не даёт.

  Ключ подписи выводится из SUPABASE_SECRET_KEY, как в rate-limit.ts keyFor: новой переменной нет.
  Смена секретного ключа Supabase делает недействительными адреса уже идущих задач — их доведёт опрос.
*/

/** Действия с асинхронной задачей kie: только для них есть обратный вызов (не текст, не монтаж). */
const CALLBACK_ACTIONS: readonly JobAction[] = ["image", "image_edit", "video", "motion", "lipsync", "voice", "music"];

export const JOB_CALLBACK_PATH = "/api/jobs/callback";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SIGNATURE = /^[0-9a-f]{64}$/;

function signingKey(): Buffer {
  return createHmac("sha256", supabaseSecretConfig().secretKey).update("iistart:job-callback:v1").digest();
}

/** Подпись адреса обратного вызова для задачи (hex, 64 знака). */
export function jobCallbackSignature(jobId: string): string {
  return createHmac("sha256", signingKey()).update(jobId.toLowerCase()).digest("hex");
}

/**
 * id задачи из query (?job=…&sig=…), если подпись верна; иначе null.
 * Сравнение за постоянное время; без обращений к базе и шлюзу.
 */
export function verifyJobCallback(params: URLSearchParams): string | null {
  const jobId = (params.get("job") ?? "").toLowerCase();
  const sig = (params.get("sig") ?? "").toLowerCase();
  if (!UUID.test(jobId) || !SIGNATURE.test(sig)) return null;
  const expected = Buffer.from(jobCallbackSignature(jobId), "hex");
  const received = Buffer.from(sig, "hex");
  return expected.length === received.length && timingSafeEqual(expected, received) ? jobId : null;
}

/**
 * Публичный https-адрес сайта, на который kie может позвонить. null — mock-режим, APP_URL не задан
 * или это локальный адрес: тогда обратного вызова нет, задачу ведёт только опрос.
 */
function publicBaseUrl(): string | null {
  if (gatewayConfig().mode === "mock") return null;
  const base = appUrl();
  if (!base) return null;
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".localhost")) {
    return null;
  }
  return base;
}

/** Будет ли у задачи этого действия обратный вызов (решается до создания задачи, по настройкам). */
export function callbackPlanned(action: JobAction): boolean {
  return CALLBACK_ACTIONS.includes(action) && publicBaseUrl() !== null;
}

/** Адрес обратного вызова для задачи, или null (см. callbackPlanned). */
export function jobCallbackUrl(jobId: string, action: JobAction): string | null {
  if (!CALLBACK_ACTIONS.includes(action) || !UUID.test(jobId.toLowerCase())) return null;
  const base = publicBaseUrl();
  if (!base) return null;
  const query = new URLSearchParams({ job: jobId.toLowerCase(), sig: jobCallbackSignature(jobId) });
  return `${base}${JOB_CALLBACK_PATH}?${query.toString()}`;
}

export type CallbackOutcome = "checked" | "ignored";

/**
 * Обработать сигнал по задаче с уже проверенной подписью. Только submitted: внеочередная проверка
 * у шлюза тем же advanceJob, что и опрос (замки claim_job_poll и begin_job_storing те же, поэтому
 * одновременный опрос из браузера не обработает задачу второй раз). Готовая, неудачная, удалённая,
 * ещё не отправленная задача — ничего не делаем (повторные вызовы kie безвредны).
 */
export async function processJobCallback(jobId: string, deadline: number): Promise<CallbackOutcome> {
  const job = await loadJob(jobId);
  if (!job || job.deleted_at || job.status !== "submitted") return "ignored";
  await advanceJob(job, { deadline, trigger: "callback" });
  return "checked";
}
