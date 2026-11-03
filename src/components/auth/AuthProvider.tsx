import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useIdleLogout } from "@/hooks/use-idle-logout";
import {
  fetchMe,
  getAuthToken,
  loginRequest,
  logoutRequest,
  pingSession,
  setAuthToken,
  setUnauthorizedHandler,
  type SessionUser,
} from "@/lib/api";

export type AuthStatus = "checking" | "signed-out" | "signed-in";

interface AuthContextValue {
  user: SessionUser | null;
  status: AuthStatus;
  /** Μήνυμα για την οθόνη login (π.χ. "αποσυνδέθηκες λόγω αδράνειας"). */
  notice: string | null;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: (notice?: string) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const IDLE_NOTICE = "You were signed out after 30 minutes of inactivity.";
const EXPIRED_NOTICE = "Your session expired. Please sign in again.";

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>(() => (getAuthToken() ? "checking" : "signed-out"));
  const [notice, setNotice] = useState<string | null>(null);

  const signOut = useCallback(
    (message?: string) => {
      const token = getAuthToken();
      setAuthToken(null);
      setUser(null);
      setStatus("signed-out");
      setNotice(message ?? null);
      // Τα cached δεδομένα ανήκαν στον προηγούμενο χρήστη.
      queryClient.clear();
      if (token) void logoutRequest(token).catch(() => undefined);
    },
    [queryClient],
  );

  const signIn = useCallback(async (username: string, password: string) => {
    const { token, user: sessionUser } = await loginRequest(username.trim(), password);
    setAuthToken(token);
    setUser(sessionUser);
    setNotice(null);
    setStatus("signed-in");
  }, []);

  // Επαναφορά session μετά από refresh της σελίδας: ο server αποφασίζει αν το token ισχύει ακόμα.
  useEffect(() => {
    if (!getAuthToken()) return;
    let cancelled = false;
    fetchMe()
      .then((sessionUser) => {
        if (cancelled) return;
        setUser(sessionUser);
        setStatus("signed-in");
      })
      .catch(() => {
        if (cancelled) return;
        setAuthToken(null);
        setStatus("signed-out");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 401 από οποιοδήποτε request ενώ ήμασταν συνδεδεμένοι = έληξε το session στον server.
  useEffect(() => {
    setUnauthorizedHandler(() => signOut(EXPIRED_NOTICE));
    return () => setUnauthorizedHandler(null);
  }, [signOut]);

  useIdleLogout({
    enabled: status === "signed-in",
    onIdle: () => signOut(IDLE_NOTICE),
    onHeartbeat: () => void pingSession().catch(() => undefined),
  });

  const value = useMemo<AuthContextValue>(
    () => ({ user, status, notice, signIn, signOut }),
    [user, status, notice, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
