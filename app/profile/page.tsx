"use client";

import { useEffect, useState, ChangeEvent } from "react";
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
  const [error, setError] = useState<string | null>(null);

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
        <nav
          className="flex items-center gap-2 pt-6 text-[16px] font-medium text-[#666666]"
          aria-label="Хлебные крошки"
        >
          <a href="/" className="hover:text-black">
            Главная
          </a>
          <span>/</span>
          <span className="text-black">Профиль</span>
        </nav>

        <article className="mt-8 max-w-[720px] mx-auto flex flex-col gap-8">
          <header className="flex flex-col gap-4">
            <h1 className="text-black text-[28px] sm:text-[40px] font-semibold leading-tight">
              Профиль коллекционера
            </h1>
            <p className="text-[#666666] text-[16px] leading-[1.6]">
              Заполните информацию о себе и добавьте фотографию. Данные сохраняются на этом устройстве.
            </p>
          </header>

          <section className="flex flex-col gap-6 border border-[#E4E4EA] rounded-2xl p-5 sm:p-6">
            <div className="flex items-start gap-4">
              <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-full bg-[#F1F1F2] flex items-center justify-center overflow-hidden shrink-0">
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
              </div>
              <div className="flex-1 min-w-0 flex flex-col gap-3">
                <div className="flex flex-col gap-2">
                  <label className="text-[14px] font-medium text-[#11111B]">
                    Фотография
                  </label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handlePhotoChange}
                    className="block w-full text-[14px] text-[#11111B] file:mr-4 file:rounded-[300px] file:border file:border-[#E4E4EA] file:bg-[#F1F1F2] file:px-4 file:py-2 file:text-[14px] file:font-medium file:text-[#11111B] hover:file:bg-[#E4E4EA]"
                  />
                  <p className="text-[13px] text-[#666666]">
                    Изображение будет автоматически сжато до&nbsp;{Math.round(MAX_AVATAR_BYTES / 1024)}&nbsp;КБ.
                  </p>
                  {error && (
                    <p className="text-[13px] text-[#CC0000]">
                      {error}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </section>

          <section className="flex flex-col gap-6 border border-[#E4E4EA] rounded-2xl p-5 sm:p-6">
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
              <label className="text-[14px] font-medium text-[#11111B]" htmlFor="city">
                Город
              </label>
              <input
                id="city"
                type="text"
                value={profile.city}
                onChange={handleChange("city")}
                placeholder="Например, Москва"
                className="w-full rounded-[300px] border border-[#E4E4EA] bg-[#F1F1F2] px-4 py-3 text-[16px] text-[#11111B] outline-none focus:bg-white focus:border-[#11111B]"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-[14px] font-medium text-[#11111B]" htmlFor="about">
                О себе
              </label>
              <textarea
                id="about"
                value={profile.about}
                onChange={handleChange("about")}
                placeholder="Расскажите пару предложений о себе и своей коллекции."
                rows={4}
                className="w-full rounded-2xl border border-[#E4E4EA] bg-[#F1F1F2] px-4 py-3 text-[16px] text-[#11111B] outline-none resize-vertical focus:bg-white focus:border-[#11111B]"
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
                placeholder="E-mail, сайт или соцсети, если хотите ими поделиться."
                rows={3}
                className="w-full rounded-2xl border border-[#E4E4EA] bg-[#F1F1F2] px-4 py-3 text-[16px] text-[#11111B] outline-none resize-vertical focus:bg-white focus:border-[#11111B]"
              />
            </div>
          </section>

          <footer className="flex items-center justify-between gap-4">
            <p className="text-[13px] text-[#666666]">
              Профиль сохраняется локально в браузере и привязан к вашему аккаунту.
            </p>
            <Button
              type="button"
              variant="secondary"
              disabled={saving}
              className="shrink-0"
            >
              {saving ? "Сохраняем…" : "Сохранено"}
            </Button>
          </footer>
        </article>
      </main>
    </div>
  );
}

