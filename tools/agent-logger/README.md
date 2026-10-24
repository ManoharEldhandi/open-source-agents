# Agent Logger

A framework-neutral TypeScript SDK for private, local agent logs. Wrap existing
functions, async streams, model calls, retrieval steps, or workflow callbacks.
An optional Google ADK plugin handles its callbacks automatically. No collector,
account, or API key is needed for logging. The core has zero runtime dependencies.

## Quick start

Requires Node.js 22.13+ and npm. From this repository:

```sh
cd tools/agent-logger
npm ci
npm run check
npm run demo
```

The demo runs a real ADK runner with a scripted offline model and a weather
fixture tool. It makes no network requests and spends no AI credits. It prints
a JSONL file path and delivery counters. Open that file with:

```sh
node dist/cli.js view .agent-logs/<printed-file-name>.jsonl
```

Example output (timings vary):

```text
Bengaluru: 25°C, clear.
```

The log includes a run, an agent scope, two model calls, one `get_weather` tool
call, and their terminal outcomes. Token counters in this offline example are
fixture values, not billed Gemini usage.

## Install in another project

This package is ready to pack; it has not been published to npm.

```sh
# In tools/agent-logger:
npm pack

# In your application:
npm install ../open-source-agents/tools/agent-logger/meldhandi-agent-logger-0.1.0.tgz
```

The core SDK has no runtime dependencies. Install `@google/adk@2.3.0` separately
only when using the ADK plugin. Exports are ESM; CommonJS applications can use
`await import('@meldhandi/agent-logger')`. A native `require()` build and browser
runtime are not provided.

## Wrap your own tools

```ts
import { createAgentLogger } from '@meldhandi/agent-logger';

const logger = await createAgentLogger();
const search = logger.wrapTool('search', async (query: string) => ({
  matches: [query],
}));

try {
  await logger.run('research', () => search('Google ADK'));
} finally {
  const delivery = await logger.close();
  if (!delivery.success) console.warn('Incomplete log:', delivery);
}
```

Wrappers preserve arguments, `this`, return values, and thrown errors. They
return promises, including when the original function is synchronous. Nested
calls share a run ID; concurrent runs keep separate parents.

Use `logger.wrap(name, kind, fn)` for other operation types. Kinds are `run`,
`agent`, `model`, `tool`, `workflow`, `retrieval`, `embedding`, `memory`, and `custom`.
This works with Node.js/TypeScript systems that expose functions or callbacks;
it does not automatically observe arbitrary processes or Python agents.

## Models and streams

Record provider usage from the actual response, independently of the model SDK:

```ts
const answer = await logger.trace(
  'generate',
  'model',
  async (span) => {
    const response = await yourModelClient.generate(prompt);
    span.recordUsage('gemini', response);
    return response.text;
  },
  { input: prompt },
);
```

`recordUsage()` supports Gemini GenerateContent, OpenAI Responses/Chat Completions,
and Anthropic Messages shapes. Missing counters stay unavailable; no total or
price is invented. Repeated cumulative updates replace earlier usage for that
span rather than double counting. `normalizeUsage()` is also exported separately.

```ts
for await (const chunk of logger.stream('answer', 'model', yourAsyncStream)) {
  // Original chunks pass through unchanged; display or process them here.
}
```

Streams start lazily, retain context for nested tools, close the source iterator
on early consumer exit, and record interruption or the original source failure.
Use an optional `onChunk(chunk, span)` callback to report terminal provider usage.
Hook failures become a capture-gap marker and do not replace the source result.
For selected visible streamed text, call `span.captureOutput(text)` from the
source factory or chunk hook. It respects `captureContent` and storage bounds;
arbitrary chunks and provider-hidden reasoning are never captured automatically.

## Story agent and external repositories

```sh
npm run demo:story
npm run demo:story -- --repo ../your-project
```

The story example uses Google's Gemini SDK directly, with no ADK dependency in
its agent workflow. It records the prompt, visible story, model timing, provider
usage, and a real word-count tool. It explicitly enables local content capture.
With `--repo`, it reads only bounded public README/package excerpts and uses them
as background context. Subject files stay unchanged and `.env` is never read.

## Google ADK

Register the plugin on your existing runner:

```ts
import { InMemorySessionService, Runner } from '@google/adk';
import { createAgentLogger } from '@meldhandi/agent-logger';
import { AgentLoggerPlugin } from '@meldhandi/agent-logger/adk';

const logger = await createAgentLogger();
const plugin = new AgentLoggerPlugin(logger);
const runner = new Runner({
  appName: 'my_app',
  agent: yourAgent,
  sessionService: new InMemorySessionService(),
  plugins: [plugin],
  autoCreateSession: true,
});

try {
  for await (const event of runner.runAsync({
    userId: 'user1',
    sessionId: 'session1',
    newMessage: { role: 'user', parts: [{ text: 'Hello' }] },
  })) {
    // Handle the original ADK event here.
  }
} finally {
  const delivery = await plugin.close();
  if (!delivery.success) console.warn('Incomplete log:', delivery);
}
```

Call `close()` at application shutdown, after all runs finish. It drains writes
and marks abandoned spans interrupted. The plugin observes callbacks and never
replaces an ADK result or error response. Agent scopes group observed callbacks;
their duration is that observed interval, not independently measured agent execution.

For a real Gemini model:

```sh
cp .env.example .env
# Set GOOGLE_API_KEY in .env. GEMINI_MODEL is optional.
npm run demo:gemini
```

Gemini requests send the example prompt to Google and may incur API charges. The
weather tool still uses fixture data. This live example requires your own key.
It defaults to `gemini-3.5-flash-lite` and permits at most four model calls in a
60-second run. Provider errors print a safe explanation and exit nonzero;
successful log delivery does not imply a successful model request. HTTP 404
with an older model can indicate restricted model access for a new API project;
see Google's [model availability notes](https://ai.google.dev/gemini-api/docs/models).

## Configuration and API

| Setting            | Default          | Purpose                                                               |
| ------------------ | ---------------- | --------------------------------------------------------------------- |
| `directory`        | `.agent-logs`    | Private local log directory; existing directories must be mode `0700` |
| `captureContent`   | `false`          | Opt into redacted explicit inputs and outputs                         |
| `maxPendingEvents` | `256`            | Bound asynchronous write queue                                        |
| `maxActiveSpans`   | `1024`           | Bound concurrent span tracking                                        |
| `maxFileBytes`     | `16777216`       | Stop writing at the per-file byte limit                               |
| `writeTimeoutMs`   | `2000`           | Bound each sink write/close; a timed-out sink is no longer written to |
| `sink`             | Local JSONL file | Inject a `LogSink` with `write(event)` and optional `close()`         |
| `onDiagnostic`     | None             | Receive error codes without sensitive error messages                  |

- `logger.run(name, operation)` records a root operation and its result status.
- `logger.wrapTool(name, function)` creates an instrumented async tool.
- `logger.wrap(name, kind, function)` instruments any ordinary function.
- `logger.stream(name, kind, source, options)` instruments an async iterable.
- `logger.trace(name, kind, operation, options)` records a model/tool/agent operation.
- `logger.startSpan(name, kind, options)` supports callback integrations; call `end()`.
- `span.setAttributes(metadata)` adds explicit, redacted metadata such as reported usage.
- `logger.flush()` drains the current queue. `logger.close()` also syncs and closes storage.
- `readLog(path)` returns version-1 events from a closed JSONL file, up to 64 MiB.

Inspect `success`, `written`, `failed`, `dropped`, and `pending` delivery counters.
Storage errors and queue overflow leave the agent running but make delivery
unsuccessful. Every event has a sequence, timestamp, run/span IDs, kind, name,
phase, optional status/duration, and sanitized data. Missing usage is omitted;
token totals are never estimated.
Sink operations have a timeout. A timed-out write has an unknown storage outcome;
the SDK never retries it or the agent action. Create a new logger after repairing
the sink. Always close the logger after application work finishes; attempts to
record after close produce a diagnostic and drop counter.

## Security and limits

Logs use private `0600` files in a `0700` directory. Creation rejects a symlink
output directory and exclusively creates a random filename. Keep parent directories
under your control. Names and explicitly supplied metadata can be sensitive.

Content capture is off by default. When enabled, sensitive fields, common API keys,
bearer tokens, private keys, and reasoning fields are filtered before queuing.
Thought-marked ADK parts are excluded. Nested data, strings, and collection sizes
are bounded; raw errors, binary values, getters, and unsupported objects are omitted.
Redaction is best effort: do not intentionally log credentials or confidential data.

This SDK records instrumented operations only. `completed` describes an operation
returning, not task correctness. ADK errors retain ADK's recovery behavior. Call
`plugin.close()` to finalize abandoned ADK invocations. Generic streams finalize
their spans automatically on iterator exit. At 128 retained ADK
invocations, the oldest is marked interrupted with a capture-gap marker. Live
bidirectional sessions and full streamed-text reconstruction are not supported.

Pending events may be lost on process crash. The per-file limit is not retention
management: remove old files according to your own retention needs. Tested on
macOS with Node.js 22.13.0 and 26.3.0; Windows permissions and filesystem flags are untested. The development
lockfile pins a fixed UUID dependency for ADK's older HTTP dependency; an application's
ADK dependency tree is managed by that application.

## Verify and package

```sh
npm run check          # Prettier, ESLint, strict types, tests, and build
npm audit
npm pack              # Repeats checks; includes dist, README, and MIT license
npm run release:check  # Also tests the packed SDK, types, CLI, and ADK in a fresh app
```

Tests cover an actual offline ADK run, concurrent contexts, provider usage, model
and tool failures, original error identity, redaction, private files, queue limits,
the log reader/viewer, generic workflows, streams, sink timeouts, and story-agent
integration. Examples and tests stay outside the published SDK. See
[RELEASING.md](RELEASING.md) for reproducible package/repository tests, failure
decisions, npm login, scope selection, and publication commands.
The release check also scans Git candidates for credentials and private machine
paths. Local logs, environment files, build outputs, and npm archives are ignored
by Git. npm includes only JavaScript, type declarations, public documentation,
license, and metadata; source maps are excluded.

## License

MIT. See [LICENSE](LICENSE).

ADK integration follows Google's [plugin API](https://adk.dev/plugins/) and
[TypeScript reference](https://adk.dev/api-reference/typescript/classes/BasePlugin.html).
