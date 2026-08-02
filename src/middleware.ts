import { clerkMiddleware } from '@clerk/astro/server';
import { getConfiguredSiteUrl, resolveAuthOrigin } from './lib/env';

const protectedRoute = (pathname: string) => ['/dashboard', '/data-settings', '/ai-insights', '/questions', '/report', '/api'].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

export const onRequest = clerkMiddleware((auth, context, next) => {
  if (protectedRoute(context.url.pathname) && !auth().userId) {
    const authOrigin = resolveAuthOrigin(context.url, getConfiguredSiteUrl());
    const signIn = new URL('/sign-in', `${authOrigin}/`);
    const returnUrl = new URL(
      `${context.url.pathname}${context.url.search}`,
      `${authOrigin}/`,
    );
    signIn.searchParams.set('redirect_url', returnUrl.toString());
    return context.redirect(signIn.toString());
  }
  return next();
});
