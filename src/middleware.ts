import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse, type NextFetchEvent, type NextRequest } from 'next/server';
import { isValidClerkKey } from '@/lib/clerk-utils';

const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/health',
  '/api/webhooks/(.*)',
]);

function fallbackMiddleware(req: NextRequest) {
  if (process.env.NODE_ENV === 'production' && !isPublicRoute(req)) {
    return NextResponse.json({ success: false, error: 'Authentication is not configured' }, { status: 503 });
  }
  return NextResponse.next();
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
  return clerkHandler(req, event);
}

export const config = {
  matcher: ['/((?!.*\\..*|_next).*)', '/', '/(api|trpc)(.*)'],
};
