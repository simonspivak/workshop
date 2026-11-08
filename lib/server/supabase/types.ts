// Типы схемы public для supabase-js. Написаны вручную по supabase/migrations/20261101200000_init.sql.
// Меняете миграцию — поправьте и этот файл (или сгенерируйте: `supabase gen types typescript --linked`).

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type AppRole = "admin" | "teacher" | "student";
export type AgeBand = "u16" | "16_17" | "adult";
export type JobStatus = "queued" | "submitted" | "storing" | "done" | "failed";
export type JobAction = "text" | "image" | "image_edit" | "video" | "motion" | "lipsync" | "voice" | "music" | "montage";
export type PriceAction = JobAction | "bot_reply";
export type PriceTier = "base" | "long";
export type PriceAccess = "all" | "adult" | "google" | "adult_or_16_consent" | "staff";
export type GroupKind = "teens" | "adults" | "corporate" | "individual" | "demo";
export type LedgerReason = "welcome" | "grant" | "adjust" | "debit" | "refund" | "quiz_bonus" | "bot_reply";
export type BotChannel = "web" | "telegram";

type Timestamps = { created_at: string; updated_at: string };

type ProfileRow = Timestamps & {
  id: string;
  role: AppRole;
  login: string | null;
  nickname: string;
  group_id: string | null;
  age_band: AgeBand;
  parental_consent_at: string | null;
  disabled: boolean;
  created_by: string | null;
};

type GroupRow = Timestamps & {
  id: string;
  code: string;
  title: string;
  kind: GroupKind;
  teacher_id: string;
  paused: boolean;
  daily_cap: number;
  budget_stars: number | null;
  planned_students: number | null;
  stars_per_student: number | null;
  ends_on: string | null;
  allow_google_minors: boolean;
  share_gallery: boolean;
};

type WalletRow = { user_id: string; balance: number; updated_at: string };

type PriceRow = {
  action: PriceAction;
  model: string;
  tier: PriceTier;
  stars: number;
  access: PriceAccess;
  library_only: boolean;
  enabled: boolean;
  position: number;
  label: string | null;
  updated_at: string;
};

type SettingRow = { key: string; value: Json; updated_at: string };

type JobRow = Timestamps & {
  id: string;
  user_id: string;
  group_id: string | null;
  action: JobAction;
  model: string;
  params: Json;
  prompt: string | null;
  status: JobStatus;
  stars: number;
  idempotency_key: string;
  gateway_task_id: string | null;
  storage_path: string | null;
  extra_paths: string[];
  mime_type: string | null;
  result_text: string | null;
  credits: number | null;
  error: string | null;
  hidden: boolean;
  hidden_by: string | null;
  /** мягкое удаление владельцем или ведущим (20261108120000_job_delete); звёзды не возвращаются */
  deleted_at: string | null;
  lesson_id: string | null;
  task_ref: string | null;
  last_polled_at: string | null;
  submitted_at: string | null;
  completed_at: string | null;
};

type LedgerRow = {
  id: number;
  user_id: string;
  delta: number;
  reason: LedgerReason;
  balance_after: number;
  job_id: string | null;
  ref: string | null;
  idempotency_key: string | null;
  note: string | null;
  actor_id: string | null;
  created_at: string;
};

type QuizAttemptRow = {
  id: string;
  user_id: string;
  lesson_id: string;
  answers: Json;
  score: number;
  max_score: number;
  bonus: number;
  created_at: string;
};

type LessonProgressRow = { user_id: string; lesson_id: string; step: string; completed_at: string };

type BotRow = Timestamps & {
  id: string;
  owner_id: string;
  slug: string;
  name: string;
  soul: string;
  knowledge: string;
  tools: Json;
  avatar_job_id: string | null;
  active: boolean;
  telegram_bot_id: number | null;
  telegram_bot_username: string | null;
  telegram_token_ciphertext: string | null;
  telegram_token_iv: string | null;
  telegram_token_tag: string | null;
  telegram_webhook_secret_hash: string | null;
  telegram_owner_chat_id: number | null;
  telegram_connected_at: string | null;
  telegram_disconnected_at: string | null;
};

type BotMessageRow = {
  id: number;
  bot_id: string;
  channel: BotChannel;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  ip_hash: string | null;
  telegram_update_id: number | null;
  stars: number;
  /** ключ входящего сообщения: повтор не записывается (миграция 20261105100000) */
  dedupe_key: string | null;
  created_at: string;
};

type BotLeadRow = {
  id: string;
  bot_id: string;
  channel: BotChannel;
  conversation_id: string | null;
  data: Json;
  notified_at: string | null;
  created_at: string;
};

type AuditRow = {
  id: number;
  actor_id: string | null;
  action: string;
  target_user: string | null;
  target_group: string | null;
  meta: Json;
  created_at: string;
};

// Insert: обязательные поля без значений по умолчанию, остальное — по желанию
type Table<Row, Required extends keyof Row, Rel extends Relationship[] = []> = {
  Row: Row;
  Insert: Pick<Row, Required> & Partial<Omit<Row, Required>>;
  Update: Partial<Row>;
  Relationships: Rel;
};

type Relationship = {
  foreignKeyName: string;
  columns: string[];
  isOneToOne?: boolean;
  referencedRelation: string;
  referencedColumns: string[];
};

export type Database = {
  public: {
    Tables: {
      profiles: Table<
        ProfileRow,
        "id" | "nickname",
        [
          {
            foreignKeyName: "profiles_group_fk";
            columns: ["group_id"];
            isOneToOne: false;
            referencedRelation: "groups";
            referencedColumns: ["id"];
          },
        ]
      >;
      groups: Table<
        GroupRow,
        "code" | "title" | "teacher_id",
        [
          {
            foreignKeyName: "groups_teacher_id_fkey";
            columns: ["teacher_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ]
      >;
      wallets: Table<
        WalletRow,
        "user_id",
        [
          {
            foreignKeyName: "wallets_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ]
      >;
      price_list: Table<PriceRow, "action" | "model" | "stars">;
      settings: Table<SettingRow, "key" | "value">;
      jobs: Table<
        JobRow,
        "user_id" | "action" | "model" | "idempotency_key",
        [
          {
            foreignKeyName: "jobs_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ]
      >;
      star_ledger: Table<LedgerRow, "user_id" | "delta" | "reason" | "balance_after">;
      quiz_attempts: Table<QuizAttemptRow, "user_id" | "lesson_id" | "answers" | "score" | "max_score">;
      lesson_progress: Table<LessonProgressRow, "user_id" | "lesson_id" | "step">;
      bots: Table<BotRow, "owner_id" | "slug" | "name">;
      bot_messages: Table<BotMessageRow, "bot_id" | "channel" | "conversation_id" | "role" | "content">;
      bot_leads: Table<BotLeadRow, "bot_id" | "channel" | "data">;
      audit_log: Table<AuditRow, "action">;
    };
    Views: { [_ in never]: never };
    Functions: {
      create_job: {
        Args: {
          p_user: string;
          p_action: JobAction;
          p_model: string;
          p_stars: number;
          p_idempotency_key: string;
          p_params?: Json;
          p_prompt?: string | null;
          p_lesson_id?: string | null;
          p_task_ref?: string | null;
        };
        Returns: { job_id: string; balance: number; reused: boolean }[];
      };
      mark_job_submitted: { Args: { p_job: string; p_task_id: string }; Returns: boolean };
      claim_job_poll: { Args: { p_job: string; p_min_interval?: number }; Returns: boolean };
      begin_job_storing: { Args: { p_job: string }; Returns: boolean };
      complete_job: {
        Args: {
          p_job: string;
          p_storage_path?: string | null;
          p_extra_paths?: string[];
          p_mime_type?: string | null;
          p_result_text?: string | null;
          p_credits?: number | null;
        };
        Returns: boolean;
      };
      refund_job: { Args: { p_job: string; p_error: string }; Returns: { refunded: number; balance: number }[] };
      grant_stars: {
        Args: {
          p_actor: string;
          p_user: string;
          p_amount: number;
          p_note?: string | null;
          p_idempotency_key?: string | null;
        };
        Returns: number;
      };
      spend_stars: {
        Args: {
          p_user: string;
          p_amount: number;
          p_reason: "bot_reply";
          p_idempotency_key: string;
          p_ref?: string | null;
        };
        Returns: { balance: number; charged: boolean }[];
      };
      insert_bot_message: {
        Args: {
          p_bot: string;
          p_channel: BotChannel;
          p_conversation_id: string;
          p_role: "user" | "assistant";
          p_content: string;
          p_ip_hash?: string | null;
          p_telegram_update_id?: number | null;
          p_stars?: number;
          p_dedupe_key?: string | null;
          p_sender_per_hour?: number | null;
          p_bot_per_day?: number | null;
        };
        Returns: { message_id: number | null; outcome: "accepted" | "duplicate" | "sender_hour" | "bot_day" }[];
      };
      rate_limit_hit: { Args: { p_key: string; p_limit: number; p_window_seconds: number }; Returns: boolean };
      rate_limit_reset: { Args: { p_key: string }; Returns: undefined };
      record_quiz_attempt: {
        Args: {
          p_user: string;
          p_lesson_id: string;
          p_answers: Json;
          p_score: number;
          p_max_score: number;
          p_bonus?: number;
        };
        Returns: {
          attempt_id: string;
          score: number;
          max_score: number;
          bonus: number;
          balance: number;
          already_done: boolean;
        }[];
      };
    };
    Enums: { app_role: AppRole; age_band: AgeBand; job_status: JobStatus };
    CompositeTypes: { [_ in never]: never };
  };
};
