import Anthropic from '@anthropic-ai/sdk';
import type { PresenceResult } from './presence/types.js';

export interface AuditReport {
  score: number;
  summary: string;
  actionPoints: Array<{ surfaceId: string; action: string; priority: 'high' | 'medium' | 'low' }>;
}

export async function buildReport(
  canonicalName: string,
  score: number,
  presence: PresenceResult[],
): Promise<AuditReport> {
  if (presence.length === 0) {
    return { score, summary: `No surfaces resolved for ${canonicalName}.`, actionPoints: [] };
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return templatedReport(canonicalName, score, presence);
  }
  try {
    const client = new Anthropic();
    const stream = client.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      thinking: { type: 'adaptive' },
      messages: [{
        role: 'user',
        content:
          `You are auditing the public visibility of "${canonicalName}". ` +
          `Coverage score: ${score}/100. Per-surface presence (JSON):\n` +
          `${JSON.stringify(presence, null, 2)}\n\n` +
          `Write a tight summary and ranked, concrete action points. ` +
          `Return ONLY JSON: {"summary": string, "actionPoints": [{"surfaceId","action","priority"}]} ` +
          `where priority is "high" | "medium" | "low".`,
      }],
    });
    const msg = await stream.finalMessage();
    const text = msg.content
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('')
      .trim();
    // Tolerate models that wrap JSON in prose/fences.
    const jsonText = text.startsWith('{') ? text : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
    const parsed = JSON.parse(jsonText);
    // Trust the model's structure only if it matches the shape we store/print.
    if (typeof parsed?.summary !== 'string' || !Array.isArray(parsed?.actionPoints)) {
      return templatedReport(canonicalName, score, presence);
    }
    return { score, summary: parsed.summary, actionPoints: parsed.actionPoints };
  } catch {
    // LLM unavailable or returned unparseable output — deterministic fallback keeps the audit running.
    return templatedReport(canonicalName, score, presence);
  }
}

function templatedReport(name: string, score: number, presence: PresenceResult[]): AuditReport {
  const absent = presence.filter(p => p.state === 'absent');
  const listed = presence.filter(p => p.state === 'listed');
  const unknown = presence.filter(p => p.state === 'unknown');
  return {
    score,
    summary:
      `${name}: coverage ${score}/100. Listed on ${listed.length}, absent from ${absent.length}, ` +
      `not checked ${unknown.length} (no/failed source) of ${presence.length} surfaces.`,
    actionPoints: absent.map(p => ({ surfaceId: p.surfaceId, action: `Get listed on ${p.surfaceName}`, priority: 'high' as const })),
  };
}
