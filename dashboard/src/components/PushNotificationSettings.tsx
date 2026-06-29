'use client';

import { useEffect, useState, useCallback } from 'react';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) output[i] = raw.charCodeAt(i);
  return output;
}

export default function PushNotificationSettings() {
  const [supported, setSupported] = useState(true);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(true);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const refresh = useCallback(async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setSupported(false);
      return;
    }
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
      const sub = await reg.pushManager.getSubscription();
      setSubscribed(Boolean(sub));
    } catch {
      setSupported(false);
    }
  }, []);

  useEffect(() => {
    setIsIOS(/iPad|iPhone|iPod/.test(navigator.userAgent));
    setIsStandalone(
      window.matchMedia('(display-mode: standalone)').matches ||
      // iOS Safari standalone flag
      (window.navigator as unknown as { standalone?: boolean }).standalone === true
    );
    refresh();
  }, [refresh]);

  async function subscribe() {
    setBusy(true);
    setMsg(null);
    try {
      const { configured, publicKey } = await fetch('/api/push/vapid').then(r => r.json());
      if (!configured || !publicKey) {
        setMsg({ text: '伺服器尚未設定 VAPID 金鑰', ok: false });
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setMsg({ text: '你拒絕了通知權限，無法推播', ok: false });
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: JSON.parse(JSON.stringify(sub)) }),
      });
      if (!res.ok) throw new Error('save failed');
      setSubscribed(true);
      setMsg({ text: '已開啟！這支裝置之後會收到推播。', ok: true });
    } catch (e) {
      setMsg({ text: `開啟失敗：${(e as Error).message}`, ok: false });
    } finally {
      setBusy(false);
    }
  }

  async function unsubscribe() {
    setBusy(true);
    setMsg(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setSubscribed(false);
      setMsg({ text: '已關閉這支裝置的推播。', ok: true });
    } catch (e) {
      setMsg({ text: `關閉失敗：${(e as Error).message}`, ok: false });
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/push/test', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'failed');
      setMsg({ text: `測試推播已送出（${data.sent} 台裝置）。看一下鎖屏。`, ok: true });
    } catch (e) {
      setMsg({ text: `測試失敗：${(e as Error).message}`, ok: false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bg-zinc-900 rounded-xl border border-zinc-800 p-5">
      <h2 className="text-sm font-medium text-zinc-200 mb-1">📱 手機推播通知</h2>
      <p className="text-[11px] text-zinc-500 mb-4">
        待審核、發布失敗、老闆快報等事件直接推到這支裝置的鎖屏（取代 Telegram）。
      </p>

      {!supported ? (
        <p className="text-xs text-amber-400">這個瀏覽器不支援 Web Push。</p>
      ) : isIOS && !isStandalone ? (
        <div className="rounded-lg bg-amber-950/40 border border-amber-900/50 p-3 text-[12px] text-amber-200 leading-relaxed">
          <p className="font-medium mb-1">iPhone 需要先「加入主畫面」才能推播</p>
          <ol className="list-decimal list-inside space-y-0.5 text-amber-200/90">
            <li>按 Safari 底部的「分享」按鈕 <span aria-hidden>⎋</span></li>
            <li>選「加入主畫面」<span aria-hidden>➕</span></li>
            <li>從主畫面的圖示打開這個 App</li>
            <li>回到這頁，按「開啟推播」</li>
          </ol>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {subscribed ? (
            <>
              <span className="inline-flex items-center gap-1.5 text-sm text-zinc-200">
                <span className="w-2 h-2 rounded-full bg-emerald-500" /> 已開啟（這支裝置）
              </span>
              <button
                onClick={sendTest}
                disabled={busy}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-300 transition-colors cursor-pointer"
              >
                {busy ? '...' : '測試推播'}
              </button>
              <button
                onClick={unsubscribe}
                disabled={busy}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-zinc-800 hover:bg-red-950/50 disabled:opacity-50 text-zinc-400 hover:text-red-400 transition-colors cursor-pointer"
              >
                關閉
              </button>
            </>
          ) : (
            <button
              onClick={subscribe}
              disabled={busy}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-brand hover:bg-brand-light disabled:opacity-50 text-white transition-colors cursor-pointer"
            >
              {busy ? '開啟中...' : '🔔 開啟推播'}
            </button>
          )}
        </div>
      )}

      {msg && (
        <p className={`mt-3 text-xs ${msg.ok ? 'text-emerald-400' : 'text-red-400'}`}>{msg.text}</p>
      )}
    </section>
  );
}
