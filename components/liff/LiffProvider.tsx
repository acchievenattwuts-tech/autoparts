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
  accessToken: string | null;
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
      getAccessToken: () => string | null;
      getIDToken: () => string | null;
      getProfile: () => Promise<LiffProfile>;
      isInClient?: () => boolean;
      openWindow?: (options: { url: string; external?: boolean }) => void;
      closeWindow: () => void;
    };
  }
}

const LiffContext = createContext<LiffContextValue | null>(null);

const isExternalPrintRequest = () =>
  typeof window !== "undefined" && new URLSearchParams(window.location.search).has("printToken");

function completeLiffSessionNavigation(sessionToken: string) {
  const form = document.createElement("form");
  const input = document.createElement("input");

  form.method = "POST";
  form.action = "/api/liff/session/complete";
  form.target = "_top";
  form.style.display = "none";
  input.type = "hidden";
  input.name = "sessionToken";
  input.value = sessionToken;
  form.append(input);
  document.body.append(form);
  form.submit();
}

function shouldCompleteSessionWithTopLevelPost() {
  return window.liff?.isInClient?.() !== true;
}

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
  const [isPrintTokenRequest] = useState(isExternalPrintRequest);
  const [scriptReady, setScriptReady] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [idToken, setIdToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<LiffProfile | null>(null);
  const [isReady, setIsReady] = useState(isPrintTokenRequest);
  const [isLinked, setIsLinked] = useState(isPrintTokenRequest);
  const [error, setError] = useState<string | null>(null);

  const refreshSession = useCallback(async () => {
    const token = window.liff?.getIDToken() ?? idToken;
    const nextAccessToken = window.liff?.getAccessToken() ?? accessToken;
    if (!token && !nextAccessToken) return;

    const response = await fetch("/api/liff/session", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: nextAccessToken, idToken: token }),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      linked?: boolean;
      sessionToken?: string;
    };
    const linked = response.ok && payload.linked === true;
    setIsLinked(linked);

    if (!linked && pathname !== "/liff/link") {
      router.replace("/liff/link");
    } else if (
      linked &&
      payload.sessionToken &&
      shouldCompleteSessionWithTopLevelPost() &&
      (pathname === "/liff" || pathname === "/liff/link")
    ) {
      completeLiffSessionNavigation(payload.sessionToken);
    } else if (linked && pathname === "/liff/link") {
      router.replace("/liff/orders");
    } else if (linked) {
      router.refresh();
    }
  }, [accessToken, idToken, pathname, router]);

  useEffect(() => {
    if (isPrintTokenRequest) return;
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

        const [nextProfile, nextAccessToken, nextIdToken] = await Promise.all([
          window.liff!.getProfile(),
          Promise.resolve(window.liff!.getAccessToken()),
          Promise.resolve(window.liff!.getIDToken()),
        ]);

        if (!nextAccessToken && !nextIdToken) {
          throw new Error("ไม่พบ LINE token");
        }

        if (!isMounted) return;
        setProfile(nextProfile);
        setAccessToken(nextAccessToken);
        setIdToken(nextIdToken);

        const response = await fetch("/api/liff/session", {
          method: "POST",
          cache: "no-store",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken: nextAccessToken, idToken: nextIdToken }),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          linked?: boolean;
          sessionToken?: string;
        };
        const linked = response.ok && payload.linked === true;

        if (!isMounted) return;
        setIsLinked(linked);

        const initialPathname = initialPathnameRef.current;
        if (!linked && initialPathname !== "/liff/link") {
          setIsReady(true);
          router.replace("/liff/link");
        } else if (
          linked &&
          payload.sessionToken &&
          shouldCompleteSessionWithTopLevelPost() &&
          (initialPathname === "/liff" || initialPathname === "/liff/link")
        ) {
          completeLiffSessionNavigation(payload.sessionToken);
        } else if (linked && initialPathname === "/liff/link") {
          setIsReady(true);
          router.replace("/liff/orders");
        } else if (linked) {
          setIsReady(true);
          router.refresh();
        } else {
          setIsReady(true);
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
  }, [isPrintTokenRequest, router, scriptReady]);

  const value = useMemo(
    () => ({ accessToken, idToken, profile, isReady, isLinked, error, refreshSession }),
    [accessToken, error, idToken, isLinked, isReady, profile, refreshSession],
  );

  return (
    <LiffContext.Provider value={value}>
      {isPrintTokenRequest ? null : (
        <Script
          src="https://static.line-scdn.net/liff/edge/2/sdk.js"
          strategy="afterInteractive"
          onLoad={() => setScriptReady(true)}
          onError={() => {
            setError("โหลด LINE LIFF SDK ไม่สำเร็จ");
            setIsReady(true);
          }}
        />
      )}
      {children}
    </LiffContext.Provider>
  );
}
