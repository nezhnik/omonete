import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** Один инстанс на вкладку: при React Strict Mode компонент монтируется дважды — без singleton получались два клиента и гонка за lock. */
let browserClient: SupabaseClient | null = null;

function devAuthLockBypass() {
  return process.env.NODE_ENV === "development"
    ? {
        auth: {
          lock: async <R,>(_name: string, _acquireTimeout: number, fn: () => Promise<R>) => fn(),
        },
      }
    : {};
}

export function createClient(): SupabaseClient {
  if (!url || !anonKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  const opts = devAuthLockBypass();
  if (typeof window !== "undefined") {
    if (!browserClient) {
      browserClient = createSupabaseClient(url, anonKey, opts);
    }
    return browserClient;
  }
  // SSR: без кэша (нет window / нет общего смысла в singleton между запросами)
  return createSupabaseClient(url, anonKey, opts);
}
