"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { AuthError, authorize, STAFF_ROLES } from "@/lib/server/dal/auth";
import { ConfigError } from "@/lib/server/env";
import { setJobHidden } from "@/lib/server/gallery";
import type { HideResult } from "@/components/platform/GalleryGrid";

const schema = z.object({ jobId: z.uuid(), hidden: z.enum(["1", "0"]) });

/** Скрыть результат ученика из галерей (или вернуть). Только ведущий этой группы или админ; пишет audit_log. */
export async function toggleJobHidden(_prev: HideResult | null, formData: FormData): Promise<HideResult> {
  try {
    const user = await authorize(STAFF_ROLES);
    const parsed = schema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ok: false, error: "invalid_input" };
    const result = await setJobHidden(user, parsed.data.jobId, parsed.data.hidden === "1");
    if (!result.ok) return { ok: false, error: result.error };
    refresh();
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.code };
    if (error instanceof ConfigError) return { ok: false, error: "not_configured" };
    console.error("teach.toggleJobHidden: unexpected error", { error: error instanceof Error ? error.message : String(error) });
    return { ok: false, error: "server_error" };
  }
}
