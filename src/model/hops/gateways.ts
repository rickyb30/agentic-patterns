import { SRC } from '../sources';
import { AGENT_APP, AUD, GATEWAY_APP, GATEWAY_MI, MCP_APP, OBO_REQUEST, CLIENT_CREDS_REQUEST, IMDS_REQUEST, appToken, callerApp, inboundAud, userToken } from '../tokens';
import type { HopContext, HopDetail, IdentityMode, Source } from '../types';
import { failHop, passthroughHop, requireUserToken } from './common';

/**
 * Gateways sit between a caller and a backend and split one hop into two.
 * The teaching point: a gateway either keeps the caller's identity (forward, exchange)
 * or replaces it with its own (swap). The backend only sees whatever the gateway sends.
 */

export type GatewayKind = 'ai' | 'api';
const NAME: Record<GatewayKind, string> = { ai: 'AI gateway', api: 'API gateway' };
const GW_SOURCES: Source[] = [SRC.apimGenAi, SRC.apimValidateJwt, SRC.awsJwtAuthorizer];

const callerName = (ctx: HopContext) => (ctx.caller === 'mcp' ? 'MCP server' : 'agent');

/**
 * Forward mode, caller → gateway. The gateway validates and meters the credential the backend expects,
 * then proxies it. If that credential is unusable, a gateway that checks it rejects the call here, one hop early.
 */
export function forwardIn(kind: GatewayKind, downstream: HopDetail, backend: string): HopDetail {
  const gw = NAME[kind];
  if (downstream.severity === 'fail') {
    return {
      ...downstream,
      caption: `The ${gw} checks the credential before proxying it and rejects the call here, one hop earlier than ${backend} would. ${downstream.caption}`,
      sources: [...downstream.sources, SRC.apimValidateJwt],
    };
  }
  return {
    ...downstream,
    caption: `The ${gw} checks and meters the ${backend} credential, then proxies it unchanged. Identity is preserved, and so is the credential's blast radius.`,
    permission: downstream.principal === 'key'
      ? `A static key cannot be validated by signature. The gateway can only match it against a list, rate-limit it and log it. ${downstream.permission}`
      : `validate-jwt / JWT authorizer: issuer, signature, expiry and aud = ${backend}; then per-consumer rate limit and an operation allowlist. ${backend} still makes the real authorization decision.`,
    result: undefined,
    audit: `Gateway log: caller (azp / sub or key name), operation, status, latency${kind === 'ai' ? ', prompt and completion token counts' : ''}. Correlate with ${backend} logs through a request ID header.`,
    failures: [
      'The gateway sees live bearer credentials. Redact Authorization headers from gateway logs and traces.',
      `If the gateway insists on aud = gateway, the caller must hold two tokens; forwarding a token minted for the gateway is token passthrough and ${backend} will reject it.`,
      ...(kind === 'ai' ? ['Callers still need their own model credentials, so keys and role assignments still spread across apps.'] : []),
    ],
    sources: [...downstream.sources, ...GW_SOURCES],
  };
}

/** Forward mode, gateway → backend: the same credential, unchanged. */
export function forwardOut(kind: GatewayKind, downstream: HopDetail): HopDetail {
  return {
    ...downstream,
    caption: `Proxied unchanged by the ${NAME[kind]}. ${downstream.caption}`,
    sources: [...downstream.sources, SRC.apimGenAi],
  };
}

/**
 * Swap and exchange modes, caller → gateway. The caller authenticates to the gateway itself (aud = gateway).
 * What the caller sends depends on the identity mode.
 */
export function gatewayIn(kind: GatewayKind, mode: IdentityMode, ctx: HopContext): HopDetail {
  const gw = NAME[kind];
  const app = callerApp(ctx.caller);
  const sources = [SRC.apimValidateJwt, SRC.awsJwtAuthorizer, SRC.apimGenAi];
  const common = {
    audit: `Gateway log names the caller and the operation${kind === 'ai' ? ', plus token usage per consumer for chargeback' : ''}. Downstream logs will not.`,
    blastRadius: `A leaked credential for aud = gateway reaches only what the gateway exposes to this caller, after its rate limits.`,
  };
  switch (mode) {
    case 'obo': {
      const missing = requireUserToken(ctx, sources);
      if (missing) return missing;
      return {
        caption: `The ${callerName(ctx)} exchanges the user's token (OBO) for one whose audience is the ${gw}. The gateway knows exactly which user is calling.`,
        credential: 'Bearer JWT (Entra, delegated), aud = gateway',
        exchange: OBO_REQUEST(`${AUD.gateway}/.default`, ctx.caller),
        claims: userToken(AUD.gateway, 'gateway.invoke', app.appId),
        principal: 'user', principalLabel: `jane@example.com via ${app.name}`,
        permission: 'validate-jwt: issuer, signature, aud = gateway, required scope gateway.invoke. Policy can key rate limits and allowlists on the user (oid) as well as the app (azp).',
        ...common, failures: [], severity: 'ok', sources: [...sources, SRC.entraObo],
      };
    }
    case 'stored_consent':
      return {
        caption: `The ${callerName(ctx)} redeems a stored refresh token for a gateway-audience token. The gateway still sees the user, even with no one signed in.`,
        credential: 'Bearer JWT (Entra, delegated, from a refresh token), aud = gateway',
        exchange: `POST https://login.microsoftonline.com/<tenant>/oauth2/v2.0/token\ngrant_type=refresh_token\n&client_id=${app.appId}\n&refresh_token=<from vault>\n&scope=${AUD.gateway}/.default offline_access`,
        claims: userToken(AUD.gateway, 'gateway.invoke', app.appId),
        principal: 'user', principalLabel: `jane@example.com via ${app.name}`,
        permission: 'validate-jwt as for OBO.',
        ...common, failures: ['Refresh tokens break when the user leaves, resets a password, or a Conditional Access policy changes.'], severity: 'caveat',
        sources,
      };
    case 'passthrough':
      return passthroughHop(ctx, AUD.gateway, `the ${gw}`, sources);
    case 'api_key':
      return {
        caption: `The ${callerName(ctx)} sends a gateway subscription key. The gateway knows which app called, but not which user.`,
        credential: 'Subscription key header (static secret)',
        wire: `POST https://gateway.example.com/${kind === 'ai' ? 'openai/deployments/chat/chat/completions' : 'data/query'}\nOcp-Apim-Subscription-Key: <key from vault>`,
        principal: 'key', principalLabel: `subscription "${app.name}"`,
        permission: 'Key lookup, then the product / subscription quota and operation allowlist.',
        ...common,
        blastRadius: 'Anyone holding the key is this app, until it is rotated.',
        failures: ['A key cannot carry user identity or be bound to a workload. Pair it with JWT validation, or replace it.'],
        severity: 'caveat', sources,
      };
    case 'managed_identity':
      if (ctx.cloud === 'aws') {
        return failHop(
          `A Lambda execution role is not an Entra managed identity, so it cannot mint a token for the ${gw} directly.`,
          ['Fix: use workload identity federation (the Lambda role\'s OIDC token exchanged at Entra), or put an AWS-native gateway with an IAM authorizer in front.'],
          [...sources, SRC.entraWif],
        );
      }
      return {
        caption: `The ${callerName(ctx)}'s managed identity gets a token for the ${gw}. No secret anywhere.`,
        credential: 'Bearer JWT (Entra, app-only, managed identity), aud = gateway',
        exchange: IMDS_REQUEST(AUD.gateway),
        claims: appToken(AUD.gateway, ctx.caller === 'mcp' ? MCP_APP.spnOid : 'i0000000-0000-0000-0000-000000000mi', ctx.caller === 'mcp' ? MCP_APP.appId : AGENT_APP.appId, ['Gateway.Invoke']),
        principal: 'agent', principalLabel: ctx.caller === 'mcp' ? 'id-mcp-server (MI)' : 'id-agent (MI)',
        permission: 'validate-jwt: aud = gateway and roles contains Gateway.Invoke.',
        ...common, failures: [], severity: 'ok', sources: [...sources, SRC.entraMi],
      };
    case 'm2m':
    case 'federation':
      return {
        caption: `The ${callerName(ctx)} uses ${mode === 'm2m' ? 'client credentials' : 'a federated workload token'} to get an app-only token for the ${gw}.`,
        credential: 'Bearer JWT (Entra, app-only), aud = gateway',
        exchange: mode === 'm2m' ? CLIENT_CREDS_REQUEST(`${AUD.gateway}/.default`, ctx.caller) : `client_assertion = the platform's OIDC token (no secret)\n${CLIENT_CREDS_REQUEST(`${AUD.gateway}/.default`, ctx.caller).replace('&client_secret=<secret from vault>      (or client_assertion with a cert)', '&client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer\n&client_assertion=<platform OIDC token>')}`,
        claims: appToken(AUD.gateway, app.spnOid, app.appId, ['Gateway.Invoke']),
        principal: 'agent', principalLabel: app.name,
        permission: 'validate-jwt: aud = gateway and roles contains Gateway.Invoke.',
        ...common, failures: mode === 'm2m' ? ['The client secret or cert has to be stored and rotated.'] : [], severity: mode === 'm2m' ? 'caveat' : 'ok',
        sources: [...sources, mode === 'm2m' ? SRC.entraClientCreds : SRC.entraWif],
      };
  }
}

/** Swap mode, gateway → model provider: the gateway's own credential. */
export function aiGatewayOut(model: string): HopDetail {
  const verify = ['Exact gateway policy names and support vary by product and version; check your gateway\'s documentation.'];
  const after = 'The model provider sees the gateway, not the app or the user. Per-app and per-user attribution exists only in gateway logs and token metrics.';
  switch (model) {
    case 'foundry':
      return {
        caption: `The gateway calls Foundry with its own managed identity. Apps never hold a model key. ${after}`,
        credential: 'Bearer JWT (Entra, gateway managed identity)',
        wire: '<authentication-managed-identity resource="https://cognitiveservices.azure.com" />\nPOST https://example-foundry.openai.azure.com/openai/deployments/chat/chat/completions',
        claims: appToken(AUD.cognitive, GATEWAY_MI.oid, GATEWAY_MI.oid),
        principal: 'agent', principalLabel: GATEWAY_MI.name,
        permission: 'Cognitive Services OpenAI User on the gateway MI only. Local (key) auth can be disabled on the Foundry resource.',
        result: 'One role assignment instead of one per app. Load balancing and failover across deployments happen here.',
        audit: 'Foundry logs show the gateway MI for every call. Use gateway token metrics, keyed by subscription or azp, for chargeback.',
        blastRadius: 'The gateway MI can call every deployment it is assigned to. Lock down who can edit gateway policy.',
        failures: ['A gateway outage is a model outage. Run it zone-redundant or multi-region.'],
        severity: 'ok', verify, sources: [SRC.apimMi, SRC.apimGenAi, SRC.aoaiMi],
      };
    case 'bedrock':
      return {
        caption: `The gateway reaches Bedrock with an AWS credential it holds centrally: a federated role or a Bedrock API key. ${after}`,
        credential: 'SigV4 (federated role) or Bedrock API key, held by the gateway',
        wire: 'POST https://bedrock-runtime.us-east-1.amazonaws.com/model/<model-id>/converse\nAuthorization: AWS4-HMAC-SHA256 Credential=<STS key>/…, SignedHeaders=…, Signature=…',
        principal: 'agent', principalLabel: 'arn:aws:sts::111122223333:assumed-role/ai-gateway/…',
        permission: 'IAM policy on the gateway role: bedrock:InvokeModel on allowed model ARNs.',
        audit: 'CloudTrail shows the gateway role for every app. Attribution lives in gateway logs.',
        blastRadius: 'The gateway role can invoke every model it allows, for every caller.',
        failures: ['SigV4 signing is not built in to every gateway product. You may need custom policy code or a Bedrock API key.'],
        severity: 'caveat',
        verify: [...verify, 'Whether a given gateway product can SigV4-sign Bedrock requests natively.'],
        sources: [SRC.bedrockIam, SRC.stsWebIdentity, SRC.bedrockApiKeys, SRC.apimGenAi],
      };
    default:
      return {
        caption: `The gateway injects the one Anthropic API key from its secret store. Apps never see it. ${after}`,
        credential: 'x-api-key (held only by the gateway)',
        wire: 'POST https://api.anthropic.com/v1/messages\nx-api-key: <named value from vault>\nanthropic-version: 2023-06-01',
        principal: 'key', principalLabel: 'workspace API key (gateway)',
        permission: 'Key-scoped workspace. The gateway enforces per-app quotas the key itself cannot express.',
        result: 'Still a static key, but one copy in one place, so rotation is a single change.',
        audit: 'The Anthropic console attributes all usage to one key. Per-app usage comes from gateway logs.',
        blastRadius: 'A leaked key is every app\'s model access. Keep it in a vault-backed named value.',
        failures: [],
        severity: 'caveat', verify, sources: [SRC.anthropicApi, SRC.apimGenAi],
      };
  }
}

/** Swap mode, gateway → data platform: the gateway's own service identity. Every caller collapses to one principal. */
export function apiGatewaySwapOut(platform: string, note = ''): HopDetail {
  const base = {
    principal: 'agent' as const,
    severity: 'caveat' as const,
    failures: [
      'Confused deputy: any caller the gateway admits gets the gateway\'s data access.',
      'Fix: forward a platform-audience user token, or let the gateway do the OBO exchange.',
    ],
  };
  switch (platform) {
    case 'snowflake':
      return {
        ...base,
        caption: `${note}The gateway connects as its own Snowflake service user. The row access policy evaluates SVC_GATEWAY, not Jane.`,
        credential: 'Bearer JWT (gateway service user: External OAuth client credentials or key-pair)',
        wire: 'POST https://example-account.snowflakecomputing.com/api/v2/statements\nX-Snowflake-Authorization-Token-Type: OAUTH',
        principalLabel: 'SVC_GATEWAY',
        permission: 'Role grants on SVC_GATEWAY. CURRENT_USER() = SVC_GATEWAY for every caller.',
        result: 'Every user receives the same rows, either all 2,000 or none, whatever their own entitlements.',
        audit: 'QUERY_HISTORY shows SVC_GATEWAY. Who asked is only in gateway logs, if a header was logged.',
        blastRadius: 'Everything SVC_GATEWAY can read, for every caller of the gateway.',
        sources: [SRC.sfExtOauthAzure, SRC.sfKeyPair, SRC.sfRap, SRC.apimMi],
      };
    case 'databricks':
      return {
        ...base,
        caption: `${note}The gateway calls Databricks with its managed identity / service principal. Unity Catalog row filters see the gateway.`,
        credential: 'Bearer JWT (Entra, gateway MI), aud = Azure Databricks',
        wire: `<authentication-managed-identity resource="${AUD.databricks}" />\nPOST https://adb-0000000000000000.0.azuredatabricks.net/api/2.0/sql/statements`,
        claims: appToken(AUD.databricks, GATEWAY_MI.oid, GATEWAY_MI.oid),
        principalLabel: GATEWAY_MI.name,
        permission: 'UC grants on the gateway service principal. current_user() is the SP application ID.',
        result: 'Row filters on current_user() return the service principal\'s rows to every caller.',
        audit: 'system.access.audit shows the gateway SP.',
        blastRadius: 'Everything the gateway SP is granted, for every caller.',
        sources: [SRC.dbxAzureMi, SRC.dbxRowFilters, SRC.apimMi],
      };
    default:
      return {
        ...base,
        caption: `${note}The gateway calls Graph app-only with its managed identity. Application Mail.Read covers every mailbox in the tenant.`,
        credential: 'Bearer JWT (Entra, app-only, gateway MI), roles = Mail.Read',
        wire: '<authentication-managed-identity resource="https://graph.microsoft.com" />\nGET https://graph.microsoft.com/v1.0/users/{id}/messages',
        claims: appToken(AUD.graph, GATEWAY_MI.oid, GATEWAY_MI.oid, ['Mail.Read']),
        principalLabel: GATEWAY_MI.name,
        permission: 'Application permission Mail.Read: every mailbox, unless Exchange RBAC for Applications narrows it.',
        result: 'The gateway can read any mailbox. Which one it reads depends on the URL the caller sent.',
        audit: 'The Graph activity log shows the gateway app, not the user.',
        blastRadius: 'Tenant-wide mail read for anyone who can reach the gateway route.',
        sources: [SRC.graphAppOnly, SRC.exoAppRbac, SRC.apimMi],
      };
  }
}

/**
 * Exchange mode, gateway → platform. Reuses the platform's OBO detail, re-labelled so the gateway app
 * (not the agent) is the middle tier that holds the client credential.
 */
export function rebrandAsGateway(d: HopDetail, ctx: HopContext): HopDetail {
  const app = callerApp(ctx.caller);
  const json = JSON.stringify(d)
    .split(app.appId).join(GATEWAY_APP.appId)
    .split(inboundAud(ctx.caller)).join(AUD.gateway);
  const out = JSON.parse(json) as HopDetail;
  return {
    ...out,
    caption: `The gateway is the OBO middle tier: it exchanges the user token it received (aud = gateway) for a platform token. ${out.caption}`,
    verify: [...(out.verify ?? []), 'Most gateways have no one-line OBO policy. It is usually a send-request to the token endpoint, with the result cached per user until expiry.'],
    sources: [...out.sources, SRC.apimCredMgr, SRC.entraObo],
  };
}
