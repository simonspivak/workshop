// Описание формы текстов сайта. Сене этот файл трогать не нужно:
// он только проверяет, что в content/site.ts ничего не потерялось.

export type Workshop = {
  title: string;
  oneLiner: string;
  skills: string[];
  tools: string[];
  takeaway: string;
};

export type SessionStep = {
  title: string;
  minutes: number;
  text: string;
};

export type AccessFact = {
  tool: string;
  what: string;
  age: string;
  /** "adult" — только 18+, "teen" — можно младше 18 */
  ageLevel: "adult" | "teen";
  source: string;
};

export type AccessOption = {
  title: string;
  price: string;
  /** "recommended" выделяется цветом, "not-recommended" — предупреждением */
  verdict: "neutral" | "recommended" | "not-recommended";
  verdictLabel: string;
  text: string[];
  minus?: string;
  source?: string;
};

export type PortfolioItem = {
  /** Крупная цифра в карточке, например { value: "48", label: "компаний" } */
  stat: { value: string; label: string };
  title: string;
  text: string;
};

export type ChatMessage = {
  /** "me" — сообщение участника (справа), "ai" — ответ ИИ (слева) */
  from: "me" | "ai";
  text: string;
  /** Маленькие «файлы» под сообщением */
  chips?: string[];
};

export type SiteContent = {
  meta: { description: string };
  nav: { label: string; href: string }[];
  skipLink: string;
  ctaLabel: string;
  placeholderPrefix: string;
  hero: {
    badge: string;
    title: string;
    titleHighlight: string;
    lead: string;
    facts: { value: string; label: string }[];
    outcomeTitle: string;
    outcomes: string[];
    secondaryLink: string;
    chat: { title: string; status: string; messages: ChatMessage[] };
  };
  marquee: string[];
  route: {
    title: string;
    intro: string;
    stationLabel: string;
    skillsTitle: string;
    toolsTitle: string;
    takeawayTitle: string;
    items: Workshop[];
    finishTitle: string;
    finishText: string;
    moreLink: string;
  };
  session: {
    title: string;
    intro: string;
    minutesLabel: string;
    steps: SessionStep[];
    note: string;
  };
  access: {
    title: string;
    asOf: string;
    problem: string;
    keyFact: string;
    factsTitle: string;
    sourceLabel: string;
    facts: AccessFact[];
    optionsTitle: string;
    options: AccessOption[];
  };
  booking: {
    title: string;
    text: string;
    schedule: string;
    calendarText: string;
    calendarButton: string;
    iframeTitle: string;
    fallbackText: string;
    telegramButton: string;
  };
  footer: {
    contactsTitle: string;
    note: string;
  };
  workshopsPage: {
    title: string;
    intro: string;
    note: string;
  };
  about: {
    title: string;
    role: string;
    intro: string[];
    photoAlt: string;
    photoPlaceholder: string;
    stats: { value: string; label: string }[];
    experienceTitle: string;
    experience: string[];
    portfolioTitle: string;
    portfolioIntro: string;
    portfolio: PortfolioItem[];
    contactsTitle: string;
    contactsText: string;
    ctaText: string;
  };
};
