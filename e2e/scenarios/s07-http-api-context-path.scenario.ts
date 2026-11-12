// S07: HTTP API listener routes by URL path and answers from the postprocessor.
// Production pattern: "10001 API". Destinations are named after URL paths; the
// source step keeps only the one matching $s('contextPath'); a destination
// transformer puts the reply in the channel map and the postprocessor returns
// it as JSON.

import { expect, request } from '@playwright/test';
import { channelExport, httpListener, jsWriter } from './support/mirth-xml.js';
import { scenario, mirthId } from './support/scenario.js';

const PORT = 16607;

const route = (name: string): { name: string; script: string } => ({
  name: `${name} handler`,
  script: `$c('response', { route: '${name}', accession: msg.accession });`,
});

scenario('S07 HTTP listener routes on context path and returns the postprocessor JSON', async (api) => {
  await api.importAndDeploy(channelExport({
    id: mirthId(7),
    name: 'S07 API',
    source: {
      name: 'sourceConnector',
      ...httpListener(PORT, { responseVariable: 'Postprocessor', contentType: 'application/json' }),
      inbound: 'JSON',
      rules: [{ name: 'Not empty', script: "return JSON.stringify(msg) !== '{}'" }],
      steps: [{ name: 'Route', script: "const contextPath = '' + $s('contextPath')\ndestinationSet.removeAllExcept([contextPath])" }],
    },
    destinations: [
      { name: '/api/study', ...jsWriter('return;'), inbound: 'JSON', steps: [route('study')] },
      { name: '/api/report', ...jsWriter('return;'), inbound: 'JSON', steps: [route('report')] },
    ],
    postprocessor: "return JSON.stringify($c('response'));",
  }), ['S07 API']);

  const ctx = await request.newContext();
  try {
    const report = await ctx.post(`http://127.0.0.1:${String(PORT)}/api/report`, { data: { accession: 'ACC007' } });
    expect(report.status()).toBe(200);
    expect(report.headers()['content-type']).toContain('application/json');
    expect(await report.json()).toEqual({ route: 'report', accession: 'ACC007' });

    const study = await ctx.post(`http://127.0.0.1:${String(PORT)}/api/study`, { data: { accession: 'ACC008' } });
    expect(await study.json()).toEqual({ route: 'study', accession: 'ACC008' });
  } finally {
    await ctx.dispose();
  }
});
