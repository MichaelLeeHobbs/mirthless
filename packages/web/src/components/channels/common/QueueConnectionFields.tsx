// ===========================================
// Kafka and AMQP Connection Fields
// ===========================================
// Broker address, credentials and TLS, shared by the Kafka and AMQP source and
// destination forms.

import type { ReactNode } from 'react';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import { CertificateSelect } from './CertificateSelect.js';
import { getStr, getNum, getBool, getTlsStr, getTlsBool, propertyUpdaters } from './connector-properties.js';

interface FieldsProps {
  readonly properties: Record<string, unknown>;
  readonly onChange: (properties: Record<string, unknown>) => void;
}

const SASL_MECHANISMS = [
  { value: 'NONE', label: 'None' },
  { value: 'PLAIN', label: 'PLAIN' },
  { value: 'SCRAM-SHA-256', label: 'SCRAM-SHA-256' },
  { value: 'SCRAM-SHA-512', label: 'SCRAM-SHA-512' },
] as const;

/** Bootstrap brokers, client id and SASL login. */
export function KafkaConnectionFields({ properties, onChange }: FieldsProps): ReactNode {
  const { handleText } = propertyUpdaters(properties, onChange);
  const sasl = getStr(properties, 'saslMechanism', 'NONE');
  return (
    <>
      <TextField
        label="Brokers"
        value={getStr(properties, 'brokers', '')}
        onChange={handleText('brokers')}
        helperText="host:port, comma separated (e.g. kafka-1:9092,kafka-2:9092)"
        fullWidth
        sx={{ mb: 2 }}
      />
      <TextField
        label="Client ID"
        value={getStr(properties, 'clientId', 'galvaniflow')}
        onChange={handleText('clientId')}
        helperText="Shown in broker logs and quotas"
        fullWidth
        sx={{ mb: 2 }}
      />
      <TextField
        label="SASL Mechanism"
        value={sasl}
        onChange={handleText('saslMechanism')}
        select
        fullWidth
        sx={{ mb: 2 }}
      >
        {SASL_MECHANISMS.map((m) => <MenuItem key={m.value} value={m.value}>{m.label}</MenuItem>)}
      </TextField>
      {sasl !== 'NONE' && (
        <>
          <TextField
            label="SASL Username"
            value={getStr(properties, 'saslUsername', '')}
            onChange={handleText('saslUsername')}
            autoComplete="off"
            fullWidth
            sx={{ mb: 2 }}
          />
          <TextField
            label="SASL Password"
            type="password"
            value={getStr(properties, 'saslPassword', '')}
            onChange={handleText('saslPassword')}
            autoComplete="new-password"
            fullWidth
            sx={{ mb: 2 }}
          />
        </>
      )}
    </>
  );
}

/** Broker host, port, virtual host and login. */
export function AmqpConnectionFields({ properties, onChange }: FieldsProps): ReactNode {
  const { handleText, handleNumber } = propertyUpdaters(properties, onChange);
  return (
    <>
      <TextField
        label="Host"
        value={getStr(properties, 'host', '')}
        onChange={handleText('host')}
        helperText="RabbitMQ (AMQP 0-9-1) broker hostname or IP"
        fullWidth
        sx={{ mb: 2 }}
      />
      <TextField
        label="Port"
        type="number"
        value={getNum(properties, 'port', 5672)}
        onChange={handleNumber('port')}
        helperText="5672 plain, 5671 with TLS"
        fullWidth
        sx={{ mb: 2 }}
        slotProps={{ htmlInput: { min: 1, max: 65535 } }}
      />
      <TextField
        label="Virtual Host"
        value={getStr(properties, 'vhost', '/')}
        onChange={handleText('vhost')}
        fullWidth
        sx={{ mb: 2 }}
      />
      <TextField
        label="Username"
        value={getStr(properties, 'username', '')}
        onChange={handleText('username')}
        autoComplete="off"
        fullWidth
        sx={{ mb: 2 }}
      />
      <TextField
        label="Password"
        type="password"
        value={getStr(properties, 'password', '')}
        onChange={handleText('password')}
        autoComplete="new-password"
        fullWidth
        sx={{ mb: 2 }}
      />
    </>
  );
}

/** TLS on/off, with the CA and client certificate chosen from the certificate store. */
export function QueueTlsFields({ properties, onChange }: FieldsProps): ReactNode {
  const { updateTls, handleBool } = propertyUpdaters(properties, onChange);
  const useTls = getBool(properties, 'useTls', false);
  return (
    <>
      <FormControlLabel
        control={<Switch checked={useTls} onChange={handleBool('useTls')} />}
        label="Use TLS"
        sx={{ mb: 1, display: 'block' }}
      />
      {useTls && (
        <>
          <CertificateSelect
            label="Trust CA"
            type="CA"
            value={getTlsStr(properties, 'caCertId') || undefined}
            onChange={(id) => { updateTls('caCertId', id ?? ''); }}
            helperText="CA that signed the broker certificate (optional; the system CAs otherwise)"
          />
          <CertificateSelect
            label="Client certificate (mTLS)"
            requirePrivateKey
            value={getTlsStr(properties, 'clientCertId') || undefined}
            onChange={(id) => { updateTls('clientCertId', id ?? ''); }}
            helperText="Client certificate + key for mutual TLS (optional)"
          />
          <FormControlLabel
            control={(
              <Switch
                checked={getTlsBool(properties, 'rejectUnauthorized', true)}
                onChange={(e) => { updateTls('rejectUnauthorized', e.target.checked); }}
              />
            )}
            label="Reject unauthorized certificates"
          />
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5, mb: 1 }}>
            Keep enabled. Disabling skips broker certificate verification (insecure — audited exceptions only).
          </Typography>
        </>
      )}
    </>
  );
}
