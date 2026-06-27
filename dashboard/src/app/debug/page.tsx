'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import PageHeader from '@/components/PageHeader';

interface TtsResult {
  ok: boolean;
  latencyMs?: number;
  contentType?: string;
  statusCode?: number;
  error?: string;
}

interface OAuthStatus {
  exists: boolean;
  hasRefreshToken: boolean;
  expiryDate: string | null;
  isExpired: boolean;
  canRefresh: boolean;
  error?: string;
}

interface RefreshResult {
  ok: boolean;
  expiryDate?: string;
  isExpired?: boolean;
  error?: string;
}

const Spinner = () => (
  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
);

export default function DebugPageWrapper() {
  return (
    <Suspense>
      <DebugPage />
    </Suspense>
  );
}

function DebugPage() {
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TtsResult | null>(null);

  // Gmail OAuth state
  const [oauthStatus, setOauthStatus] = useState<OAuthStatus | null>(null);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState<RefreshResult | null>(null);
  const [oauthMessage, setOauthMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [sendingTest, setSendingTest] = useState(false);

  const fetchOAuthStatus = useCallback(async () => {
    setOauthLoading(true);
    try {
      const res = await fetch('/api/debug/gmail-oauth');
      const data = await res.json();
      if (data.error) {
        setOauthStatus({ exists: false, hasRefreshToken: false, expiryDate: null, isExpired: true, canRefresh: false, error: data.error });
      } else {
        setOauthStatus(data);
      }
    } catch (err) {
      setOauthStatus({ exists: false, hasRefreshToken: false, expiryDate: null, isExpired: true, canRefresh: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setOauthLoading(false);
    }
  }, []);

  // Check OAuth callback result from URL params
  useEffect(() => {
    const oauth = searchParams.get('oauth');
    if (oauth === 'success') {
      setOauthMessage({ type: 'success', text: 'OAuth 驗證成功！Token 已更新。' });
    } else if (oauth === 'error') {
      const msg = searchParams.get('message') || 'Unknown error';
      setOauthMessage({ type: 'error', text: `OAuth 驗證失敗：${msg}` });
    }
  }, [searchParams]);

  // Auto-fetch OAuth status on mount
  useEffect(() => {
    fetchOAuthStatus();
  }, [fetchOAuthStatus]);

  async function testVoai() {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch('/api/debug/voai-tts', { method: 'POST' });
      const data = await res.json();
      setResult(data);
    } catch (err: unknown) {
      setResult({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  }

  async function refreshToken() {
    setRefreshing(true);
    setRefreshResult(null);
    try {
      const res = await fetch('/api/debug/gmail-oauth', { method: 'POST' });
      const data = await res.json();
      setRefreshResult(data);
      if (data.ok) {
        fetchOAuthStatus();
      }
    } catch (err) {
      setRefreshResult({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setRefreshing(false);
    }
  }

  async function startOAuth() {
    try {
      const res = await fetch('/api/debug/gmail-oauth/authorize');
      const data = await res.json();
      if (data.authUrl) {
        window.location.href = data.authUrl;
      } else if (data.error) {
        setOauthMessage({ type: 'error', text: data.error });
      }
    } catch (err) {
      setOauthMessage({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  }

  async function sendTestEmail() {
    setSendingTest(true);
    setOauthMessage(null);
    try {
      const res = await fetch('/api/debug/gmail-oauth/test', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        setOauthMessage({ type: 'success', text: '測試 Email 已寄出，請檢查信箱。' });
      } else {
        setOauthMessage({ type: 'error', text: `寄送失敗：${data.error}` });
      }
    } catch (err) {
      setOauthMessage({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setSendingTest(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <PageHeader title="除錯" />

      {/* OAuth callback message */}
      {oauthMessage && (
        <div className={`p-4 rounded-lg border text-sm ${
          oauthMessage.type === 'success'
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
            : 'bg-red-500/10 border-red-500/30 text-red-400'
        }`}>
          <p className="font-medium">{oauthMessage.text}</p>
        </div>
      )}

      {/* VoAI TTS Test */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-brand-cream mb-1">VoAI TTS</h2>
        <p className="text-sm text-zinc-400 mb-4">
          送一段短文字到 VoAI endpoint，確認服務是否可用。
        </p>

        <button
          onClick={testVoai}
          disabled={loading}
          className="px-4 py-2 bg-brand/20 text-brand rounded-lg text-sm font-medium hover:bg-brand/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? (
            <span className="flex items-center gap-2"><Spinner />Testing...</span>
          ) : (
            'Test VoAI TTS'
          )}
        </button>

        {result && (
          <div className={`mt-4 p-4 rounded-lg border text-sm ${
            result.ok
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
              : 'bg-red-500/10 border-red-500/30 text-red-400'
          }`}>
            {result.ok ? (
              <div className="space-y-1">
                <p className="font-medium">OK — VoAI is reachable</p>
                <p className="text-zinc-400">Latency: {result.latencyMs}ms</p>
                <p className="text-zinc-400">Content-Type: {result.contentType}</p>
              </div>
            ) : (
              <div className="space-y-1">
                <p className="font-medium">Failed</p>
                {result.statusCode && <p className="text-zinc-400">Status: {result.statusCode}</p>}
                {result.latencyMs != null && <p className="text-zinc-400">Latency: {result.latencyMs}ms</p>}
                <pre className="mt-2 text-xs whitespace-pre-wrap break-all text-red-300/80">{result.error}</pre>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Gmail OAuth */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-brand-cream mb-1">Gmail OAuth</h2>
        <p className="text-sm text-zinc-400 mb-4">
          檢查 Gmail OAuth token 狀態，如果過期可以 refresh 或重新驗證。
        </p>

        {/* Status display */}
        {oauthLoading ? (
          <div className="flex items-center gap-2 text-zinc-400 text-sm">
            <Spinner /> Loading token status...
          </div>
        ) : oauthStatus ? (
          <div className="space-y-3">
            <div className={`p-4 rounded-lg border text-sm ${
              oauthStatus.exists && !oauthStatus.isExpired
                ? 'bg-emerald-500/10 border-emerald-500/30'
                : oauthStatus.exists && oauthStatus.isExpired
                  ? 'bg-amber-500/10 border-amber-500/30'
                  : 'bg-red-500/10 border-red-500/30'
            }`}>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className={`inline-block w-2 h-2 rounded-full ${
                    oauthStatus.exists && !oauthStatus.isExpired ? 'bg-emerald-400' :
                    oauthStatus.exists && oauthStatus.isExpired ? 'bg-amber-400' : 'bg-red-400'
                  }`} />
                  <span className={`font-medium ${
                    oauthStatus.exists && !oauthStatus.isExpired ? 'text-emerald-400' :
                    oauthStatus.exists && oauthStatus.isExpired ? 'text-amber-400' : 'text-red-400'
                  }`}>
                    {!oauthStatus.exists ? 'Token 不存在' :
                     oauthStatus.isExpired ? 'Token 已過期' : 'Token 有效'}
                  </span>
                </div>
                {oauthStatus.exists && (
                  <>
                    <p className="text-zinc-400 text-xs">
                      Expiry: {oauthStatus.expiryDate ? new Date(oauthStatus.expiryDate).toLocaleString('zh-TW') : 'N/A'}
                    </p>
                    <p className="text-zinc-400 text-xs">
                      Refresh Token: {oauthStatus.hasRefreshToken ? 'Yes' : 'No'}
                    </p>
                  </>
                )}
                {oauthStatus.error && (
                  <pre className="text-xs text-red-300/80 whitespace-pre-wrap break-all">{oauthStatus.error}</pre>
                )}
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex gap-3">
              <button
                onClick={fetchOAuthStatus}
                className="px-4 py-2 bg-zinc-800 text-zinc-300 rounded-lg text-sm font-medium hover:bg-zinc-700 transition-colors"
              >
                Refresh Status
              </button>
              {oauthStatus.canRefresh && (
                <button
                  onClick={refreshToken}
                  disabled={refreshing}
                  className="px-4 py-2 bg-brand/20 text-brand rounded-lg text-sm font-medium hover:bg-brand/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {refreshing ? (
                    <span className="flex items-center gap-2"><Spinner />Refreshing...</span>
                  ) : (
                    'Refresh Token'
                  )}
                </button>
              )}
              <button
                onClick={startOAuth}
                className="px-4 py-2 bg-blue-600/20 text-blue-400 rounded-lg text-sm font-medium hover:bg-blue-600/30 transition-colors"
              >
                重新驗證 OAuth
              </button>
              {oauthStatus?.exists && !oauthStatus.isExpired && (
                <button
                  onClick={sendTestEmail}
                  disabled={sendingTest}
                  className="px-4 py-2 bg-emerald-600/20 text-emerald-400 rounded-lg text-sm font-medium hover:bg-emerald-600/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {sendingTest ? (
                    <span className="flex items-center gap-2"><Spinner />Sending...</span>
                  ) : (
                    'Send Test Email'
                  )}
                </button>
              )}
            </div>

            {/* Refresh result */}
            {refreshResult && (
              <div className={`p-3 rounded-lg border text-sm ${
                refreshResult.ok
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                  : 'bg-red-500/10 border-red-500/30 text-red-400'
              }`}>
                {refreshResult.ok ? (
                  <p className="font-medium">Token refreshed — expires {refreshResult.expiryDate ? new Date(refreshResult.expiryDate).toLocaleString('zh-TW') : 'N/A'}</p>
                ) : (
                  <div>
                    <p className="font-medium">Refresh failed</p>
                    <pre className="mt-1 text-xs whitespace-pre-wrap break-all text-red-300/80">{refreshResult.error}</pre>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
