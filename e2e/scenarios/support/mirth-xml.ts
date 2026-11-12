// ===========================================
// Scenario suite: Mirth Connect 4.5 export builder
// ===========================================
// Writes channel exports in the shape Mirth Connect 4.5 produces: the element
// names, property classes and nesting match a real 4.5 server backup. The
// scenarios feed these to the importer exactly as an operator would feed an
// export from their own server, so the builder must not bend toward what the
// importer happens to read. When in doubt, copy the structure of a real export.
//
// Scripts inside are written the way a Mirth (Rhino) channel writes them.

const V = '4.5.0';

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

const RESOURCE_IDS = '<resourceIds class="linked-hash-map"><entry><string>Default Resource</string><string>[Default Resource]</string></entry></resourceIds>';

// ----- Data types -----

export type DataType = 'HL7V2' | 'JSON' | 'XML' | 'RAW' | 'DELIMITED' | 'EDI/X12';

export interface DelimitedOptions {
  readonly columnDelimiter?: string;
  readonly recordDelimiter?: string;
  readonly columnNames?: string;
}

function hl7Props(tag: string, splitType = 'MSH_Segment'): string {
  return `<${tag} class="com.mirth.connect.plugins.datatypes.hl7v2.HL7v2DataTypeProperties" version="${V}">
  <serializationProperties class="com.mirth.connect.plugins.datatypes.hl7v2.HL7v2SerializationProperties" version="${V}"><handleRepetitions>true</handleRepetitions><handleSubcomponents>true</handleSubcomponents><useStrictParser>false</useStrictParser><useStrictValidation>false</useStrictValidation><stripNamespaces>true</stripNamespaces><segmentDelimiter>\\r</segmentDelimiter><convertLineBreaks>true</convertLineBreaks></serializationProperties>
  <deserializationProperties class="com.mirth.connect.plugins.datatypes.hl7v2.HL7v2DeserializationProperties" version="${V}"><useStrictParser>false</useStrictParser><useStrictValidation>false</useStrictValidation><segmentDelimiter>\\r</segmentDelimiter></deserializationProperties>
  <batchProperties class="com.mirth.connect.plugins.datatypes.hl7v2.HL7v2BatchProperties" version="${V}"><splitType>${splitType}</splitType><batchScript></batchScript></batchProperties>
  <responseGenerationProperties class="com.mirth.connect.plugins.datatypes.hl7v2.HL7v2ResponseGenerationProperties" version="${V}"><segmentDelimiter>\\r</segmentDelimiter><successfulACKCode>AA</successfulACKCode><successfulACKMessage></successfulACKMessage><errorACKCode>AE</errorACKCode><errorACKMessage>An Error Occurred Processing Message.</errorACKMessage><rejectedACKCode>AR</rejectedACKCode><rejectedACKMessage>Message Rejected.</rejectedACKMessage><msh15ACKAccept>false</msh15ACKAccept><dateFormat>yyyyMMddHHmmss.SSS</dateFormat></responseGenerationProperties>
  <responseValidationProperties class="com.mirth.connect.plugins.datatypes.hl7v2.HL7v2ResponseValidationProperties" version="${V}"><successfulACKCode>AA,CA</successfulACKCode><errorACKCode>AE,CE</errorACKCode><rejectedACKCode>AR,CR</rejectedACKCode><validateMessageControlId>true</validateMessageControlId><originalMessageControlId>Destination_Encoded</originalMessageControlId><originalIdMapVariable></originalIdMapVariable></responseValidationProperties>
</${tag}>`;
}

function dataTypeProps(tag: string, type: DataType, delimited?: DelimitedOptions): string {
  switch (type) {
    case 'HL7V2': return hl7Props(tag);
    case 'JSON': return `<${tag} class="com.mirth.connect.plugins.datatypes.json.JSONDataTypeProperties" version="${V}"><batchProperties class="com.mirth.connect.plugins.datatypes.json.JSONBatchProperties" version="${V}"><splitType>JavaScript</splitType><batchScript></batchScript></batchProperties></${tag}>`;
    case 'XML': return `<${tag} class="com.mirth.connect.plugins.datatypes.xml.XMLDataTypeProperties" version="${V}"><serializationProperties class="com.mirth.connect.plugins.datatypes.xml.XMLSerializationProperties" version="${V}"><stripNamespaces>false</stripNamespaces></serializationProperties><batchProperties class="com.mirth.connect.plugins.datatypes.xml.XMLBatchProperties" version="${V}"><splitType>Element_Name</splitType><elementName></elementName><level>1</level><query></query><batchScript></batchScript></batchProperties></${tag}>`;
    case 'RAW': return `<${tag} class="com.mirth.connect.plugins.datatypes.raw.RawDataTypeProperties" version="${V}"><batchProperties class="com.mirth.connect.plugins.datatypes.raw.RawBatchProperties" version="${V}"><splitType>JavaScript</splitType><batchScript></batchScript></batchProperties></${tag}>`;
    case 'DELIMITED': return `<${tag} class="com.mirth.connect.plugins.datatypes.delimited.DelimitedDataTypeProperties" version="${V}">
  <serializationProperties class="com.mirth.connect.plugins.datatypes.delimited.DelimitedSerializationProperties" version="${V}"><columnDelimiter>${esc(delimited?.columnDelimiter ?? ',')}</columnDelimiter><recordDelimiter>${esc(delimited?.recordDelimiter ?? '\\n')}</recordDelimiter><columnWidths/><quoteToken>&quot;</quoteToken><escapeWithDoubleQuote>true</escapeWithDoubleQuote><quoteEscapeToken>\\</quoteEscapeToken><columnNames>${esc(delimited?.columnNames ?? '')}</columnNames><numberedRows>false</numberedRows><ignoreCR>true</ignoreCR></serializationProperties>
  <deserializationProperties class="com.mirth.connect.plugins.datatypes.delimited.DelimitedDeserializationProperties" version="${V}"><columnDelimiter>${esc(delimited?.columnDelimiter ?? ',')}</columnDelimiter><recordDelimiter>${esc(delimited?.recordDelimiter ?? '\\n')}</recordDelimiter><columnWidths/><quoteToken>&quot;</quoteToken><escapeWithDoubleQuote>true</escapeWithDoubleQuote><quoteEscapeToken>\\</quoteEscapeToken></deserializationProperties>
  <batchProperties class="com.mirth.connect.plugins.datatypes.delimited.DelimitedBatchProperties" version="${V}"><splitType>Record</splitType><batchSkipRecords>0</batchSkipRecords><batchMessageDelimiter></batchMessageDelimiter><batchMessageDelimiterIncluded>false</batchMessageDelimiterIncluded><batchGroupingColumn></batchGroupingColumn><batchScript></batchScript></batchProperties>
</${tag}>`;
    case 'EDI/X12': return `<${tag} class="com.mirth.connect.plugins.datatypes.edi.EDIDataTypeProperties" version="${V}"><serializationProperties class="com.mirth.connect.plugins.datatypes.edi.EDISerializationProperties" version="${V}"><segmentDelimiter>~</segmentDelimiter><elementDelimiter>*</elementDelimiter><subelementDelimiter>:</subelementDelimiter><inferX12Delimiters>true</inferX12Delimiters></serializationProperties><batchProperties class="com.mirth.connect.plugins.datatypes.edi.EDIBatchProperties" version="${V}"><splitType>JavaScript</splitType><batchScript></batchScript></batchProperties></${tag}>`;
    default: return '';
  }
}

// ----- Filter and transformer -----

export interface Step { readonly name: string; readonly script: string }
export interface Rule { readonly name: string; readonly script: string; readonly operator?: 'NONE' | 'AND' | 'OR' }

function steps(list: readonly Step[]): string {
  if (list.length === 0) return '<elements/>';
  return `<elements>${list.map((s, i) => `
  <com.mirth.connect.plugins.javascriptstep.JavaScriptStep version="${V}"><name>${esc(s.name)}</name><sequenceNumber>${String(i)}</sequenceNumber><enabled>true</enabled><script>${esc(s.script)}</script></com.mirth.connect.plugins.javascriptstep.JavaScriptStep>`).join('')}
</elements>`;
}

function rules(list: readonly Rule[]): string {
  if (list.length === 0) return '<elements/>';
  return `<elements>${list.map((r, i) => `
  <com.mirth.connect.plugins.javascriptrule.JavaScriptRule version="${V}"><name>${esc(r.name)}</name><sequenceNumber>${String(i)}</sequenceNumber><enabled>true</enabled><operator>${r.operator ?? (i === 0 ? 'NONE' : 'AND')}</operator><script>${esc(r.script)}</script></com.mirth.connect.plugins.javascriptrule.JavaScriptRule>`).join('')}
</elements>`;
}

interface TransformerSpec {
  readonly inbound: DataType;
  readonly outbound: DataType;
  readonly steps?: readonly Step[];
  readonly delimited?: DelimitedOptions;
  readonly batchSplitType?: string;
}

function transformer(tag: string, t: TransformerSpec): string {
  const inProps = t.batchSplitType && t.inbound === 'HL7V2' ? hl7Props('inboundProperties', t.batchSplitType) : dataTypeProps('inboundProperties', t.inbound, t.delimited);
  return `<${tag} version="${V}">
${steps(t.steps ?? [])}
<inboundTemplate encoding="base64"></inboundTemplate>
<outboundTemplate encoding="base64"></outboundTemplate>
<inboundDataType>${t.inbound}</inboundDataType>
<outboundDataType>${t.outbound}</outboundDataType>
${inProps}
${dataTypeProps('outboundProperties', t.outbound)}
</${tag}>`;
}

// ----- Connector properties -----

export interface Queue {
  readonly enabled: boolean;
  readonly retryCount?: number;
  readonly retryIntervalMillis?: number;
  readonly threadCount?: number;
  readonly threadAssignmentVariable?: string;
  readonly validateResponse?: boolean;
}

export function destProps(q?: Queue): string {
  return `<destinationConnectorProperties version="${V}"><queueEnabled>${String(q?.enabled ?? false)}</queueEnabled><sendFirst>false</sendFirst><retryIntervalMillis>${String(q?.retryIntervalMillis ?? 10000)}</retryIntervalMillis><regenerateTemplate>false</regenerateTemplate><retryCount>${String(q?.retryCount ?? 0)}</retryCount><rotate>false</rotate><includeFilterTransformer>false</includeFilterTransformer><threadCount>${String(q?.threadCount ?? 1)}</threadCount><threadAssignmentVariable>${q?.threadAssignmentVariable ?? ''}</threadAssignmentVariable><validateResponse>${String(q?.validateResponse ?? false)}</validateResponse>${RESOURCE_IDS}<queueBufferSize>1000</queueBufferSize><reattachAttachments>true</reattachAttachments></destinationConnectorProperties>`;
}

export interface SourceOptions {
  /** Response variable: 'None', 'Auto-generate (After source transformer)', 'Postprocessor', or a destination name. */
  readonly responseVariable?: string;
  readonly processBatch?: boolean;
}

function sourceProps(o?: SourceOptions): string {
  return `<sourceConnectorProperties version="${V}"><responseVariable>${esc(o?.responseVariable ?? 'Auto-generate (After source transformer)')}</responseVariable><respondAfterProcessing>true</respondAfterProcessing><processBatch>${String(o?.processBatch ?? false)}</processBatch><firstResponse>false</firstResponse><processingThreads>1</processingThreads>${RESOURCE_IDS}<queueBufferSize>1000</queueBufferSize></sourceConnectorProperties>`;
}

function pollProps(frequencyMs: number): string {
  return `<pollConnectorProperties version="${V}"><pollingType>INTERVAL</pollingType><pollOnStart>true</pollOnStart><pollingFrequency>${String(frequencyMs)}</pollingFrequency><pollingHour>0</pollingHour><pollingMinute>0</pollingMinute><cronJobs/><pollConnectorPropertiesAdvanced><weekly>true</weekly><inactiveDays><boolean>false</boolean><boolean>false</boolean><boolean>false</boolean><boolean>false</boolean><boolean>false</boolean><boolean>false</boolean><boolean>false</boolean><boolean>false</boolean></inactiveDays><dayOfMonth>1</dayOfMonth><allDay>true</allDay><startingHour>8</startingHour><startingMinute>0</startingMinute><endingHour>17</endingHour><endingMinute>0</endingMinute></pollConnectorPropertiesAdvanced></pollConnectorProperties>`;
}

function mllpMode(startHex = '0B', endHex = '1C0D'): string {
  return `<transmissionModeProperties class="com.mirth.connect.plugins.mllpmode.MLLPModeProperties"><pluginPointName>MLLP</pluginPointName><startOfMessageBytes>${startHex}</startOfMessageBytes><endOfMessageBytes>${endHex}</endOfMessageBytes><useMLLPv2>false</useMLLPv2><ackBytes>06</ackBytes><nackBytes>15</nackBytes><maxRetries>2</maxRetries></transmissionModeProperties>`;
}

function frameMode(startHex: string, endHex: string): string {
  return `<transmissionModeProperties class="com.mirth.connect.model.transmission.framemode.FrameModeProperties"><pluginPointName>Basic</pluginPointName><startOfMessageBytes>${startHex}</startOfMessageBytes><endOfMessageBytes>${endHex}</endOfMessageBytes></transmissionModeProperties>`;
}

/** A connector: its transport name, properties XML and scripts. */
export interface Connector {
  readonly name: string;
  readonly transportName: string;
  readonly properties: string;
  readonly inbound?: DataType;
  readonly outbound?: DataType;
  readonly steps?: readonly Step[];
  readonly rules?: readonly Rule[];
  readonly responseSteps?: readonly Step[];
  readonly delimited?: DelimitedOptions;
  readonly batchSplitType?: string;
  readonly enabled?: boolean;
}

export const tcpListener = (port: number, o?: SourceOptions & { startHex?: string; endHex?: string; basic?: boolean }): Pick<Connector, 'transportName' | 'properties'> => ({
  transportName: 'TCP Listener',
  properties: `<properties class="com.mirth.connect.connectors.tcp.TcpReceiverProperties" version="${V}"><pluginProperties/><listenerConnectorProperties version="${V}"><host>0.0.0.0</host><port>${String(port)}</port></listenerConnectorProperties>${sourceProps(o)}${o?.basic ? frameMode(o.startHex ?? '02', o.endHex ?? '03') : mllpMode(o?.startHex, o?.endHex)}<serverMode>true</serverMode><remoteAddress></remoteAddress><remotePort></remotePort><overrideLocalBinding>false</overrideLocalBinding><reconnectInterval>5000</reconnectInterval><receiveTimeout>0</receiveTimeout><bufferSize>65536</bufferSize><maxConnections>10</maxConnections><keepConnectionOpen>true</keepConnectionOpen><dataTypeBinary>false</dataTypeBinary><charsetEncoding>DEFAULT_ENCODING</charsetEncoding><respondOnNewConnection>0</respondOnNewConnection><responseAddress></responseAddress><responsePort></responsePort></properties>`,
});

export const tcpSender = (host: string, port: string, q?: Queue, template = '${message.encodedData}'): Pick<Connector, 'transportName' | 'properties'> => ({
  transportName: 'TCP Sender',
  properties: `<properties class="com.mirth.connect.connectors.tcp.TcpDispatcherProperties" version="${V}"><pluginProperties/>${destProps(q)}${mllpMode()}<serverMode>false</serverMode><remoteAddress>${esc(host)}</remoteAddress><remotePort>${esc(port)}</remotePort><overrideLocalBinding>false</overrideLocalBinding><localAddress>0.0.0.0</localAddress><localPort>0</localPort><sendTimeout>5000</sendTimeout><bufferSize>65536</bufferSize><maxConnections></maxConnections><keepConnectionOpen>false</keepConnectionOpen><checkRemoteHost>false</checkRemoteHost><responseTimeout>5000</responseTimeout><ignoreResponse>false</ignoreResponse><queueOnResponseTimeout>true</queueOnResponseTimeout><dataTypeBinary>false</dataTypeBinary><charsetEncoding>DEFAULT_ENCODING</charsetEncoding><template>${esc(template)}</template></properties>`,
});

export const channelReader = (): Pick<Connector, 'transportName' | 'properties'> => ({
  transportName: 'Channel Reader',
  properties: `<properties class="com.mirth.connect.connectors.vm.VmReceiverProperties" version="${V}"><pluginProperties/>${sourceProps()}</properties>`,
});

export const channelWriter = (channelId: string, q?: Queue): Pick<Connector, 'transportName' | 'properties'> => ({
  transportName: 'Channel Writer',
  properties: `<properties class="com.mirth.connect.connectors.vm.VmDispatcherProperties" version="${V}"><pluginProperties/>${destProps(q)}<channelId>${esc(channelId)}</channelId><channelTemplate>\${message.encodedData}</channelTemplate><mapVariables/></properties>`,
});

export const httpListener = (port: number, o?: SourceOptions & { contentType?: string }): Pick<Connector, 'transportName' | 'properties'> => ({
  transportName: 'HTTP Listener',
  properties: `<properties class="com.mirth.connect.connectors.http.HttpReceiverProperties" version="${V}"><pluginProperties><com.mirth.connect.plugins.httpauth.NoneHttpAuthProperties version="${V}"><authType>NONE</authType></com.mirth.connect.plugins.httpauth.NoneHttpAuthProperties></pluginProperties><listenerConnectorProperties version="${V}"><host>0.0.0.0</host><port>${String(port)}</port></listenerConnectorProperties>${sourceProps(o)}<xmlBody>false</xmlBody><parseMultipart>true</parseMultipart><includeMetadata>false</includeMetadata><binaryMimeTypes>application/.*(?&lt;!json|xml)$|image/.*|video/.*|audio/.*</binaryMimeTypes><binaryMimeTypesRegex>true</binaryMimeTypesRegex><responseContentType>${esc(o?.contentType ?? 'text/plain')}</responseContentType><responseDataTypeBinary>false</responseDataTypeBinary><responseStatusCode></responseStatusCode><responseHeaders class="linked-hash-map"/><responseHeadersVariable></responseHeadersVariable><useResponseHeadersVariable>false</useResponseHeadersVariable><charset>UTF-8</charset><contextPath></contextPath><timeout>30000</timeout><staticResources/></properties>`,
});

function stringListMap(tag: string, entries: Readonly<Record<string, string>>): string {
  const keys = Object.keys(entries);
  if (keys.length === 0) return `<${tag} class="linked-hash-map"/>`;
  return `<${tag} class="linked-hash-map">${keys.map((k) => `<entry><string>${esc(k)}</string><list><string>${esc(entries[k]!)}</string></list></entry>`).join('')}</${tag}>`;
}

export interface HttpSenderOptions {
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly parameters?: Readonly<Record<string, string>>;
  readonly basicAuth?: { readonly username: string; readonly password: string };
  readonly content?: string;
  readonly contentType?: string;
}

export const httpSender = (url: string, q?: Queue, o?: HttpSenderOptions): Pick<Connector, 'transportName' | 'properties'> => {
  const headers = stringListMap('headers', o?.headers ?? {});
  const params = stringListMap('parameters', o?.parameters ?? {});
  return {
    transportName: 'HTTP Sender',
    properties: `<properties class="com.mirth.connect.connectors.http.HttpDispatcherProperties" version="${V}"><pluginProperties/>${destProps(q)}<host>${esc(url)}</host><useProxyServer>false</useProxyServer><proxyAddress></proxyAddress><proxyPort></proxyPort><method>${o?.method ?? 'post'}</method>${headers}${params}<useHeadersVariable>false</useHeadersVariable><headersVariable></headersVariable><useParametersVariable>false</useParametersVariable><parametersVariable></parametersVariable><responseXmlBody>false</responseXmlBody><responseParseMultipart>true</responseParseMultipart><responseIncludeMetadata>false</responseIncludeMetadata><responseBinaryMimeTypes>application/.*(?&lt;!json|xml)$|image/.*|video/.*|audio/.*</responseBinaryMimeTypes><responseBinaryMimeTypesRegex>true</responseBinaryMimeTypesRegex><multipart>false</multipart><useAuthentication>${String(o?.basicAuth !== undefined)}</useAuthentication><authenticationType>Basic</authenticationType><usePreemptiveAuthentication>${String(o?.basicAuth !== undefined)}</usePreemptiveAuthentication><username>${esc(o?.basicAuth?.username ?? '')}</username><password>${esc(o?.basicAuth?.password ?? '')}</password><content>${esc(o?.content ?? '${message.encodedData}')}</content><contentType>${esc(o?.contentType ?? 'application/json')}</contentType><dataTypeBinary>false</dataTypeBinary><charset>UTF-8</charset><socketTimeout>30000</socketTimeout></properties>`,
  };
};

export const jsWriter = (script: string, q?: Queue): Pick<Connector, 'transportName' | 'properties'> => ({
  transportName: 'JavaScript Writer',
  properties: `<properties class="com.mirth.connect.connectors.js.JavaScriptDispatcherProperties" version="${V}"><pluginProperties/>${destProps(q)}<script>${esc(script)}</script></properties>`,
});

export const jsReader = (script: string, pollMs: number): Pick<Connector, 'transportName' | 'properties'> => ({
  transportName: 'JavaScript Reader',
  properties: `<properties class="com.mirth.connect.connectors.js.JavaScriptReceiverProperties" version="${V}"><pluginProperties/>${pollProps(pollMs)}${sourceProps({ responseVariable: 'None' })}<script>${esc(script)}</script></properties>`,
});

export interface FileReaderOptions {
  readonly scheme?: 'FILE' | 'SFTP' | 'FTP';
  readonly host: string;
  readonly fileFilter?: string;
  readonly regex?: boolean;
  readonly moveToDirectory?: string;
  readonly username?: string;
  readonly password?: string;
  readonly processBatch?: boolean;
  readonly pollMs?: number;
}

export const fileReader = (o: FileReaderOptions): Pick<Connector, 'transportName' | 'properties'> => {
  const scheme = o.scheme ?? 'FILE';
  const schemeProps = scheme === 'SFTP'
    ? `<schemeProperties class="com.mirth.connect.connectors.file.SftpSchemeProperties"><passwordAuth>true</passwordAuth><keyAuth>false</keyAuth><keyFile></keyFile><passPhrase></passPhrase><hostKeyChecking>no</hostKeyChecking><knownHostsFile></knownHostsFile><configurationSettings class="linked-hash-map"/></schemeProperties>`
    : '';
  return {
    transportName: 'File Reader',
    properties: `<properties class="com.mirth.connect.connectors.file.FileReceiverProperties" version="${V}"><pluginProperties/>${pollProps(o.pollMs ?? 1000)}${sourceProps({ responseVariable: 'None', processBatch: o.processBatch ?? false })}<scheme>${scheme}</scheme>${schemeProps}<host>${esc(o.host)}</host><fileFilter>${esc(o.fileFilter ?? '*')}</fileFilter><regex>${String(o.regex ?? false)}</regex><directoryRecursion>false</directoryRecursion><ignoreDot>true</ignoreDot><anonymous>${String(o.username === undefined)}</anonymous><username>${esc(o.username ?? 'anonymous')}</username><password>${esc(o.password ?? 'anonymous')}</password><timeout>10000</timeout><secure>true</secure><passive>true</passive><validateConnection>true</validateConnection><afterProcessingAction>${o.moveToDirectory ? 'MOVE' : 'DELETE'}</afterProcessingAction><moveToDirectory>${esc(o.moveToDirectory ?? '')}</moveToDirectory><moveToFileName></moveToFileName><errorReadingAction>NONE</errorReadingAction><errorResponseAction>AFTER_PROCESSING</errorResponseAction><errorMoveToDirectory></errorMoveToDirectory><errorMoveToFileName></errorMoveToFileName><checkFileAge>false</checkFileAge><fileAge>1000</fileAge><fileSizeMinimum>0</fileSizeMinimum><fileSizeMaximum></fileSizeMaximum><ignoreFileSizeMaximum>true</ignoreFileSizeMaximum><sortBy>date</sortBy><binary>false</binary><charsetEncoding>DEFAULT_ENCODING</charsetEncoding></properties>`,
  };
};

export interface DbOptions {
  readonly driver: string;
  readonly url: string;
  readonly username: string;
  readonly password: string;
}

export const dbReader = (db: DbOptions, select: string, update: string, pollMs = 1000): Pick<Connector, 'transportName' | 'properties'> => ({
  transportName: 'Database Reader',
  properties: `<properties class="com.mirth.connect.connectors.jdbc.DatabaseReceiverProperties" version="${V}"><pluginProperties/>${pollProps(pollMs)}${sourceProps({ responseVariable: 'None' })}<driver>${esc(db.driver)}</driver><url>${esc(db.url)}</url><username>${esc(db.username)}</username><password>${esc(db.password)}</password><select>${esc(select)}</select><update>${esc(update)}</update><useScript>false</useScript><aggregateResults>false</aggregateResults><cacheResults>true</cacheResults><keepConnectionOpen>true</keepConnectionOpen><updateMode>3</updateMode><retryCount>3</retryCount><retryInterval>10000</retryInterval><fetchSize>1000</fetchSize><encoding>DEFAULT_ENCODING</encoding></properties>`,
});

export const dbWriter = (db: DbOptions, query: string, q?: Queue): Pick<Connector, 'transportName' | 'properties'> => ({
  transportName: 'Database Writer',
  properties: `<properties class="com.mirth.connect.connectors.jdbc.DatabaseDispatcherProperties" version="${V}"><pluginProperties/>${destProps(q)}<driver>${esc(db.driver)}</driver><url>${esc(db.url)}</url><username>${esc(db.username)}</username><password>${esc(db.password)}</password><query>${esc(query)}</query><useScript>false</useScript></properties>`,
});

export interface SmtpOptions {
  readonly host: string;
  readonly port: string;
  readonly to: string;
  readonly from: string;
  readonly subject: string;
  readonly body: string;
}

export const smtpSender = (o: SmtpOptions, q?: Queue): Pick<Connector, 'transportName' | 'properties'> => ({
  transportName: 'SMTP Sender',
  properties: `<properties class="com.mirth.connect.connectors.smtp.SmtpDispatcherProperties" version="${V}"><pluginProperties/>${destProps(q)}<smtpHost>${esc(o.host)}</smtpHost><smtpPort>${esc(o.port)}</smtpPort><overrideLocalBinding>false</overrideLocalBinding><localAddress>0.0.0.0</localAddress><localPort>0</localPort><timeout>5000</timeout><encryption>none</encryption><authentication>false</authentication><username></username><password></password><to>${esc(o.to)}</to><from>${esc(o.from)}</from><cc></cc><bcc></bcc><replyTo></replyTo><headers class="linked-hash-map"/><headersVariable></headersVariable><isUseHeadersVariable>false</isUseHeadersVariable><subject>${esc(o.subject)}</subject><charsetEncoding>UTF-8</charsetEncoding><html>false</html><body>${esc(o.body)}</body><attachments/><attachmentsVariable></attachmentsVariable><isUseAttachmentsVariable>false</isUseAttachmentsVariable></properties>`,
});

// ----- Channel -----

export interface MetaDataColumn { readonly name: string; readonly type: 'STRING' | 'NUMBER' | 'BOOLEAN' | 'TIMESTAMP'; readonly mappingName: string }

export interface ChannelSpec {
  readonly id: string;
  readonly name: string;
  readonly source: Connector;
  readonly destinations: readonly Connector[];
  readonly preprocessor?: string;
  readonly postprocessor?: string;
  readonly deploy?: string;
  readonly metaDataColumns?: readonly MetaDataColumn[];
  readonly storageMode?: 'DEVELOPMENT' | 'PRODUCTION' | 'RAW' | 'METADATA' | 'DISABLED';
}

function connectorXml(c: Connector, metaDataId: number, mode: 'SOURCE' | 'DESTINATION', channelInbound: DataType): string {
  const inbound = c.inbound ?? channelInbound;
  const outbound = c.outbound ?? inbound;
  const tSpec: TransformerSpec = {
    inbound, outbound,
    ...(c.steps ? { steps: c.steps } : {}),
    ...(c.delimited ? { delimited: c.delimited } : {}),
    ...(c.batchSplitType ? { batchSplitType: c.batchSplitType } : {}),
  };
  const tag = mode === 'SOURCE' ? 'sourceConnector' : 'connector';
  const response = mode === 'DESTINATION'
    ? transformer('responseTransformer', { inbound: outbound, outbound, ...(c.responseSteps ? { steps: c.responseSteps } : {}) })
    : '';
  return `<${tag} version="${V}">
<metaDataId>${String(metaDataId)}</metaDataId>
<name>${esc(c.name)}</name>
${c.properties}
${transformer('transformer', tSpec)}
${response}
<filter version="${V}">${rules(c.rules ?? [])}</filter>
<transportName>${esc(c.transportName)}</transportName>
<mode>${mode}</mode>
<enabled>${String(c.enabled ?? true)}</enabled>
<waitForPrevious>true</waitForPrevious>
</${tag}>`;
}

/** One channel element, as it appears inside an export or a server backup. */
export function channelXml(spec: ChannelSpec): string {
  const inbound = spec.source.inbound ?? 'HL7V2';
  const columns = spec.metaDataColumns ?? [];
  const columnsXml = columns.length === 0
    ? '<metaDataColumns/>'
    : `<metaDataColumns>${columns.map((c) => `<metaDataColumn><name>${esc(c.name)}</name><type>${c.type}</type><mappingName>${esc(c.mappingName)}</mappingName></metaDataColumn>`).join('')}</metaDataColumns>`;
  return `<channel version="${V}">
<id>${spec.id}</id>
<nextMetaDataId>${String(spec.destinations.length + 1)}</nextMetaDataId>
<name>${esc(spec.name)}</name>
<description></description>
<revision>1</revision>
${connectorXml({ ...spec.source, name: 'sourceConnector' }, 0, 'SOURCE', inbound)}
<destinationConnectors>
${spec.destinations.map((d, i) => connectorXml(d, i + 1, 'DESTINATION', d.inbound ?? spec.source.outbound ?? inbound)).join('\n')}
</destinationConnectors>
<preprocessingScript>${esc(spec.preprocessor ?? '// Modify the message variable below to pre process data\nreturn message;')}</preprocessingScript>
<postprocessingScript>${esc(spec.postprocessor ?? '// This script executes once after a message has been processed\nreturn;')}</postprocessingScript>
<deployScript>${esc(spec.deploy ?? '// This script executes once when the channel is deployed\nreturn;')}</deployScript>
<undeployScript>${esc('// This script executes once when the channel is undeployed\nreturn;')}</undeployScript>
<properties version="${V}">
<clearGlobalChannelMap>true</clearGlobalChannelMap>
<messageStorageMode>${spec.storageMode ?? 'DEVELOPMENT'}</messageStorageMode>
<encryptData>false</encryptData><encryptAttachments>false</encryptAttachments><encryptCustomMetaData>false</encryptCustomMetaData>
<removeContentOnCompletion>false</removeContentOnCompletion><removeOnlyFilteredOnCompletion>false</removeOnlyFilteredOnCompletion><removeAttachmentsOnCompletion>false</removeAttachmentsOnCompletion>
<initialState>STARTED</initialState>
<storeAttachments>false</storeAttachments>
${columnsXml}
<attachmentProperties version="${V}"><type>None</type><properties/></attachmentProperties>
${RESOURCE_IDS}
</properties>
<exportData><metadata><enabled>true</enabled><lastModified><time>1790000000000</time><timezone>America/New_York</timezone></lastModified><pruningSettings><pruneMetaDataDays>30</pruneMetaDataDays><archiveEnabled>false</archiveEnabled><pruneErroredMessages>false</pruneErroredMessages></pruningSettings></metadata></exportData>
</channel>`;
}

/** A single-channel export file (Mirth: Channels > Export Channel). */
export function channelExport(spec: ChannelSpec): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${channelXml(spec)}`;
}

export interface CodeTemplate { readonly id: string; readonly name: string; readonly code: string }
export interface CodeTemplateLibrary { readonly id: string; readonly name: string; readonly enabledChannelIds: readonly string[]; readonly templates: readonly CodeTemplate[] }

const ALL_CONTEXTS = ['GLOBAL_DEPLOY', 'GLOBAL_UNDEPLOY', 'GLOBAL_PREPROCESSOR', 'GLOBAL_POSTPROCESSOR', 'CHANNEL_DEPLOY', 'CHANNEL_UNDEPLOY', 'CHANNEL_PREPROCESSOR', 'CHANNEL_POSTPROCESSOR', 'CHANNEL_ATTACHMENT', 'CHANNEL_BATCH', 'SOURCE_RECEIVER', 'SOURCE_FILTER_TRANSFORMER', 'DESTINATION_FILTER_TRANSFORMER', 'DESTINATION_DISPATCHER', 'DESTINATION_RESPONSE_TRANSFORMER'];

function libraryXml(lib: CodeTemplateLibrary): string {
  return `<codeTemplateLibrary version="${V}">
<id>${lib.id}</id><name>${esc(lib.name)}</name><revision>1</revision><lastModified><time>1790000000000</time><timezone>GMT</timezone></lastModified><description></description>
<includeNewChannels>false</includeNewChannels>
<enabledChannelIds>${lib.enabledChannelIds.map((c) => `<string>${c}</string>`).join('')}</enabledChannelIds>
<disabledChannelIds/>
<codeTemplates>${lib.templates.map((t) => `
<codeTemplate version="${V}"><id>${t.id}</id><name>${esc(t.name)}</name><revision>1</revision><lastModified><time>1790000000000</time><timezone>GMT</timezone></lastModified><contextSet><delegate>${ALL_CONTEXTS.map((c) => `<contextType>${c}</contextType>`).join('')}</delegate></contextSet><properties class="com.mirth.connect.model.codetemplates.BasicCodeTemplateProperties"><type>FUNCTION</type><code>${esc(t.code)}</code></properties></codeTemplate>`).join('')}
</codeTemplates>
</codeTemplateLibrary>`;
}

/** A full server backup (Mirth: Settings > Backup Config), the usual way to move a whole server. */
export function serverBackup(channels: readonly ChannelSpec[], libraries: readonly CodeTemplateLibrary[] = []): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<serverConfiguration version="${V}">
<date>2026-11-10 12:00:00</date>
<channelGroups/>
<channels>
${channels.map(channelXml).join('\n')}
</channels>
<channelTags/>
<users/>
<alerts/>
<codeTemplateLibraries>
${libraries.map(libraryXml).join('\n')}
</codeTemplateLibraries>
<serverSettings/>
<updateSettings version="${V}"/>
<globalScripts/>
<pluginProperties/>
<resourceProperties version="${V}"/>
<channelDependencies/>
<configurationMap/>
</serverConfiguration>`;
}
