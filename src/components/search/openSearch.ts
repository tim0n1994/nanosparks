/**
 * The command palette lives in the root layout; anything that wants to open it
 * (nav button, empty-state CTA, mobile users with no keyboard) fires this event.
 * A one-line event beats threading a context provider through every page.
 */
export const OPEN_SEARCH_EVENT = 'nanosparks:open-search';

export function openSearch(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(OPEN_SEARCH_EVENT));
}
