// S29: a DICOM router forwards what a modality stores to the PACS.
// Issue #171: the import kept no DICOM Listener or Sender setting (port, AE
// titles, storage folder), so DICOM channels did not deploy. Both channels here
// are Mirth DICOM channels: a router (DICOM Listener -> DICOM Sender) and the
// PACS it forwards to (DICOM Listener -> TCP Sender, so the test sees what
// arrived). A DICOM message here is the stored file's path (connector reference).

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { expect } from '@playwright/test';
import { channelExport, dicomListener, dicomSender, tcpSender } from './support/mirth-xml.js';
import { MllpSink } from './support/net.js';
import { dropFolder, exists } from './support/files.js';
import { cStore, SAMPLE_DCM } from './support/dicom.js';
import { scenario, mirthId } from './support/scenario.js';

const ROUTER_PORT = 16680;
const PACS_PORT = 16681;
const SINK = 16682;

scenario('S29 DICOM router forwards a stored image to the PACS', async (api) => {
  const routerDir = dropFolder('s29-router');
  const pacsDir = dropFolder('s29-pacs');
  const sink = new MllpSink(SINK);
  await sink.listen();
  try {
    await api.importAndDeploy(channelExport({
      id: mirthId(29, 2),
      name: 'S29 PACS',
      source: { name: 'sourceConnector', ...dicomListener(PACS_PORT, pacsDir, 'S29_PACS'), inbound: 'DICOM', outbound: 'DICOM' },
      destinations: [{ name: 'Archive log', ...tcpSender('127.0.0.1', String(SINK)) }],
    }), ['S29 PACS']);
    await api.importAndDeploy(channelExport({
      id: mirthId(29),
      name: 'S29 DICOM Router',
      source: { name: 'sourceConnector', ...dicomListener(ROUTER_PORT, routerDir, 'S29_ROUTER'), inbound: 'DICOM', outbound: 'DICOM' },
      destinations: [{ name: 'PACS', ...dicomSender('127.0.0.1', String(PACS_PORT), 'S29_PACS', 'S29_ROUTER'), inbound: 'DICOM', outbound: 'DICOM' }],
    }), ['S29 DICOM Router']);

    await cStore(ROUTER_PORT, SAMPLE_DCM, 'S29_CT', 'S29_ROUTER');

    await expect.poll(() => sink.received.length, { timeout: 20_000 }).toBe(1);
    const stored = sink.received[0]!.trim();
    // The PACS stored a real DICOM object: a 128-byte preamble, then "DICM".
    expect(readFileSync(stored).subarray(128, 132).toString('ascii')).toBe('DICM');
    // Both listeners name a file by its SOP Instance UID, so the same name means the
    // same image. The router kept its copy, as Mirth keeps what a DICOM Listener stores.
    expect(exists(routerDir, basename(stored))).toBe(true);
  } finally {
    await sink.close();
  }
});
