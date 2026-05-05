"use client";

import Script from "next/script";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

type LiffProfile = {
  userId: string;
  displayName: string;
  pictureUrl?: string;
};

type LiffContextValue = {
  idToken: string | null;
  profile: LiffProfile | null;
  isReady: boolean;
  isLinked: boolean;
  error: string | null;
  refreshSession: () => Promise<void>;
};

declare global {
  interface Window {
    liff?: {
      init: (options: { liffId: string }) => Promise<void>;
      isLoggedIn: () => boolean;
      login: (options?: { redirectUri?: string }) => void;
      getIDToken: () => string | null;
      getProfile: () => Promise<LiffProfile>;
      closeWindow: () => void;
    };
  }
}

const LiffContext = createContext<LiffContextValue | null>(null);

export function useLiff() {
  const value = useContext(LiffContext);
  if (!value) {
    throw new Error("useLiff must be used within LiffProvider");
  }
  return value;
}

export default function LiffProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const initialPathnameRef = useRef(pathname);
  const [scriptReady, setScriptReady] = useState(false);
  const [idToken, setIdToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<LiffProfile | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isLinked, setIsLinked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshSession = useCallback(async () => {
    const token = window.liff?.getIDToken() ?? idToken;
    if (!token) return;

    const response = await fetch("/api/liff/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: token }),
    });
    const payload = (await response.json().catch(() => ({}))) as { linked?: boolean };
    const linked = response.ok && payload.linked === true;
    setIsLinked(linked);

    if (!linked && pathname !== "/liff/link") {
      router.replace("/liff/link");
    } else if (linked && pathname === "/liff/link") {
      router.replace("/liff/orders");
    }
  }, [idToken, pathname, router]);

  useEffect(() => {
    if (!scriptReady || !window.liff) return;

    let isMounted = true;

    async function initLiff() {
      try {
        const liffId = process.env.NEXT_PUBLIC_LINE_LIFF_ID;
        if (!liffId) {
          throw new Error("ยังไม่ได้ตั้งค่า LIFF ID");
        }

        await window.liff!.init({ liffId });

        if (!window.liff!.isLoggedIn()) {
          window.liff!.login({ redirectUri: window.location.href });
          return;
        }

        const [nextProfile, nextIdToken] = await Promise.all([
          window.liff!.getProfile(),
          Promise.resolve(window.liff!.getIDToken()),
        ]);

        if (!nextIdToken) {
          throw new Error("ไม่พบ LINE ID token");
        }

        if (!isMounted) return;
        setProfile(nextProfile);
        setIdToken(nextIdToken);
        setIsReady(true);

        const response = await fetch("/api/liff/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken: nextIdToken }),
        });
        const payload = (await response.json().catch(() => ({}))) as { linked?: boolean };
        const linked = response.ok && payload.linked === true;

        if (!isMounted) return;
        setIsLinked(linked);

        const initialPathname = initialPathnameRef.current;
        if (!linked && initialPathname !== "/liff/link") {
          router.replace("/liff/link");
        } else if (linked && initialPathname === "/liff/link") {
          router.replace("/liff/orders");
        }
      } catch (initError) {
        if (!isMounted) return;
        setError(initError instanceof Error ? initError.message : "เปิด LINE LIFF ไม่สำเร็จ");
        setIsReady(true);
      }
    }

    void initLiff();

    return () => {
      isMounted = false;
    };
  }, [router, scriptReady]);

  const value = useMemo(
    () => ({ idToken, profile, isReady, isLinked, error, refreshSession }),
    [error, idToken, isLinked, isReady, profile, refreshSession],
  );

  return (
    <LiffContext.Provider value={value}>
      <Script
        src="https://static.line-scdn.net/liff/edge/2/sdk.js"
        strategy="afterInteractive"
        onLoad={() => setScriptReady(true)}
        onError={() => {
          setError("โหลด LINE LIFF SDK ไม่สำเร็จ");
          setIsReady(true);
        }}
      />
      {children}
    </LiffContext.Provider>
  );
}
