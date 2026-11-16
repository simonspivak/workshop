import { connection } from "next/server";
import { authorize } from "@/lib/server/dal/auth";
import { listAttachOptions } from "@/lib/server/homework/attachments";
import { homeworkFailure } from "@/lib/server/homework/submissions";
import { json } from "@/lib/server/studio";

// «Прикрепить из галереи»: свои готовые результаты (картинки, видео, звук, монтаж), новые первыми,
// с подписанными ссылками для превью. Только свои: чтение через RLS клиента пользователя.
export async function GET() {
  // только по запросу: ответ зависит от пользователя, при сборке не пререндерим
  await connection();
  try {
    const user = await authorize();
    return json({ ok: true, items: await listAttachOptions(user) });
  } catch (error) {
    return homeworkFailure(error, "gallery");
  }
}
