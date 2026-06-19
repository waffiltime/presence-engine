import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';

// Verifies each API key is present AND actually works, without ever printing the key.
// Run: npm run keys:check

interface CheckResult { name: string; ok: boolean; detail: string; required: boolean; }

async function checkAnthropic(): Promise<CheckResult> {
  const name = 'ANTHROPIC_API_KEY  (report synthesis — Sonnet)';
  if (!process.env.ANTHROPIC_API_KEY) return { name, ok: false, detail: 'not set', required: true };
  try {
    const client = new Anthropic();
    const models = await client.models.list();
    return { name, ok: true, detail: `ok — ${models.data.length} models visible`, required: true };
  } catch (e: any) {
    return { name, ok: false, detail: `call failed: ${e?.status ?? ''} ${e?.message ?? e}`.trim(), required: true };
  }
}

async function checkBrave(): Promise<CheckResult> {
  const name = 'BRAVE_SEARCH_API_KEY  (registry/community presence)';
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) return { name, ok: false, detail: 'not set', required: true };
  try {
    const res = await fetch('https://api.search.brave.com/res/v1/web/search?q=test', {
      headers: { Accept: 'application/json', 'X-Subscription-Token': key },
    });
    return { name, ok: res.status === 200, detail: `HTTP ${res.status}${res.status === 401 ? ' (bad key)' : res.status === 429 ? ' (rate limited)' : ''}`, required: true };
  } catch (e: any) {
    return { name, ok: false, detail: `call failed: ${e?.message ?? e}`, required: true };
  }
}

async function checkGitHub(): Promise<CheckResult> {
  const name = 'GITHUB_TOKEN  (optional — raises rate limit 60→5000/hr)';
  const token = process.env.GITHUB_TOKEN;
  if (!token) return { name, ok: false, detail: 'not set — GitHub checks use unauthenticated 60/hr', required: false };
  try {
    const res = await fetch('https://api.github.com/rate_limit', {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'presence-engine', Authorization: `Bearer ${token}` },
    });
    const data: any = await res.json().catch(() => ({}));
    const remaining = data?.resources?.core?.remaining;
    return { name, ok: res.status === 200, detail: res.status === 200 ? `ok — ${remaining} core req remaining` : `HTTP ${res.status} (bad token?)`, required: false };
  } catch (e: any) {
    return { name, ok: false, detail: `call failed: ${e?.message ?? e}`, required: false };
  }
}

async function main(): Promise<void> {
  console.log('\n=== Key preflight ===\n');
  const results = await Promise.all([checkAnthropic(), checkBrave(), checkGitHub()]);
  for (const r of results) {
    const mark = r.ok ? '✓' : r.required ? '✗' : '○';
    console.log(`${mark} ${r.name}: ${r.detail}`);
  }
  const requiredFailed = results.filter(r => r.required && !r.ok);
  console.log('');
  if (requiredFailed.length) {
    console.log(`${requiredFailed.length} required key(s) not working. Add them to .env, then re-run: npm run keys:check`);
    process.exitCode = 1;
  } else {
    console.log('All required keys working. Run a live audit: npm run audit -- <slug>');
    process.exitCode = 0;
  }
  // No process.exit() — let the event loop drain (undici keep-alive) to avoid a teardown assertion.
}

main();
