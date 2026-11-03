/**
 * Higgsfield API example: text-to-video with Seedance 2.5.
 *
 * Run:  npm run higgsfield:example      (or: npx tsx index.ts)
 *
 * Credentials come from HF_CREDENTIALS in the form key-id:key-secret, read by the official SDK
 * from the environment. `.env.local` (ignored by Git) is loaded first so a local value is picked up;
 * an already-exported variable wins. The value is never printed or logged here.
 *
 * This makes a billable generation request.
 */
import { config as loadEnv } from 'dotenv';
import { higgsfield, createHiggsfieldClient } from '@higgsfield/client/v2';

loadEnv({ path: '.env.local', quiet: true });

const MODEL = 'bytedance/seedance-2.5/text-to-video';
const INPUT = {
  prompt: 'A cinematic scene at sunset',
  duration: 5,
  resolution: '720p',
  aspect_ratio: '16:9',
};

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function main(): Promise<void> {
  const creds = process.env.HF_CREDENTIALS;
  if (!creds || !creds.includes(':')) {
    fail('HF_CREDENTIALS is not set (expected key-id:key-secret in .env.local or the environment). No request was made.');
  }

  // Video generation can take a while: allow 15 minutes of polling instead of the SDK's 5-minute default.
  const client = createHiggsfieldClient({ credentials: creds, maxPollTime: 15 * 60 * 1000, pollInterval: 3000 });
  void higgsfield; // the configured singleton would work too; an explicit client keeps the timeout settings local

  console.log(`Submitting ${MODEL} ...`);
  const response = await client.subscribe(MODEL, { input: INPUT, withPolling: true });

  const status = String(response.status);
  const url = response.video?.url;

  switch (status) {
    case 'completed':
      if (!url) fail(`Request ${response.request_id} completed but returned no video URL.`);
      console.log(`Completed. Request ${response.request_id}`);
      console.log(`Video URL: ${url}`);
      return;
    case 'failed':
      fail(`Request ${response.request_id} failed (credits are refunded for failed requests). No video was produced.`);
    // eslint-disable-next-line no-fallthrough
    case 'nsfw':
      fail(`Request ${response.request_id} was rejected by moderation (status "nsfw"). No video was produced.`);
    // eslint-disable-next-line no-fallthrough
    case 'canceled':
      fail(`Request ${response.request_id} was canceled. No video was produced.`);
    // eslint-disable-next-line no-fallthrough
    default:
      fail(`Request ${response.request_id} ended with status "${status}" and no usable result.`);
  }
}

main().catch((err: unknown) => {
  const e = err as { name?: string; message?: string; statusCode?: number; details?: unknown; code?: string };
  const parts = [e?.name || 'Error', e?.message || String(err)];
  if (e?.statusCode) parts.push(`HTTP ${e.statusCode}`);
  if (e?.code) parts.push(`code ${e.code}`);
  if (e?.details) parts.push(JSON.stringify(e.details));
  fail('Generation did not complete: ' + parts.join(' | '));
});
