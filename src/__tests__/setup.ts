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
