/**
 * Generate the home-page artwork with the Higgsfield API and save it into assets/art/.
 *
 *   npx tsx scripts/generate-art.ts              # every piece that is missing
 *   npx tsx scripts/generate-art.ts --all        # regenerate everything
 *   npx tsx scripts/generate-art.ts hero card-highway   # only these
 *   npx tsx scripts/generate-art.ts --model alibaba/qwen-image-3/text-to-image hero
 *
 * Credentials: HF_CREDENTIALS=key-id:key-secret in .env.local (ignored by Git) or the environment.
 * Each image is a billable request. Results are downloaded and converted to JPG with ffmpeg
 * (longest side 1800px, quality 82) so the site stays light.
 */
import { config as loadEnv } from 'dotenv';
import axios from 'axios';
import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createHiggsfieldClient } from '@higgsfield/client/v2';

loadEnv({ path: '.env.local', quiet: true });

const OUT = join(process.cwd(), 'assets', 'art');
const STYLE = 'Hand-painted editorial illustration, flat shapes with soft gouache texture and visible paper grain, limited palette of deep navy, cobalt blue, warm orange and a touch of red, soft rim light, cinematic composition, no text, no letters, no logos, no watermark, no people\'s faces.';

const PIECES: Record<string, { aspect: string; prompt: string }> = {
  'hero': { aspect: '2:1', prompt: 'A wide dusk landscape seen from a quiet hilltop: a long road with glowing blue lane lines winding toward a small town of warm-lit houses, a big low orange sun behind blocky mountains, a few stars above. Calm, spacious, most detail on the right third, the left third kept dark and simple.' },
  'card-platformer': { aspect: '4:3', prompt: 'A small running figure, seen from the side and far away, leaping between floating stone platforms above a misty canyon at dusk, a trail of orange energy sparks behind it, a tall gate of blue light on the far platform.' },
  'card-spell': { aspect: '4:3', prompt: 'A blacksmith\'s anvil on a dark workbench, struck by a hammer, orange sparks flying up and cooling into small glowing blue marks in the air, warm forge light from the left, deep navy shadows.' },
  'card-accent': { aspect: '4:3', prompt: 'A brass magnifying glass lying on a sheet of aged cream paper with faint handwritten lines, the lens magnifying a single small glowing orange mark, soft shadow, warm desk lamp light from the top left.' },
  'card-blaster': { aspect: '4:3', prompt: 'A night city skyline of simple blocky towers with warm windows, three meteors with long orange tails falling from a deep blue sky, a thin blue beam of light rising from a small dome on the ground to meet one of them.' },
  'card-flash': { aspect: '4:3', prompt: 'A fan of five blank playing cards on a dark wooden table, one card turned over to show a bright orange sun motif, soft blue rim light along the card edges, a small cup of coffee at the corner, warm and quiet.' },
  'card-highway': { aspect: '4:3', prompt: 'A low blocky sports car with a red spoiler, seen from behind, driving down a straight road toward a big orange sun, blocky green plains and distant blocky towers on both sides, glowing blue road edges, light motion blur on the ground.' },
};

function fail(message: string): never { console.error(message); process.exit(1); }

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const mi = args.indexOf('--model');
  const model = mi >= 0 ? args[mi + 1] : 'recraft/v4.1/pro/text-to-image';
  const names = args.filter((a, i) => !a.startsWith('--') && !(mi >= 0 && i === mi + 1));
  const wanted = names.length ? names : Object.keys(PIECES);
  for (const n of wanted) if (!PIECES[n]) fail(`Unknown piece "${n}". Known: ${Object.keys(PIECES).join(', ')}`);

  const creds = process.env.HF_CREDENTIALS;
  if (!creds || !creds.includes(':')) fail('HF_CREDENTIALS is not set (key-id:key-secret in .env.local or the environment). No request was made.');
  const client = createHiggsfieldClient({ credentials: creds, baseURL: 'https://api.higgsfield.ai', maxPollTime: 10 * 60 * 1000, pollInterval: 3000 });
  mkdirSync(OUT, { recursive: true });

  let made = 0;
  for (const name of wanted) {
    const target = join(OUT, name + '.jpg');
    if (!all && !names.length && existsSync(target)) { console.log(`${name}: exists, skipping (use --all to regenerate)`); continue; }
    const piece = PIECES[name];
    const input: Record<string, unknown> = { prompt: piece.prompt + ' ' + STYLE, aspect_ratio: piece.aspect };
    if (/recraft|qwen|grok/.test(model)) input.resolution = '2k';
    console.log(`${name}: generating with ${model} (${piece.aspect}) ...`);
    const res = await client.subscribe(model, { input, withPolling: true });
    const status = String(res.status);
    const url = res.images && res.images[0] && res.images[0].url;
    if (status !== 'completed' || !url) fail(`${name}: request ${res.request_id} ended with status "${status}"${status === 'nsfw' ? ' (moderated)' : ''}; no image saved.`);
    const raw = await axios.get<ArrayBuffer>(url, { responseType: 'arraybuffer', timeout: 120000 });
    const tmp = join(OUT, name + '.download');
    writeFileSync(tmp, Buffer.from(raw.data));
    // normalise to a light JPG; the longest side 1800px keeps the hero crisp on wide screens
    execFileSync('/usr/bin/ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', tmp, '-vf', "scale='min(1800,iw)':-2", '-q:v', '4', target]);
    unlinkSync(tmp);
    const kb = Math.round(execFileSync('stat', ['-c', '%s', target]).toString().trim() as unknown as number / 1024);
    console.log(`${name}: saved ${target} (${kb} KB) from request ${res.request_id}`);
    made++;
  }
  console.log(`Done: ${made} image(s) generated.`);
}

main().catch((err: unknown) => {
  const e = err as { name?: string; message?: string; statusCode?: number; details?: unknown };
  fail('Generation did not complete: ' + [e?.name || 'Error', e?.message || String(err), e?.statusCode ? 'HTTP ' + e.statusCode : '', e?.details ? JSON.stringify(e.details) : ''].filter(Boolean).join(' | '));
});
