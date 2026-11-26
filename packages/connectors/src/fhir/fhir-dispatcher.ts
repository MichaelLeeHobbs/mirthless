import { isPlainObject, tryCatch, type Result } from '@galvanigraph/core-util';
import { fillVariables, variableNames, type DestinationConnectorRuntime, type ConnectorMessage, type ConnectorResponse } from '../base.js';
import { answerText } from '../answer.js';
import { createConnectorLogger, type ConnectorLogger } from '../logger.js';
import { redirectMessage } from '../redirect.js';
import { refuseQuotedCredentials } from '../request-credentials.js';

const FHIR_AUTH_TYPE = {
  NONE: 'NONE',
  BASIC: 'BASIC',
  BEARER: 'BEARER',
  API_KEY: 'API_KEY',
} as const;
type FhirAuthType = typeof FHIR_AUTH_TYPE[keyof typeof FHIR_AUTH_TYPE];

export { FHIR_AUTH_TYPE };
export type { FhirAuthType };

export interface FhirAuthConfig {
  readonly username?: string | undefined;
  readonly password?: string | undefined;
  readonly token?: string | undefined;
  readonly headerName?: string | undefined;
  readonly apiKey?: string | undefined;
}

export interface FhirDispatcherConfig {
  readonly baseUrl: string;
  readonly resourceType: string;
  readonly method: 'POST' | 'PUT';
  readonly authType: FhirAuthType;
  readonly authConfig: FhirAuthConfig;
  readonly format: 'json' | 'xml';
  readonly timeout: number;
  readonly headers: Readonly<Record<string, string>>;
}

export class FhirDispatcher implements DestinationConnectorRuntime {
  private readonly config: FhirDispatcherConfig;
  private readonly logger: ConnectorLogger;
  private started = false;

  constructor(config: FhirDispatcherConfig, logger?: ConnectorLogger) {
    this.config = config;
    this.logger = logger ?? createConnectorLogger('FHIR');
  }

  async onDeploy(): Promise<Result<void>> {
    return tryCatch(async () => {
      if (!this.config.baseUrl) throw new Error('FHIR base URL is required');
      // Not quoted in the error: it may hold credentials. One with `${name}` is filled per message.
      if (!this.config.baseUrl.includes('${') && !URL.canParse(this.config.baseUrl)) throw new Error('Invalid base URL');
      if (!this.config.resourceType) throw new Error('FHIR resource type is required');
      validateAuth(this.config.authType, this.config.authConfig);
    });
  }

  async onStart(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.started = true;
    });
  }

  variablesUsed(): readonly string[] {
    return variableNames([this.config.baseUrl, ...Object.values(this.config.headers)]);
  }

  async send(message: ConnectorMessage, signal: AbortSignal): Promise<Result<ConnectorResponse>> {
    return tryCatch(async () => {
      if (!this.started) throw new Error('Dispatcher not started');
      if (signal.aborted) throw new Error('Send aborted');

      // No retry can change the message or the setting, and a queue would wait behind it for ever (D-400).
      const refused = refusedContent(message.content, this.config);
      if (refused !== null) return { status: 'ERROR' as const, content: '', errorMessage: `${refused}, so nothing was sent`, final: true as const };

      const { url, headers } = this.request(message);
      const timeoutSignal = AbortSignal.timeout(this.config.timeout);
      const combinedSignal = AbortSignal.any([signal, timeoutSignal]);

      const response = await fetch(url, {
        method: this.config.method,
        headers,
        body: message.content,
        signal: combinedSignal,
        // Never follow a redirect: fetch would re-send the POST as a body-less
        // GET, the server would answer 200, and nothing would be created (#163).
        redirect: 'manual',
      });

      const responseBody = answerText({
        status: response.status,
        contentType: response.headers.get('content-type'),
        bytes: new Uint8Array(await response.arrayBuffer()),
      }, message, this.logger);

      if (response.status >= 300 && response.status < 400) {
        return {
          status: 'ERROR' as const,
          content: responseBody,
          errorMessage: redirectMessage(response.status, response.headers.get('location')),
        };
      }
      if (response.ok) {
        return { status: 'SENT' as const, content: responseBody };
      }
      return {
        status: 'ERROR' as const,
        content: responseBody,
        errorMessage: `FHIR ${String(response.status)}: ${response.statusText}`,
      };
    });
  }

  /** Throws for a request that cannot be made: a PUT without an id, or a URL or header that would quote a credential. */
  private request(message: ConnectorMessage): { readonly url: string; readonly headers: Record<string, string> } {
    // R4 servers reject a bare `PUT /{type}`: an update targets /{type}/{id}.
    const resourceId = this.config.method === 'PUT' ? extractResourceId(message.content, this.config.format) : undefined;
    if (this.config.method === 'PUT' && !resourceId) {
      throw new Error('FHIR PUT requires a resource id in the message body');
    }
    const url = buildFhirUrl(fillVariables(this.config.baseUrl, message), this.config.resourceType, resourceId);
    const headers = buildHeaders({
      ...this.config,
      headers: Object.fromEntries(Object.entries(this.config.headers).map(([name, value]) => [name, fillVariables(value, message)])),
    });
    refuseQuotedCredentials(new URL(url), headers);
    return { url, headers };
  }

  async onStop(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.started = false;
    });
  }

  async onHalt(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.started = false;
    });
  }

  async onUndeploy(): Promise<Result<void>> {
    return tryCatch(async () => {
      this.started = false;
    });
  }
}

/** A resource type as FHIR names one; a setting of another form is an operation or a path, such as `$process-message`. */
const RESOURCE_TYPE_RE = /^[A-Z][A-Za-z]+$/;

const FHIR_NAMESPACE = 'http://hl7.org/fhir';

/**
 * The root start tag of an XML resource is looked for in this much of the content. Message content comes from
 * outside: the scan is linear, and bounded so that no content can make it slow.
 */
const XML_HEAD_CHARS = 8_192;
const XML_NAME_CHAR_RE = /[\w.:-]/;
/** An attribute that declares a namespace: `xmlns` or `xmlns:<prefix>`, and its quoted value. */
const XMLNS_RE = /(?:^|\s)xmlns(?::([\w.-]+))?\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** The resource's own type, or null when the content is not a FHIR resource in that format. */
export function resourceTypeOf(content: string, format: 'json' | 'xml'): string | null {
  const text = content.startsWith('\uFEFF') ? content.slice(1) : content;
  if (format === 'xml') return xmlRootType(text.slice(0, XML_HEAD_CHARS));
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isPlainObject(parsed)) return null;
    const type = parsed['resourceType'];
    return typeof type === 'string' && RESOURCE_TYPE_RE.test(type) ? type : null;
  } catch {
    return null;
  }
}

/** The root element's name when it is in the FHIR namespace, after white space, the XML declaration and comments. */
function xmlRootType(head: string): string | null {
  let at = 0;
  for (;;) {
    while (at < head.length && /\s/.test(head[at] ?? '')) at += 1;
    const close = head.startsWith('<?', at) ? '?>' : head.startsWith('<!--', at) ? '-->' : null;
    if (close === null) break;
    const end = head.indexOf(close, at);
    if (end === -1) return null;
    at = end + close.length;
  }
  if (head[at] !== '<') return null;
  let nameEnd = at + 1;
  while (nameEnd < head.length && XML_NAME_CHAR_RE.test(head[nameEnd] ?? '')) nameEnd += 1;
  const tagEnd = head.indexOf('>', nameEnd);
  if (tagEnd === -1) return null;
  const [prefix, name] = splitQName(head.slice(at + 1, nameEnd));
  if (!RESOURCE_TYPE_RE.test(name)) return null;
  for (const [, declaredPrefix, double, single] of head.slice(nameEnd, tagEnd).matchAll(XMLNS_RE)) {
    if (declaredPrefix === prefix && (double ?? single) === FHIR_NAMESPACE) return name;
  }
  return null;
}

function splitQName(qname: string): [string | undefined, string] {
  const colon = qname.indexOf(':');
  return colon === -1 ? [undefined, qname] : [qname.slice(0, colon), qname.slice(colon + 1)];
}

/** Why the content is not sent, or null: a server takes the type in the URL as given and may store content that is no FHIR. */
function refusedContent(content: string, config: Pick<FhirDispatcherConfig, 'format' | 'resourceType'>): string | null {
  const type = resourceTypeOf(content, config.format);
  if (type === null) return `The message is not a FHIR resource in ${config.format.toUpperCase()}`;
  if (RESOURCE_TYPE_RE.test(config.resourceType) && type !== config.resourceType) {
    return `The message is a resource of type ${type}, and this destination sends ${config.resourceType}`;
  }
  return null;
}

/** The FHIR spec's logical id grammar. */
const FHIR_ID_RE = /^[A-Za-z0-9\-.]{1,64}$/;

/** The id comes from message content: validated so `/`, `?` or `..` cannot rewrite the request path. */
export function buildFhirUrl(baseUrl: string, resourceType: string, resourceId?: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  if (resourceId !== undefined) {
    if (!FHIR_ID_RE.test(resourceId)) {
      throw new Error(`Invalid FHIR resource id: ${resourceId}`);
    }
    return `${base}/${resourceType}/${resourceId}`;
  }
  return `${base}/${resourceType}`;
}

export function extractResourceId(content: string, format: 'json' | 'xml'): string | undefined {
  if (format === 'json') {
    try {
      const parsed = JSON.parse(content) as { id?: unknown };
      return typeof parsed.id === 'string' && parsed.id.length > 0 ? parsed.id : undefined;
    } catch {
      return undefined;
    }
  }
  const match = /<id\b[^>]*\bvalue\s*=\s*"([^"]+)"/.exec(content);
  return match?.[1];
}

export function buildHeaders(config: FhirDispatcherConfig): Record<string, string> {
  const contentType = config.format === 'json'
    ? 'application/fhir+json'
    : 'application/fhir+xml';

  const accept = config.format === 'json'
    ? 'application/fhir+json'
    : 'application/fhir+xml';

  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Accept': accept,
    ...config.headers,
  };

  const auth = config.authConfig;
  switch (config.authType) {
    case FHIR_AUTH_TYPE.BASIC:
      if (auth.username && auth.password) {
        headers['Authorization'] = `Basic ${btoa(`${auth.username}:${auth.password}`)}`;
      }
      break;
    case FHIR_AUTH_TYPE.BEARER:
      if (auth.token) {
        headers['Authorization'] = `Bearer ${auth.token}`;
      }
      break;
    case FHIR_AUTH_TYPE.API_KEY:
      if (auth.headerName && auth.apiKey) {
        headers[auth.headerName] = auth.apiKey;
      }
      break;
    case FHIR_AUTH_TYPE.NONE:
      break;
  }

  return headers;
}

function validateAuth(authType: FhirAuthType, authConfig: FhirAuthConfig): void {
  switch (authType) {
    case FHIR_AUTH_TYPE.BASIC:
      if (!authConfig.username || !authConfig.password) {
        throw new Error('Basic auth requires username and password');
      }
      break;
    case FHIR_AUTH_TYPE.BEARER:
      if (!authConfig.token) {
        throw new Error('Bearer auth requires a token');
      }
      break;
    case FHIR_AUTH_TYPE.API_KEY:
      if (!authConfig.headerName || !authConfig.apiKey) {
        throw new Error('API key auth requires headerName and apiKey');
      }
      break;
    case FHIR_AUTH_TYPE.NONE:
      break;
  }
}
