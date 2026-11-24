import type { Pattern } from '../types';

// Identity & authorization patterns for agents. All hosts, IDs and tokens are fictional.

export const IDENTITY_PATTERNS: Pattern[] = [
  // ---------------------------------------------------------------------------
  {
    id: 'mcp-oauth',
    category: 'identity',
    title: 'MCP authorization (OAuth 2.1)',
    tagline: 'The MCP server is a protected resource; tokens must be minted for it and only it.',
    summary:
      'An HTTP-based MCP server acts as an OAuth 2.1 resource server. A client without a token gets a 401 whose WWW-Authenticate header points at Protected Resource Metadata (RFC 9728), which names the authorization server. The client runs authorization code + PKCE and sends a resource indicator (RFC 8707) so the token audience is the MCP server. The server must reject tokens not issued for it, and must never forward the client\'s token downstream: if it needs to call another API it gets its own token.',
    whenToUse: [
      'Any remote (HTTP transport) MCP server that exposes user data or actions.',
      'When MCP clients are third-party hosts you do not control and must discover your authorization server at runtime.',
    ],
    risks: [
      'Token passthrough: forwarding the client token downstream breaks audience boundaries and produces a confused deputy.',
      'Missing audience validation lets a token minted for one MCP server be replayed at another.',
      'Dynamic client registration with open registration lets anyone create a client; pair it with consent screens that show the client identity clearly.',
      'Static client IDs shared by a proxy MCP server can be abused to skip consent (the confused-deputy case in the security best practices).',
    ],
    actors: [
      { id: 'user', label: 'User', kind: 'user', sub: 'jane@example.com' },
      { id: 'client', label: 'MCP client', kind: 'client', sub: 'agent host' },
      { id: 'mcp', label: 'MCP server', kind: 'mcp', sub: 'mcp.example.com' },
      { id: 'as', label: 'Authorization server', kind: 'idp', sub: 'auth.example.com' },
      { id: 'api', label: 'Downstream API', kind: 'tool', sub: 'api.example.com' },
    ],
    variants: [
      {
        id: 'spec-flow',
        label: 'Spec flow (audience-bound)',
        tone: 'good',
        outcome: 'The client discovers the authorization server from the 401, gets a token whose audience is the MCP server, and the MCP server uses its own credential downstream.',
        steps: [
          {
            from: 'client', to: 'mcp', kind: 'call', label: 'POST /mcp tools/call (no token)',
            detail: 'The first request carries no Authorization header. The client does not need to know in advance which authorization server protects this MCP server.',
          },
          {
            from: 'mcp', to: 'client', kind: 'block', label: '401 + resource_metadata',
            detail: 'The server must return 401 with a WWW-Authenticate header pointing at its Protected Resource Metadata document. This is the discovery hook; nothing is hard-coded in the client.',
            payload: 'HTTP/1.1 401 Unauthorized\nWWW-Authenticate: Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource"',
          },
          {
            from: 'client', to: 'mcp', kind: 'call', label: 'GET protected resource metadata',
            detail: 'RFC 9728 metadata lists the authorization servers the resource trusts and its canonical resource identifier, which the client will use as the resource indicator.',
            payload: '{\n  "resource": "https://mcp.example.com/mcp",\n  "authorization_servers": ["https://auth.example.com"],\n  "scopes_supported": ["files:read", "files:write"]\n}',
          },
          {
            from: 'client', to: 'as', kind: 'call', label: 'GET AS metadata (RFC 8414)',
            detail: 'The client fetches the authorization server metadata (OAuth 2.0 AS metadata or OpenID discovery) to find the authorize, token and optional registration endpoints.',
          },
          {
            from: 'client', to: 'as', kind: 'call', label: 'register client (optional DCR)',
            detail: 'Because MCP clients and servers often meet for the first time at runtime, dynamic client registration (RFC 7591) is supported. Preregistered or metadata-document client IDs avoid an open registration endpoint.',
          },
          {
            from: 'client', to: 'user', kind: 'call', label: 'open /authorize in browser',
            detail: 'Authorization code with PKCE (S256) is mandatory. The resource parameter names the MCP server so the authorization server can mint an audience-restricted token.',
            payload: 'GET https://auth.example.com/authorize?response_type=code\n  &client_id=11111111-1111-1111-1111-111111111111\n  &redirect_uri=http://127.0.0.1:33418/callback\n  &code_challenge=…&code_challenge_method=S256\n  &scope=files:read\n  &resource=https%3A%2F%2Fmcp.example.com%2Fmcp\n  &state=…',
          },
          {
            from: 'user', to: 'as', kind: 'approval', label: 'sign in + consent',
            detail: 'The user authenticates and approves the scopes for this client. The consent screen is the only place the user sees which client is asking, so it must show the client identity, not only the server name.',
          },
          {
            from: 'as', to: 'client', kind: 'token', label: 'code -> token (aud = MCP server)',
            detail: 'The client redeems the code with the PKCE verifier and repeats the resource parameter. The audience is the MCP server, so the token is useless at any other resource server that checks aud.',
            payload: '{\n  "iss": "https://auth.example.com",\n  "sub": "jane@example.com",\n  "aud": "https://mcp.example.com/mcp",\n  "client_id": "11111111-1111-1111-1111-111111111111",\n  "scope": "files:read",\n  "exp": 1767225600\n}',
          },
          {
            from: 'client', to: 'mcp', kind: 'call', label: 'tools/call + Bearer token',
            detail: 'Every HTTP request carries the token in the Authorization header, never in the query string.',
          },
          {
            from: 'mcp', to: 'mcp', kind: 'think', label: 'validate iss, aud, exp, scope',
            detail: 'The server must reject tokens whose audience is not itself. This is the check that stops a token minted for a different MCP server being replayed here.',
          },
          {
            from: 'mcp', to: 'api', kind: 'call', label: 'call API with its own token',
            detail: 'If the tool needs a downstream API, the MCP server acts as a separate OAuth client (its own credential, OBO or token exchange). The downstream audit log names the MCP server as the client.',
          },
          {
            from: 'api', to: 'mcp', kind: 'data', label: 'files list',
            detail: 'The downstream API saw a token issued for it, so its own audience, scope and rate-limit checks all apply.',
          },
          {
            from: 'mcp', to: 'client', kind: 'return', label: 'tool result',
            detail: 'The result goes back to the client and then into the model context as untrusted data.',
          },
        ],
      },
      {
        id: 'passthrough',
        label: 'Token passthrough (forbidden)',
        tone: 'bad',
        outcome: 'The MCP server forwards whatever token it received; the downstream API cannot tell who is calling or whether the token was meant for it.',
        steps: [
          {
            from: 'client', to: 'as', kind: 'call', label: 'request token for the API',
            detail: 'The client asks for a token whose audience is the downstream API, not the MCP server, because the MCP server will simply forward it.',
          },
          {
            from: 'as', to: 'client', kind: 'token', label: 'token (aud = api.example.com)',
            detail: 'The token was issued for the API. The MCP server is not named anywhere in it.',
            payload: '{\n  "sub": "jane@example.com",\n  "aud": "https://api.example.com",\n  "scope": "files:read files:write",\n  "client_id": "11111111-1111-1111-1111-111111111111"\n}',
          },
          {
            from: 'client', to: 'mcp', kind: 'call', label: 'tools/call + API token',
            detail: 'The MCP server accepts a token that was not issued for it. It cannot enforce its own scopes or rate limits because the token describes another resource.',
          },
          {
            from: 'mcp', to: 'api', kind: 'attack', label: 'forward same Bearer token',
            detail: 'The server becomes a confused deputy: it lends its network position and trust to whatever token arrives. The spec forbids this outright.',
            payload: 'GET /v1/files HTTP/1.1\nHost: api.example.com\nAuthorization: Bearer eyJ…(client token, unchanged)',
          },
          {
            from: 'api', to: 'mcp', kind: 'data', label: '200 files list',
            detail: 'The API accepts it because aud matches. Its audit log shows the original client ID, so the MCP server is invisible in the trail and any controls it was meant to apply were skipped.',
          },
          {
            from: 'api', to: 'api', kind: 'think', label: 'audit: caller = client, not MCP',
            detail: 'Incident responders cannot tell whether a request came straight from the client or through the MCP server. Revoking the MCP server does nothing because it never had its own credential.',
          },
          {
            from: 'mcp', to: 'client', kind: 'return', label: 'tool result',
            detail: 'Everything worked, which is why passthrough survives code review. The failure shows up only when a stolen token is replayed or an incident needs attribution.',
          },
        ],
      },
    ],
    sources: [
      { title: 'MCP specification 2025-06-18: Authorization', url: 'https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization' },
      { title: 'MCP specification 2025-06-18: Security best practices', url: 'https://modelcontextprotocol.io/specification/2025-06-18/basic/security_best_practices' },
      { title: 'RFC 9728: OAuth 2.0 Protected Resource Metadata', url: 'https://www.rfc-editor.org/rfc/rfc9728' },
      { title: 'RFC 8707: Resource Indicators for OAuth 2.0', url: 'https://www.rfc-editor.org/rfc/rfc8707' },
    ],
    verify: [
      'Later spec revisions (2025-11-25 onward) add client ID metadata documents as the preferred registration method and demote dynamic client registration; check the current revision before relying on DCR.',
      'Scope selection rules (scope in WWW-Authenticate, step-up on 403 insufficient_scope) changed after 2025-06-18.',
    ],
    tags: ['MCP', 'OAuth 2.1', 'PKCE', 'RFC 9728', 'RFC 8707', 'confused deputy'],
  },

  // ---------------------------------------------------------------------------
  {
    id: 'mcp-url-elicitation',
    category: 'identity',
    title: 'MCP URL-mode elicitation',
    tagline: 'Send the user to a URL for third-party consent; the token never touches the client or model.',
    summary:
      'Some MCP tools need a credential for a third-party service the MCP client knows nothing about. URL-mode elicitation (spec 2025-11-25, SEP-1036) lets the server ask the client to open a URL; the user completes OAuth consent directly with the third party in the browser, and the resulting token is stored at the MCP server, bound to that user. Form-mode elicitation returns user input through the client and the model context, so it must never be used to collect passwords, API keys or tokens.',
    whenToUse: [
      'An MCP server that calls a third-party API on behalf of the user and needs that user\'s consent.',
      'Any out-of-band interaction (payment, sign-in, sensitive confirmation) whose data must not pass through the MCP client.',
    ],
    risks: [
      'Phishing: a malicious server can send any URL. Clients must show the full domain and require explicit user consent before opening it.',
      'Session binding: the server must check that the user who completes consent is the same user who made the MCP request, or an attacker can attach their own account to a victim session (or the reverse).',
      'Using form mode for secrets puts the credential into the client, the transcript and possibly model context and logs.',
    ],
    actors: [
      { id: 'user', label: 'User', kind: 'user', sub: 'jane@example.com' },
      { id: 'client', label: 'MCP client', kind: 'client', sub: 'agent host + model' },
      { id: 'mcp', label: 'MCP server', kind: 'mcp', sub: 'mcp.example.com' },
      { id: 'browser', label: 'Browser', kind: 'client', sub: 'system browser' },
      { id: 'third', label: 'Third-party AS', kind: 'idp', sub: 'calendar.example.com' },
      { id: 'vault', label: 'Server token store', kind: 'vault', sub: 'per-user tokens' },
    ],
    variants: [
      {
        id: 'url-mode',
        label: 'URL mode (out of band)',
        tone: 'good',
        outcome: 'The third-party token is issued to and stored by the MCP server; the client only ever saw a URL.',
        steps: [
          {
            from: 'client', to: 'mcp', kind: 'call', label: 'tools/call list_events',
            detail: 'The client is already authenticated to the MCP server (its own token). The server has no calendar token for this user yet.',
          },
          {
            from: 'mcp', to: 'client', kind: 'call', label: 'elicitation/create mode=url',
            detail: 'The server asks the client to direct the user to a URL. The URL points at a page on the MCP server that starts an OAuth flow with the third party; it must not contain credentials or user data.',
            payload: '{\n  "jsonrpc": "2.0", "id": 7,\n  "method": "elicitation/create",\n  "params": {\n    "mode": "url",\n    "elicitationId": "el-11111111-1111-1111-1111-111111111111",\n    "url": "https://mcp.example.com/connect/calendar?session=…",\n    "message": "Connect your calendar so I can read events."\n  }\n}',
          },
          {
            from: 'client', to: 'user', kind: 'approval', label: 'show domain, ask to open',
            detail: 'The client must show the target domain and get explicit consent before navigating. It must not prefetch the URL or open it inside an embedded view the client can read.',
          },
          {
            from: 'client', to: 'mcp', kind: 'return', label: 'action: accept',
            detail: 'accept means only that the user agreed to open the URL, not that the flow finished. The client never learns the outcome directly.',
          },
          {
            from: 'browser', to: 'third', kind: 'call', label: 'authorize (redirect from MCP)',
            detail: 'The MCP server redirects the browser to the third party with its own client ID, PKCE and state. The MCP server is the OAuth client here, not the MCP client.',
          },
          {
            from: 'user', to: 'third', kind: 'approval', label: 'sign in + consent at third party',
            detail: 'The user authenticates directly with the third party. Neither the MCP client nor the model sees the password, MFA, or the consent screen.',
          },
          {
            from: 'third', to: 'mcp', kind: 'token', label: 'code -> token to MCP server',
            detail: 'The browser returns to the MCP server callback; the server redeems the code. Before storing it, the server verifies the signed-in user matches the user who owns the MCP session.',
          },
          {
            from: 'mcp', to: 'vault', kind: 'data', label: 'store token (user + server)',
            detail: 'The token is stored server-side, keyed to the MCP user identity. Revocation and audit live here.',
          },
          {
            from: 'mcp', to: 'client', kind: 'event', label: 'notifications/elicitation/complete',
            detail: 'Optional notification telling the client the out-of-band step finished, so it can retry without polling.',
            payload: '{"jsonrpc": "2.0", "method": "notifications/elicitation/complete",\n "params": {"elicitationId": "el-11111111-1111-1111-1111-111111111111"}}',
          },
          {
            from: 'client', to: 'mcp', kind: 'call', label: 'retry tools/call list_events',
            detail: 'The original request (or a retry after a URL-elicitation-required error) now succeeds because the server has the user\'s calendar token.',
          },
          {
            from: 'mcp', to: 'client', kind: 'return', label: 'events (no token in result)',
            detail: 'Only the data comes back. The transcript and model context contain a URL and the events, never the third-party credential.',
          },
        ],
      },
      {
        id: 'form-mode-misuse',
        label: 'Form mode for a secret (wrong)',
        tone: 'bad',
        outcome: 'The API key passes through the client and lands in the transcript; this is what the spec prohibits.',
        steps: [
          {
            from: 'client', to: 'mcp', kind: 'call', label: 'tools/call list_events',
            detail: 'Same starting point: the server lacks a calendar credential.',
          },
          {
            from: 'mcp', to: 'client', kind: 'call', label: 'elicitation/create form: api_key',
            detail: 'Form mode sends a JSON schema that the client renders. Its response travels back through the client, which may log it or place it in model context.',
            payload: '{"method": "elicitation/create", "params": {\n  "mode": "form",\n  "message": "Paste your calendar API key",\n  "requestedSchema": {"type": "object",\n    "properties": {"api_key": {"type": "string"}}}}}',
          },
          {
            from: 'user', to: 'client', kind: 'data', label: 'types API key into form',
            detail: 'The secret is now in the client process. The user has no way to tell which party will keep it.',
          },
          {
            from: 'client', to: 'mcp', kind: 'attack', label: 'secret in elicitation response',
            detail: 'The key crosses the client, may appear in host logs and telemetry, and can be echoed into the conversation that the model reads.',
          },
          {
            from: 'mcp', to: 'mcp', kind: 'think', label: 'long-lived key, no scoping',
            detail: 'A pasted API key usually has no audience, no expiry and no per-user consent record, so revocation and audit are both worse than with OAuth.',
          },
          {
            from: 'mcp', to: 'client', kind: 'return', label: 'events',
            detail: 'Functionally identical result; the difference is entirely where the secret travelled.',
          },
        ],
      },
    ],
    sources: [
      { title: 'MCP specification 2025-11-25: Elicitation', url: 'https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation' },
      { title: 'SEP-1036: URL mode elicitation for secure out-of-band interactions', url: 'https://modelcontextprotocol.io/seps/1036-url-mode-elicitation-for-secure-out-of-band-intera' },
    ],
    verify: [
      'The 2026-07-28 spec revision reworked this mechanism: the MCP server acts as an OAuth client for the third party and elicitationId plus notifications/elicitation/complete were removed. Check the current revision before implementing the message shapes shown here.',
      'The exact error code for URL-elicitation-required (-32042 in 2025-11-25) and the retry semantics may differ in later revisions.',
    ],
    tags: ['MCP', 'elicitation', 'SEP-1036', 'third-party OAuth', 'consent'],
  },

  // ---------------------------------------------------------------------------
  {
    id: 'entra-agent-id',
    category: 'identity',
    title: 'Microsoft Entra Agent ID',
    tagline: 'A blueprint holds the credential; each agent identity borrows it to get its own tokens.',
    summary:
      'Entra Agent ID gives each agent a first-class directory identity. An agent identity blueprint holds the credentials (certificate, federated credential or managed identity); agent identities created from it have none of their own. To act, the blueprint authenticates, obtains an exchange token for a specific agent identity, and that agent identity presents it as a client assertion. The agent can then act autonomously (app-only) or on behalf of a user, and Conditional Access and sign-in logs apply to the agent identity itself.',
    whenToUse: [
      'Many agent instances that need distinct, auditable identities without minting a secret per agent.',
      'Agents that call Microsoft Graph or your own Entra-protected APIs, either as themselves or for a signed-in user.',
      'When security teams need Conditional Access, lifecycle and ownership for agents the same way they have for users.',
    ],
    risks: [
      'The blueprint credential is the crown jewel: compromise lets an attacker obtain tokens for every agent identity under it.',
      'App-only (autonomous) permissions are tenant-wide by default; grant the narrowest application permissions and review them like any daemon.',
      'In the OBO variant the downstream token carries the user as subject; the agent can do anything the user can within the delegated scopes.',
      'Agent user accounts (for agents that need a mailbox or user-only APIs) are a further identity to govern; do not create them by default.',
    ],
    actors: [
      { id: 'user', label: 'User', kind: 'user', sub: 'jane@example.com' },
      { id: 'clientapp', label: 'Client app', kind: 'client', sub: 'chat front end' },
      { id: 'agent', label: 'Agent runtime', kind: 'agent', sub: 'agent identity' },
      { id: 'blueprint', label: 'Blueprint credential', kind: 'vault', sub: 'cert / managed identity' },
      { id: 'entra', label: 'Microsoft Entra ID', kind: 'idp', sub: 'tenant 2222…' },
      { id: 'graph', label: 'Downstream API', kind: 'tool', sub: 'Microsoft Graph' },
    ],
    variants: [
      {
        id: 'autonomous',
        label: 'Autonomous (app-only)',
        tone: 'neutral',
        outcome: 'The agent gets an app-only token as its own agent identity, using the blueprint credential only as a stepping stone.',
        steps: [
          {
            from: 'agent', to: 'blueprint', kind: 'data', label: 'load blueprint credential',
            detail: 'The runtime holds the blueprint credential, ideally a managed identity or federated credential so there is no secret on disk.',
          },
          {
            from: 'agent', to: 'entra', kind: 'call', label: 'blueprint: token for agent X',
            detail: 'The blueprint authenticates with client credentials and names the target agent identity. Entra checks that the agent identity was created from this blueprint.',
          },
          {
            from: 'entra', to: 'agent', kind: 'token', label: 'exchange token (blueprint -> X)',
            detail: 'A short-lived token usable only as a client assertion for that agent identity. It is not accepted by resource APIs.',
          },
          {
            from: 'agent', to: 'entra', kind: 'call', label: 'agent X: client_credentials',
            detail: 'The agent identity authenticates using the exchange token as its client assertion and requests the downstream resource. The sign-in is logged against the agent identity, not the blueprint.',
            payload: 'POST /22222222-2222-2222-2222-222222222222/oauth2/v2.0/token\nclient_id=33333333-3333-3333-3333-333333333333   (agent identity)\n&grant_type=client_credentials\n&client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer\n&client_assertion=eyJ…(exchange token)\n&scope=https://graph.microsoft.com/.default',
          },
          {
            from: 'entra', to: 'entra', kind: 'think', label: 'Conditional Access for agents',
            detail: 'Policies can target agent identities (block, restrict by risk). Blocking one agent does not affect other agents under the same blueprint.',
          },
          {
            from: 'entra', to: 'agent', kind: 'token', label: 'app-only token (sub = agent X)',
            detail: 'Application permissions granted to the agent identity appear as roles. There is no user in the token.',
            payload: '{\n  "aud": "https://graph.microsoft.com",\n  "iss": "https://sts.windows.net/22222222-2222-2222-2222-222222222222/",\n  "appid": "33333333-3333-3333-3333-333333333333",\n  "sub": "44444444-4444-4444-4444-444444444444",\n  "roles": ["Sites.Selected"],\n  "idtyp": "app"\n}',
          },
          {
            from: 'agent', to: 'graph', kind: 'call', label: 'GET /sites/… as agent X',
            detail: 'Graph audit shows the agent identity as the caller, so activity can be attributed per agent rather than to one shared service principal.',
          },
          {
            from: 'graph', to: 'agent', kind: 'data', label: 'site content',
            detail: 'Data access is bounded by the agent identity\'s application permissions, not by any user.',
          },
        ],
      },
      {
        id: 'obo',
        label: 'On behalf of a user',
        tone: 'good',
        outcome: 'The agent exchanges the user\'s token, with the blueprint-derived assertion, for a delegated downstream token whose subject is the user.',
        steps: [
          {
            from: 'user', to: 'clientapp', kind: 'call', label: '"Summarise my unread mail"',
            detail: 'The user is signed in to the client app, which fronts the agent.',
          },
          {
            from: 'clientapp', to: 'entra', kind: 'call', label: 'get user token for the agent',
            detail: 'The client app requests a delegated token whose audience is the agent (its blueprint), using normal authorization code + PKCE. The user consents to the agent, not to Graph directly.',
          },
          {
            from: 'entra', to: 'clientapp', kind: 'token', label: 'user token (aud = agent)',
            detail: 'This token is only valid at the agent. It cannot be replayed at Graph.',
            payload: '{\n  "aud": "55555555-5555-5555-5555-555555555555",\n  "upn": "jane@example.com",\n  "oid": "66666666-6666-6666-6666-666666666666",\n  "scp": "access_agent",\n  "azp": "77777777-7777-7777-7777-777777777777"\n}',
          },
          {
            from: 'clientapp', to: 'agent', kind: 'call', label: 'request + user token',
            detail: 'The agent validates the token audience and issuer before doing anything with it.',
          },
          {
            from: 'agent', to: 'entra', kind: 'call', label: 'blueprint: exchange token for X',
            detail: 'Same first leg as the autonomous flow: the blueprint authenticates and gets an assertion for the specific agent identity.',
          },
          {
            from: 'entra', to: 'agent', kind: 'token', label: 'exchange token (blueprint -> X)',
            detail: 'Short-lived and only usable as a client assertion by agent identity X.',
          },
          {
            from: 'agent', to: 'entra', kind: 'call', label: 'OBO: user token + assertion',
            detail: 'Agent identity X presents the user token as the assertion and the blueprint-derived token as its client assertion, asking for a delegated Graph token. Exact parameters are in the verify notes.',
            payload: 'POST /22222222-2222-2222-2222-222222222222/oauth2/v2.0/token\nclient_id=33333333-3333-3333-3333-333333333333\n&grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer\n&requested_token_use=on_behalf_of\n&assertion=eyJ…(user token)\n&client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer\n&client_assertion=eyJ…(exchange token)\n&scope=https://graph.microsoft.com/Mail.Read',
          },
          {
            from: 'entra', to: 'entra', kind: 'think', label: 'consent + CA for user and agent',
            detail: 'Entra checks delegated consent for the agent identity and evaluates Conditional Access. Sign-in logs record both the user and the agent identity.',
          },
          {
            from: 'entra', to: 'agent', kind: 'token', label: 'delegated token (sub = user)',
            detail: 'The token subject is the user; the agent identity appears as the client application. There is no RFC 8693 act claim.',
          },
          {
            from: 'agent', to: 'graph', kind: 'call', label: 'GET /me/messages',
            detail: 'Graph enforces the user\'s own permissions intersected with the delegated scope.',
          },
          {
            from: 'graph', to: 'agent', kind: 'data', label: 'unread mail',
            detail: 'Mail content is untrusted input to the model (indirect prompt injection risk).',
          },
          {
            from: 'agent', to: 'user', kind: 'return', label: 'summary',
            detail: 'Audit can tie the Graph reads to both jane@example.com and the specific agent identity.',
          },
        ],
      },
    ],
    sources: [
      { title: 'Microsoft Entra Agent ID: agent on-behalf-of OAuth flow', url: 'https://learn.microsoft.com/en-us/entra/agent-id/identity-platform/agent-on-behalf-of-oauth-flow' },
      { title: 'Microsoft Entra Agent ID: key concepts', url: 'https://learn.microsoft.com/en-us/entra/agent-id/identity-professional/key-concepts' },
    ],
    verify: [
      'Exact multi-step token requests: the blueprint first-leg request (scope api://AzureADTokenExchange/.default with an fmi_path or similar parameter naming the agent identity) and the agent OBO request parameters shown in the payload are reconstructed and need checking against the current docs.',
      'Whether the user token audience in the OBO flow is the blueprint app ID or the agent identity.',
      'Product naming and preview/GA status of Agent ID, agent user accounts and Conditional Access for agents.',
      'The URL path of the key concepts page may have moved.',
    ],
    tags: ['Entra', 'Agent ID', 'blueprint', 'OBO', 'Conditional Access'],
  },

  // ---------------------------------------------------------------------------
  {
    id: 'agentcore-token-vault',
    category: 'identity',
    title: 'AgentCore Identity and the token vault',
    tagline: 'Consent once, store the third-party token per agent and user, reuse it without re-prompting.',
    summary:
      'Amazon Bedrock AgentCore Identity splits agent auth into inbound and outbound. Inbound, the runtime validates the caller\'s JWT against a configured OIDC discovery URL (or uses IAM SigV4). Outbound, the agent swaps its workload access token for a third-party OAuth token held in a token vault encrypted with KMS and keyed to the workload identity plus user. The first 3-legged call returns an authorization URL; once the user consents, later calls get the stored token directly. Machine targets use a 2-legged client credentials provider instead.',
    whenToUse: [
      'Agents on AgentCore Runtime or Gateway that call third-party SaaS (calendar, ticketing, code hosting) on behalf of users.',
      'When you want refresh tokens and client secrets out of agent code and environment variables.',
    ],
    risks: [
      'The vault binds tokens to the user ID the agent asserts; if the user ID comes from an unvalidated header, one user can retrieve another\'s token.',
      'Authorization URLs returned to the agent must reach the right user, unaltered; a URL delivered to the wrong session lets someone else\'s account be linked.',
      'Long-lived refresh tokens in the vault widen the blast radius of an over-privileged agent role; scope IAM access to the specific credential providers.',
    ],
    actors: [
      { id: 'user', label: 'User', kind: 'user', sub: 'jane@example.com' },
      { id: 'idp', label: 'Inbound IdP', kind: 'idp', sub: 'login.example.com' },
      { id: 'runtime', label: 'Agent runtime', kind: 'agent', sub: 'AgentCore Runtime' },
      { id: 'identity', label: 'AgentCore Identity', kind: 'vault', sub: 'token vault (KMS)' },
      { id: 'third', label: 'Third-party OAuth', kind: 'idp', sub: 'calendar.example.com' },
      { id: 'api', label: 'Calendar API', kind: 'tool', sub: 'api.calendar.example.com' },
    ],
    variants: [
      {
        id: 'three-legged',
        label: '3-legged (user consent)',
        tone: 'good',
        outcome: 'The first call returns an authorization URL; after consent the token lives in the vault and later calls retrieve it silently.',
        steps: [
          {
            from: 'user', to: 'idp', kind: 'call', label: 'sign in to the app',
            detail: 'The user signs in to the front end with the organisation IdP and gets an access token.',
          },
          {
            from: 'user', to: 'runtime', kind: 'call', label: 'invoke agent + Bearer JWT',
            detail: 'The runtime\'s JWT authorizer validates signature, issuer, audience or client ID against the configured discovery URL before the agent code runs.',
            payload: 'POST /runtimes/agent-calendar/invocations\nAuthorization: Bearer eyJ…\n{"prompt": "What is on my calendar tomorrow?"}',
          },
          {
            from: 'runtime', to: 'identity', kind: 'token', label: 'workload access token (for user)',
            detail: 'The runtime obtains a workload access token bound to the agent\'s workload identity and the user taken from the validated JWT. This is the key into the vault.',
          },
          {
            from: 'runtime', to: 'identity', kind: 'call', label: 'GetResourceOauth2Token',
            detail: 'The agent asks for a calendar token from a named credential provider. The provider holds the OAuth client ID and secret; agent code never sees them.',
            payload: '{\n  "workloadIdentityToken": "eyJ…",\n  "resourceCredentialProviderName": "calendar-provider",\n  "scopes": ["calendar.read"],\n  "oauth2Flow": "USER_FEDERATION",\n  "resourceOauth2ReturnUrl": "https://app.example.com/oauth/return"\n}',
          },
          {
            from: 'identity', to: 'runtime', kind: 'return', label: 'no token: authorizationUrl',
            detail: 'Nothing is stored for this agent and user, so the call returns an authorization URL instead of a token. The agent must surface it to the user and stop or wait.',
            payload: '{"authorizationUrl": "https://calendar.example.com/oauth/authorize?client_id=…&state=…"}',
          },
          {
            from: 'runtime', to: 'user', kind: 'return', label: '"Connect your calendar" link',
            detail: 'The link must reach the same user who made the request. The agent run either pauses or ends and is retried after consent.',
          },
          {
            from: 'user', to: 'third', kind: 'approval', label: 'sign in + consent',
            detail: 'The user consents directly at the third party. The agent and model never see the third-party password or MFA.',
          },
          {
            from: 'third', to: 'identity', kind: 'token', label: 'tokens to AgentCore callback',
            detail: 'AgentCore redeems the code and stores access and refresh tokens in the vault, encrypted with KMS (optionally a customer managed key), keyed to workload identity plus user.',
          },
          {
            from: 'runtime', to: 'identity', kind: 'call', label: 'GetResourceOauth2Token (retry)',
            detail: 'Same request as before. This time a token exists, so no consent is needed.',
          },
          {
            from: 'identity', to: 'runtime', kind: 'token', label: 'calendar access token',
            detail: 'Returned only for this workload identity and user. Refresh is handled by the vault.',
          },
          {
            from: 'runtime', to: 'api', kind: 'call', label: 'GET /events?date=tomorrow',
            detail: 'The calendar provider sees the AgentCore OAuth client acting for the user. CloudTrail records the vault retrieval on the AWS side.',
          },
          {
            from: 'api', to: 'runtime', kind: 'data', label: 'events',
            detail: 'Event text is untrusted input to the model.',
          },
          {
            from: 'runtime', to: 'user', kind: 'return', label: 'agenda',
            detail: 'Next session the token is reused from the vault; the user is not prompted again until revocation or refresh failure.',
          },
        ],
      },
      {
        id: 'two-legged',
        label: '2-legged (M2M)',
        tone: 'neutral',
        outcome: 'For machine targets the vault runs client credentials and caches the token; no user and no consent.',
        steps: [
          {
            from: 'user', to: 'runtime', kind: 'call', label: 'invoke agent + Bearer JWT',
            detail: 'Inbound auth is unchanged; the outbound target simply does not need a user.',
          },
          {
            from: 'runtime', to: 'identity', kind: 'token', label: 'workload access token',
            detail: 'Bound to the workload identity only.',
          },
          {
            from: 'runtime', to: 'identity', kind: 'call', label: 'GetResourceOauth2Token M2M',
            detail: 'oauth2Flow is M2M. The provider holds a client ID and secret registered at the target authorization server.',
            payload: '{\n  "workloadIdentityToken": "eyJ…",\n  "resourceCredentialProviderName": "inventory-m2m",\n  "scopes": ["inventory.read"],\n  "oauth2Flow": "M2M"\n}',
          },
          {
            from: 'identity', to: 'third', kind: 'call', label: 'client_credentials grant',
            detail: 'AgentCore authenticates to the target authorization server with the stored client secret.',
          },
          {
            from: 'third', to: 'identity', kind: 'token', label: 'app token',
            detail: 'Cached in the vault until expiry so repeated calls do not hit the authorization server.',
          },
          {
            from: 'identity', to: 'runtime', kind: 'token', label: 'access token',
            detail: 'Every user of this agent shares the same app identity downstream, so the target cannot attribute actions to users. Log the user in the agent trace.',
          },
          {
            from: 'runtime', to: 'api', kind: 'call', label: 'GET /inventory',
            detail: 'Permissions are those of the app client, which must be scoped to what every caller is allowed to see.',
          },
        ],
      },
    ],
    sources: [
      { title: 'Amazon Bedrock AgentCore: key features and benefits', url: 'https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/key-features-and-benefits.html' },
      { title: 'Amazon Bedrock AgentCore: Gateway outbound authorization', url: 'https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway-outbound-auth.html' },
      { title: 'AWS Security Blog: Securing AI agents with Amazon Bedrock AgentCore Identity', url: 'https://aws.amazon.com/blogs/security/securing-ai-agents-with-amazon-bedrock-agentcore-identity/' },
    ],
    verify: [
      'API and field names (GetWorkloadAccessTokenForJWT, GetResourceOauth2Token, oauth2Flow USER_FEDERATION / M2M, resourceOauth2ReturnUrl) are from the 2025 preview/GA docs and may have changed.',
      'Whether a session-binding step (confirming the consenting user matches the requesting user before the token is stored) is now required, and its API name.',
      'Customer managed KMS key support for the token vault.',
    ],
    tags: ['AWS', 'AgentCore', 'token vault', '3-legged OAuth', 'M2M'],
  },

  // ---------------------------------------------------------------------------
  {
    id: 'ciba-async-approval',
    category: 'identity',
    title: 'CIBA asynchronous approval',
    tagline: 'The agent asks, the user approves on their phone, the token covers exactly that action.',
    summary:
      'Client-Initiated Backchannel Authentication (OpenID CIBA) lets a backend start authentication without a browser redirect: it names the user, the authorization server pushes a request to the user\'s authenticator, and the backend polls for the result. Combined with Rich Authorization Requests (RFC 9396), the resulting token is scoped to one concrete action, such as a single payment, so an agent can do sensitive work while the user is away from the screen without holding broad standing permission.',
    whenToUse: [
      'Long-running or background agents that hit an action needing explicit human approval.',
      'High-value, low-frequency actions (payments, deletions, permission changes) where a standing token would be too broad.',
    ],
    risks: [
      'Push fatigue: users approve without reading. The binding_message and authorization details must be specific and shown on the device.',
      'login_hint is attacker-chosen if the agent derives it from untrusted content; bind it to the authenticated session that started the task.',
      'Poll interval and expiry must be honoured; aggressive polling gets slow_down, and an expired request must not fall back to a broader token.',
    ],
    actors: [
      { id: 'agent', label: 'Agent backend', kind: 'agent', sub: 'CIBA client' },
      { id: 'as', label: 'Authorization server', kind: 'idp', sub: 'auth.example.com' },
      { id: 'phone', label: 'Authenticator app', kind: 'client', sub: 'jane\'s phone' },
      { id: 'user', label: 'User', kind: 'human', sub: 'jane@example.com' },
      { id: 'api', label: 'Payments API', kind: 'tool', sub: 'pay.example.com' },
    ],
    variants: [
      {
        id: 'approved',
        label: 'Approved',
        tone: 'good',
        outcome: 'The user approves on their phone and the agent receives a token valid only for that one payment.',
        steps: [
          {
            from: 'agent', to: 'agent', kind: 'think', label: 'payment needs user approval',
            detail: 'The agent has no standing payment permission. Policy says any transfer requires a fresh, specific user approval.',
          },
          {
            from: 'agent', to: 'as', kind: 'call', label: 'POST /bc-authorize',
            detail: 'The client authenticates itself (private_key_jwt or mTLS), names the user with a hint, supplies a short binding message and the exact action as RAR authorization_details.',
            payload: 'POST /bc-authorize\nclient_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer\n&client_assertion=eyJ…\n&scope=openid\n&login_hint=jane@example.com\n&binding_message=PAY-4821\n&authorization_details=[{"type":"payment_initiation",\n  "instructedAmount":{"currency":"EUR","amount":"240.00"},\n  "creditorName":"Example Supplies"}]',
          },
          {
            from: 'as', to: 'agent', kind: 'return', label: 'auth_req_id, expires_in, interval',
            detail: 'The request ID is a handle, not a credential the user ever sees. interval is the minimum poll spacing.',
            payload: '{"auth_req_id": "areq-0001-example", "expires_in": 300, "interval": 5}',
          },
          {
            from: 'as', to: 'phone', kind: 'event', label: 'push: approve EUR 240?',
            detail: 'The authorization server notifies the user\'s registered authenticator. The device shows the binding message and the payment details so the user can match it to what the agent said.',
          },
          {
            from: 'agent', to: 'as', kind: 'call', label: 'POST /token (poll)',
            detail: 'Poll mode. Until the user acts the response is authorization_pending; polling faster than interval returns slow_down.',
            payload: 'grant_type=urn:openid:params:grant-type:ciba\n&auth_req_id=areq-0001-example\n&client_assertion=eyJ…\n\n<- 400 {"error": "authorization_pending"}',
          },
          {
            from: 'user', to: 'phone', kind: 'approval', label: 'reviews and approves',
            detail: 'The user authenticates on the device (biometric or PIN) and approves. This is the human gate.',
          },
          {
            from: 'phone', to: 'as', kind: 'event', label: 'approval recorded',
            detail: 'The authorization server records who approved, when, on which device, for which authorization_details. That record is the audit evidence.',
          },
          {
            from: 'agent', to: 'as', kind: 'call', label: 'POST /token (poll)',
            detail: 'The next poll after approval succeeds.',
          },
          {
            from: 'as', to: 'agent', kind: 'token', label: 'token for this payment only',
            detail: 'The access token carries the approved authorization_details. It should be short-lived and single-use at the resource.',
            payload: '{\n  "sub": "jane@example.com",\n  "aud": "https://pay.example.com",\n  "client_id": "agent-backend",\n  "authorization_details": [{"type": "payment_initiation",\n    "instructedAmount": {"currency": "EUR", "amount": "240.00"},\n    "creditorName": "Example Supplies"}],\n  "exp": 1767225900\n}',
          },
          {
            from: 'agent', to: 'api', kind: 'call', label: 'POST /payments EUR 240',
            detail: 'The payments API compares the request against authorization_details. A different amount or payee is rejected even with a valid token.',
          },
          {
            from: 'api', to: 'agent', kind: 'return', label: '201 payment created',
            detail: 'The API log links the payment to the user\'s approval via the token\'s identifiers.',
          },
        ],
      },
      {
        id: 'denied',
        label: 'Denied or expired',
        tone: 'bad',
        outcome: 'The user declines (or ignores) the push; the agent gets an error and must not retry with a broader grant.',
        steps: [
          {
            from: 'agent', to: 'as', kind: 'call', label: 'POST /bc-authorize',
            detail: 'Same request: one payment, specific amount and payee.',
          },
          {
            from: 'as', to: 'agent', kind: 'return', label: 'auth_req_id',
            detail: 'The agent starts polling at the advertised interval.',
          },
          {
            from: 'as', to: 'phone', kind: 'event', label: 'push: approve EUR 240?',
            detail: 'The user sees a request they did not expect, or the binding message does not match.',
          },
          {
            from: 'user', to: 'phone', kind: 'approval', label: 'denies',
            detail: 'A denial is also an audit event. Unexpected requests are a useful signal that the agent was manipulated, for example by injected instructions.',
          },
          {
            from: 'agent', to: 'as', kind: 'call', label: 'POST /token (poll)',
            detail: 'The poll returns a terminal error.',
            payload: '<- 400 {"error": "access_denied"}\n\n(or, if nobody responds before expires_in)\n<- 400 {"error": "expired_token"}',
          },
          {
            from: 'as', to: 'agent', kind: 'block', label: 'access_denied / expired_token',
            detail: 'Both are final for this auth_req_id. The agent must not reuse it or escalate to a different flow.',
          },
          {
            from: 'agent', to: 'agent', kind: 'think', label: 'abort task, report back',
            detail: 'The correct behaviour is to stop the action and tell the user what was not done. Retrying in a loop turns CIBA into a push-bombing tool.',
          },
        ],
      },
    ],
    sources: [
      { title: 'OpenID Connect CIBA Core 1.0', url: 'https://openid.net/specs/openid-client-initiated-backchannel-authentication-core-1_0.html' },
      { title: 'Auth0 for AI Agents: Asynchronous authorization', url: 'https://auth0.com/ai/docs/intro/asynchronous-authorization' },
      { title: 'RFC 9396: OAuth 2.0 Rich Authorization Requests', url: 'https://www.rfc-editor.org/rfc/rfc9396' },
    ],
    verify: [
      'Support for authorization_details in the CIBA request and its reflection into the access token varies by authorization server; check the vendor docs.',
      'The bc-authorize and token endpoint paths shown are illustrative; real paths come from the authorization server metadata (backchannel_authentication_endpoint).',
    ],
    tags: ['CIBA', 'RAR', 'RFC 9396', 'human in the loop', 'async approval'],
  },

  // ---------------------------------------------------------------------------
  {
    id: 'id-jag-xaa',
    category: 'identity',
    title: 'ID-JAG / Cross App Access',
    tagline: 'The enterprise IdP, not a per-user consent screen, decides which apps an agent may reach.',
    summary:
      'The Identity Assertion JWT Authorization Grant lets an app the user is already signed in to obtain an access token for a second app without a browser redirect or consent screen. The first app exchanges the user\'s ID token at the enterprise IdP (RFC 8693) for an ID-JAG, a signed assertion targeted at the second app\'s authorization server; the IdP applies admin policy before issuing it. The second app redeems it with the JWT bearer grant (RFC 7523). This is the mechanism behind Cross App Access and MCP\'s enterprise-managed authorization extension.',
    whenToUse: [
      'Enterprise agents that connect to many SaaS apps where users already sign in through the same IdP.',
      'When security teams want central, revocable control over app-to-app connections instead of per-user OAuth grants scattered across SaaS tenants.',
    ],
    risks: [
      'Both apps must trust the same IdP for the user; the resource authorization server must validate the ID-JAG issuer, audience, client_id and expiry.',
      'Admin policy becomes the only gate; an overly broad policy silently grants every user\'s agent access to the target app.',
      'Draft specification: parameter names and token types can change before RFC status.',
    ],
    actors: [
      { id: 'user', label: 'User', kind: 'user', sub: 'jane@example.com' },
      { id: 'appa', label: 'App A + agent', kind: 'agent', sub: 'chat.example.com' },
      { id: 'idp', label: 'Enterprise IdP', kind: 'idp', sub: 'idp.example.com' },
      { id: 'asb', label: 'App B auth server', kind: 'idp', sub: 'auth.tickets.example.com' },
      { id: 'appb', label: 'App B API', kind: 'tool', sub: 'tickets.example.com' },
    ],
    variants: [
      {
        id: 'allowed',
        label: 'Policy allows A -> B',
        tone: 'good',
        outcome: 'The agent obtains an app B token for the user with no consent screen, because the enterprise admin allowed the connection.',
        steps: [
          {
            from: 'user', to: 'idp', kind: 'call', label: 'SSO into App A',
            detail: 'Ordinary OpenID Connect sign-in. App A holds the user\'s ID token (and possibly a refresh token) from the IdP.',
          },
          {
            from: 'user', to: 'appa', kind: 'call', label: '"Open a ticket for this bug"',
            detail: 'The agent in App A needs to act in App B as the user.',
          },
          {
            from: 'appa', to: 'idp', kind: 'call', label: 'token exchange -> ID-JAG',
            detail: 'App A authenticates as its own client at the IdP and exchanges the user\'s ID token, naming App B\'s authorization server as the audience.',
            payload: 'POST /oauth2/token\ngrant_type=urn:ietf:params:oauth:grant-type:token-exchange\n&requested_token_type=urn:ietf:params:oauth:token-type:id-jag\n&audience=https://auth.tickets.example.com\n&resource=https://tickets.example.com/api\n&scope=tickets.write\n&subject_token=eyJ…(ID token)\n&subject_token_type=urn:ietf:params:oauth:token-type:id_token\n&client_id=app-a&client_assertion=eyJ…',
          },
          {
            from: 'idp', to: 'idp', kind: 'think', label: 'admin policy: may A reach B?',
            detail: 'The IdP checks that the user is assigned to both apps and that an admin has allowed App A to request access to App B with these scopes. No user consent is collected.',
          },
          {
            from: 'idp', to: 'appa', kind: 'token', label: 'ID-JAG (aud = B auth server)',
            detail: 'A short-lived signed JWT. It is not an access token; it can only be redeemed at the named authorization server by the named client.',
            payload: '{\n  "typ": "oauth-id-jag+jwt"\n}.{\n  "iss": "https://idp.example.com",\n  "sub": "88888888-8888-8888-8888-888888888888",\n  "aud": "https://auth.tickets.example.com",\n  "client_id": "app-a-at-tickets",\n  "resource": "https://tickets.example.com/api",\n  "scope": "tickets.write",\n  "jti": "jti-0001", "exp": 1767225900\n}',
          },
          {
            from: 'appa', to: 'asb', kind: 'call', label: 'JWT bearer grant with ID-JAG',
            detail: 'App A presents the ID-JAG to App B\'s authorization server using RFC 7523, authenticating as its client registered there.',
            payload: 'POST /token\ngrant_type=urn:ietf:params:oauth:grant-type:jwt-bearer\n&assertion=eyJ…(ID-JAG)\n&client_id=app-a-at-tickets&client_assertion=eyJ…',
          },
          {
            from: 'asb', to: 'asb', kind: 'think', label: 'validate iss, aud, client_id',
            detail: 'App B trusts the IdP for this tenant, checks the assertion was minted for it and for this client, and maps sub to its local user. Replay protection uses jti.',
          },
          {
            from: 'asb', to: 'appa', kind: 'token', label: 'access token for App B',
            detail: 'A normal App B access token. Its lifetime is App B\'s choice; refresh tokens are usually not issued so the IdP stays in the loop.',
          },
          {
            from: 'appa', to: 'appb', kind: 'call', label: 'POST /tickets as jane',
            detail: 'App B logs the action under the user and the App A client, so both identities are visible in its audit trail.',
          },
          {
            from: 'appb', to: 'appa', kind: 'return', label: '201 ticket created',
            detail: 'Disabling the user or the A -> B policy at the IdP stops new ID-JAGs immediately, without touching App B.',
          },
        ],
      },
      {
        id: 'blocked',
        label: 'Policy denies A -> B',
        tone: 'bad',
        outcome: 'The IdP refuses to issue the ID-JAG; there is no consent screen to click through.',
        steps: [
          {
            from: 'user', to: 'appa', kind: 'call', label: '"File this in the tickets app"',
            detail: 'The agent wants to reach an app the admin has not approved for this source app.',
          },
          {
            from: 'appa', to: 'idp', kind: 'call', label: 'token exchange -> ID-JAG for B',
            detail: 'Same token exchange request as the allowed case.',
          },
          {
            from: 'idp', to: 'idp', kind: 'think', label: 'no A -> B policy',
            detail: 'No admin rule allows this pairing. The decision is central and logged at the IdP.',
          },
          {
            from: 'idp', to: 'appa', kind: 'block', label: '400 access_denied',
            detail: 'The user cannot override this; unlike classic OAuth there is no per-user consent prompt to accept.',
            payload: '{"error": "access_denied", "error_description": "client not permitted for audience"}',
          },
          {
            from: 'appa', to: 'user', kind: 'return', label: '"Not permitted by your admin"',
            detail: 'The agent reports the refusal. The IdP sign-in log has a record of the denied cross-app request.',
          },
        ],
      },
    ],
    sources: [
      { title: 'IETF draft: Identity Assertion JWT Authorization Grant', url: 'https://datatracker.ietf.org/doc/draft-ietf-oauth-identity-assertion-authz-grant/' },
      { title: 'Auth0: Cross App Access for AI agents and MCP', url: 'https://auth0.com/docs/ai-agents-mcp/cross-app-access' },
      { title: 'RFC 8693: OAuth 2.0 Token Exchange', url: 'https://www.rfc-editor.org/rfc/rfc8693' },
      { title: 'RFC 7523: JWT Profile for OAuth 2.0 Client Authentication and Authorization Grants', url: 'https://www.rfc-editor.org/rfc/rfc7523' },
    ],
    verify: [
      'The specification is an IETF draft; its current version and status need checking.',
      'Parameter and type names (urn:ietf:params:oauth:token-type:id-jag, typ oauth-id-jag+jwt, the client_id and resource claims) are from draft text and may change.',
      'The name and status of MCP\'s enterprise-managed authorization extension that builds on ID-JAG.',
      'The Auth0 documentation URL path.',
    ],
    tags: ['ID-JAG', 'Cross App Access', 'token exchange', 'RFC 8693', 'RFC 7523', 'enterprise'],
  },

  // ---------------------------------------------------------------------------
  {
    id: 'token-exchange-delegation',
    category: 'identity',
    title: 'Token exchange: delegation vs impersonation',
    tagline: 'Does the downstream token say "agent acting for Jane" or just "Jane"?',
    summary:
      'RFC 8693 token exchange lets an agent trade a user\'s token for a new one aimed at a downstream API. If the agent also presents its own actor_token, the issued token can carry an act claim naming the agent: delegation, where both principals are visible. Without it, the result is impersonation: the downstream sees only the user and cannot tell an agent was involved. Entra\'s on-behalf-of flow is delegation in effect but does not emit act; the middle tier shows up only as azp/appid.',
    whenToUse: [
      'Multi-hop agent chains where downstream services must enforce or log which agent acted for which user.',
      'When you need to narrow audience and scope at each hop instead of forwarding the original token.',
    ],
    risks: [
      'Impersonation tokens erase the agent from the audit trail; a compromised agent looks exactly like the user.',
      'Resource servers often ignore act; delegation only helps if policy and logging actually read it.',
      'Nested act chains can grow long; decide a maximum depth and whether may_act in the subject token is required.',
    ],
    actors: [
      { id: 'user', label: 'User', kind: 'user', sub: 'jane@example.com' },
      { id: 'agent', label: 'Agent', kind: 'agent', sub: 'agent.example.com' },
      { id: 'sts', label: 'Token service', kind: 'idp', sub: 'sts.example.com' },
      { id: 'api', label: 'Downstream API', kind: 'tool', sub: 'hr.example.com' },
      { id: 'log', label: 'Audit log', kind: 'observability', sub: 'API access log' },
    ],
    variants: [
      {
        id: 'delegation',
        label: 'Delegation (act claim)',
        tone: 'good',
        outcome: 'The downstream token names Jane as subject and the agent as actor, so policy and audit see both.',
        steps: [
          {
            from: 'user', to: 'agent', kind: 'call', label: 'request + user token',
            detail: 'The user token\'s audience is the agent. It may include a may_act claim listing which actors may act for this user.',
            payload: '{\n  "sub": "jane@example.com",\n  "aud": "https://agent.example.com",\n  "scope": "hr.read profile",\n  "may_act": {"sub": "agent.example.com"}\n}',
          },
          {
            from: 'agent', to: 'sts', kind: 'call', label: 'exchange: subject + actor_token',
            detail: 'The agent sends the user token as subject_token and its own credential as actor_token, asking for a token for the HR API with a narrower scope.',
            payload: 'POST /token\ngrant_type=urn:ietf:params:oauth:grant-type:token-exchange\n&subject_token=eyJ…(user)\n&subject_token_type=urn:ietf:params:oauth:token-type:access_token\n&actor_token=eyJ…(agent)\n&actor_token_type=urn:ietf:params:oauth:token-type:jwt\n&audience=https://hr.example.com\n&scope=hr.read',
          },
          {
            from: 'sts', to: 'sts', kind: 'think', label: 'policy: may agent act for Jane?',
            detail: 'The token service checks may_act (or its own policy), audience and scope reduction. Scope must not grow beyond the subject token.',
          },
          {
            from: 'sts', to: 'agent', kind: 'token', label: 'token with act claim',
            detail: 'sub stays the user; act names the current actor. A further hop would nest the previous actor inside act.',
            payload: '{\n  "iss": "https://sts.example.com",\n  "sub": "jane@example.com",\n  "aud": "https://hr.example.com",\n  "scope": "hr.read",\n  "act": {"sub": "agent.example.com"},\n  "exp": 1767225600\n}',
          },
          {
            from: 'agent', to: 'api', kind: 'call', label: 'GET /employees/me',
            detail: 'The API can authorise on both: Jane\'s rights, and whether this actor is allowed to use them (for example, read only).',
          },
          {
            from: 'api', to: 'log', kind: 'data', label: 'log sub=jane act=agent',
            detail: 'The audit record shows both principals. Investigators can separate what Jane did from what the agent did on her behalf.',
          },
          {
            from: 'api', to: 'agent', kind: 'data', label: 'employee record',
            detail: 'Returned to the agent and then to the model as untrusted data.',
          },
        ],
      },
      {
        id: 'impersonation',
        label: 'Impersonation (no act)',
        tone: 'bad',
        outcome: 'The downstream token is indistinguishable from one Jane obtained herself; the agent vanishes from the audit trail.',
        steps: [
          {
            from: 'user', to: 'agent', kind: 'call', label: 'request + user token',
            detail: 'Same input token.',
          },
          {
            from: 'agent', to: 'sts', kind: 'call', label: 'exchange: subject_token only',
            detail: 'No actor_token. The token service only knows the authenticated client that called it.',
            payload: 'grant_type=urn:ietf:params:oauth:grant-type:token-exchange\n&subject_token=eyJ…(user)\n&subject_token_type=urn:ietf:params:oauth:token-type:access_token\n&audience=https://hr.example.com',
          },
          {
            from: 'sts', to: 'agent', kind: 'token', label: 'token: sub=jane, no act',
            detail: 'The issued token looks like any other token for Jane.',
            payload: '{\n  "iss": "https://sts.example.com",\n  "sub": "jane@example.com",\n  "aud": "https://hr.example.com",\n  "scope": "hr.read"\n}',
          },
          {
            from: 'agent', to: 'api', kind: 'call', label: 'GET /employees/me',
            detail: 'The API cannot apply agent-specific restrictions because it cannot see an agent.',
          },
          {
            from: 'api', to: 'log', kind: 'data', label: 'log sub=jane',
            detail: 'If the agent is tricked into bulk reads, the log attributes them to Jane.',
          },
          {
            from: 'log', to: 'log', kind: 'think', label: 'Entra OBO: azp shows middle tier',
            detail: 'Entra on-behalf-of tokens also lack act. The middle-tier app is visible only in azp (v2) or appid (v1), so policies must key on that claim instead.',
            payload: '{\n  "aud": "https://hr.example.com",\n  "upn": "jane@example.com",\n  "azp": "99999999-9999-9999-9999-999999999999",\n  "scp": "hr.read"\n}',
          },
        ],
      },
    ],
    sources: [
      { title: 'RFC 8693: OAuth 2.0 Token Exchange', url: 'https://www.rfc-editor.org/rfc/rfc8693' },
      { title: 'Microsoft identity platform: OAuth 2.0 on-behalf-of flow', url: 'https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-on-behalf-of-flow' },
    ],
    verify: [
      'Entra Agent ID tokens may add agent-specific claims beyond azp/appid; check whether any act-like claim is now emitted.',
    ],
    tags: ['RFC 8693', 'token exchange', 'act claim', 'delegation', 'impersonation', 'OBO'],
  },
];
