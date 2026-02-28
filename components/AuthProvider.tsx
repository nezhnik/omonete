"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { createClient } from "../lib/supabase";

/** Кэш строк портфолио: при переключении вкладок не делаем повторный запрос; инвалидируется при add/remove монеты */
export type PortfolioCacheEntry = { sig: string; rows: Record<string, unknown>[] };

type AuthUser = {
  id: string;
  email?: string | null;
};

type AuthContextValue = {
  user: AuthUser | null;
  collectionIds: Set<string>;
  isAuthorized: boolean;
  addToCollection: (coinId: string) => Promise<void>;
  removeFromCollection: (coinId: string) => Promise<void>;
  inCollection: (coinId: string) => boolean;
  /** Кэш портфолио (sig = отсортированный join collectionIds); null после add/remove */
  portfolioCache: PortfolioCacheEntry | null;
  setPortfolioCache: (entry: PortfolioCacheEntry | null) => void;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
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
  const [portfolioCache, setPortfolioCache] = useState<PortfolioCacheEntry | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchCollection = useCallback(async (userId: string) => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("user_collection")
      .select("coin_id")
      .eq("user_id", userId);
    if (error) return;
    setCollectionIds(new Set((data ?? []).map((r) => r.coin_id)));
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
      }
    });
    return () => subscription.unsubscribe();
  }, [supabase, fetchCollection]);

  const addToCollection = useCallback(
    async (coinId: string) => {
      if (!supabase || !user) return;
      await supabase.from("user_collection").insert({ user_id: user.id, coin_id: coinId });
      setCollectionIds((prev) => new Set(prev).add(coinId));
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
      setPortfolioCache(null); // инвалидируем кэш: коллекция изменилась
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
    isAuthorized: !!user,
    addToCollection,
    removeFromCollection,
    inCollection,
    portfolioCache,
    setPortfolioCache,
    signIn,
    signUp,
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
      isAuthorized: false,
      addToCollection: async () => {},
      removeFromCollection: async () => {},
      inCollection: () => false,
      portfolioCache: null,
      setPortfolioCache: () => {},
      signIn: async () => ({ error: "AuthProvider не подключён" }),
      signUp: async () => ({ error: "AuthProvider не подключён" }),
      sendMagicLink: async () => ({ error: "AuthProvider не подключён" }),
      signOut: async () => {},
      loading: false,
    };
  }
  return ctx;
}
