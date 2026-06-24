import { describe, it, expect } from 'vitest';
import { huggingFaceAdapter } from '../submit/adapters/hugging-face.js';

const surface = { surfaceId: 'hugging-face', name: 'Hugging Face' } as any;
const record = {
  subject: { canonical_name: 'Beacon', slug: 'beacon', category: 'embedding model' },
  positioning: { one_liner: 'An example model.', long_description: 'Longer description.' },
  links: { homepage: 'https://beacon.example.com', hf_model: 'exampleco/beacon' },
};

describe('huggingFaceAdapter', () => {
  it('matches only the hugging-face surface', () => {
    expect(huggingFaceAdapter.matches(surface)).toBe(true);
    expect(huggingFaceAdapter.matches({ surfaceId: 'docker-hub', name: 'Docker Hub' } as any)).toBe(false);
  });

  it('plan() builds an assisted_manual model-card with YAML front matter', () => {
    const p = huggingFaceAdapter.plan(record, surface);
    expect(p.mechanism).toBe('assisted_manual');
    const card = String((p.payload as any).card);
    expect(card.startsWith('---')).toBe(true);
    expect(card).toContain('# Beacon');
    expect(card).toContain('An example model.');
    expect(p.preview).toContain('README.md');
  });

  it('execute() does no network and returns needs_human', async () => {
    const p = huggingFaceAdapter.plan(record, surface);
    const r = await huggingFaceAdapter.execute(p, surface);
    expect(r.outcome).toBe('needs_human');
    expect(r.notes).toMatch(/commit|model repo/i);
  });
});
