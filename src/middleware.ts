import { clerkMiddleware } from '@clerk/astro/server';

const protectedRoute = (pathname: string) => ['/dashboard', '/data-settings', '/ai-insights', '/questions', '/report', '/api'].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

export const onRequest = clerkMiddleware((auth, context, next) => {
  if (protectedRoute(context.url.pathname) && !auth().userId) {
    const signIn = new URL('/sign-in', context.url);
    signIn.searchParams.set('redirect_url', context.url.href);
    return context.redirect(signIn.toString());
  }
  return next();
});
