import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { getServerEnv } from '../env';

export const AI_MODEL = 'deepseek/deepseek-v4-flash';

export function languageModel() {
  const apiKey = getServerEnv('OPENROUTER_API_KEY');
  if (!apiKey) {
    throw Object.assign(new Error('AI_NOT_CONFIGURED'), {
      code: 'AI_NOT_CONFIGURED',
    });
  }
  const provider = createOpenRouter({
    apiKey,
    compatibility: 'strict',
    appName: 'STSICONIC',
    appUrl: getServerEnv('PUBLIC_SITE_URL')
      ?? (getServerEnv('VERCEL_PROJECT_PRODUCTION_URL')
        ? `https://${getServerEnv('VERCEL_PROJECT_PRODUCTION_URL')}`
        : undefined),
  });
  return provider.chat(AI_MODEL);
}
