"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Lottie from "lottie-react";
import { Header } from "../../components/Header";
import { useAuth } from "../../components/AuthProvider";

export default function LoginPage() {
  const [moneyAnimationData, setMoneyAnimationData] = useState<object | null>(null);
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { signIn, signUp, sendMagicLink, isAuthorized } = useAuth();
  const router = useRouter();

  useEffect(() => {
    fetch("/animations/Money_fly.json")
      .then((res) => res.json())
      .then(setMoneyAnimationData)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (isAuthorized) router.replace("/portfolio");
  }, [isAuthorized, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setSubmitting(true);
    const { error: err } = mode === "in" ? await signIn(email, password) : await signUp(email, password);
    setSubmitting(false);
    if (err) setError(err);
    else router.replace("/portfolio");
  };

  const handleMagicLink = async () => {
    setError(null);
    setInfo(null);
    if (!email) {
      setError("Введите email, чтобы получить ссылку для входа.");
      return;
    }
    const redirectTo = typeof window !== "undefined" ? `${window.location.origin}/login` : undefined;
    const { error: err } = await sendMagicLink(email, redirectTo);
    if (err) setError(err);
    else setInfo("Мы отправили ссылку для входа на указанный email. Проверьте почту.");
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header activePath="/login" />
      <main className="flex-1 flex flex-col items-center justify-center py-16 px-4 text-center">
        <div className="w-[168px] h-[168px] mb-6 flex items-center justify-center">
          {moneyAnimationData ? (
            <Lottie animationData={moneyAnimationData} loop style={{ width: 168, height: 168 }} />
          ) : (
            <div className="w-full h-full rounded-full bg-[#E4E4EA]" aria-hidden />
          )}
        </div>
        <p className="text-black text-[18px] leading-[1.4] max-w-[360px] font-medium mb-6">
          {mode === "in" ? "Вход в аккаунт" : "Регистрация"}
        </p>
        <form onSubmit={handleSubmit} className="w-full max-w-[320px] flex flex-col gap-3 text-left">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full px-4 py-3 rounded-2xl border border-[#E4E4EA] text-[16px] outline-none focus:border-[#11111B]"
          />
          <input
            type="password"
            placeholder="Пароль"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            className="w-full px-4 py-3 rounded-2xl border border-[#E4E4EA] text-[16px] outline-none focus:border-[#11111B]"
          />
          {error && <p className="text-red-600 text-[14px]">{error}</p>}
          {info && !error && <p className="text-green-600 text-[14px]">{info}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="mt-2 w-full px-6 py-3 rounded-[300px] bg-[#11111B] text-white text-[16px] font-medium hover:opacity-90 transition-opacity disabled:opacity-60"
          >
            {submitting ? "..." : mode === "in" ? "Войти" : "Зарегистрироваться"}
          </button>
        </form>
        <button
          type="button"
          onClick={handleMagicLink}
          className="mt-3 text-[#11111B] text-[14px] underline hover:text-black"
        >
          Войти по ссылке на e-mail
        </button>
        <button
          type="button"
          onClick={() => { setMode(mode === "in" ? "up" : "in"); setError(null); setInfo(null); }}
          className="mt-2 text-[#666666] text-[14px] underline hover:text-[#11111B]"
        >
          {mode === "in" ? "Нет аккаунта? Зарегистрироваться" : "Уже есть аккаунт? Войти"}
        </button>
      </main>
    </div>
  );
}
