import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse, type NextRequest } from 'next/server';
import { isValidClerkKey } from '@/lib/clerk-utils';

// Full-site login wall: only auth pages, health check, and webhooks are public.
// Everything else (/, /submit, /p/*, /share/*, /dashboard, /admin, all APIs)
// requires an authenticated session; unauthenticated visitors are sent to sign-in.
const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/health',
  // Webhooks must be reachable without Clerk session auth — verified via
  // CLERK_WEBHOOK_SIGNING_SECRET inside the route handler instead.
  '/api/webhooks/(.*)',
]);

// Fallback middleware when Clerk key is invalid (E2E / dev / local)
function fallbackMiddleware(req: NextRequest) {
  if (process.env.NODE_ENV === 'production' && !isPublicRoute(req)) {
    return NextResponse.json(
      { success: false, error: 'Authentication is not configured' },
      { status: 503 },
    );
  }
  return NextResponse.next();
}

export default isValidClerkKey
  ? clerkMiddleware(async (auth, req) => {
      if (!isPublicRoute(req)) {
        const { userId } = await auth();
        if (!userId) {
          // API routes get a 401 JSON; pages get redirected to sign-in.
          if (req.nextUrl.pathname.startsWith('/api/')) {
            return NextResponse.json(
              { success: false, error: 'Unauthorized' },
              { status: 401 },
            );
          }
          return NextResponse.redirect(new URL('/sign-in', req.url));
        }
      }
      return NextResponse.next();
    })
  : fallbackMiddleware;

export const config = {
  matcher: ['/((?!.*\\..*|_next).*)', '/', '/(api|trpc)(.*)'],
};
