"use client";

import { useState, useEffect, useCallback } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, LogIn, Wrench } from "lucide-react";

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000; // 5 minutes
const STORAGE_KEY = "admin_login_lockout";

interface LockoutData {
  until: number;
  attempts: number;
}

const getLockout = (): LockoutData => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { until: 0, attempts: 0 };
    return JSON.parse(raw) as LockoutData;
  } catch {
    return { until: 0, attempts: 0 };
  }
};

const setLockout = (data: LockoutData) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // localStorage unavailable — degrade gracefully
  }
};

const clearLockout = () => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
};

const LoginPage = () => {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [countdown, setCountdown] = useState(0);

  // Check lockout on mount and update countdown
  useEffect(() => {
    const { until } = getLockout();
    if (until > Date.now()) {
      setLockedUntil(until);
    }
  }, []);

  useEffect(() => {
    if (lockedUntil <= Date.now()) {
      setCountdown(0);
      return;
    }
    const tick = () => {
      const remaining = Math.ceil((lockedUntil - Date.now()) / 1000);
      if (remaining <= 0) {
        setCountdown(0);
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
    const newAttempts = (data.until > Date.now() ? data.attempts : 0) + 1;
    if (newAttempts >= MAX_ATTEMPTS) {
      const until = Date.now() + LOCKOUT_MS;
      setLockout({ until, attempts: newAttempts });
      setLockedUntil(until);
    } else {
      setLockout({ until: Date.now() + LOCKOUT_MS, attempts: newAttempts });
    }
    return newAttempts;
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Check lockout
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
        setError(
          `ล็อกชั่วคราว 5 นาที เนื่องจากพยายาม login ผิดหลายครั้ง`
        );
      } else {
        setError(
          `ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง (เหลืออีก ${remaining} ครั้ง)`
        );
      }
    } else {
      clearLockout();
      router.push("/admin");
      router.refresh();
    }
  };

  const isLocked = countdown > 0;
  const minutes = Math.floor(countdown / 60);
  const seconds = countdown % 60;

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#1e3a5f] to-[#0f2240] flex items-center justify-center p-4 font-sarabun">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-[#1e3a5f] rounded-2xl mb-4">
            <Wrench className="text-[#f97316]" size={32} />
          </div>
          <h1 className="font-kanit text-2xl font-bold text-gray-900">ศรีวรรณ อะไหล่แอร์</h1>
          <p className="text-gray-500 text-sm mt-1">ระบบจัดการหลังบ้าน</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">ชื่อผู้ใช้</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              required
              disabled={isLocked}
              autoComplete="username"
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] focus:border-transparent text-sm disabled:bg-gray-50 disabled:text-gray-400"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">รหัสผ่าน</label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                disabled={isLocked}
                autoComplete="current-password"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] focus:border-transparent text-sm pr-10 disabled:bg-gray-50 disabled:text-gray-400"
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
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg text-center">
              <p className="font-medium">ระงับการเข้าสู่ระบบชั่วคราว</p>
              <p className="text-xs mt-1">
                กรุณารอ{" "}
                <span className="font-bold tabular-nums">
                  {minutes > 0 ? `${minutes}:${String(seconds).padStart(2, "0")} นาที` : `${seconds} วินาที`}
                </span>
              </p>
            </div>
          )}

          {!isLocked && error && (
            <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-4 py-2.5 rounded-lg">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || isLocked}
            className="w-full bg-[#1e3a5f] hover:bg-[#163055] text-white font-medium py-2.5 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? (
              <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
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

export default LoginPage;
