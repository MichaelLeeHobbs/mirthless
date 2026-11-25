// D-301 for the settings #418 found dropped: each is carried, or the preview names it.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelExportEntry } from '@galvanigraph/core-models';
import { compileTransformerStepsToScript } from '@galvanigraph/engine';

vi.mock('../../lib/db.js', () => ({ db: {} }));
vi.mock('../../lib/event-emitter.js', () => ({ emitEvent: vi.fn() }));

import { MirthImportService, type MirthConvertResult } from '../mirth-import.service.js';
import { validateConnectorProperties } from '../connector-validation.service.js';
import { ChannelImportService } from '../channel-import.service.js';
import { CodeTemplateService } from '../code-template.service.js';

const CLASS = 'com.mirth.connect.connectors';
const ID = '5c000418-0000-4000-8000-000000000001';

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

interface TransformerXml {
  readonly elements?: string;
  readonly inbound?: string;
  readonly outbound?: string;
  readonly inboundProperties?: string;
  readonly more?: string;
}

function transformerXml(tag: string, t: TransformerXml = {}): string {
  return `<${tag} version="4.5.0">${t.elements ? `<elements>${t.elements}</elements>` : '<elements/>'}<inboundDataType>${t.inbound ?? 'HL7V2'}</inboundDataType><outboundDataType>${t.outbound ?? 'HL7V2'}</outboundDataType>${t.inboundProperties ?? ''}${t.more ?? ''}</${tag}>`;
}

function jsStep(script: string, sequence = 0, enabled = true, name = 'Step'): string {
  return `<com.mirth.connect.plugins.javascriptstep.JavaScriptStep version="4.5.0"><name>${name}</name><sequenceNumber>${String(sequence)}</sequenceNumber><enabled>${String(enabled)}</enabled><script>${esc(script)}</script></com.mirth.connect.plugins.javascriptstep.JavaScriptStep>`;
}

function jsRule(script: string): string {
  return `<elements><com.mirth.connect.plugins.javascriptrule.JavaScriptRule version="4.5.0"><name>r</name><sequenceNumber>0</sequenceNumber><enabled>true</enabled><operator>NONE</operator><script>${esc(script)}</script></com.mirth.connect.plugins.javascriptrule.JavaScriptRule></elements>`;
}

function builderStep(segment: string, mapping: string, defaultValue = '', replacements = '<replacements/>', enabled = true): string {
  return `<com.mirth.connect.plugins.messagebuilder.MessageBuilderStep version="4.5.0"><name>Set name</name><sequenceNumber>0</sequenceNumber><enabled>${String(enabled)}</enabled><messageSegment>${esc(segment)}</messageSegment><mapping>${esc(mapping)}</mapping><defaultValue>${esc(defaultValue)}</defaultValue>${replacements}</com.mirth.connect.plugins.messagebuilder.MessageBuilderStep>`;
}

const MAPPER = '<com.mirth.connect.plugins.mapper.MapperStep version="4.5.0"><name>Map id</name><sequenceNumber>1</sequenceNumber><enabled>true</enabled><variable>pid</variable><mapping>msg</mapping><defaultValue/><replacements/><scope>CHANNEL</scope></com.mirth.connect.plugins.mapper.MapperStep>';

interface SourceXml {
  readonly transport?: string;
  readonly className?: string;
  readonly props?: string;
  readonly responseVariable?: string;
  readonly transformer?: TransformerXml;
  readonly filter?: string;
  readonly noFilter?: boolean;
}

function sourceXml(s: SourceXml = {}): string {
  const respond = s.responseVariable === undefined ? '' : `<sourceConnectorProperties version="4.5.0"><responseVariable>${s.responseVariable}</responseVariable></sourceConnectorProperties>`;
  return `<sourceConnector version="4.5.0"><metaDataId>0</metaDataId><name>sourceConnector</name><properties class="${CLASS}.${s.className ?? 'vm.VmReceiverProperties'}" version="4.5.0">${respond}${s.props ?? ''}</properties>${transformerXml('transformer', s.transformer)}${s.noFilter ? '' : `<filter version="4.5.0">${s.filter ?? '<elements/>'}</filter>`}<transportName>${s.transport ?? 'Channel Reader'}</transportName><enabled>true</enabled></sourceConnector>`;
}

interface DestXml {
  readonly name?: string;
  readonly id?: number;
  readonly enabled?: boolean;
  readonly transport?: string;
  readonly className?: string;
  readonly props?: string;
  readonly queue?: string;
  readonly response?: TransformerXml;
  readonly transformer?: TransformerXml;
}

function destXml(d: DestXml = {}): string {
  return `<connector version="4.5.0"><metaDataId>${String(d.id ?? 1)}</metaDataId><name>${d.name ?? 'Out'}</name><properties class="${CLASS}.${d.className ?? 'js.JavaScriptDispatcherProperties'}" version="4.5.0"><destinationConnectorProperties version="4.5.0">${d.queue ?? '<queueEnabled>false</queueEnabled><sendFirst>false</sendFirst><retryCount>0</retryCount>'}</destinationConnectorProperties>${d.props ?? '<script>return;</script>'}</properties>${transformerXml('transformer', d.transformer)}${transformerXml('responseTransformer', d.response)}<filter version="4.5.0"><elements/></filter><transportName>${d.transport ?? 'JavaScript Writer'}</transportName><mode>DESTINATION</mode><enabled>${String(d.enabled ?? true)}</enabled><waitForPrevious>true</waitForPrevious></connector>`;
}

interface ChannelXml {
  readonly id?: string;
  readonly name?: string;
  readonly source?: SourceXml;
  readonly destinations?: readonly DestXml[];
  readonly properties?: string;
  readonly exportData?: string;
}

function channelXml(c: ChannelXml = {}): string {
  return `<channel version="4.5.0"><id>${c.id ?? ID}</id><name>${c.name ?? 'C'}</name><description/><revision>1</revision>${sourceXml(c.source)}<destinationConnectors>${(c.destinations ?? [{}]).map(destXml).join('')}</destinationConnectors><preprocessingScript>return message;</preprocessingScript><properties version="4.5.0">${c.properties ?? ''}</properties>${c.exportData ? `<exportData>${c.exportData}</exportData>` : ''}</channel>`;
}

function convertRaw(xml: string): MirthConvertResult {
  const result = MirthImportService.convertXml(xml);
  if (!result.ok) throw result.error;
  return result.value;
}

const convert = (c: ChannelXml = {}): MirthConvertResult => convertRaw(channelXml(c));

function only(result: MirthConvertResult): ChannelExportEntry {
  expect(result.channels).toHaveLength(1);
  return result.channels[0]!;
}

const firstDest = (result: MirthConvertResult): ChannelExportEntry['destinations'][number] => only(result).destinations[0]!;
const warningsWith = (result: MirthConvertResult, ...needles: string[]): string[] =>
  result.warnings.filter((w) => needles.every((n) => w.includes(n)));

function expectHeld(result: MirthConvertResult, reason: string): void {
  const channel = only(result);
  expect(channel.enabled).toBe(false);
  expect(channel.description).toContain('Imported disabled from Mirth');
  expect(channel.description).toContain(reason);
  expect(result.holds[channel.id]?.join(' ')).toContain(reason);
  expect(warningsWith(result, 'imported disabled', reason)).toHaveLength(1);
}

function expectNotHeld(result: MirthConvertResult): void {
  expect(only(result).enabled).toBe(true);
  expect(result.holds).toEqual({});
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('an export with Mirth\'s default settings', () => {
  it('warns about nothing and is not held', () => {
    const result = convert();
    expect(result.warnings).toEqual([]);
    expectNotHeld(result);
  });
});

describe('response transformers', () => {
  it('carries the enabled JavaScript steps, in order, as the destination\'s response transformer, and says what differs', () => {
    const result = convert({ destinations: [{ response: { elements: jsStep('second();', 1) + jsStep('first();', 0) } }] });
    const script = firstDest(result).responseTransformer ?? '';
    expect(script.indexOf('first();')).toBeGreaterThanOrEqual(0);
    expect(script.indexOf('first();')).toBeLessThan(script.indexOf('second();'));
    expect(script.trimEnd().endsWith('return msg;')).toBe(true);
    const [warning] = warningsWith(result, 'Channel "C"', '"Out"', 'response transformer');
    expect(warning).toContain('cannot change whether the message counts as delivered');
    expectNotHeld(result);
  });

  it('carries none, without a warning, when Mirth has no steps', () => {
    const result = convert();
    expect(firstDest(result).responseTransformer ?? null).toBeNull();
    expect(result.warnings).toEqual([]);
  });

  it('leaves out disabled steps and says so', () => {
    const result = convert({ destinations: [{ response: { elements: jsStep('kept();') + jsStep('off();', 1, false, 'Old step') } }] });
    expect(firstDest(result).responseTransformer).toContain('kept();');
    expect(firstDest(result).responseTransformer).not.toContain('off();');
    expect(warningsWith(result, 'disabled step', '"Old step"')).toHaveLength(1);
  });

  it('warns about the data types the response had in Mirth when they are not the channel\'s', () => {
    const result = convert({ destinations: [{ response: { elements: jsStep('a();'), inbound: 'JSON', outbound: 'JSON' } }] });
    expect(warningsWith(result, 'response transformer', 'JSON', 'HL7V2')).toHaveLength(1);
  });

  it('holds the channel for a step this engine cannot run, which fails loudly in its place', () => {
    const result = convert({ destinations: [{ response: { elements: jsStep('a();') + MAPPER } }] });
    expectHeld(result, 'the response transformer of "Out" has the step "Map id" (MAPPER)');
    expect(firstDest(result).responseTransformer).toMatch(/throw new Error\(.*Map id/);
  });

  it('holds the channel when the response transformer decides whether the message was delivered', () => {
    const result = convert({ destinations: [{ response: { elements: jsStep("if (msg.length == 0) { responseStatus = ERROR; }") } }] });
    expectHeld(result, 'the response transformer of "Out" uses responseStatus');
  });

  it('holds the channel when the response transformer throws, which in Mirth makes the message an error', () => {
    expectHeld(convert({ destinations: [{ response: { elements: jsStep("if (!msg) { throw new Error('no answer'); }") } }] }), 'the response transformer of "Out" uses throw');
  });

  it('says what else differs: when it runs, what sees its result and that its templates are gone', () => {
    const templates = '<inboundTemplate encoding="base64">TVNI</inboundTemplate>';
    const [warning] = warningsWith(convert({ destinations: [{ response: { elements: jsStep('a();'), more: templates } }] }), 'response transformer');
    expect(warning).toContain('only for an answer that counts as delivered');
    expect(warning).toContain('postprocessor');
    expect(warning).toContain('templates');
    expect(warningsWith(convert({ destinations: [{ response: { elements: jsStep('a();') } }] }), 'templates')).toEqual([]);
  });

  it('knows X12 by Mirth\'s name for it', () => {
    const x12 = { inbound: 'EDI/X12', outbound: 'EDI/X12' };
    const result = convert({ source: { transformer: x12 }, destinations: [{ transformer: x12, response: { ...x12, elements: jsStep('a();') } }] });
    expect(warningsWith(result, 'where Mirth used')).toEqual([]);
  });

  it('holds nothing for a destination disabled in Mirth, which never sends', () => {
    const result = convert({ destinations: [{ enabled: false, response: { elements: jsStep('responseStatus = ERROR;') + MAPPER } }] });
    expectNotHeld(result);
    expect(firstDest(result).responseTransformer).toContain('responseStatus = ERROR;');
  });

  it('reads the response transformer for Mirth-only constructs', () => {
    const result = convert({ destinations: [{ response: { elements: jsStep("var code = msg['MSA']['MSA.1'].toString();") } }] });
    expect(warningsWith(result, 'Mirth-only constructs', 'E4X')).toHaveLength(1);
  });

  it('writes a step name as text, never as code', () => {
    const result = convert({ destinations: [{ response: { elements: MAPPER.replace('Map id', 'x&apos;&quot;&#10;evil();') } }] });
    expect(firstDest(result).responseTransformer).toMatch(/^throw new Error\(".*\\nevil\(\);.*"\);$/m);
  });

  it('that only a disabled step is in carries nothing', () => {
    expect(firstDest(convert({ destinations: [{ response: { elements: jsStep('off();', 0, false) } }] })).responseTransformer ?? null).toBeNull();
  });

  it('says that it does not run for what a queue delivers', () => {
    const queue = '<queueEnabled>true</queueEnabled><sendFirst>true</sendFirst><retryCount>0</retryCount>';
    expect(warningsWith(convert({ destinations: [{ queue, response: { elements: jsStep('a();') } }] }), 'response transformer', 'the queue delivers')).toHaveLength(1);
    expect(warningsWith(convert({ destinations: [{ response: { elements: jsStep('a();') } }] }), 'the queue delivers')).toEqual([]);
  });
});

describe('a TCP connector\'s charset', () => {
  const listener = (charset: string, binary = false): SourceXml => ({
    transport: 'TCP Listener', className: 'tcp.TcpReceiverProperties',
    props: `<listenerConnectorProperties version="4.5.0"><host>0.0.0.0</host><port>6661</port></listenerConnectorProperties><dataTypeBinary>${String(binary)}</dataTypeBinary><charsetEncoding>${charset}</charsetEncoding>`,
  });
  const sender = (charset: string, binary = false): DestXml => ({
    transport: 'TCP Sender', className: 'tcp.TcpDispatcherProperties',
    props: `<remoteAddress>partner</remoteAddress><remotePort>6662</remotePort><dataTypeBinary>${String(binary)}</dataTypeBinary><charsetEncoding>${charset}</charsetEncoding><template>\${message.encodedData}</template>`,
  });

  it('is carried on the listener and the sender', () => {
    const result = convert({ source: listener('ISO-8859-1'), destinations: [sender('ISO-8859-1')] });
    expect(only(result).sourceConnectorProperties['charset']).toBe('latin1');
    expect(firstDest(result).properties['charset']).toBe('latin1');
    expect(result.warnings).toEqual([]);
    expect(validateConnectorProperties('TCP_MLLP', 'source', only(result).sourceConnectorProperties)).toMatchObject({ ok: true });
    expect(validateConnectorProperties('TCP_MLLP', 'destination', firstDest(result).properties)).toMatchObject({ ok: true });
  });

  it('that this engine lacks is kept, so the deploy refuses it, with a warning', () => {
    const result = convert({ source: listener('Shift_JIS'), destinations: [sender('UTF-8')] });
    expect(validateConnectorProperties('TCP_MLLP', 'source', only(result).sourceConnectorProperties)).toMatchObject({ ok: false });
    expect(warningsWith(result, 'Channel "C"', 'TCP Listener', 'Shift_JIS', 'will not deploy')).toHaveLength(1);
  });

  it('that was the Mirth server\'s default is UTF-8 here, with a warning', () => {
    const result = convert({ source: listener('DEFAULT_ENCODING'), destinations: [sender('DEFAULT_ENCODING')] });
    expect(only(result).sourceConnectorProperties['charset']).toBeUndefined();
    expect(warningsWith(result, 'TCP Listener', 'default charset')).toHaveLength(1);
    expect(warningsWith(result, 'TCP Sender "Out"', 'default charset')).toHaveLength(1);
  });

  it('does not apply to binary data, which Mirth keeps as base64 and this connector as text', () => {
    const result = convert({ source: listener('DEFAULT_ENCODING', true), destinations: [sender('UTF-8', true)] });
    expect(warningsWith(result, 'the TCP Listener handles binary')).toHaveLength(1);
    expect(warningsWith(result, 'the TCP Sender "Out" handles binary')).toHaveLength(1);
    expect(warningsWith(result, 'default charset')).toEqual([]);
  });

  it('of an export whose class is the JavaScript one follows the transport name, the hold too', () => {
    expectHeld(convert({ destinations: [{ ...sender('UTF-8', true), className: 'js.JavaScriptDispatcherProperties' }] }), 'the TCP Sender "Out" sends binary data');
  });

  it('holds the channel for binary data, which text cannot hold', () => {
    expectHeld(convert({ source: listener('UTF-8', true) }), 'its TCP Listener receives binary data');
    expectHeld(convert({ destinations: [sender('UTF-8', true)] }), 'the TCP Sender "Out" sends binary data');
    expectNotHeld(convert({ destinations: [{ ...sender('UTF-8', true), enabled: false }] }));
  });
});

describe('an SMTP Sender', () => {
  const smtp = (extra: string, over: Partial<DestXml> = {}): ChannelXml => ({
    destinations: [{
      name: 'Mail', transport: 'SMTP Sender', className: 'smtp.SmtpDispatcherProperties',
      props: `<smtpHost>mail</smtpHost><smtpPort>25</smtpPort><to>a@example.com</to><from>b@example.com</from><subject>s</subject><body>x</body>${extra}`, ...over,
    }],
  });
  const attachment = (name: string, mimeType: string, content: string): string =>
    `<com.mirth.connect.connectors.smtp.Attachment><name>${name}</name><content>${esc(content)}</content><mimeType>${mimeType}</mimeType></com.mirth.connect.connectors.smtp.Attachment>`;

  it('keeps its text and XML attachments, with the message and its id filled in them', () => {
    const result = convert(smtp(`<attachments>${attachment('a.hl7', 'text/plain', '${message.encodedData}')}${attachment('${message.messageId}.xml', 'application/xml', '<a/>')}${attachment('b', '', 'plain')}</attachments>`));
    expect(firstDest(result).properties['attachments']).toEqual([
      { filename: 'a.hl7', mimeType: 'text/plain', content: '${msg}' },
      { filename: '${messageId}.xml', mimeType: 'application/xml', content: '<a/>' },
      { filename: 'b', mimeType: 'text/plain', content: 'plain' },
    ]);
    expect(validateConnectorProperties('SMTP', 'destination', firstDest(result).properties)).toMatchObject({ ok: true });
    expect(result.warnings).toEqual([]);
    expectNotHeld(result);
  });

  it('sends the encoded message where its subject and body name it', () => {
    const xml = channelXml(smtp('')).replace('<body>x</body>', '<body>Got ${message.encodedData}</body>').replace('<subject>s</subject>', '<subject>No ${message.messageId}</subject>');
    expect(firstDest(convertRaw(xml)).properties).toMatchObject({ bodyTemplate: 'Got ${msg}', subject: 'No ${messageId}' });
  });

  it('is held when a binary attachment, the attachments of a map variable or headers would be lost', () => {
    const binary = convert(smtp(`<attachments>${attachment('r.pdf', 'application/pdf', '${pdf}')}</attachments>`));
    expect(firstDest(binary).properties['attachments']).toBeUndefined();
    expectHeld(binary, 'the SMTP Sender "Mail" would lose the attachment "r.pdf" (application/pdf, which Mirth decodes from base64)');

    const typed = convert(smtp(`<attachments>${attachment('r', '${mime}', '${pdf}')}</attachments>`));
    expect(firstDest(typed).properties['attachments']).toBeUndefined();
    expectHeld(typed, 'the attachment "r" (${mime}');

    expectHeld(convert(smtp('<isUseAttachmentsVariable>true</isUseAttachmentsVariable><attachmentsVariable>files</attachmentsVariable>')), 'the attachments in the map variable "files"');
    expectHeld(convert(smtp('<headers class="linked-hash-map"><entry><string>X-Encrypt</string><string>secret-value</string></entry></headers>')), 'the header X-Encrypt');
    expectHeld(convert(smtp('<isUseHeadersVariable>true</isUseHeadersVariable><headersVariable>hdrs</headersVariable>')), 'the headers in the map variable "hdrs"');
  });

  it('is held when its export names it by transport only', () => {
    const { className: _class, ...dest } = smtp('<headers class="linked-hash-map"><entry><string>X-A</string><string>v</string></entry></headers>').destinations![0]!;
    const xml = channelXml({ destinations: [dest] }).replace(` class="${CLASS}.js.JavaScriptDispatcherProperties"`, '');
    expectHeld(convertRaw(xml), 'the header X-A');
  });

  it('sends an empty body where Mirth does, not the whole message', () => {
    const xml = channelXml(smtp('')).replace('<body>x</body>', '<body></body>');
    expect(firstDest(convertRaw(xml)).properties['bodyTemplate']).toBe('');
  });

  it('never quotes a header\'s value', () => {
    const result = convert(smtp('<headers class="linked-hash-map"><entry><string>X-Encrypt</string><string>secret-value</string></entry></headers>'));
    expect(JSON.stringify(result.warnings)).not.toContain('secret-value');
  });

  it('is not held when it is disabled in Mirth', () => {
    const result = convert(smtp('<headers class="linked-hash-map"><entry><string>X-Encrypt</string><string>v</string></entry></headers>', { enabled: false }));
    expectNotHeld(result);
    expect(warningsWith(result, 'X-Encrypt')).toHaveLength(1);
  });

  it('warns about a charset and a reply-to address it cannot keep', () => {
    expect(warningsWith(convert(smtp('<charsetEncoding>ISO-8859-1</charsetEncoding>')), 'SMTP Sender "Mail"', 'ISO-8859-1', 'UTF-8')).toHaveLength(1);
    expect(warningsWith(convert(smtp('<replyTo>desk@example.com</replyTo>')), 'SMTP Sender "Mail"', 'reply-to')).toHaveLength(1);
    expect(convert(smtp('<charsetEncoding>UTF-8</charsetEncoding><replyTo></replyTo>')).warnings).toEqual([]);
    expect(convert(smtp('<charsetEncoding>DEFAULT_ENCODING</charsetEncoding>')).warnings).toEqual([]);
  });
});

describe('the attachment handler', () => {
  const handler = (type: string, className: string): string => `<attachmentProperties version="4.5.0"><className>${className}</className><type>${type}</type><properties/></attachmentProperties><storeAttachments>true</storeAttachments>`;

  it('warns, naming it, that the message keeps its attachments inside', () => {
    const result = convert({ properties: handler('Regex', 'com.mirth.connect.server.attachments.regex.RegexAttachmentHandlerProvider') });
    expect(warningsWith(result, 'Channel "C"', 'attachment handler (Regex)')).toHaveLength(1);
    expectNotHeld(result);
  });

  it.each(['JavaScript', 'Custom'])('holds the channel for a %s handler, which can change the message', (type) => {
    expectHeld(convert({ properties: handler(type, 'x.Provider') }), `its ${type} attachment handler`);
  });

  it('holds the channel when a destination was sent the message without its attachments', () => {
    const queue = '<queueEnabled>false</queueEnabled><sendFirst>false</sendFirst><retryCount>0</retryCount><reattachAttachments>false</reattachAttachments>';
    const properties = handler('Regex', 'x.Provider');
    expectHeld(convert({ properties, destinations: [{ queue }] }), 'Mirth sends "Out" the message without its attachments');
    expectNotHeld(convert({ properties, destinations: [{ queue, enabled: false }] }));
    expectNotHeld(convert({ properties: handler('None', ''), destinations: [{ queue }] }));
  });

  it('reads an export that has only the handler\'s class', () => {
    const only = (className: string): string => `<attachmentProperties version="3.0.0"><className>${className}</className></attachmentProperties>`;
    expectHeld(convert({ properties: only('com.mirth.connect.server.attachments.javascript.JavaScriptAttachmentHandlerProvider') }), 'attachment handler');
    expectNotHeld(convert({ properties: only('com.mirth.connect.server.attachments.regex.RegexAttachmentHandlerProvider') }));
  });

  it('that is Mirth\'s do-nothing script is no handler', () => {
    const properties = '<attachmentProperties version="4.5.0"><className>x.Provider</className><type>JavaScript</type><properties><entry><string>javascript.script</string><string>// Modify the message variable below to create attachments&#xa;return message;</string></entry></properties></attachmentProperties>';
    const result = convert({ properties });
    expect(result.warnings).toEqual([]);
    expectNotHeld(result);
  });

  it('says nothing when Mirth has none', () => {
    expect(convert({ properties: handler('None', '') }).warnings).toEqual([]);
  });
});

describe('HL7 acknowledgement settings', () => {
  const ackProps = (over: Readonly<Record<string, string>>): string => {
    const values: Record<string, string> = {
      segmentDelimiter: '\\r', successfulACKCode: 'AA', successfulACKMessage: '', errorACKCode: 'AE', errorACKMessage: 'An Error Occurred Processing Message.',
      rejectedACKCode: 'AR', rejectedACKMessage: 'Message Rejected.', msh15ACKAccept: 'false', dateFormat: 'yyyyMMddHHmmss.SSS', ...over,
    };
    return `<inboundProperties><responseGenerationProperties>${Object.entries(values).map(([k, v]) => `<${k}>${v}</${k}>`).join('')}</responseGenerationProperties></inboundProperties>`;
  };
  const withAck = (over: Readonly<Record<string, string>>, more: Partial<SourceXml> = {}): MirthConvertResult =>
    convert({ source: {
      transport: 'TCP Listener', className: 'tcp.TcpReceiverProperties', props: '<listenerConnectorProperties version="4.5.0"><host>0.0.0.0</host><port>6661</port></listenerConnectorProperties>',
      responseVariable: 'Auto-generate (After source transformer)', transformer: { inboundProperties: ackProps(over) }, ...more,
    } });

  it('that were changed are named with their values', () => {
    const result = withAck({ successfulACKCode: 'CA', errorACKMessage: 'Call the desk' });
    const [warning] = warningsWith(result, 'Channel "C"', 'acknowledgement');
    expect(warning).toContain('successfulACKCode "CA"');
    expect(warning).toContain('errorACKMessage "Call the desk"');
    expect(warning).not.toContain('errorACKCode');
    expectNotHeld(result);
  });

  it('that are Mirth\'s defaults are not mentioned', () => {
    expect(withAck({}).warnings).toEqual([]);
  });

  it('that do nothing in Mirth, because the response comes from elsewhere, are not mentioned', () => {
    expect(withAck({ successfulACKCode: 'CA' }, { responseVariable: 'Postprocessor' }).warnings).toEqual([]);
  });

  it('a message the source filter stops is answered AR in Mirth and AA here', () => {
    const filter = jsRule('return false;');
    expect(warningsWith(withAck({}, { filter }), 'filtered message', 'AR', 'AA')).toHaveLength(1);
    expect(withAck({ rejectedACKCode: 'AA' }, { filter }).warnings.filter((w) => w.includes('filtered message'))).toEqual([]);
    expect(withAck({}, { filter, responseVariable: 'Auto-generate (Before processing)' }).warnings).toEqual([]);
  });

  it('reads the source filter where older exports keep it', () => {
    const result = withAck({}, { transformer: { inboundProperties: ackProps({}), more: `<filter>${jsRule('return false;')}</filter>` }, noFilter: true });
    expect(warningsWith(result, 'filtered message')).toHaveLength(1);
  });

  it('of a source that answers nobody are not mentioned', () => {
    expect(withAck({ successfulACKCode: 'CA' }, { transport: 'JavaScript Reader', className: 'js.JavaScriptReceiverProperties', props: '<script>return;</script>' }).warnings).toEqual([]);
  });
});

describe('code template libraries in a channel export', () => {
  const library = (name: string, code = 'function f() { return 1; }', enabledFor = ID): string => `<codeTemplateLibrary version="4.5.0"><id>${name}</id><name>${name}</name><includeNewChannels>false</includeNewChannels><enabledChannelIds><string>${enabledFor}</string></enabledChannelIds><disabledChannelIds/><codeTemplates><codeTemplate version="4.5.0"><id>${name}-t</id><name>f</name><contextSet><delegate><contextType>SOURCE_FILTER_TRANSFORMER</contextType></delegate></contextSet><properties class="com.mirth.connect.model.codetemplates.BasicCodeTemplateProperties"><type>FUNCTION</type><code>${esc(code)}</code></properties></codeTemplate></codeTemplates></codeTemplateLibrary>`;
  const exported = (libraries: string): string => `<codeTemplateLibraries>${libraries}</codeTemplateLibraries>`;

  it('are carried as a backup\'s are', () => {
    const result = convert({ exportData: exported(library('Globals')) });
    expect(result.codeTemplateLibraries).toEqual([{
      name: 'Globals', description: '', channelIds: [ID],
      templates: [{ name: 'f', description: '', type: 'FUNCTION', code: 'function f() { return 1; }', contexts: ['SOURCE_FILTER_TRANSFORMER'] }],
    }]);
    expect(result.warnings).toEqual([]);
  });

  it('that several channels of one file carry are imported once', () => {
    const xml = `<list>${channelXml({ exportData: exported(library('Globals')) })}${channelXml({ id: ID.replace(/1$/, '2'), name: 'D', exportData: exported(library('Globals')) })}</list>`;
    expect(convertRaw(xml).codeTemplateLibraries.map((l) => l.name)).toEqual(['Globals']);
  });

  it('are read for Mirth-only constructs, a template\'s own "message" parameter not being one', () => {
    const found = convert({ exportData: exported(library('Old', "function f(msg) { return msg['PID']['PID.5']; }")) });
    expect(warningsWith(found, 'Code template "f" in library "Old"', 'E4X')).toHaveLength(1);
    expect(convert({ exportData: exported(library('New', 'function f(message) { return message; }')) }).warnings).toEqual([]);
  });

  it('warns about the tags and dependencies the export also carries', () => {
    const result = convert({ exportData: '<dependentIds><string>a</string></dependentIds><dependencyIds/><channelTags><channelTag><id>t</id><name>Lab</name></channelTag></channelTags>' });
    const [warning] = warningsWith(result, 'Channel "C"', 'not imported');
    expect(warning).toContain('channelTags');
    expect(warning).toContain('dependentIds');
    expect(warning).not.toContain('dependencyIds');
  });

  it('that cannot be written are reported, with the channels still imported', async () => {
    vi.spyOn(ChannelImportService, 'importChannels').mockResolvedValue({ ok: true, value: { created: 1, updated: 0, skipped: 0, errors: [] }, error: null });
    vi.spyOn(CodeTemplateService, 'listLibraries').mockResolvedValue({ ok: true, value: [], error: null });
    vi.spyOn(CodeTemplateService, 'assertCanWriteLinks').mockResolvedValue({ ok: false, value: null, error: new Error('outside your scope') } as never);
    const result = await MirthImportService.importFromXml(channelXml({ exportData: exported(library('Globals')) }), { collisionMode: 'SKIP', dryRun: false });
    expect(result).toMatchObject({ ok: true, value: { importResult: { created: 1, errors: ['Code template libraries were not imported: outside your scope'] } } });
  });

  it('are read for E4X that is no JavaScript at all', () => {
    for (const code of ['var x = <a/>;', 'return <PID/>;', 'var y = m..PID;']) {
      expect(warningsWith(convert({ exportData: exported(library('Old', code)) }), 'Code template "f"', 'E4X literal')).toHaveLength(1);
    }
    expect(convert({ exportData: exported(library('New', "if (a < b) { x = '../y'; f(...z); n = a <b; }")) }).warnings).toEqual([]);
  });

  it('that fail part way are reported with what was written', async () => {
    vi.spyOn(ChannelImportService, 'importChannels').mockResolvedValue({ ok: true, value: { created: 1, updated: 0, skipped: 0, errors: [] }, error: null });
    vi.spyOn(CodeTemplateService, 'listLibraries').mockResolvedValue({ ok: true, value: [], error: null });
    vi.spyOn(CodeTemplateService, 'assertCanWriteLinks').mockResolvedValue({ ok: true, value: undefined, error: null });
    vi.spyOn(CodeTemplateService, 'createLibrary').mockResolvedValue({ ok: true, value: { id: 'l' }, error: null } as never);
    vi.spyOn(CodeTemplateService, 'listTemplates').mockResolvedValue({ ok: true, value: [], error: null });
    vi.spyOn(CodeTemplateService, 'createTemplate')
      .mockResolvedValueOnce({ ok: false, value: null, error: new Error('Line 1: Unexpected "<"') } as never)
      .mockResolvedValueOnce({ ok: true, value: { id: 't' }, error: null } as never);
    const two = channelXml({ exportData: exported(library('One') + library('Two')) });
    const result = await MirthImportService.importFromXml(two, { collisionMode: 'SKIP', dryRun: false });
    expect(result).toMatchObject({ ok: true, value: {
      codeTemplates: { created: 1, updated: 0, skipped: 0 },
      importResult: { errors: ['Code template "f" in library "One" was not imported: Line 1: Unexpected "<"'] },
    } });
  });

  it('that cannot be created leaves the others to be imported', async () => {
    vi.spyOn(ChannelImportService, 'importChannels').mockResolvedValue({ ok: true, value: { created: 1, updated: 0, skipped: 0, errors: [] }, error: null });
    vi.spyOn(CodeTemplateService, 'listLibraries').mockResolvedValue({ ok: true, value: [], error: null });
    vi.spyOn(CodeTemplateService, 'assertCanWriteLinks').mockResolvedValue({ ok: true, value: undefined, error: null });
    vi.spyOn(CodeTemplateService, 'createLibrary')
      .mockResolvedValueOnce({ ok: false, value: null, error: new Error('refused') } as never)
      .mockResolvedValueOnce({ ok: true, value: { id: 'l' }, error: null } as never);
    vi.spyOn(CodeTemplateService, 'listTemplates').mockResolvedValue({ ok: true, value: [], error: null });
    vi.spyOn(CodeTemplateService, 'createTemplate').mockResolvedValue({ ok: true, value: { id: 't' }, error: null } as never);
    const result = await MirthImportService.importFromXml(channelXml({ exportData: exported(library('One') + library('Two')) }), { collisionMode: 'SKIP', dryRun: false });
    expect(result).toMatchObject({ ok: true, value: { codeTemplates: { created: 1 }, importResult: { errors: ['Code template library "One" was not imported: refused'] } } });
  });

  describe('when the library is here already', () => {
    const stored = { id: 'l', name: 'Globals', revision: 1, channelIds: ['5c000418-0000-4000-8000-0000000000ee'] };
    async function importOver(xml: string, collisionMode: 'SKIP' | 'OVERWRITE', channelIds: readonly string[] | null = stored.channelIds): Promise<{ readonly warnings: readonly string[]; readonly rescoped: number; readonly updated: number }> {
      vi.spyOn(ChannelImportService, 'importChannels').mockResolvedValue({ ok: true, value: { created: 1, updated: 0, skipped: 0, errors: [] }, error: null });
      vi.spyOn(CodeTemplateService, 'listLibraries').mockResolvedValue({ ok: true, value: [{ ...stored, channelIds }], error: null } as never);
      vi.spyOn(CodeTemplateService, 'assertCanWriteLinks').mockResolvedValue({ ok: true, value: undefined, error: null });
      vi.spyOn(CodeTemplateService, 'listTemplates').mockResolvedValue({ ok: true, value: [{ id: 't', name: 'f', revision: 1 }], error: null } as never);
      const rescope = vi.spyOn(CodeTemplateService, 'updateLibrary').mockResolvedValue({ ok: true, value: {}, error: null } as never);
      const update = vi.spyOn(CodeTemplateService, 'updateTemplate').mockResolvedValue({ ok: true, value: {}, error: null } as never);
      const result = await MirthImportService.importFromXml(xml, { collisionMode, dryRun: false });
      if (!result.ok) throw result.error;
      return { warnings: result.value.convertResult.warnings, rescoped: rescope.mock.calls.length, updated: update.mock.calls.length };
    }

    it('a channel\'s export never changes it, even with OVERWRITE, and says so, and which channel it does not reach', async () => {
      const { warnings, rescoped, updated } = await importOver(channelXml({ exportData: exported(library('Globals')) }), 'OVERWRITE');
      expect([rescoped, updated]).toEqual([0, 0]);
      expect(warnings.filter((w) => w.includes('library "Globals" is here already') && w.includes('left as it is'))).toHaveLength(1);
      expect(warnings.filter((w) => w.includes('"Globals"') && w.includes('does not reach') && w.includes('"C"'))).toHaveLength(1);
    });

    it('it is not said of a library that reaches the channel', async () => {
      const reaches = async (channelIds: readonly string[] | null): Promise<readonly string[]> =>
        (await importOver(channelXml({ exportData: exported(library('Globals')) }), 'SKIP', channelIds)).warnings.filter((w) => w.includes('does not reach'));
      expect(await reaches(null)).toEqual([]);
      expect(await reaches([ID])).toEqual([]);
    });

    it('a server backup with OVERWRITE replaces it', async () => {
      const xml = `<serverConfiguration version="4.5.0"><channels>${channelXml()}</channels>${exported(library('Globals'))}</serverConfiguration>`;
      const { warnings, rescoped, updated } = await importOver(xml, 'OVERWRITE');
      expect([rescoped, updated]).toEqual([1, 1]);
      expect(warnings).toEqual([]);
    });
  });
});

describe('a server backup', () => {
  const backup = (sections: string): string => `<serverConfiguration version="4.5.0"><date>now</date>${sections}<channels>${channelXml()}</channels></serverConfiguration>`;
  const scripts = (over: Readonly<Record<string, string>>): string => {
    const values: Record<string, string> = { Undeploy: 'return;', Postprocessor: 'return;', Deploy: '// comment\nreturn;', Preprocessor: '// Modify the message\nreturn message;', ...over };
    return `<globalScripts>${Object.entries(values).map(([k, v]) => `<entry><string>${k}</string><string>${esc(v)}</string></entry>`).join('')}</globalScripts>`;
  };

  it('names every section that is not imported, and no empty one', () => {
    const result = convertRaw(backup('<channelGroups><channelGroup><id>g</id></channelGroup></channelGroups><channelTags/><users><user><id>1</id></user><user><id>2</id></user></users><alerts></alerts><serverSettings><serverName>x</serverName></serverSettings><configurationMap><entry><string>a</string><value>secret-value</value></entry></configurationMap><somethingNew><a>1</a></somethingNew>'));
    const [warning, ...more] = warningsWith(result, 'backup', 'not imported');
    expect(more).toEqual([]);
    for (const name of ['channel groups', 'users', 'server settings', 'configuration map', 'somethingNew']) expect(warning).toContain(name);
    for (const name of ['tags', 'alerts', 'secret-value', 'date', 'channels,']) expect(warning).not.toContain(name);
  });

  it('with Mirth\'s do-nothing global scripts says nothing about them', () => {
    const result = convertRaw(backup(scripts({})));
    expect(result.warnings).toEqual([]);
    expectNotHeld(result);
  });

  it('names its global scripts', () => {
    const result = convertRaw(backup(scripts({ Deploy: 'load();' })));
    expect(warningsWith(result, 'global scripts', 'Deploy')).toHaveLength(1);
    expectNotHeld(result);
  });

  it('with a global preprocessor holds its channels, which would get messages it did not rewrite', () => {
    expectHeld(convertRaw(backup(scripts({ Preprocessor: 'return message.trim();' }))), 'the global preprocessor of the Mirth server is not imported');
  });
});

describe('a Message Builder step', () => {
  const steps = (result: MirthConvertResult): ChannelExportEntry['transformers'][number]['steps'] => only(result).transformers[0]?.steps ?? [];

  it('becomes the JavaScript Mirth generates for it, which the preview names', () => {
    const result = convert({ source: { transformer: { elements: builderStep("tmp['PID']['PID.5']", "msg['PID']['PID.5'].toString()", "'none'") } } });
    expect(steps(result)[0]?.script).toBe("tmp['PID']['PID.5'] = validate(msg['PID']['PID.5'].toString(), 'none', new Array());");
    const [warning] = warningsWith(result, 'Mirth-only constructs');
    expect(warning).toContain('validate(');
    const compiled = compileTransformerStepsToScript(steps(result));
    expect(compiled.ok && compiled.value).toContain('validate(');
  });

  it('reads an empty mapping and default as empty text, and carries its replacements', () => {
    const replacements = "<replacements><org.apache.commons.lang3.tuple.ImmutablePair><left>/a/g</left><right>'b'</right></org.apache.commons.lang3.tuple.ImmutablePair><org.apache.commons.lang3.tuple.ImmutablePair><left>'c'</left><right>'d'</right></org.apache.commons.lang3.tuple.ImmutablePair></replacements>";
    const result = convert({ source: { transformer: { elements: builderStep('tmp.x', '', '', replacements) } } });
    expect(steps(result)[0]?.script).toBe("tmp.x = validate('', '', new Array(new Array(/a/g, 'b'),new Array('c', 'd')));");
  });

  it('with nothing to set is refused at deploy, with a warning, unless it is disabled', () => {
    const result = convert({ source: { transformer: { elements: builderStep('', "msg['PID']") } } });
    expect(compileTransformerStepsToScript(steps(result))).toMatchObject({ ok: false });
    expect(warningsWith(result, 'step "Set name" (MESSAGE_BUILDER)', 'will not deploy')).toHaveLength(1);
    expect(convert({ source: { transformer: { elements: builderStep('', 'x', '', '<replacements/>', false) } } }).warnings).toEqual([]);
  });

  it('of the 3.x form, with a space in its type, is one too', () => {
    const legacy = (script: string): ChannelXml => ({ source: { transformer: { more: `<steps><step><sequenceNumber>0</sequenceNumber><name>Old</name><enabled>true</enabled><type>Message Builder</type>${script}</step></steps>` } } });
    const xml = (script: string): string => channelXml(legacy(script)).replace('<transformer version="4.5.0"><elements/>', '<transformer version="3.0.0">');
    expect(steps(convertRaw(xml('<script>tmp.a = 1;</script>')))[0]).toMatchObject({ type: 'MESSAGE_BUILDER', script: 'tmp.a = 1;' });
    expect(warningsWith(convertRaw(xml('')), 'step "Old" (MESSAGE_BUILDER)', 'will not deploy')).toHaveLength(1);
  });

  it('is not the only kind that is named when it cannot run', () => {
    expect(warningsWith(convert({ source: { transformer: { elements: MAPPER } } }), 'step "Map id" (MAPPER)', 'will not deploy')).toHaveLength(1);
    expect(warningsWith(convert({ destinations: [{ transformer: { elements: MAPPER } }] }), 'step "Map id" (MAPPER)')).toHaveLength(1);
  });

  it('is carried in a response transformer too', () => {
    const result = convert({ destinations: [{ response: { elements: builderStep('msg.a', "'x'") } }] });
    expect(firstDest(result).responseTransformer).toContain("msg.a = validate('x', '', new Array());");
    expectNotHeld(result);
  });
});

describe('Mirth-only constructs in a connector\'s script', () => {
  it('are not a variable named responseStatus', () => {
    expect(convert({ destinations: [{ props: '<script>var responseStatus = 2; return responseStatus;</script>' }] }).warnings).toEqual([]);
  });

  it('are named for a JavaScript Reader and a JavaScript Writer', () => {
    const reader = convert({ source: { transport: 'JavaScript Reader', className: 'js.JavaScriptReceiverProperties', props: '<script>return new java.util.ArrayList();</script>' } });
    expect(warningsWith(reader, 'Mirth-only constructs', 'Java classes')).toHaveLength(1);
    const writer = convert({ destinations: [{ props: '<script>router.routeMessage(&apos;x&apos;, msg);</script>' }] });
    expect(warningsWith(writer, 'Mirth-only constructs', 'user API')).toHaveLength(1);
  });
});

describe('a File Reader\'s file size range', () => {
  const reader = (extra: string): ChannelXml => ({
    source: { transport: 'File Reader', className: 'file.FileReceiverProperties', props: `<scheme>FILE</scheme><host>/data/in</host><fileFilter>*</fileFilter><afterProcessingAction>DELETE</afterProcessingAction>${extra}` },
  });

  it('holds the channel, which would read, and delete, files Mirth leaves', () => {
    const reason = 'its File Reader skips files outside a file size range in Mirth';
    expectHeld(convert(reader('<fileSizeMinimum>100</fileSizeMinimum>')), reason);
    expectHeld(convert(reader('<fileSizeMinimum>0</fileSizeMinimum><fileSizeMaximum>5000</fileSizeMaximum><ignoreFileSizeMaximum>false</ignoreFileSizeMaximum>')), reason);
  });

  it('whose minimum is a reference holds it too', () => {
    expectHeld(convert(reader('<fileSizeMinimum>${min}</fileSizeMinimum>')), 'file size range');
  });

  it.each(['SFTP', 'FILE'])('and binary files over %s: SFTP is text only here', (scheme) => {
    const file = `<scheme>${scheme}</scheme><host>files.example.com/in</host><fileFilter>*</fileFilter><afterProcessingAction>DELETE</afterProcessingAction><binary>true</binary>`;
    const read = convert({ source: { transport: 'File Reader', className: 'file.FileReceiverProperties', props: file } });
    const write = convert({ destinations: [{ transport: 'File Writer', className: 'file.FileDispatcherProperties', props: `<scheme>${scheme}</scheme><host>files.example.com/in</host><outputPattern>a</outputPattern><binary>true</binary>` }] });
    if (scheme === 'FILE') {
      expectNotHeld(read);
      expectNotHeld(write);
    } else {
      expectHeld(read, 'its File Reader reads binary files over SFTP');
      expectHeld(write, 'the File Writer "Out" writes binary files over SFTP');
    }
  });

  it('that takes every file holds nothing', () => {
    expectNotHeld(convert(reader('<fileSizeMinimum>0</fileSizeMinimum><fileSizeMaximum>5000</fileSizeMaximum><ignoreFileSizeMaximum>true</ignoreFileSizeMaximum>')));
    expectNotHeld(convert(reader('<fileSizeMinimum>0</fileSizeMinimum><fileSizeMaximum/><ignoreFileSizeMaximum>false</ignoreFileSizeMaximum>')));
  });

  it('means nothing on a connector that is not a File Reader', () => {
    expectNotHeld(convert({ source: { props: '<fileSizeMinimum>100</fileSizeMinimum>' } }));
  });
});

describe('${...} references', () => {
  const tcp = (host: string, template: string, port = '6662'): ChannelXml => ({
    destinations: [{ transport: 'TCP Sender', className: 'tcp.TcpDispatcherProperties', props: `<remoteAddress>${host}</remoteAddress><remotePort>${port}</remotePort><charsetEncoding>UTF-8</charsetEncoding><template>${esc(template)}</template>` }],
  });
  const http = (url: string, header: string, content = '${message.encodedData}'): ChannelXml => ({
    destinations: [{ transport: 'HTTP Sender', className: 'http.HttpDispatcherProperties', props: `<host>${esc(url)}</host><method>post</method><headers class="linked-hash-map"><entry><string>X-A</string><list><string>${esc(header)}</string></list></entry></headers><content>${content}</content>` }],
  });
  const cannotFill = 'cannot fill';
  const atDeploy = 'configuration map at deploy';

  it('that a destination\'s template fills are not mentioned', () => {
    expect(convert(tcp('partner', '${message.encodedData}|${accession}|${originalFilename}')).warnings).toEqual([]);
  });

  // Mirth's raw data of a destination is what the source transformer made, GalvaniGraph's what came in.
  it('to the raw data are the encoded message when the destination changes nothing, and hold the channel when it does', () => {
    const same = convert(tcp('partner', 'R:${message.rawData}'));
    expect(firstDest(same).properties['template']).toBe('R:${message.encodedData}');
    expect(same.warnings).toEqual([]);

    const dest = tcp('partner', 'R:${message.rawData}').destinations![0]!;
    const reason = 'the template of "Out" uses ${message.rawData}';
    expectHeld(convert({ destinations: [{ ...dest, transformer: { elements: jsStep('msg.x = 1;') } }] }), reason);
    expectHeld(convert({ destinations: [{ ...dest, transformer: { outbound: 'JSON' } }] }), reason);
    expectNotHeld(convert({ destinations: [{ ...dest, transformer: { elements: jsStep('off();', 0, false) } }] }));
    expectNotHeld(convert({ destinations: [{ ...dest, enabled: false, transformer: { elements: jsStep('msg.x = 1;') } }] }));
  });

  it('to the transformed data hold the channel: Mirth sends its internal form', () => {
    expectHeld(convert(tcp('partner', '${message.transformedData}')), 'the template of "Out" uses ${message.transformedData}');
    expectHeld(convert(http('http://api', 'x', '${message.transformedData}')), '${message.transformedData}');
  });

  it('without braces, and Velocity directives, are named', () => {
    const [warning] = warningsWith(convert(tcp('partner', "$accession $!{q} $date.get('y') #if($x)a#end $5 ${ok}")), cannotFill);
    for (const text of ['$accession', '$date', '$x', '#if', '#end']) expect(warning).toContain(text);
    expect(warning).not.toContain('$5');
    expect(warning).not.toContain('${ok}');
  });

  it('in the name of a header are named', () => {
    expect(warningsWith(convert({ destinations: [{ ...http('http://api', 'x').destinations![0]!, props: http('http://api', 'x').destinations![0]!.props!.replace('X-A', '${name}') }] }), cannotFill, '${name} (headers)')).toHaveLength(1);
  });

  it('are found in time that grows with the text, not with its square', () => {
    const text = '${'.repeat(200_000) + 'validate('.repeat(20_000);
    const started = performance.now();
    convert({ destinations: [{ props: `<script>${text}</script>` }, { ...tcp('partner', text).destinations![0]!, id: 2, name: 'Two' }] });
    expect(performance.now() - started).toBeLessThan(5_000);
  });

  it('in no template at all: a blank one sends nothing, as in Mirth, and not the whole message', () => {
    expect(firstDest(convert(http('http://api', 'x', ''))).properties['template']).toBe('');
    expect(firstDest(convert(http('http://api', 'x'))).properties).not.toHaveProperty('template');
  });

  it('to the message id become the name GalvaniGraph fills', () => {
    const result = convert(tcp('partner', 'id=${message.messageId}'));
    expect(firstDest(result).properties['template']).toBe('id=${messageId}');
    expect(result.warnings).toEqual([]);
  });

  it('that nothing fills are named, with the destination and the setting', () => {
    const result = convert(tcp('partner', "${DATE} ${UUID} ${date.get('yyyy')} ${message.channelName} $!{quiet} ${ok}"));
    const [warning, ...more] = warningsWith(result, cannotFill);
    expect(more).toEqual([]);
    for (const text of ['Channel "C"', 'TCP Sender "Out"', 'template', '${DATE}', '${UUID}', "${date.get('yyyy')}", '${message.channelName}', '$!{quiet}']) expect(warning).toContain(text);
    expect(warning).not.toContain('${ok}');
  });

  it('in a URL or header take map variables only', () => {
    expect(convert(http('http://api/${accession}', '${site}')).warnings).toEqual([]);
    const [warning] = warningsWith(convert(http('http://api/${message.messageId}', '${message.rawData}')), cannotFill);
    expect(warning).toContain('${message.messageId}');
    expect(warning).toContain('${message.rawData}');
    expect(warning).toContain('url');
    expect(warning).toContain('headers');
  });

  it('in a setting read once, at deploy, are named as needing a configuration map entry', () => {
    const result = convert(tcp('${partnerHost}', '${message.encodedData}', '${partnerPort}'));
    const [warning] = warningsWith(result, atDeploy);
    expect(warning).toContain('TCP Sender "Out"');
    expect(warning).toContain('${partnerHost} (host)');
    expect(warning).toContain('${partnerPort} (port)');
  });

  it('on a source are read at deploy', () => {
    const source: SourceXml = { transport: 'File Reader', className: 'file.FileReceiverProperties', props: "<scheme>FILE</scheme><host>/data/in</host><fileFilter>*</fileFilter><afterProcessingAction>MOVE</afterProcessingAction><moveToDirectory>/done/${date.get('yyyyMMdd')}</moveToDirectory>" };
    expect(warningsWith(convert({ source }), 'File Reader', atDeploy, "${date.get('yyyyMMdd')} (moveToDirectory)")).toHaveLength(1);
  });

  it('in SQL bind only plain names', () => {
    const writer = (query: string): ChannelXml => ({ destinations: [{ transport: 'Database Writer', className: 'jdbc.DatabaseDispatcherProperties', props: `<url>jdbc:postgresql://db:5432/lab</url><query>${query}</query>` }] });
    expect(convert(writer('INSERT INTO t VALUES (${accession})')).warnings).toEqual([]);
    expect(warningsWith(convert(writer('INSERT INTO t VALUES (${message.rawData})')), 'Database Writer "Out"', cannotFill, '${message.rawData}')).toHaveLength(1);
    const reader: SourceXml = { transport: 'Database Reader', className: 'jdbc.DatabaseReceiverProperties', props: '<url>jdbc:postgresql://db:5432/lab</url><select>SELECT * FROM t WHERE id &gt; ${lastId}</select><update>UPDATE t SET done = 1 WHERE id = ${id}</update><updateMode>3</updateMode>' };
    const [select] = warningsWith(convert({ source: reader }), 'Database Reader', cannotFill);
    expect(select).toContain('${lastId} (selectQuery)');
    expect(select).not.toContain('${id}');
  });

  it('in the template of an SFTP File Writer are carried with it', () => {
    const sftp = convert({ destinations: [{ transport: 'File Writer', className: 'file.FileDispatcherProperties', props: '<scheme>SFTP</scheme><host>sftp.example.com/in</host><outputPattern>a.txt</outputPattern><template>H|${accession}</template>' }] });
    expect(firstDest(sftp)).toMatchObject({ connectorType: 'SFTP', properties: { template: 'H|${accession}' } });
    expect(validateConnectorProperties('SFTP', 'destination', { ...firstDest(sftp).properties, username: 'u', password: 'p', strictHostKey: false })).toMatchObject({ ok: true });
  });

  it('in a script are code, and in a file name are reported once, by the file name check', () => {
    expect(convert({ destinations: [{ props: '<script>var t = `${x.y}`;</script>' }] }).warnings).toEqual([]);
    const file = convert({ destinations: [{ transport: 'File Writer', className: 'file.FileDispatcherProperties', props: '<scheme>FILE</scheme><host>/out</host><outputPattern>${UUID}.txt</outputPattern>' }] });
    expect(warningsWith(file, '${UUID}')).toHaveLength(1);
  });

  it('never put a credential in a warning', () => {
    const xml = channelXml(tcp('partner', 'x')).replace('<remoteAddress>partner</remoteAddress>', '<remoteAddress>user:s3cret@${host}</remoteAddress>');
    expect(JSON.stringify(convertRaw(xml).warnings)).not.toContain('s3cret');
  });
});

describe('the retry count', () => {
  const queue = (enabled: boolean, sendFirst: boolean, count: number): ChannelXml => ({
    destinations: [{ queue: `<queueEnabled>${String(enabled)}</queueEnabled><sendFirst>${String(sendFirst)}</sendFirst><retryIntervalMillis>5000</retryIntervalMillis><retryCount>${String(count)}</retryCount>` }],
  });

  it.each([true, false])('of a queued destination (try first: %s) is 0, so the queue delivers as Mirth\'s does, with no end', (sendFirst) => {
    expect(firstDest(convert(queue(true, sendFirst, 3)))).toMatchObject({ queueMode: sendFirst ? 'ON_FAILURE' : 'ALWAYS', retryCount: 0, retryIntervalMs: 5000 });
  });

  it('that Mirth applies before it queues is named', () => {
    expect(warningsWith(convert(queue(true, true, 3)), '"Out"', '3 times', 'before it queues')).toHaveLength(1);
    expect(warningsWith(convert(queue(true, false, 3)), 'before it queues')).toEqual([]);
    expect(warningsWith(convert(queue(true, true, 0)), 'before it queues')).toEqual([]);
  });

  it('is joined by a warning where the queue retries what Mirth\'s gives up: a NACK and a script that fails', () => {
    const tcpSender = { ...queue(true, false, 0).destinations![0]!, transport: 'TCP Sender', className: 'tcp.TcpDispatcherProperties', props: '<remoteAddress>p</remoteAddress><remotePort>1</remotePort><charsetEncoding>UTF-8</charsetEncoding>' };
    expect(warningsWith(convert({ destinations: [tcpSender] }), '"Out"', 'negative acknowledgement', 'sends again', 'behind it')).toHaveLength(1);
    expect(warningsWith(convert(queue(true, false, 0)), '"Out"', 'script', 'runs it again')).toHaveLength(1);
    expect(convert(queue(false, false, 0)).warnings).toEqual([]);
    const ignoring = { ...tcpSender, props: `${tcpSender.props}<ignoreResponse>true</ignoreResponse>` };
    expectHeld(convert({ destinations: [ignoring] }), 'the TCP Sender "Out" ignores the answer in Mirth');
    const unqueued = convert({ destinations: [{ ...ignoring, queue: '<queueEnabled>false</queueEnabled>' }] });
    expectNotHeld(unqueued);
    expect(warningsWith(unqueued, '"Out"', 'ignores the answer', 'ERROR')).toHaveLength(1);
    const timeout = convert({ destinations: [{ ...tcpSender, props: `${tcpSender.props}<queueOnResponseTimeout>false</queueOnResponseTimeout>` }] });
    expect(warningsWith(timeout, '"Out"', 'no answer', 'does not queue')).toHaveLength(1);
    const http = { ...tcpSender, transport: 'HTTP Sender', className: 'http.HttpDispatcherProperties', props: '<host>http://api</host>' };
    expect(convert({ destinations: [http] }).warnings).toEqual([]);
  });

  it('of a destination with no queue is named, since nothing here retries it', () => {
    const result = convert(queue(false, false, 2));
    expect(warningsWith(result, '"Out"', '2 times', 'no queue')).toHaveLength(1);
    expect(firstDest(result)).toMatchObject({ queueMode: 'NEVER', retryCount: 2 });
    expect(convert(queue(false, false, 0)).warnings).toEqual([]);
  });
});

describe('importing copies (RENAME)', () => {
  const OTHER = '5c000418-0000-4000-8000-000000000002';
  const ELSEWHERE = '5c000418-0000-4000-8000-00000000000f';
  const writer = (id: number, target: string): DestXml => ({ id, name: `W${String(id)}`, transport: 'Channel Writer', className: 'vm.VmDispatcherProperties', props: `<channelId>${target}</channelId><channelTemplate>\${message.encodedData}</channelTemplate>` });
  const file = `<list>${channelXml({ name: 'A', destinations: [writer(1, OTHER.toUpperCase()), writer(2, ELSEWHERE)] })}${channelXml({ id: OTHER, name: 'B', destinations: [{ props: '<script>routeMessage(&apos;A&apos;, rawData);</script>' }] })}</list>`;

  async function imported(copies: ReadonlyMap<string, string>): Promise<{ entries: readonly ChannelExportEntry[]; warnings: readonly string[] }> {
    vi.spyOn(ChannelImportService, 'copyIds').mockResolvedValue(copies);
    const importChannels = vi.spyOn(ChannelImportService, 'importChannels').mockResolvedValue({ ok: true, value: { created: 2, updated: 0, skipped: 0, errors: [] }, error: null });
    const result = await MirthImportService.importFromXml(file, { collisionMode: 'RENAME', dryRun: false });
    if (!result.ok) throw result.error;
    return { entries: importChannels.mock.calls[0]![0], warnings: result.value.convertResult.warnings };
  }

  it('points a copy\'s Channel Writers at the other copies, and leaves a target the file does not have', async () => {
    const copyA = '5c000418-0000-4000-8000-0000000000aa';
    const copyB = '5c000418-0000-4000-8000-0000000000bb';
    const { entries, warnings } = await imported(new Map([[ID, copyA], [OTHER, copyB]]));
    expect(entries.map((e) => e.id)).toEqual([copyA, copyB]);
    expect(entries[0]?.destinations.map((d) => d.properties['targetChannelId'])).toEqual([copyB, ELSEWHERE]);
    expect(warnings.filter((w) => w.includes('Channel "B"') && w.includes('"A"') && w.includes('by its name'))).toHaveLength(1);
  });

  it('changes nothing when no channel of the file exists here', async () => {
    const { entries, warnings } = await imported(new Map());
    expect(entries.map((e) => e.id)).toEqual([ID, OTHER]);
    expect(entries[0]?.destinations[0]?.properties['targetChannelId']).toBe(OTHER);
    expect(warnings.filter((w) => w.includes('copy'))).toEqual([]);
  });
});

describe('importing over a channel (OVERWRITE)', () => {
  it('passes on why each channel may not run, one disabled in Mirth included', async () => {
    const importChannels = vi.spyOn(ChannelImportService, 'importChannels').mockResolvedValue({ ok: true, value: { created: 0, updated: 1, skipped: 0, errors: [] }, error: null });
    const props = '<scheme>FILE</scheme><host>/data/in</host><fileFilter>*</fileFilter><fileSizeMinimum>100</fileSizeMinimum>';
    const xml = channelXml({ source: { transport: 'File Reader', className: 'file.FileReceiverProperties', props }, exportData: '<metadata><enabled>false</enabled></metadata>' });
    const result = await MirthImportService.importFromXml(xml, { collisionMode: 'OVERWRITE', dryRun: false });
    expect(result.ok).toBe(true);
    const placement = importChannels.mock.calls[0]?.[3];
    expect(placement).toMatchObject({ holds: { [ID]: [expect.stringContaining('file size range')] } });
  });
});
