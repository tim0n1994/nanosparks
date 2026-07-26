'use client';

/**
 * V3/T-V3-4: Person Hub page.
 *
 * Surfaces a person's profile card, opinion library (CanonicalClaims with
 * stance/citation/timestamp/reader-link), claim timeline, style card, and
 * (when chatEnabled) a persona chat panel with the mandatory AI-simulated
 * disclosure. The chat panel is hidden when chatEnabled is false (hard gate).
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Navbar from '@/components/ui/Navbar';
import PageShell from '@/components/ui/PageShell';
import { useTranslation } from '@/lib/i18n/useTranslation';
import ClaimTimeline from '@/components/visualization/ClaimTimeline';

interface Profile {
  displayName: string;
  statsJson: { mentionCount?: number; conversationCount?: number; spokenConversationCount?: number; spokenTurnCount?: number; firstSeenAt?: string | null; lastSeenAt?: string | null } | null;
  styleJson: { catchphrases?: string[]; metaphors?: string[]; sentencePatterns?: string[]; toneSummary?: string } | null;
  relationsJson: { coAppears?: { name: string; count: number }[] } | null;
  summaryText: string | null;
  chatEnabled: boolean;
}
interface OpinionEntry {
  id: string;
  text: string;
  stance: string | null;
  modality?: string | null;
  assertedAt: string | null;
  conversationId: string | null;
  evidence?: { turnId: string | null; startMs: number; endMs: number; quote: string } | null;
  trust?: { score: number; factors: Array<{ stage: string; value: number; basis: string }> } | null;
}
interface PersonData {
  entity: { id: string; canonicalName: string; aliasesJson: unknown };
  profile: Profile | null;
  opinionLibrary: OpinionEntry[];
  fingerprint?: {
    version: number;
    coreClaimsJson: unknown;
    stanceMapJson: unknown;
    styleJson: { hedgeRate?: number; evidenceTypeDist?: Record<string, number>; sourceTypes?: string[] } | null;
    lineageJson: Array<{ name: string; count: number }> | null;
    coverageJson: { episodeCount?: number; wordCount?: number; timeSpanMs?: number };
    builtAt: string;
  } | null;
  quoteWall: { id: string; text: string; conversationId: string }[];
}

export default function PersonHubPage() {
  const params = useParams();
  const entityId = params.id as string;
  const { t } = useTranslation();
  const [data, setData] = useState<PersonData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    fetch(`/api/person/${entityId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(t('person.notFound')))))
      .then((j) => setData(j.data))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : t('common.networkError')))
      .finally(() => setLoading(false));
  }, [entityId, t]);

  // Fetch-on-mount: the setState calls happen in promise callbacks.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => load(), [load]);

  if (loading || error || !data) {
    return (
      <PageShell
        width="reading"
        loading={loading}
        error={error || (!data ? t('person.notFound') : null)}
        onRetry={load}
        breadcrumb={{ href: '/dashboard', label: t('shelf.title') }}
      />
    );
  }

  const profile = data.profile;
  const aliases = Array.isArray(data.entity.aliasesJson) ? (data.entity.aliasesJson as string[]) : [];
  const style = profile?.styleJson ?? {};
  const stats = profile?.statsJson ?? {};
  const relations = (profile?.relationsJson as { coAppears?: { name: string; count: number }[] } | null)?.coAppears ?? [];

  return (
    <div className="min-h-[100dvh] bg-surface">
      <Navbar />
      <main id="main" className="mx-auto max-w-reading space-y-8 px-5 py-8">
        {/* Profile card */}
        <header className="rounded-xl border border-line bg-surface-raised p-6">
          <h1 className="text-2xl font-bold text-ink">{data.entity.canonicalName}</h1>
          {aliases.length > 0 && (
            <p className="mt-1 text-sm text-ink-muted">{t('person.aliases', { list: aliases.join(t('person.aliasSep')) })}</p>
          )}
          {profile?.summaryText && <p className="mt-3 leading-relaxed text-ink-subtle">{profile.summaryText}</p>}
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-muted">
            <span>{t('person.mentions', { count: stats.mentionCount ?? 0 })}</span>
            <span>·</span>
            <span>{t('person.appearances', { count: stats.conversationCount ?? 0 })}</span>
            {typeof stats.spokenTurnCount === 'number' && stats.spokenTurnCount > 0 && (
              <>
                <span>·</span>
                <span>{stats.spokenTurnCount} turns spoken</span>
              </>
            )}
            {typeof stats.spokenConversationCount === 'number' && stats.spokenConversationCount > 0 && (
              <>
                <span>·</span>
                <span>{stats.spokenConversationCount} episodes spoken</span>
              </>
            )}
            {stats.firstSeenAt && <><span>·</span><span>{t('person.firstSeen', { date: new Date(stats.firstSeenAt).toLocaleDateString() })}</span></>}
          </div>

          {data.fingerprint && (
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink-muted">
              <span>fingerprint v{data.fingerprint.version}</span>
              {data.fingerprint.styleJson?.hedgeRate != null && (
                <span>hedge {data.fingerprint.styleJson.hedgeRate}%</span>
              )}
              {data.fingerprint.coverageJson?.wordCount != null && (
                <span>{Math.round(data.fingerprint.coverageJson.wordCount / 1000)}k chars</span>
              )}
              {data.fingerprint.styleJson?.sourceTypes && (
                <span>sources: {data.fingerprint.styleJson.sourceTypes.join(', ')}</span>
              )}
            </div>
          )}
        </header>

        {/* Style card */}
        {(style.catchphrases?.length || style.metaphors?.length || style.toneSummary) && (
          <section className="rounded-xl border border-line bg-surface-raised p-6">
            <h2 className="mb-3 section-label">{t('person.style')}</h2>
            {style.toneSummary && <p className="mb-3 text-sm text-ink-subtle">{style.toneSummary}</p>}
            {style.catchphrases && style.catchphrases.length > 0 && (
              <TagRow label={t('person.catchphrases')} items={style.catchphrases} />
            )}
            {style.metaphors && style.metaphors.length > 0 && (
              <TagRow label={t('person.metaphors')} items={style.metaphors} />
            )}
            {style.sentencePatterns && style.sentencePatterns.length > 0 && (
              <TagRow label={t('person.sentencePatterns')} items={style.sentencePatterns} />
            )}
          </section>
        )}

        {/* Opinion library + claim timeline */}
        <section className="rounded-xl border border-line bg-surface-raised p-6">
          <h2 className="mb-4 section-label">{t('person.opinions')}</h2>
          <ClaimTimeline
            entries={data.opinionLibrary.map((o) => ({ claimId: o.id, text: o.text, assertedAt: o.assertedAt, conversationId: o.conversationId, stance: o.stance, modality: o.modality, evidence: o.evidence, trust: o.trust }))}
          />
        </section>

        {/* Relation net: frequent co-speakers */}
        {relations.length > 0 && (
          <section className="rounded-xl border border-line bg-surface-raised p-6">
            <h2 className="mb-3 section-label">{t('person.coSpeakers')}</h2>
            <div className="flex flex-wrap gap-1.5">
              {relations.map((r, i) => (
                <span key={i} className="rounded-full bg-surface-sunken px-2.5 py-1 text-xs text-ink-subtle">
                  {r.name} <span className="text-ink-muted">×{r.count}</span>
                </span>
              ))}
            </div>
          </section>
        )}

        {/* Quote wall (seeds B1 card generation) */}
        {data.quoteWall.length > 0 && (
          <section className="rounded-xl border border-line bg-surface-raised p-6">
            <h2 className="mb-3 section-label">{t('person.quoteWall')}</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {data.quoteWall.map((q) => (
                <div key={q.id} className="rounded-lg bg-surface-sunken p-3">
                  <p className="text-sm leading-relaxed text-ink-subtle">&ldquo;{q.text.slice(0, 80)}&rdquo;</p>
                  {q.conversationId && (
                    <a className="mt-1 inline-block text-2xs text-link hover:underline" href={`/read/${q.conversationId}`}>{t('person.toReader')}</a>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

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
      <span className="mr-2 text-xs font-medium text-ink-muted">{label}</span>
      <span className="flex flex-wrap gap-1.5">
        {items.map((it, i) => (
          <span key={i} className="rounded-full bg-surface-sunken px-2 py-0.5 text-xs text-ink-subtle">{it}</span>
        ))}
      </span>
    </div>
  );
}

function PersonaChat({ entityId, name }: { entityId: string; name: string }) {
  const { t } = useTranslation();
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
      setMessages((m) => [...m, { role: 'assistant', text: answer || '(no reply)' }]);
    } catch {
      setMessages((m) => [...m, { role: 'assistant', text: t('person.chat.failed') }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-line bg-surface-raised p-6">
      <h2 className="mb-1 section-label">与 {name} 对话</h2>
      <p className="mb-3 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
        AI 根据公开播客发言模拟，非本人，观点以原音频为准。
      </p>
      <div className="mb-3 space-y-2">
        {messages.map((m, i) => (
          <div key={i} className={`rounded-lg px-3 py-2 text-sm ${m.role === 'user' ? 'bg-surface-sunken text-ink' : 'bg-blue-50 text-ink'}`}>
            {m.text}
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && ask()}
          placeholder={t('person.chat.placeholder')}
          className="flex-1 rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-ink-muted"
        />
        <button
          type="button"
          onClick={ask}
          disabled={busy}
          className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-surface-raised disabled:opacity-50"
        >
          {busy ? '…' : t('person.chat.send')}
        </button>
      </div>
    </section>
  );
}
