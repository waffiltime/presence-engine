import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SubmitAdapter, SubmitProposal, SubmitResult } from '../types.js';
import type { Surface } from '../../surfaces/resolve.js';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildPad(record: any): string {
  const name = String(record?.subject?.canonical_name ?? record?.subject?.slug ?? 'unknown');
  const version = String(record?.attributes?.current_version ?? '1.0');
  const desc = String(record?.positioning?.one_liner ?? '');
  const url = String(record?.links?.homepage ?? '');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<XML_DIZ_INFO>',
    '  <Program_Info>',
    `    <Program_Name>${esc(name)}</Program_Name>`,
    `    <Program_Version>${esc(version)}</Program_Version>`,
    '  </Program_Info>',
    '  <Web_Info>',
    `    <Application_URLs><Application_Info_URL>${esc(url)}</Application_Info_URL></Application_URLs>`,
    '  </Web_Info>',
    '  <Program_Descriptions>',
    `    <English><Char_Desc_45>${esc(desc)}</Char_Desc_45></English>`,
    '  </Program_Descriptions>',
    '</XML_DIZ_INFO>',
  ].join('\n');
}

export const padXmlAdapter: SubmitAdapter = {
  matches: (s: Surface) => s.surfaceId === 'pad-friendly-portals-softpedia-sourceforge-majorgeeks-snapfiles-',

  plan(record, _surface): SubmitProposal {
    const xml = buildPad(record);
    return { mechanism: 'manifest', payload: { xml, _slug: record?.subject?.slug }, preview: xml };
  },

  async execute(proposal, _surface): Promise<SubmitResult> {
    const slug = String(proposal.payload._slug ?? 'project');
    const outPath = `out/${slug}/pad.xml`;
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, String(proposal.payload.xml), 'utf-8');
    return { outcome: 'needs_human', notes: `Generated ${outPath}. Host it and submit the PAD URL to the directories.` };
  },
};
