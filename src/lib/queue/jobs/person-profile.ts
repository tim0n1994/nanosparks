/**
 * Person-Profile Job (V3/T-V3-2) — incremental person profile rebuild.
 *
 * Recomputes a PersonProfile (stats / style card / relations / summary) for a
 * given person Entity. Triggered after an episode import that mentioned the
 * person. Debouncing/serialization is the queue's concern (concurrency=1).
 * chatEnabled is re-evaluated against the latest episode count.
 */

import { buildPersonProfile } from '@/lib/person/profile-builder';
import { logger } from '@/lib/logger';

export interface PersonProfileJobData {
  entityId: string;
  /** mark a sensitive person so chat stays disabled even at high counts */
  sensitive?: boolean;
}

export async function processPersonProfileJob(data: PersonProfileJobData): Promise<void> {
  const { entityId, sensitive } = data;
  if (!entityId) throw new Error('person-profile job requires entityId');
  logger.info('Person-profile job started', { entityId, sensitive });
  const result = await buildPersonProfile(entityId, { sensitive });
  logger.info('Person-profile job done', { entityId, chatEnabled: result.chatEnabled });
}
