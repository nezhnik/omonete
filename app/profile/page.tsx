"use client";

import { useEffect, useState, ChangeEvent, useRef } from "react";
import { IconCamera } from "@tabler/icons-react";
import { Header } from "../../components/Header";
import { Button } from "../../components/Button";
import { useAuth } from "../../components/AuthProvider";

type ProfileData = {
  fullName: string;
  city: string;
  about: string;
  contacts: string;
  photoDataUrl: string | null;
};

const MAX_AVATAR_BYTES = 24 * 1024;

function getStorageKey(userId: string | null) {
  return userId ? `profile_${userId}` : "profile_guest";
}

async function fileToImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Не удалось загрузить изображение")); 
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error("Не удалось прочитать файл")); 
    reader.readAsDataURL(file);
  });
}

async function compressImage(file: File, maxBytes = MAX_AVATAR_BYTES): Promise<string> {
  const img = await fileToImage(file);

  const maxSize = 320;
  const ratio = Math.min(1, maxSize / Math.max(img.width, img.height || 1));
  const width = Math.max(1, Math.round(img.width * ratio));
  const height = Math.max(1, Math.round(img.height * ratio));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas не поддерживается");
  ctx.drawImage(img, 0, 0, width, height);

  let quality = 0.8;
  let dataUrl = canvas.toDataURL("image/webp", quality);

  while (dataUrl.length * 0.75 > maxBytes && quality > 0.2) {
    quality -= 0.1;
    dataUrl = canvas.toDataURL("image/webp", quality);
  }

  return dataUrl;
}

export default function ProfilePage() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<ProfileData>({
    fullName: "",
    city: "",
    about: "",
    contacts: "",
    photoDataUrl: null,
  });
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [savedVisible, setSavedVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const key = getStorageKey(user?.id ?? null);
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem(key) : null;
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<ProfileData>;
      setProfile((prev) => ({
        ...prev,
        ...parsed,
      }));
    } catch {
      // ignore
    }
  }, [user?.id]);

  useEffect(() => {
    const key = getStorageKey(user?.id ?? null);
    try {
      if (typeof window !== "undefined") {
        localStorage.setItem(key, JSON.stringify(profile));
      }
    } catch {
      // ignore
    }
  }, [profile, user?.id]);

  const handleSaveClick = () => {
    setSaving(true);
    try {
      const key = getStorageKey(user?.id ?? null);
      if (typeof window !== "undefined") {
        localStorage.setItem(key, JSON.stringify(profile));
      }
      setSavedNotice("Данные сохранены");
      setSavedVisible(true);
      // через 2 секунды запускаем обратную анимацию
      setTimeout(() => setSavedVisible(false), 2000);
      // ещё через 250 мс убираем уведомление из DOM
      setTimeout(() => setSavedNotice(null), 2250);
    } finally {
      setSaving(false);
    }
  };

  const handleChange =
    (field: keyof ProfileData) =>
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value = e.target.value;
      setProfile((prev) => ({ ...prev, [field]: value }));
    };

  const handlePhotoChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setSaving(true);
    try {
      const compressed = await compressImage(file);
      setProfile((prev) => ({ ...prev, photoDataUrl: compressed }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось обработать изображение");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-white">
      <Header activePath="/profile" />

      <main className="w-full px-4 sm:px-6 lg:px-20 pb-24">
        {savedNotice && (
          <div
            className={`fixed top-[80px] left-1/2 -translate-x-1/2 z-40 px-4 py-2 rounded-[999px] bg-[#11111B] text-white text-[14px] shadow-lg transform transition-transform transition-opacity duration-250 ease-out ${
              savedVisible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-3"
            }`}
          >
            {savedNotice}
          </div>
        )}
        <nav
          className="flex items-center gap-2 pt-6 text-[16px] font-medium text-[#666666]"
          aria-label="Хлебные крошки"
        >
          <span className="text-[#666666]">Профиль</span>
          <span>/</span>
          <span className="text-black">Личные данные</span>
        </nav>

        <article className="mt-8 max-w-[720px] mx-auto flex flex-col gap-8">
          <header className="flex flex-col gap-4">
            <h1 className="text-black text-[28px] sm:text-[40px] font-semibold leading-tight">
              Личные данные
            </h1>
          </header>

          <section className="flex flex-col gap-6 border border-[#E4E4EA] rounded-2xl p-5 sm:p-6">
            <div className="flex flex-col items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="relative w-24 h-24 sm:w-28 sm:h-28 rounded-full bg-[#F1F1F2] flex items-center justify-center overflow-hidden cursor-pointer border border-transparent hover:border-[#E4E4EA] transition-colors group"
              >
                {profile.photoDataUrl ? (
                  <img
                    src={profile.photoDataUrl}
                    alt="Фото профиля"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-[14px] text-[#666666] text-center px-2">
                    Фото профиля
                  </span>
                )}
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                  <IconCamera size={22} stroke={2} className="text-white" />
                </div>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handlePhotoChange}
                className="hidden"
              />
              <p className="text-[13px] text-[#666666]">
                Фото до 1 МБ
              </p>
              {error && (
                <p className="text-[13px] text-[#CC0000]">
                  {error}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-[14px] font-medium text-[#11111B]" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={user?.email ?? ""}
                disabled
                className="w-full rounded-[300px] border border-[#E4E4EA] bg-[#F1F1F2] px-4 py-3 text-[16px] text-[#666666] outline-none cursor-not-allowed opacity-80"
              />
              <p className="text-[13px] text-[#666666]">
                Этот email используется для входа и не может быть изменён
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-[14px] font-medium text-[#11111B]" htmlFor="fullName">
                Имя и фамилия
              </label>
              <input
                id="fullName"
                type="text"
                value={profile.fullName}
                onChange={handleChange("fullName")}
                placeholder="Например, Георгий Иванов"
                className="w-full rounded-[300px] border border-[#E4E4EA] bg-[#F1F1F2] px-4 py-3 text-[16px] text-[#11111B] outline-none focus:bg-white focus:border-[#11111B]"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-[14px] font-medium text-[#11111B]" htmlFor="contacts">
                Контакты
              </label>
              <textarea
                id="contacts"
                value={profile.contacts}
                onChange={handleChange("contacts")}
                placeholder="Телеграм, сайт или соцсети, если хотите ими поделиться."
                rows={3}
                className="w-full rounded-2xl border border-[#E4E4EA] bg-[#F1F1F2] px-4 py-3 text-[16px] text-[#11111B] outline-none resize-vertical focus:bg-white focus:border-[#11111B]"
              />
            </div>

            <div className="mt-2">
              <Button
                type="button"
                variant="primary"
                disabled={saving}
                className="shrink-0"
                onClick={handleSaveClick}
              >
                {saving ? "Сохраняем…" : "Сохранить"}
              </Button>
            </div>
          </section>

          <footer className="flex items-center justify-between gap-4">
            <p className="text-[13px] text-[#666666]">
              Профиль пока сохраняется локально в браузере и привязан к вашему аккаунту.
            </p>
          </footer>
        </article>
      </main>
    </div>
  );
}

