import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Sigma's renderer import references WebGL globals that jsdom lacks. The
// InsightGraph component only calls it inside its network-view effect; stub the
// module so component tests (list-view + insight panel) don't emit unhandled
// WebGL rejections. The real renderer is exercised by e2e in a browser.
vi.mock('sigma', () => ({
  default: class MockSigma {
    constructor() {}
    on() {}
    kill() {}
  },
}));

// App-router hooks. Components that navigate (ReaderShell, Navbar, the command
// palette) call these at render time and throw outside a Next request scope.
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/',
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
  notFound: vi.fn(),
  redirect: vi.fn(),
}));

// jsdom has no IntersectionObserver; the reader uses it for reading-progress
// tracking and for the load-more sentinel.
class MockIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '';
  readonly thresholds: ReadonlyArray<number> = [];
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}
vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);

// jsdom has no EventSource; the reader subscribes to the staged-progress SSE
// stream whenever an episode is still being processed. Inert by default —
// tests that care about stream behaviour install their own richer mock.
class MockEventSource {
  static readonly CLOSED = 2;
  readyState = 0;
  url: string;
  constructor(url: string) {
    this.url = url;
  }
  addEventListener() {}
  removeEventListener() {}
  close() {
    this.readyState = 2;
  }
}
vi.stubGlobal('EventSource', MockEventSource);

// Nor a real matchMedia — the pre-paint theme script probes it.
vi.stubGlobal(
  'matchMedia',
  vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
);
