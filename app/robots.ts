import type { MetadataRoute } from "next";

// Сайт открывается только по прямой ссылке: просим поисковики его не индексировать.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      disallow: "/",
    },
  };
}
