"use client";

import { useEffect, useState, useCallback } from "react";
import { getToken } from "@/lib/auth";

// ---------------------------------------------------------------------------
// iOS / standalone detection helpers
// ---------------------------------------------------------------------------

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    ("standalone" in window.navigator && (window.navigator as any).standalone === true) ||
    window.matchMedia("(display-mode: standalone)").matches
  );
}

function isIOSChrome(): boolean {
  if (typeof navigator === "undefined") return false;
  return isIOS() && /CriOS/.test(navigator.userAgent);
}

/**
 * PushNotifications — registers the service worker and manages push subscription.
 *
 * On iOS: guides user to add to Home Screen via Safari (Chrome iOS can't do push).
 * On other platforms: shows standard Enable button.
 */
export function PushNotifications() {
  const [status, setStatus] = useState<
    "loading" | "subscribed" | "can-enable" | "ios-need-safari" | "ios-need-homescreen" | "ios-ready" | "unsupported" | "denied"
  >("loading");
  const [dismissed, setDismissed] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    setIsLoggedIn(Boolean(getToken()));
    const onStorage = () => setIsLoggedIn(Boolean(getToken()));
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (sessionStorage.getItem("push-dismissed")) {
      setDismissed(true);
    }

    // iOS Chrome → must use Safari
    if (isIOSChrome()) {
      setStatus("ios-need-safari");
      return;
    }

    // iOS Safari but not added to home screen
    if (isIOS() && !isStandalone()) {
      setStatus("ios-need-homescreen");
      return;
    }

    // iOS standalone (added to home screen) — can proceed
    if (isIOS() && isStandalone()) {
      if (!("Notification" in window) || !("serviceWorker" in navigator)) {
        setStatus("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        setStatus("denied");
        return;
      }
      if (Notification.permission === "granted") {
        void registerAndSubscribe();
        return;
      }
      setStatus("ios-ready");
      return;
    }

    // Non-iOS
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      setStatus("unsupported");
      return;
    }

    if (Notification.permission === "denied") {
      setStatus("denied");
      return;
    }

    if (Notification.permission === "granted") {
      void registerAndSubscribe();
      return;
    }

    setStatus("can-enable");
  }, [isLoggedIn]);

  const registerAndSubscribe = useCallback(async () => {
    if (!isLoggedIn) return;

    try {
      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      const res = await fetch("/api/trpc/push.vapidPublicKey?batch=1&input=%7B%220%22%3A%7B%7D%7D");
      const data = await res.json();
      const vapidKey = data?.[0]?.result?.data?.key;

      if (!vapidKey) {
        console.warn("[push] No VAPID key from server");
        return;
      }

      const existing = await registration.pushManager.getSubscription();
      let subscription = existing;

      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        });
      }

      const token = getToken();
      if (!token) return;

      const subJson = subscription.toJSON();

      await fetch("/api/trpc/push.subscribe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          "0": {
            json: {
              endpoint: subscription.endpoint,
              p256dh: subJson.keys?.p256dh ?? "",
              auth: subJson.keys?.auth ?? "",
            },
          },
        }),
      });

      setStatus("subscribed");
      console.log("[push] Subscription saved successfully");
    } catch (err) {
      console.error("[push] Failed to subscribe:", err);
    }
  }, [isLoggedIn]);

  const handleEnable = useCallback(async () => {
    try {
      const result = await Notification.requestPermission();
      if (result === "granted") {
        await registerAndSubscribe();
      } else if (result === "denied") {
        setStatus("denied");
      }
    } catch (err) {
      console.error("[push] Permission request failed:", err);
    }
  }, [registerAndSubscribe]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    sessionStorage.setItem("push-dismissed", "1");
  }, []);

  // Don't show banner if logged out, subscribed, or dismissed
  if (!isLoggedIn || status === "subscribed" || status === "loading" || dismissed) {
    return null;
  }

  // Don't show for denied/unsupported — nothing useful to show
  if (status === "denied" || status === "unsupported") {
    return null;
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-gold/95 text-white px-4 py-3 shadow-lg">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {status === "ios-need-safari" && (
            <>
              <p className="text-sm font-medium">
                Open in Safari for notifications
              </p>
              <p className="text-xs text-white/80 mt-1">
                Chrome on iPhone doesn&apos;t support push notifications. Open this page in Safari, then tap
                {" "}<strong>Share &gt; Add to Home Screen</strong>.
              </p>
            </>
          )}

          {status === "ios-need-homescreen" && (
            <>
              <p className="text-sm font-medium">
                Add to Home Screen for notifications
              </p>
              <p className="text-xs text-white/80 mt-1">
                Tap the <strong>Share</strong> button below, then <strong>Add to Home Screen</strong>.
                Open from there to get push notifications.
              </p>
            </>
          )}

          {(status === "can-enable" || status === "ios-ready") && (
            <p className="text-sm font-medium">
              Get notified about new markets and bets
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {(status === "can-enable" || status === "ios-ready") && (
            <button
              onClick={handleEnable}
              className="bg-white text-gold font-semibold text-sm px-4 py-1.5 rounded-full whitespace-nowrap hover:bg-gold-50 transition-colors"
            >
              Enable
            </button>
          )}
          <button
            onClick={handleDismiss}
            className="text-white/80 hover:text-white text-lg leading-none"
            aria-label="Dismiss"
          >
            &times;
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
