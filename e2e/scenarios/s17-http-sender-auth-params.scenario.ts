// S17: HTTP Sender with Basic auth, query parameters, headers and ${} values.
// Gap doc 12 rank 5. The URL path and a query parameter come from the channel
// map, as Mirth substitutes ${var} in every HTTP Sender field.

import { expect } from '@playwright/test';
import { channelExport, tcpListener, httpSender } from './support/mirth-xml.js';
import { HttpSink, sendMllp } from './support/net.js';
import { scenario, mirthId } from './support/scenario.js';

const PORT = 16617;
const API_PORT = 16667;

scenario('S17 HTTP Sender sends Basic auth, query parameters and substituted values', async (api) => {
  const sink = new HttpSink(API_PORT);
  await sink.listen();
  try {
    await api.importAndDeploy(channelExport({
      id: mirthId(17),
      name: 'S17 Portal Orders',
      source: {
        name: 'sourceConnector',
        ...tcpListener(PORT),
        inbound: 'HL7V2',
        steps: [{
          name: 'Values',
          script: [
            "var raw = String(connectorMessage.getRawData());",
            "channelMap.put('accession', raw.split('ORC|NW|')[1].split('\\r')[0]);",
            "channelMap.put('site', raw.split('\\r')[0].split('|')[3]);",
          ].join('\n'),
        }],
      },
      destinations: [{
        name: 'Portal',
        ...httpSender(`http://127.0.0.1:${String(API_PORT)}/orders/\${accession}`, undefined, {
          method: 'put',
          basicAuth: { username: 'mirth', password: 's3cret' },
          parameters: { site: '${site}' },
          headers: { 'X-Source': 'VNS' },
          content: '{"accession":"${accession}"}',
        }),
      }],
    }), ['S17 Portal Orders']);

    await sendMllp(PORT, 'MSH|^~\\&|RIS|SITE17|VNS|V|20261110120000||ORM^O01|S17|P|2.3\rORC|NW|ACC017');
    await expect.poll(() => sink.requests.length, { timeout: 15_000 }).toBe(1);
    const r = sink.requests[0]!;
    expect(r.method).toBe('PUT');
    expect(r.url).toBe('/orders/ACC017?site=SITE17');
    expect(r.headers['authorization']).toBe(`Basic ${Buffer.from('mirth:s3cret').toString('base64')}`);
    expect(r.headers['x-source']).toBe('VNS');
    expect(JSON.parse(r.body)).toEqual({ accession: 'ACC017' });
  } finally {
    await sink.close();
  }
});
