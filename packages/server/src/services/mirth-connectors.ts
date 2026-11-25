// Which GalvaniGraph connector a Mirth connector becomes.

import { getNestedRecord, getString } from './mirth-xml.js';

const CONNECTOR_CLASSES: ReadonlyMap<string, string> = new Map([
  ['com.mirth.connect.connectors.tcp.TcpReceiverProperties', 'TCP_MLLP'],
  ['com.mirth.connect.connectors.tcp.TcpDispatcherProperties', 'TCP_MLLP'],
  ['com.mirth.connect.connectors.http.HttpReceiverProperties', 'HTTP'],
  ['com.mirth.connect.connectors.http.HttpDispatcherProperties', 'HTTP'],
  ['com.mirth.connect.connectors.file.FileReceiverProperties', 'FILE'],
  ['com.mirth.connect.connectors.file.FileDispatcherProperties', 'FILE'],
  ['com.mirth.connect.connectors.jdbc.DatabaseReceiverProperties', 'DATABASE'],
  ['com.mirth.connect.connectors.jdbc.DatabaseDispatcherProperties', 'DATABASE'],
  ['com.mirth.connect.connectors.js.JavaScriptReceiverProperties', 'JAVASCRIPT'],
  ['com.mirth.connect.connectors.js.JavaScriptDispatcherProperties', 'JAVASCRIPT'],
  ['com.mirth.connect.connectors.smtp.SmtpDispatcherProperties', 'SMTP'],
  ['com.mirth.connect.connectors.vm.VmReceiverProperties', 'CHANNEL'],
  ['com.mirth.connect.connectors.vm.VmDispatcherProperties', 'CHANNEL'],
  ['com.mirth.connect.connectors.dimse.DICOMReceiverProperties', 'DICOM'],
  ['com.mirth.connect.connectors.dimse.DICOMDispatcherProperties', 'DICOM'],
]);

const TRANSPORTS: ReadonlyMap<string, string> = new Map([
  ['TCP Listener', 'TCP_MLLP'],
  ['TCP Sender', 'TCP_MLLP'],
  ['HTTP Listener', 'HTTP'],
  ['HTTP Sender', 'HTTP'],
  ['File Reader', 'FILE'],
  ['File Writer', 'FILE'],
  ['Database Reader', 'DATABASE'],
  ['Database Writer', 'DATABASE'],
  ['JavaScript Reader', 'JAVASCRIPT'],
  ['JavaScript Writer', 'JAVASCRIPT'],
  ['SMTP Sender', 'SMTP'],
  ['Channel Reader', 'CHANNEL'],
  ['Channel Writer', 'CHANNEL'],
  ['DICOM Listener', 'DICOM'],
  ['DICOM Sender', 'DICOM'],
]);

export function connectorTypeOfClass(className: string): string | null {
  return CONNECTOR_CLASSES.get(className) ?? null;
}

export function connectorTypeOfTransport(transportName: string): string | null {
  return TRANSPORTS.get(transportName) ?? null;
}

/** A connector whose class is unknown or the JavaScript one goes by its transport name. */
export function connectorType(connector: Record<string, unknown>): string {
  const className = getString(getNestedRecord(connector, 'properties') ?? {}, '@_class') ?? '';
  const byClass = connectorTypeOfClass(className) ?? 'JAVASCRIPT';
  return byClass === 'JAVASCRIPT' ? connectorTypeOfTransport(getString(connector, 'transportName') ?? '') ?? byClass : byClass;
}
