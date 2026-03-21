"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { createClient } from "../lib/supabase";

/** Кэш строк портфолио: при переключении вкладок не делаем повторный запрос; инвалидируется при add/remove монеты */
export type PortfolioCacheEntry = { sig: string; rows: Record<string, unknown>[] };

type AuthUser = {
  id: string;
  email?: string | null;
};

/** Максимум экземпляров одной монеты в коллекции (совпадает с check в БД) */
export const MAX_COLLECTION_QUANTITY = 99999;

type AuthContextValue = {
  user: AuthUser | null;
  collectionIds: Set<string>;
  /** Количество по coin_id (только для монет в коллекции) */
  collectionQuantities: Record<string, number>;
  isAuthorized: boolean;
  addToCollection: (coinId: string) => Promise<void>;
  removeFromCollection: (coinId: string) => Promise<void>;
  /** Сохранить количество в Supabase (кламп 1…MAX_COLLECTION_QUANTITY) */
  updateCollectionQuantity: (coinId: string, quantity: number) => Promise<void>;
  inCollection: (coinId: string) => boolean;
  /** Кэш портфолио (sig = отсортированный join collectionIds); null после add/remove */
  portfolioCache: PortfolioCacheEntry | null;
  setPortfolioCache: (entry: PortfolioCacheEntry | null) => void;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  /** Смена пароля в профиле: текущий + новый */
  changePassword: (currentPassword: string, newPassword: string) => Promise<{ error: string | null }>;
  /** Отправка magic-link на email */
  sendMagicLink: (email: string, redirectTo?: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  loading: boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/** Ключ localStorage такой же, как у Supabase: sb-<hostname_first_part>-auth-token */
function getStoredUserId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!url) return null;
    const hostname = new URL(url).hostname;
    const prefix = hostname.split(".")[0];
    const key = `sb-${prefix}-auth-token`;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw);
    const userId = data?.user?.id ?? data?.session?.user?.id;
    if (userId) return userId;
    const accessToken = data?.access_token ?? data?.session?.access_token;
    if (accessToken && typeof accessToken === "string") {
      const payload = JSON.parse(atob(accessToken.split(".")[1]));
      if (payload.exp && payload.exp * 1000 < Date.now()) return null;
      if (payload.sub) return payload.sub;
    }
  } catch {
    // ignore
  }
  return null;
}

function useSupabase() {
  const [client] = useState(() => {
    try {
      return createClient();
    } catch {
      return null;
    }
  });
  return client;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = useSupabase();
  const [user, setUser] = useState<AuthUser | null>(() => {
    const id = getStoredUserId();
    return id ? { id } : null;
  });
  const [collectionIds, setCollectionIds] = useState<Set<string>>(new Set());
  const [collectionQuantities, setCollectionQuantities] = useState<Record<string, number>>({});
  const [portfolioCache, setPortfolioCache] = useState<PortfolioCacheEntry | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchCollection = useCallback(async (userId: string) => {
    if (!supabase) return;
    // Сначала с quantity (новая схема). Если колонки ещё нет в БД — fallback на coin_id, все qty = 1.
    let rows: { coin_id: string | number; quantity?: number | null }[] | null = null;
    const withQty = await supabase
      .from("user_collection")
      .select("coin_id, quantity")
      .eq("user_id", userId);
    if (!withQty.error && withQty.data) {
      rows = withQty.data as { coin_id: string | number; quantity?: number | null }[];
    } else {
      const onlyId = await supabase.from("user_collection").select("coin_id").eq("user_id", userId);
      if (onlyId.error) return;
      rows = (onlyId.data ?? []) as { coin_id: string | number }[];
    }
    const ids = new Set<string>();
    const quantities: Record<string, number> = {};
    for (const r of rows ?? []) {
      const id = String(r.coin_id);
      ids.add(id);
      const raw = "quantity" in r ? r.quantity : undefined;
      const n = typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : 1;
      quantities[id] = Math.min(MAX_COLLECTION_QUANTITY, Math.max(1, n));
    }
    setCollectionIds(ids);
    setCollectionQuantities(quantities);
  }, [supabase]);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user?.id) {
        setUser({ id: session.user.id, email: session.user.email ?? null });
        await fetchCollection(session.user.id);
      }
      setLoading(false);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user?.id) {
        setUser({ id: session.user.id, email: session.user.email ?? null });
        fetchCollection(session.user.id);
      } else {
        setUser(null);
        setCollectionIds(new Set());
        setCollectionQuantities({});
      }
    });
    return () => subscription.unsubscribe();
  }, [supabase, fetchCollection]);

  const addToCollection = useCallback(
    async (coinId: string) => {
      if (!supabase || !user) return;
      let ins = await supabase
        .from("user_collection")
        .insert({ user_id: user.id, coin_id: coinId, quantity: 1 });
      if (ins.error) {
        ins = await supabase.from("user_collection").insert({ user_id: user.id, coin_id: coinId });
      }
      if (ins.error) return;
      setCollectionIds((prev) => new Set(prev).add(coinId));
      setCollectionQuantities((prev) => ({ ...prev, [coinId]: 1 }));
      setPortfolioCache(null); // инвалидируем кэш: коллекция изменилась
    },
    [supabase, user]
  );

  const removeFromCollection = useCallback(
    async (coinId: string) => {
      if (!supabase || !user) return;
      await supabase.from("user_collection").delete().eq("user_id", user.id).eq("coin_id", coinId);
      setCollectionIds((prev) => {
        const next = new Set(prev);
        next.delete(coinId);
        return next;
      });
      setCollectionQuantities((prev) => {
        const next = { ...prev };
        delete next[coinId];
        return next;
      });
      setPortfolioCache(null); // инвалидируем кэш: коллекция изменилась
    },
    [supabase, user]
  );

  const updateCollectionQuantity = useCallback(
    async (coinId: string, quantity: number) => {
      if (!supabase || !user) return;
      const q = Math.min(
        MAX_COLLECTION_QUANTITY,
        Math.max(1, Math.floor(Number(quantity)) || 1)
      );
      let previous = 1;
      setCollectionQuantities((prev) => {
        previous = prev[coinId] ?? 1;
        return { ...prev, [coinId]: q };
      });
      const { error } = await supabase
        .from("user_collection")
        .update({ quantity: q })
        .eq("user_id", user.id)
        .eq("coin_id", coinId);
      if (error) {
        setCollectionQuantities((prev) => ({ ...prev, [coinId]: previous }));
      }
    },
    [supabase, user]
  );

  const inCollection = useCallback((coinId: string) => collectionIds.has(coinId), [collectionIds]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      if (!supabase) return { error: "Supabase не настроен" };
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error: error?.message ?? null };
    },
    [supabase]
  );

  const signUp = useCallback(
    async (email: string, password: string) => {
      if (!supabase) return { error: "Supabase не настроен" };
      const { error } = await supabase.auth.signUp({ email, password });
      return { error: error?.message ?? null };
    },
    [supabase]
  );

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      if (!supabase) return { error: "Supabase не настроен" };
      if (!user?.email) return { error: "Пользователь не найден" };
      // Проверяем текущий пароль
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: currentPassword,
      });
      if (signInError) return { error: "INVALID_CURRENT_PASSWORD" };
      // Если текущий пароль верный — обновляем на новый
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      return { error: error?.message ?? null };
    },
    [supabase, user]
  );

  const sendMagicLink = useCallback(
    async (email: string, redirectTo?: string) => {
      if (!supabase) return { error: "Supabase не настроен" };
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: redirectTo ? { emailRedirectTo: redirectTo } : undefined,
      });
      return { error: error?.message ?? null };
    },
    [supabase]
  );

  const signOut = useCallback(async () => {
    if (supabase) await supabase.auth.signOut();
  }, [supabase]);

  const value: AuthContextValue = {
    user,
    collectionIds,
    collectionQuantities,
    isAuthorized: !!user,
    addToCollection,
    removeFromCollection,
    updateCollectionQuantity,
    inCollection,
    portfolioCache,
    setPortfolioCache,
    signIn,
    signUp,
    changePassword,
    sendMagicLink,
    signOut,
    loading,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    return {
      user: null,
      collectionIds: new Set(),
      collectionQuantities: {},
      isAuthorized: false,
      addToCollection: async () => {},
      removeFromCollection: async () => {},
      updateCollectionQuantity: async () => {},
      inCollection: () => false,
      portfolioCache: null,
      setPortfolioCache: () => {},
      signIn: async () => ({ error: "AuthProvider не подключён" }),
      signUp: async () => ({ error: "AuthProvider не подключён" }),
      changePassword: async () => ({ error: "AuthProvider не подключён" }),
      sendMagicLink: async () => ({ error: "AuthProvider не подключён" }),
      signOut: async () => {},
      loading: false,
    };
  }
  return ctx;
}
