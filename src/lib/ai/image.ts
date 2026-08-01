import { createHash, randomUUID } from 'node:crypto';
import OpenAI from 'openai';
import { generateText, Output } from 'ai';
import { z } from 'zod';
import type { AnalyticsSnapshot } from './grounding';
import { getServerEnv } from '../env';
import { languageModel } from './model';

export const imageTypeSchema = z.enum([
  'cover',
  'summary',
  'campaign',
  'product',
  'achievement',
]);
export type ImageType = z.infer<typeof imageTypeSchema>;

export type GeneratedImageAsset = {
  imageBase64: string;
  mimeType: 'image/webp';
  prompt: string;
  title: string;
};

const imagePromptSchema = z.object({
  title: z.string().trim().min(3).max(100),
  prompt: z.string().trim().min(40).max(2_000),
});

const assets = new Map<string, {
  userId: string;
  expiresAt: number;
  asset: GeneratedImageAsset;
}>();

export function buildImageFacts(snapshot: AnalyticsSnapshot, type: ImageType) {
  return {
    type,
    period: snapshot.period,
    topCampaign: snapshot.leaders.topCampaign,
    topProduct: snapshot.rankings.products[0] ?? null,
    revenue: snapshot.kpis.revenue?.current ?? null,
    spend: snapshot.kpis.actualSpend?.current ?? null,
    leads: snapshot.kpis.leads?.current ?? null,
    deals: snapshot.kpis.deals?.current ?? null,
    roi: snapshot.kpis.roi?.current ?? null,
  };
}

export function storeImageAsset(userId: string, asset: GeneratedImageAsset) {
  const assetId = randomUUID();
  assets.set(assetId, {
    userId,
    expiresAt: Date.now() + 10 * 60_000,
    asset,
  });
  return assetId;
}

export function getImageAsset(userId: string, assetId: string) {
  const stored = assets.get(assetId);
  if (!stored || stored.userId !== userId || stored.expiresAt < Date.now()) {
    if (stored?.expiresAt && stored.expiresAt < Date.now()) assets.delete(assetId);
    return null;
  }
  return stored.asset;
}

async function draftImagePrompt(snapshot: AnalyticsSnapshot, type: ImageType) {
  const facts = buildImageFacts(snapshot, type);
  const result = await generateText({
    model: languageModel(),
    output: Output.object({ schema: imagePromptSchema }),
    system: `
You are an art director for a premium Israeli business intelligence brand.
Create an English image-generation prompt based only on the supplied facts.
Do not place text, letters, numbers, logos, watermarks, dashboards, or UI screenshots inside the image.
Use a refined dark navy and cyan visual language, high contrast, professional editorial composition.
The result should communicate the selected business story through objects, light, geometry, and atmosphere.
`.trim(),
    prompt: `Image category and verified business facts: ${JSON.stringify(facts)}`,
    temperature: 0.4,
    timeout: { totalMs: 45_000 },
  });
  return result.output;
}

export async function generateMarketingImage(
  snapshot: AnalyticsSnapshot,
  type: ImageType,
  userId: string,
): Promise<GeneratedImageAsset> {
  if (snapshot.rowCount === 0) {
    throw Object.assign(new Error('NO_DATA'), { code: 'NO_DATA' });
  }
  const apiKey = getServerEnv('OPENAI_API_KEY');
  if (!apiKey) {
    throw Object.assign(new Error('IMAGE_NOT_CONFIGURED'), {
      code: 'IMAGE_NOT_CONFIGURED',
    });
  }
  const drafted = await draftImagePrompt(snapshot, type);
  const client = new OpenAI({ apiKey });
  try {
    const response = await client.images.generate({
      model: 'gpt-image-2',
      prompt: drafted.prompt,
      size: '1024x1024',
      quality: 'low',
      background: 'opaque',
      output_format: 'webp',
      output_compression: 85,
      moderation: 'auto',
      n: 1,
      user: createHash('sha256').update(userId).digest('hex'),
    }, {
      timeout: 120_000,
      maxRetries: 1,
    });
    const imageBase64 = response.data?.[0]?.b64_json;
    if (!imageBase64) {
      throw Object.assign(new Error('IMAGE_EMPTY_RESPONSE'), {
        code: 'IMAGE_EMPTY_RESPONSE',
      });
    }
    return {
      imageBase64,
      mimeType: 'image/webp',
      prompt: drafted.prompt,
      title: drafted.title,
    };
  } catch (error) {
    if (
      typeof error === 'object'
      && error
      && 'code' in error
      && error.code === 'IMAGE_EMPTY_RESPONSE'
    ) {
      throw error;
    }
    throw Object.assign(new Error('IMAGE_GENERATION_FAILED'), {
      code: 'IMAGE_GENERATION_FAILED',
    });
  }
}
