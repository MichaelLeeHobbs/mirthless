# Quickstart: Create Your First Channel

This walkthrough builds a working channel end to end: it receives an HL7v2 message
over TCP/MLLP, transforms it, writes it to a file, and confirms the message flowed.
Allow about 10 minutes.

## Prerequisites

- Mirthless running (`pnpm dev`, or the Docker prod stack — see the repo README).
- The web UI open at `http://localhost:5173` (dev) or your deployed URL.
- Logged in. The seeded admin account is `admin` / `Admin123!` — change this password.

## 1. Create the channel

1. Go to **Channels** in the left navigation and click **New Channel**.
2. Give it a name, e.g. `Quickstart ADT`. New channels start **undeployed** and are
   added to the **Default** group automatically.
3. You land in the channel editor, which has tabs for **Source**, **Destinations**,
   **Transformers/Filters**, **Scripts**, and **Settings**.

## 2. Configure the source connector

The source is the inbound side — where messages arrive.

1. On the **Source** tab, choose connector type **TCP_MLLP**.
2. Set the key fields:
   - **Port** — the TCP port to listen on, e.g. `6661`.
   - **Host** — leave `0.0.0.0` to listen on all interfaces.
3. Use **Test Connection** to sanity-check the binding, then save.

See the [Connector Reference](./connector-reference.md) for every source type and its
settings.

## 3. Add a transformer

Transformers are JavaScript/TypeScript steps that reshape the message. Inbound HL7 is
parsed automatically, so `msg` is already an HL7 message object.

1. Open the **Transformers/Filters** tab and add a **source transformer** step.
2. Example — stamp a value into the channel map and normalize a field:

   ```js
   // Read the patient ID from PID-3 and stash it for later steps
   channelMap.patientId = msg.get('PID.3.1');

   // Force the message type visible in the message browser
   logger.info('Processing ' + msg.get('MSH.9.1') + '^' + msg.get('MSH.9.2'));
   ```

3. Filters live on the same tab. A filter returns a boolean — return `false` to drop
   the message. Leave filters empty to accept everything.

The full scripting surface (`msg`, the maps, `parseHL7`, `createACK`, `logger`, the
`$` shortcuts) is documented in the [Scripting API](./scripting-api.md).

## 4. Add a destination connector

The destination is the outbound side — where transformed messages go.

1. Open the **Destinations** tab and add a destination.
2. Choose connector type **FILE**.
3. Set the key fields:
   - **Directory** — an output folder the server can write to, e.g. `/tmp/mirthless-out`.
   - **Output Pattern** — file name template, e.g. `${messageId}.hl7`.
4. Each destination can have its own transformer/filter. For now leave them empty so the
   message is written as received.

## 5. Deploy

1. Click **Deploy** (or **Save & Deploy**). Deployment validates the connectors and
   starts the channel runtime; the source begins listening.
2. The channel state moves to **STARTED**. If validation fails, the error is surfaced —
   fix it and redeploy. Deployment fails loud rather than starting a broken channel.

## 6. Send a test message

Send an HL7v2 message to the source port. From a shell with the MLLP framing bytes:

```bash
# 0x0B ... 0x1C 0x0D are the MLLP start/end framing bytes
printf '\x0bMSH|^~\\&|SENDER|FAC|RECEIVER|FAC|20260101120000||ADT^A01|MSG0001|P|2.3\rPID|1||12345^^^MRN||DOE^JANE\r\x1c\x0d' | nc localhost 6661
```

You can also point any HL7 sending application at `localhost:6661`.

## 7. Confirm the flow

1. Open **Message Browser** for the channel (or the dashboard **Messages** view).
2. You should see one message with a **RECEIVED → TRANSFORMED → SENT** progression.
   The dashboard updates in real time over WebSocket.
3. Check the output directory — a file named after the message ID should contain the
   HL7 payload.
4. Open the message to inspect its content at each pipeline stage, the maps, and any
   `logger` output from your transformer.

## Next steps

- Swap the destination for **HTTP**, **DATABASE**, **FHIR**, or **CHANNEL** to route
  onward — see the [Connector Reference](./connector-reference.md).
- Add **Code Templates** (reusable functions) and reference them from transformers.
- Configure **Alerts** to notify on channel errors.
