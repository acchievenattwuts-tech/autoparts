"use client";

import Image from "next/image";
import { useState, useEffect, useCallback } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, LogIn } from "lucide-react";

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000; // 5 minutes
const STORAGE_KEY = "admin_login_lockout";

interface LockoutData {
  until: number;
  attempts: number;
}

interface LoginFormProps {
  shopName: string;
  shopLogoUrl: string;
}

const getLockout = (): LockoutData => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { until: 0, attempts: 0 };
    const data = JSON.parse(raw) as LockoutData;
    if (data.until <= Date.now()) {
      return { until: 0, attempts: data.attempts ?? 0 };
    }
    return data;
  } catch {
    return { until: 0, attempts: 0 };
  }
};

const setLockout = (data: LockoutData) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // localStorage unavailable - degrade gracefully
  }
};

const clearLockout = () => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
};

const getInitials = (shopName: string) =>
  shopName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("") || "ศว";

const LoginForm = ({ shopName, shopLogoUrl }: LoginFormProps) => {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [lockedUntil, setLockedUntil] = useState(() => {
    if (typeof window === "undefined") return 0;
    const { until } = getLockout();
    return until > Date.now() ? until : 0;
  });
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    if (lockedUntil <= Date.now()) {
      return;
    }
    const tick = () => {
      const remaining = Math.ceil((lockedUntil - Date.now()) / 1000);
      if (remaining <= 0) {
        setCountdown(0);
        setLockedUntil(0);
        clearLockout();
      } else {
        setCountdown(remaining);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lockedUntil]);

  const recordFailedAttempt = useCallback(() => {
    const data = getLockout();
    const newAttempts = (data.until > Date.now() ? data.attempts : data.attempts || 0) + 1;
    if (newAttempts >= MAX_ATTEMPTS) {
      const until = Date.now() + LOCKOUT_MS;
      setLockout({ until, attempts: newAttempts });
      setLockedUntil(until);
    } else {
      setLockout({ until: 0, attempts: newAttempts });
      setLockedUntil(0);
    }
    return newAttempts;
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const { until } = getLockout();
    if (until > Date.now()) return;

    setError("");
    setLoading(true);

    const result = await signIn("credentials", {
      username,
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      const attempts = recordFailedAttempt();
      const remaining = MAX_ATTEMPTS - attempts;
      if (remaining <= 0) {
        setError("ล็อกชั่วคราว 5 นาที เนื่องจากพยายาม login ผิดหลายครั้ง");
      } else {
        setError(`ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง (เหลืออีก ${remaining} ครั้ง)`);
      }
    } else {
      clearLockout();
      router.push("/admin");
    }
  };

  const isLocked = countdown > 0;
  const minutes = Math.floor(countdown / 60);
  const seconds = countdown % 60;

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#1e3a5f] to-[#0f2240] p-4 font-sarabun">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl">
        <div className="mb-8 text-center">
          <div className="mb-4 flex justify-center">
            {shopLogoUrl ? (
              <div className="relative h-16 w-16 overflow-hidden rounded-full border border-gray-200 bg-white shadow-sm">
                <Image
                  src={shopLogoUrl}
                  alt={`${shopName} logo`}
                  fill
                  sizes="64px"
                  className="object-contain p-1.5"
                  priority
                />
              </div>
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-[#1e3a5f] to-[#345b87] text-xl font-bold text-white shadow-sm">
                {getInitials(shopName)}
              </div>
            )}
          </div>
          <h1 className="font-kanit text-2xl font-bold text-gray-900">{shopName}</h1>
          <p className="mt-1 text-sm text-gray-500">ระบบจัดการหลังบ้าน</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">ชื่อผู้ใช้</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              required
              disabled={isLocked}
              autoComplete="username"
              className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] disabled:bg-gray-50 disabled:text-gray-400"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">รหัสผ่าน</label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                disabled={isLocked}
                autoComplete="current-password"
                className="w-full rounded-lg border border-gray-300 px-4 py-2.5 pr-10 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] disabled:bg-gray-50 disabled:text-gray-400"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {isLocked && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-center text-sm text-red-700">
              <p className="font-medium">ระงับการเข้าสู่ระบบชั่วคราว</p>
              <p className="mt-1 text-xs">
                กรุณารอ{" "}
                <span className="font-bold tabular-nums">
                  {minutes > 0 ? `${minutes}:${String(seconds).padStart(2, "0")} นาที` : `${seconds} วินาที`}
                </span>
              </p>
            </div>
          )}

          {!isLocked && error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-600">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || isLocked}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#1e3a5f] px-4 py-2.5 font-medium text-white transition-colors hover:bg-[#163055] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? (
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            ) : (
              <LogIn size={18} />
            )}
            {loading ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
          </button>
        </form>
      </div>
    </div>
  );
};

export default LoginForm;
