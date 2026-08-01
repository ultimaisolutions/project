import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function keyFrom(value: string) {
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) throw new Error('INVALID_ENCRYPTION_KEY');
  return key;
}

export function encryptSecret(secret: string, userId: string, encodedKey: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(encodedKey), iv);
  cipher.setAAD(Buffer.from(userId));
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((value) => value.toString('base64url')).join('.');
}

export function decryptSecret(payload: string, userId: string, encodedKey: string) {
  const [iv, tag, encrypted] = payload.split('.').map((value) => Buffer.from(value!, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(encodedKey), iv!);
  decipher.setAAD(Buffer.from(userId));
  decipher.setAuthTag(tag!);
  return Buffer.concat([decipher.update(encrypted!), decipher.final()]).toString('utf8');
}

type StoredSettings = { apiKeyEncrypted: string; apiKeyLastFour: string; spreadsheetId: string; worksheetName: string; status: string; lastTestedAt?: Date | string | null; lastSyncAt?: Date | string | null; lastErrorCode?: string | null };
export function publicSettings(settings: StoredSettings | null) {
  if (!settings) return { apiKeyConfigured: false, maskedApiKey: null, spreadsheetId: '', worksheetName: '', status: 'DISCONNECTED', lastTestedAt: null, lastSyncAt: null, lastErrorCode: null };
  return { apiKeyConfigured: true, maskedApiKey: `•••• •••• •••• ${settings.apiKeyLastFour}`, spreadsheetId: settings.spreadsheetId, worksheetName: settings.worksheetName, status: settings.status, lastTestedAt: settings.lastTestedAt ?? null, lastSyncAt: settings.lastSyncAt ?? null, lastErrorCode: settings.lastErrorCode ?? null };
}
