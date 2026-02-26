"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import Link from "next/link";
import { IconMenu2, IconUser, IconX } from "@tabler/icons-react";
import { Button } from "./Button";
import { Tabs } from "./Tabs";
import { useAuth } from "./AuthProvider";

/** До этого брейкпоинта: бургер-меню; с lg и выше — табы и кнопки в хедере */
const MENU_BREAKPOINT = 1024;
const SCROLL_THRESHOLD = 8;
const MIN_SCROLL_TO_HIDE = 60;

const LOGIN_PATH = "/login";

type HeaderNavItem = {
  label: string;
  href: string;
  disabled?: boolean;
};

type HeaderProps = {
  activePath?: string;
  navItems?: HeaderNavItem[];
};

const defaultNav: HeaderNavItem[] = [
  { label: "Главная", href: "/" },
  { label: "Каталог", href: "/catalog" },
  { label: "Монетные дворы", href: "/mints" },
  { label: "Графики", href: "/charts" },
];

export function Header({ activePath = "/", navItems = defaultNav }: HeaderProps) {
  const { isAuthorized, signOut, loading } = useAuth();

  // Показываем «Портфолио» при загрузке авторизации и при isAuthorized, чтобы при перезагрузке табы не прыгали и таб не пропадал
  const resolvedNav = useMemo(() => {
    const base = navItems ?? defaultNav;
    const showPortfolio = loading || isAuthorized;
    if (!showPortfolio) return base;
    if (base.some((i) => i.href === "/portfolio")) return base;
    const catalogIndex = base.findIndex((i) => i.href === "/catalog");
    if (catalogIndex < 0) return [...base, { label: "Портфолио", href: "/portfolio" }];
    const next = [...base];
    next.splice(catalogIndex + 1, 0, { label: "Портфолио", href: "/portfolio" });
    return next;
  }, [navItems, isAuthorized, loading]);

  const [menuOpen, setMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [headerHidden, setHeaderHidden] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const lastScrollY = useRef(0);
  const profileRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const check = () => setIsMobile(typeof window !== "undefined" && window.innerWidth < MENU_BREAKPOINT);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    if (menuOpen) setHeaderHidden(false);
  }, [menuOpen]);

  useEffect(() => {
    if (!profileOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (profileRef.current && target && !profileRef.current.contains(target)) {
        setProfileOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setProfileOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [profileOpen]);

  useEffect(() => {
    if (menuOpen) return;
    // Инициализация под текущую позицию скролла (важно для главной и при навигации)
    const initScroll = () => (typeof window !== "undefined" && (lastScrollY.current = window.scrollY));
    initScroll();
    const onScroll = () => {
      const y = typeof window !== "undefined" ? window.scrollY : 0;
      const delta = y - lastScrollY.current;
      if (y < MIN_SCROLL_TO_HIDE) {
        setHeaderHidden(false);
      } else if (delta > SCROLL_THRESHOLD) {
        setHeaderHidden(true);
      } else if (delta < -SCROLL_THRESHOLD) {
        setHeaderHidden(false);
      }
      lastScrollY.current = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [menuOpen]);

  return (
    <nav
      className={`sticky top-0 z-50 bg-white overflow-visible transition-transform duration-200 ease-out ${headerHidden ? "-translate-y-full" : ""}`}
    >
      <div className="w-full min-w-0 overflow-visible px-4 sm:px-6 lg:px-20">
        <div className="h-[72px] flex items-center overflow-visible">
          <div className="flex-1 min-w-0 flex items-center justify-start">
            <a href="/" className="flex items-center gap-3 cursor-pointer shrink-0">
              <img className="w-[73px] h-[40px]" src="/image/logo.png" alt="О монете" />
              <span className="text-[20px] leading-[26px] font-semibold whitespace-nowrap">О монете</span>
            </a>
          </div>

          <div className="hidden lg:flex flex-1 min-w-0 shrink-0 items-center justify-center">
            <Tabs items={resolvedNav} activePath={activePath} className="flex items-center gap-8 h-full" />
          </div>

          {/* Справа: с lg — кнопки/иконка профиля, до lg — бургер */}
          <div className="flex flex-1 min-w-0 items-center justify-end gap-2">
            <div className="hidden lg:flex gap-2 items-center">
              {!loading && !isAuthorized && (
                <Button href="/portfolio" variant="ghost">
                  ДЕМО портфолио
                </Button>
              )}
              {!loading && isAuthorized ? (
                <div className="relative" ref={profileRef}>
                  <button
                    type="button"
                    onClick={() => setProfileOpen((v) => !v)}
                    className="w-10 h-10 rounded-full border border-[#E4E4EA] flex items-center justify-center hover:bg-[#F1F1F2] cursor-pointer"
                    aria-label="Меню профиля"
                  >
                    <IconUser size={22} stroke={2} />
                  </button>
                  {profileOpen && (
                    <div className="absolute right-0 mt-2 w-48 rounded-2xl bg-white shadow-lg border border-[#E4E4EA] py-2 z-50">
                      <Link
                        href="/profile"
                        className="block px-4 py-2 text-[14px] text-[#11111B] hover:bg-[#F1F1F2]"
                      >
                        Профиль
                      </Link>
                      <Link
                        href="/portfolio"
                        className="block px-4 py-2 text-[14px] text-[#11111B] hover:bg-[#F1F1F2]"
                      >
                        Портфолио
                      </Link>
                      <button
                        type="button"
                        onClick={() => {
                          setProfileOpen(false);
                          signOut();
                        }}
                        className="w-full text-left px-4 py-2 text-[14px] text-[#CC0000] hover:bg-[#F1F1F2]"
                      >
                        Выйти
                      </button>
                    </div>
                  )}
                </div>
              ) : !loading ? (
                <Link href={LOGIN_PATH}>
                  <Button variant="primary">Вход</Button>
                </Link>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="lg:hidden p-2 -mr-2 rounded-lg hover:bg-[#F1F1F2] cursor-pointer flex items-center justify-center"
              aria-label={menuOpen ? "Закрыть меню" : "Открыть меню"}
            >
              {menuOpen ? <IconX size={28} stroke={2} /> : <IconMenu2 size={28} stroke={2} />}
            </button>
          </div>
        </div>
      </div>

      {/* Мобильное меню */}
      {menuOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/20 lg:hidden"
            aria-hidden
            onClick={() => setMenuOpen(false)}
          />
          <div className="fixed top-[72px] left-0 right-0 z-50 bg-white border-b border-[#E4E4EA] shadow-lg lg:hidden max-h-[calc(100vh-72px)] overflow-y-auto overflow-x-hidden">
            <div className="px-4 py-4 flex flex-col">
              {/* Сначала табы разделов сайта */}
              <div className="flex flex-col gap-1">
                {resolvedNav.map((item) => {
                  if (item.disabled) {
                    return (
                      <div
                        key={item.href}
                        className="py-3 px-3 text-[16px] font-medium text-[#11111B] opacity-40 cursor-not-allowed"
                      >
                        {item.label}
                      </div>
                    );
                  }
                  const isActive = item.href === activePath;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMenuOpen(false)}
                      className={`py-3 px-3 rounded-lg text-[16px] font-medium ${isActive ? "bg-[#F1F1F2] text-[#11111B]" : "text-[#11111B] hover:bg-[#F1F1F2]"}`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
              {/* Внизу — кнопки Вход/Выйти и Портфолио */}
              <div className="mt-4 pt-4 border-t border-[#E4E4EA] flex flex-col gap-2">
                {!loading && (
                  <>
                    <Link href="/portfolio" onClick={() => setMenuOpen(false)}>
                      <Button variant="ghost" className="w-full justify-center">
                        {isAuthorized ? "Портфолио" : "ДЕМО портфолио"}
                      </Button>
                    </Link>
                    {isAuthorized ? (
                      <Button
                        variant="primary"
                        className="w-full justify-center"
                        onClick={() => {
                          signOut();
                          setMenuOpen(false);
                        }}
                      >
                        Выйти
                      </Button>
                    ) : (
                      <Link href={LOGIN_PATH} onClick={() => setMenuOpen(false)}>
                        <Button variant="primary" className="w-full justify-center">
                          Вход
                        </Button>
                      </Link>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </nav>
  );
}

