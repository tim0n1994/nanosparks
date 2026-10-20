import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server';
import { isValidClerkKey } from '@/lib/clerk-utils';

const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/health',
  '/api/health/worker', // Prometheus scrape target (2026-10-19): public so the deploy gate and scrapers can reach it
  '/api/webhooks/(.*)',
]);

function fallbackMiddleware(req: NextRequest) {
  if (process.env.NODE_ENV === 'production' && !isPublicRoute(req)) {
    return NextResponse.json({ success: false, error: 'Authentication is not configured' }, { status: 503 });
  }
  return NextResponse.next();
}

/**
 * Clerk's decorateRequest turns NextResponse.next() into a same-URL absolute
 * rewrite (x-middleware-rewrite: https://<origin>/path) to carry its auth
 * headers. Next 16 proxies absolute-URL rewrites, so behind an https tunnel
 * it proxies https back into this http server (EPROTO 500, observed on
 * nanosparks.udify.fun 2026-10-19). A same-origin rewrite is by definition
 * internal — normalize it to a path rewrite and keep every header.
 */
function internalizeSameOriginRewrite(res: Response, req: NextRequest): Response {
  const rw = res.headers.get('x-middleware-rewrite');
  if (!rw) return res;
  try {
    const target = new URL(rw);
    const self = new URL(req.url);
    if (target.origin === self.origin) {
      // Point the rewrite at this server over plain http instead of the
      // forwarded https origin. Next 16 proxies absolute-URL rewrites; with
      // the https origin it would speak TLS to the http port (EPROTO 500),
      // and a path-only value crashes the edge adapter (ERR_INVALID_URL).
      // A local absolute http URL is exactly what the no-proxy-header path
      // already uses, so the proxy hop stays on-loopback.
      const localOrigin = `http://127.0.0.1:${process.env.PORT ?? '17503'}`;
      const headers = new Headers(res.headers);
      headers.set('x-middleware-rewrite', `${localOrigin}${target.pathname}${target.search}`);
      return new NextResponse(null, { status: res.status, headers });
    }
  } catch {
    // relative rewrite or non-URL value — leave untouched
  }
  return res;
}

const clerkHandler = clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    const { userId } = await auth();
    if (!userId) {
      if (req.nextUrl.pathname.startsWith('/api/')) {
        return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
      }
      return NextResponse.redirect(new URL('/sign-in', req.url));
    }
  }
  return NextResponse.next();
});

export default async function middleware(req: NextRequest, event: NextFetchEvent) {
  if (!isValidClerkKey) {
    return fallbackMiddleware(req);
  }
  // Guard against Clerk's Next 16 middleware recursion. decorateRequest turns
  // NextResponse.next() into a same-URL rewrite carrying Clerk auth headers;
  // in Next 16 that rewrite re-enters middleware, looping forever. When the
  // incoming request already carries Clerk's auth state, pass it through so
  // the route handler reads auth() from headers.
  if (req.headers.has('x-clerk-auth-status') || req.headers.has('x-clerk-request-data')) {
    return NextResponse.next();
  }
  const handled = await clerkHandler(req, event);
  return handled ? internalizeSameOriginRewrite(handled, req) : NextResponse.next();
}

export const config = {
  matcher: ['/((?!.*\\..*|_next).*)', '/', '/(api|trpc)(.*)'],
};
