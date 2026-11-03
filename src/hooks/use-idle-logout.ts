import { useEffect, useRef } from "react";

import { IDLE_CHECK_INTERVAL_MS, IDLE_LIMIT_MS, PING_INTERVAL_MS, isIdle, shouldPing } from "@/lib/idle";

const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "wheel"] as const;

interface IdleLogoutOptions {
  enabled: boolean;
  onIdle: () => void;
  onHeartbeat: () => void;
}

/**
 * Αποσυνδέει τον χρήστη μετά από IDLE_LIMIT_MS χωρίς δραστηριότητα και στέλνει heartbeat στο backend
 * όσο είναι ενεργός. Συγκρίνει πάντα με Date.now() ώστε ένα sleep/hibernate του υπολογιστή να μετράει ως idle.
 */
export function useIdleLogout({ enabled, onIdle, onHeartbeat }: IdleLogoutOptions): void {
  const callbacks = useRef({ onIdle, onHeartbeat });
  callbacks.current = { onIdle, onHeartbeat };

  useEffect(() => {
    if (!enabled) return;

    let lastActivityAt = Date.now();
    let lastPingAt = Date.now();

    const markActivity = () => {
      lastActivityAt = Date.now();
    };

    const check = () => {
      const now = Date.now();
      if (isIdle(lastActivityAt, now, IDLE_LIMIT_MS)) {
        callbacks.current.onIdle();
        return;
      }
      if (shouldPing(lastActivityAt, lastPingAt, now, PING_INTERVAL_MS)) {
        lastPingAt = now;
        callbacks.current.onHeartbeat();
      }
    };

    ACTIVITY_EVENTS.forEach((name) => window.addEventListener(name, markActivity, { passive: true }));
    // Μετά από sleep ή επιστροφή στο tab, έλεγξε αμέσως αντί να περιμένεις τον επόμενο γύρο.
    document.addEventListener("visibilitychange", check);
    const timer = setInterval(check, IDLE_CHECK_INTERVAL_MS);

    return () => {
      ACTIVITY_EVENTS.forEach((name) => window.removeEventListener(name, markActivity));
      document.removeEventListener("visibilitychange", check);
      clearInterval(timer);
    };
  }, [enabled]);
}
