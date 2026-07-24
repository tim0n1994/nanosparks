'use client';

/**
 * V3/T-V3-4: Person Hub page.
 *
 * Surfaces a person's profile card, opinion library (CanonicalClaims with
 * stance/citation/timestamp/reader-link), claim timeline, style card, and
 * (when chatEnabled) a persona chat panel with the mandatory AI-simulated
 * disclosure. The chat panel is hidden when chatEnabled is false (hard gate).
 */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Navbar from '@/components/ui/Navbar';
import LoadingSpinner from '@/components/loading-spinner';
import ClaimTimeline from '@/components/visualization/ClaimTimeline';

interface Profile {
  displayName: string;
  statsJson: { mentionCount?: number; conversationCount?: number; firstSeenAt?: string | null; lastSeenAt?: string | null } | null;
  styleJson: { catchphrases?: string[]; metaphors?: string[]; sentencePatterns?: string[]; toneSummary?: string } | null;
  summaryText: string | null;
  chatEnabled: boolean;
}
interface OpinionEntry {
  id: string;
  text: string;
  stance: string | null;
  assertedAt: string | null;
  conversationId: string | null;
}
interface PersonData {
  entity: { id: string; canonicalName: string; aliasesJson: unknown };
  profile: Profile | null;
  opinionLibrary: OpinionEntry[];
}

export default function PersonHubPage() {
  const params = useParams();
  const entityId = params.id as string;
  const [data, setData] = useState<PersonData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/person/${entityId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Not found'))))
      .then((j) => setData(j.data))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [entityId]);

  if (loading) return <LoadingSpinner />;
  if (error || !data) return <div className="p-8 text-red-500">{error || 'Not found'}</div>;

  const profile = data.profile;
  const aliases = Array.isArray(data.entity.aliasesJson) ? (data.entity.aliasesJson as string[]) : [];
  const style = profile?.styleJson ?? {};
  const stats = profile?.statsJson ?? {};

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <main className="mx-auto max-w-3xl space-y-8 px-4 py-8">
        {/* Profile card */}
        <header className="rounded-xl border border-zinc-200 bg-white p-6">
          <h1 className="text-2xl font-bold text-zinc-900">{data.entity.canonicalName}</h1>
          {aliases.length > 0 && (
            <p className="mt-1 text-sm text-zinc-500">又称：{aliases.join('、')}</p>
          )}
          {profile?.summaryText && <p className="mt-3 leading-relaxed text-zinc-700">{profile.summaryText}</p>}
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-sm text-zinc-500">
            <span>提及 {stats.mentionCount ?? 0} 次</span>
            <span>·</span>
            <span>出场 {stats.conversationCount ?? 0} 集</span>
            {stats.firstSeenAt && <><span>·</span><span>首次 {new Date(stats.firstSeenAt).toLocaleDateString()}</span></>}
          </div>
        </header>

        {/* Style card */}
        {(style.catchphrases?.length || style.metaphors?.length || style.toneSummary) && (
          <section className="rounded-xl border border-zinc-200 bg-white p-6">
            <h2 className="mb-3 section-label">语言风格</h2>
            {style.toneSummary && <p className="mb-3 text-sm text-zinc-700">{style.toneSummary}</p>}
            {style.catchphrases && style.catchphrases.length > 0 && (
              <TagRow label="口头禅" items={style.catchphrases} />
            )}
            {style.metaphors && style.metaphors.length > 0 && (
              <TagRow label="常用比喻" items={style.metaphors} />
            )}
            {style.sentencePatterns && style.sentencePatterns.length > 0 && (
              <TagRow label="句式习惯" items={style.sentencePatterns} />
            )}
          </section>
        )}

        {/* Opinion library + claim timeline */}
        <section className="rounded-xl border border-zinc-200 bg-white p-6">
          <h2 className="mb-4 section-label">观点库</h2>
          <ClaimTimeline
            entries={data.opinionLibrary.map((o) => ({ claimId: o.id, text: o.text, assertedAt: o.assertedAt, conversationId: o.conversationId, stance: o.stance }))}
          />
        </section>

        {/* Persona chat (only when enabled) */}
        {profile?.chatEnabled && (
          <PersonaChat entityId={entityId} name={data.entity.canonicalName} />
        )}
      </main>
    </div>
  );
}

function TagRow({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="mb-2">
      <span className="mr-2 text-xs font-medium text-zinc-400">{label}</span>
      <span className="flex flex-wrap gap-1.5">
        {items.map((it, i) => (
          <span key={i} className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600">{it}</span>
        ))}
      </span>
    </div>
  );
}

function PersonaChat({ entityId, name }: { entityId: string; name: string }) {
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; text: string }[]>([]);
  const [busy, setBusy] = useState(false);

  const ask = async () => {
    const q = question.trim();
    if (!q || busy) return;
    setMessages((m) => [...m, { role: 'user', text: q }]);
    setQuestion('');
    setBusy(true);
    try {
      const res = await fetch(`/api/person/${entityId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({ error: 'failed' }));
        setMessages((m) => [...m, { role: 'assistant', text: j.error ?? 'failed' }]);
        return;
      }
      // Parse the single result SSE event (non-streaming payload for simplicity).
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let answer = '';
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const resultLine = buffer.match(/data: (.+)/);
          if (resultLine && buffer.includes('event: result')) {
            const parsed = JSON.parse(resultLine[1]);
            answer = parsed.answer ?? parsed.text ?? '';
            break;
          }
        }
      }
      setMessages((m) => [...m, { role: 'assistant', text: answer || '（无回复）' }]);
    } catch {
      setMessages((m) => [...m, { role: 'assistant', text: '请求失败' }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-6">
      <h2 className="mb-1 section-label">与 {name} 对话</h2>
      <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
        AI 根据公开播客发言模拟，非本人，观点以原音频为准。
      </p>
      <div className="mb-3 space-y-2">
        {messages.map((m, i) => (
          <div key={i} className={`rounded-lg px-3 py-2 text-sm ${m.role === 'user' ? 'bg-zinc-100 text-zinc-800' : 'bg-blue-50 text-zinc-800'}`}>
            {m.text}
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && ask()}
          placeholder="问一个 TA 公开谈过的话题…"
          className="flex-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400"
        />
        <button
          type="button"
          onClick={ask}
          disabled={busy}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? '…' : '发送'}
        </button>
      </div>
    </section>
  );
}
