import { describe, expect, test } from 'bun:test';
import * as envModule from '../src/lib/env';

type ResolveAuthOrigin = (
  requestUrl: URL,
  configuredSiteUrl?: string,
) => string;

const resolveAuthOrigin = (
  envModule as typeof envModule & { resolveAuthOrigin?: ResolveAuthOrigin }
).resolveAuthOrigin;

describe('authentication redirect origin', () => {
  test('keeps authentication on localhost during local development', () => {
    expect(resolveAuthOrigin?.(
      new URL('http://localhost:4321/sign-in'),
      'https://stsiconic-project.vercel.app',
    )).toBe('http://localhost:4321');
  });

  test('never lets a hosted request inherit a configured localhost origin', () => {
    expect(resolveAuthOrigin?.(
      new URL('https://stsiconic-project.vercel.app/sign-in'),
      'http://localhost:4321',
    )).toBe('https://stsiconic-project.vercel.app');
  });

  test('sends a hosted preview back to the configured showcase origin', () => {
    expect(resolveAuthOrigin?.(
      new URL('https://stsiconic-project-git-fix.example.vercel.app/sign-in'),
      'https://stsiconic-project.vercel.app',
    )).toBe('https://stsiconic-project.vercel.app');
  });
});
