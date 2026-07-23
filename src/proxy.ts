import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse, type NextRequest } from 'next/server';
import { isValidClerkKey } from '@/lib/clerk-utils';

const isPublicRoute = createRouteMatcher([
  '/',
  '/submit',
  '/p/:path*',
  '/share/:path*',
  '/api/health',
]);

// Fallback middleware when Clerk key is invalid (E2E / dev / local)
function fallbackMiddleware(_req: NextRequest) {
  return NextResponse.next();
}

export default isValidClerkKey
  ? clerkMiddleware(async (auth, req) => {
      if (!isPublicRoute(req)) {
        const { userId } = await auth();
        if (!userId) {
          // API routes get a 401 JSON; pages get redirected to home.
          if (req.nextUrl.pathname.startsWith('/api/')) {
            return NextResponse.json(
              { success: false, error: 'Unauthorized' },
              { status: 401 },
            );
          }
          return NextResponse.redirect(new URL('/', req.url));
        }
      }
      return NextResponse.next();
    })
  : fallbackMiddleware;

export const config = {
  matcher: ['/((?!.*\\..*|_next).*)', '/', '/(api|trpc)(.*)'],
};
