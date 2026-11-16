import { connection } from "next/server";
import { authorizeCourse } from "@/lib/server/dal/auth";
import { json, listStudioMedia, studioFailure } from "@/lib/server/studio";

// Медиа для студии монтажа: свои готовые клипы, картинки, озвучки и музыка
// (+ общая галерея группы, если учитель её включил) с подписанными ссылками на час.
export async function GET() {
  // только по запросу: ответ зависит от пользователя, при сборке не пререндерим
  await connection();
  try {
    const user = await authorizeCourse();
    return json(await listStudioMedia(user));
  } catch (error) {
    return studioFailure(error, "media");
  }
}
