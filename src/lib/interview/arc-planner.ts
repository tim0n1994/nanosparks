/**
 * P5a: arc planner — the interviewer's topic order + time budget.
 *
 * Plans an interview arc from the host fingerprint (habitual topic flow) and the
 * interviewee's PersonClaims (what's worth asking about). Produces an ordered
 * list of topics with time budgets that sum to the session length.
 *
 * Pure planner exported for testing; no LLM call (deterministic scheduling).
 */

export interface ArcTopic {
  id: string;
  label: string;
  /** Minutes allocated to this topic in the arc. */
  minutes: number;
  /** Seed question to open the topic. */
  seedQuestion: string;
}

export interface InterviewArc {
  topics: ArcTopic[];
  totalMinutes: number;
}

/**
 * Pure: build an arc from the interviewee's core claims. Ranks by the fingerprint's
 * core-claim scores, allocates time proportional to score, caps the topic count,
 * and synthesizes a seed question per topic. Falls back to generic topics if no
 * claims/fingerprint.
 */
export function planArc(opts: {
  fingerprint: { coreClaimsJson: unknown } | null;
  totalMinutes: number;
  maxTopics?: number;
}): InterviewArc {
  const { totalMinutes, maxTopics = 5 } = opts;
  const rawClaims = (opts.fingerprint?.coreClaimsJson ?? []) as Array<{
    text: string; score?: number; recurrence?: number;
  }>;

  const ranked = [...rawClaims]
    .sort((a, b) => (b.score ?? (b.recurrence ?? 0)) - (a.score ?? (a.recurrence ?? 0)))
    .slice(0, maxTopics);

  if (ranked.length === 0) {
    // Generic fallback arc.
    const mins = Math.round(totalMinutes / 3);
    return {
      topics: [
        { id: 'intro', label: '开场', minutes: Math.max(2, Math.round(mins * 0.5)), seedQuestion: '先简单介绍一下你自己和最近在忙什么？' },
        { id: 'main', label: '核心', minutes: mins, seedQuestion: '你最近最重要的一个观点是什么？' },
        { id: 'close', label: '收尾', minutes: Math.max(2, Math.round(mins * 0.5)), seedQuestion: '对未来一年你最想看到什么变化？' },
      ],
      totalMinutes,
    };
  }

  const totalScore = ranked.reduce((n, c) => n + (c.score ?? c.recurrence ?? 1), 0) || 1;
  const topics: ArcTopic[] = ranked.map((c, i) => {
    const share = (c.score ?? c.recurrence ?? 1) / totalScore;
    const minutes = Math.max(2, Math.round(totalMinutes * share));
    return {
      id: `topic_${i}`,
      label: c.text.slice(0, 40),
      minutes,
      seedQuestion: seedQuestionFor(c.text),
    };
  });
  // Ensure sums roughly to totalMinutes (normalize the largest topic to absorb slack).
  const used = topics.reduce((n, t) => n + t.minutes, 0);
  if (topics.length > 0) topics[0].minutes += Math.max(0, totalMinutes - used);

 return { topics, totalMinutes };
}

/** Pure: synthesize an opening seed question from a claim text. */
export function seedQuestionFor(claimText: string): string {
  const t = claimText.trim().replace(/[。.]+$/, '');
  if (!t) return '能展开讲讲吗？';
  return `你说过「${t.slice(0, 60)}」，能详细讲讲吗？依据是什么？`;
}
