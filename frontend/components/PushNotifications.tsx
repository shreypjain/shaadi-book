"use client";

import { useEffect, useState, useCallback } from "react";
import { getToken } from "@/lib/auth";

/**
 * PushNotifications — registers the service worker and manages push subscription.
 *
 * Renders an opt-in banner when the user is logged in but hasn't subscribed.
 * Auto-registers on mount if permission was already granted.
 */
export function PushNotifications() {
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [subscribed, setSubscribed] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  // Check login status
  useEffect(() => {
    setIsLoggedIn(Boolean(getToken()));

    // Listen for storage changes (login/logout)
    const onStorage = () => setIsLoggedIn(Boolean(getToken()));
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Check current permission + subscription status
  useEffect(() => {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      setPermission("unsupported");
      return;
    }

    setPermission(Notification.permission);

    // Check if dismissed previously this session
    if (sessionStorage.getItem("push-dismissed")) {
      setDismissed(true);
    }

    // If already granted, auto-register
    if (Notification.permission === "granted") {
      void registerAndSubscribe();
    }
  }, [isLoggedIn]);

  const registerAndSubscribe = useCallback(async () => {
    if (!isLoggedIn) return;

    try {
      // Register service worker
      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      // Get VAPID public key from backend
      const res = await fetch("/api/trpc/push.vapidPublicKey?batch=1&input=%7B%220%22%3A%7B%7D%7D");
      const data = await res.json();
      const vapidKey = data?.[0]?.result?.data?.key;

      if (!vapidKey) {
        console.warn("[push] No VAPID key from server — push not configured");
        return;
      }

      // Subscribe to push
      const existing = await registration.pushManager.getSubscription();
      let subscription = existing;

      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        });
      }

      // Send subscription to backend
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

      setSubscribed(true);
      console.log("[push] Subscription saved successfully");
    } catch (err) {
      console.error("[push] Failed to subscribe:", err);
    }
  }, [isLoggedIn]);

  const handleEnable = useCallback(async () => {
    try {
      const result = await Notification.requestPermission();
      setPermission(result);

      if (result === "granted") {
        await registerAndSubscribe();
      }
    } catch (err) {
      console.error("[push] Permission request failed:", err);
    }
  }, [registerAndSubscribe]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    sessionStorage.setItem("push-dismissed", "1");
  }, []);

  // Don't show if: not logged in, already subscribed, unsupported, denied, or dismissed
  if (
    !isLoggedIn ||
    subscribed ||
    permission === "unsupported" ||
    permission === "denied" ||
    dismissed
  ) {
    return null;
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-gold/95 text-white px-4 py-3 flex items-center justify-between gap-3 shadow-lg">
      <p className="text-sm font-medium flex-1">
        Get notified about new markets and bets
      </p>
      <button
        onClick={handleEnable}
        className="bg-white text-gold font-semibold text-sm px-4 py-1.5 rounded-full whitespace-nowrap hover:bg-gold-50 transition-colors"
      >
        Enable
      </button>
      <button
        onClick={handleDismiss}
        className="text-white/80 hover:text-white text-lg leading-none"
        aria-label="Dismiss"
      >
        &times;
      </button>
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
