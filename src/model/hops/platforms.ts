import { SRC } from '../sources';
import { AUD, CLIENT_CREDS_REQUEST, IMDS_REQUEST, MI, OBO_REQUEST, USER, appToken, callerApp, userToken } from '../tokens';
import type { HopContext, HopDetail, IdentityMode } from '../types';
import { failHop, passthroughHop, requireUserToken } from './common';

type Resolver = (mode: IdentityMode, ctx: HopContext) => HopDetail;

const who = (ctx: HopContext) => (ctx.caller === 'mcp' ? 'MCP server' : 'agent');
const miName = (ctx: HopContext) => (ctx.caller === 'mcp' ? 'id-mcp-server (MI)' : MI.name);

/** Stored consent: same downstream token shape as OBO, but obtained from a vaulted refresh token. */
const STORED_CONSENT_EXCHANGE = (scope: string, ctx: HopContext) => `POST https://login.microsoftonline.com/<tid>/oauth2/v2.0/token
grant_type=refresh_token
&client_id=${callerApp(ctx.caller).appId}
&refresh_token=<Jane's refresh token, read from the vault>
&scope=${scope} offline_access`;

// ─── Snowflake ───────────────────────────────────────────────────────────────

const SF_WIRE = (auth: string, type: string) =>
  `POST https://<account>.snowflakecomputing.com/api/v2/statements\nAuthorization: Bearer ${auth}\nX-Snowflake-Authorization-Token-Type: ${type}\n\n{"statement": "SELECT region, SUM(amount) FROM sales GROUP BY region"}`;

const SF_RAP = 'Row access policy on SALES: rows visible only where region is mapped to CURRENT_USER() (or CURRENT_ROLE()).';

const snowflake: Resolver = (mode, ctx) => {
  switch (mode) {
    case 'api_key':
      return {
        caption: `The ${who(ctx)} sends a programmatic access token (PAT) tied to a Snowflake user.`,
        credential: 'Bearer PAT',
        wire: SF_WIRE('<programmatic access token>', 'PROGRAMMATIC_ACCESS_TOKEN'),
        principal: 'key', principalLabel: 'SVC_AGENT (PAT owner)',
        permission: `${SF_RAP} Evaluated as SVC_AGENT, not as the person who asked.`,
        result: 'Every user gets the same rows: whatever SVC_AGENT is allowed to see.',
        audit: 'LOGIN_HISTORY: user=SVC_AGENT, first_authentication_factor=PROGRAMMATIC_ACCESS_TOKEN',
        blastRadius: 'The PAT works from any allowed network until it expires. It can be restricted to one role.',
        failures: ['Network policy required for PATs on service users.', 'PAT expired.'],
        severity: 'caveat',
        verify: ['PAT header value and network-policy requirement.'],
        sources: [SRC.sfPat, SRC.sfRap],
      };
    case 'm2m':
      return {
        caption: `The ${who(ctx)} signs a JWT with a private key registered on a Snowflake service user. Snowflake sees the service, not Jane.`,
        credential: 'Key-pair JWT (RS256)',
        exchange: 'JWT signed locally: { iss: "ACCT.SVC_AGENT.SHA256:<public key fingerprint>", sub: "ACCT.SVC_AGENT", iat, exp (≤ 1h) }',
        wire: SF_WIRE('<key-pair JWT>', 'KEYPAIR_JWT'),
        claims: { iss: 'MYACCT.SVC_AGENT.SHA256:Zm9vYmFy…', sub: 'MYACCT.SVC_AGENT', iat: 1794996400, exp: 1795000000 },
        principal: 'agent', principalLabel: 'SVC_AGENT (TYPE=SERVICE)',
        permission: `${SF_RAP} Evaluated as SVC_AGENT with role AGENT_RO.`,
        result: 'Returns 2,000 rows across every region if AGENT_RO is mapped broadly, or 0 rows if it is not. Never "Jane\'s rows".',
        audit: 'QUERY_HISTORY: user=SVC_AGENT, role=AGENT_RO. Jane does not appear anywhere in Snowflake.',
        blastRadius: 'Whoever holds the private key can query everything AGENT_RO can, for every user\'s question.',
        failures: ['JWT token is invalid: public key fingerprint mismatch.', 'Clock skew pushes iat/exp out of range.'],
        severity: 'caveat', sources: [SRC.sfKeyPair, SRC.sfRap],
      };
    case 'managed_identity':
    case 'federation': {
      const azure = ctx.cloud === 'azure';
      return {
        caption: `The ${who(ctx)}'s cloud identity (${azure ? 'Azure MI' : 'AWS role'}) proves itself to a Snowflake service user configured for workload identity federation. There is no key to rotate.`,
        credential: azure ? 'Entra token (MI) presented as workload identity' : 'Signed AWS GetCallerIdentity request presented as workload identity',
        exchange: azure ? IMDS_REQUEST('<snowflake WIF audience>') : 'SDK builds a presigned sts:GetCallerIdentity request for Snowflake to verify',
        principal: 'agent', principalLabel: 'SVC_AGENT (WORKLOAD_IDENTITY)',
        permission: `${SF_RAP} Evaluated as SVC_AGENT.`,
        result: 'Same as M2M: the service\'s rows, not Jane\'s.',
        audit: 'LOGIN_HISTORY: user=SVC_AGENT, authentication via workload identity.',
        blastRadius: 'Only that cloud workload can log in. Data scope is still the service role.',
        failures: ['Workload identity subject/issuer does not match the user definition.'],
        severity: 'caveat',
        verify: ['Snowflake workload identity federation syntax and GA status for Azure and AWS.'],
        sources: [SRC.sfWif, SRC.sfRap],
      };
    }
    case 'obo': {
      const missing = requireUserToken(ctx, [SRC.entraObo, SRC.sfExtOauthAzure]);
      if (missing) return missing;
      return {
        caption: `The ${who(ctx)} exchanges Jane's token for one issued to Snowflake. Snowflake maps the upn claim to Jane's Snowflake user.`,
        credential: 'Bearer JWT (Entra, delegated, External OAuth)',
        exchange: OBO_REQUEST(`${AUD.snowflake}/session:role:ANALYST`, ctx.caller),
        wire: SF_WIRE('eyJ… (Entra token)', 'OAUTH'),
        claims: userToken(AUD.snowflake, 'session:role:ANALYST', callerApp(ctx.caller).appId),
        principal: 'user', principalLabel: `JANE (mapped from upn ${USER.upn})`,
        permission: `External OAuth integration: issuer = Entra tenant, audience = ${AUD.snowflake}, user mapping claim = upn → LOGIN_NAME. ${SF_RAP} Evaluated as JANE / ANALYST.`,
        result: 'Returns 40 rows: only EMEA, Jane\'s region.',
        audit: 'LOGIN_HISTORY: user=JANE, first_authentication_factor=OAUTH_ACCESS_TOKEN. QUERY_HISTORY shows JANE ran the query.',
        blastRadius: 'Limited to what Jane can already see, for the token\'s lifetime (~1h).',
        failures: ['Invalid OAuth access token: audience not in EXTERNAL_OAUTH_AUDIENCE_LIST.', 'User mapping failed: upn does not match any LOGIN_NAME.', 'Role in scp not granted to Jane.'],
        severity: 'ok', sources: [SRC.entraObo, SRC.sfExtOauthAzure, SRC.sfRap],
      };
    }
    case 'stored_consent':
      return {
        caption: 'Jane consented earlier. The agent redeems her vaulted refresh token for a Snowflake token, even when she is not online.',
        credential: 'Bearer JWT (Entra, delegated, from refresh token)',
        exchange: STORED_CONSENT_EXCHANGE(`${AUD.snowflake}/session:role:ANALYST`, ctx),
        wire: SF_WIRE('eyJ… (Entra token)', 'OAUTH'),
        claims: userToken(AUD.snowflake, 'session:role:ANALYST', callerApp(ctx.caller).appId),
        principal: 'user', principalLabel: 'JANE',
        permission: `${SF_RAP} Evaluated as JANE.`,
        result: 'Returns Jane\'s 40 rows, even at 2 a.m.',
        audit: 'Snowflake shows JANE. Entra shows a refresh-token redemption by the agent app.',
        blastRadius: 'The vault now holds long-lived user credentials, often valid for up to 90 days of inactivity.',
        failures: ['AADSTS700082: refresh token expired.', 'Conditional Access (MFA, device) re-evaluation blocks a non-interactive refresh.', 'Revoked when Jane leaves or resets her password.'],
        severity: 'caveat', sources: [SRC.entraAuthCode, SRC.sfExtOauthAzure],
      };
    case 'passthrough':
      return passthroughHop(ctx, AUD.snowflake, 'Snowflake', [SRC.sfExtOauthAzure, SRC.mcpSecurity]);
  }
};

// ─── Databricks (Azure Databricks shown; AWS/GCP differ in token issuer) ─────

const DBX_WIRE = (auth: string) =>
  `POST https://adb-<id>.azuredatabricks.net/api/2.0/sql/statements\nAuthorization: Bearer ${auth}\n\n{"warehouse_id": "…", "statement": "SELECT region, SUM(amount) FROM main.sales.orders GROUP BY region"}`;

const DBX_FILTER = 'Unity Catalog row filter on main.sales.orders: region IN (SELECT region FROM region_access WHERE principal = current_user()).';

const databricks: Resolver = (mode, ctx) => {
  switch (mode) {
    case 'api_key':
      return {
        caption: `The ${who(ctx)} sends a personal access token. The token belongs to whoever created it, which is often a human.`,
        credential: 'Bearer PAT (dapi…)',
        wire: DBX_WIRE('dapi0123…'),
        principal: 'key', principalLabel: 'PAT owner (e.g. the engineer who built the agent)',
        permission: `${DBX_FILTER} current_user() = PAT owner.`,
        result: 'Everyone gets the PAT owner\'s rows. If that is the developer, users see the developer\'s data.',
        audit: 'Audit log: user = PAT owner, authentication = PAT.',
        blastRadius: 'Everything the PAT owner can do in the workspace, until expiry (often set to 90 days or never).',
        failures: ['403: workspace admin disabled PATs.', 'Token expired.'],
        severity: 'caveat', sources: [SRC.dbxPat, SRC.dbxRowFilters],
      };
    case 'm2m':
      return {
        caption: `The ${who(ctx)} uses a Databricks service principal's OAuth secret to get a workspace token.`,
        credential: 'Bearer JWT (Databricks OAuth M2M)',
        exchange: `POST https://adb-<id>.azuredatabricks.net/oidc/v1/token\nAuthorization: Basic <client_id:client_secret>\ngrant_type=client_credentials&scope=all-apis`,
        wire: DBX_WIRE('eyJ…'),
        principal: 'agent', principalLabel: 'service principal sp-agent',
        permission: `${DBX_FILTER} current_user() = the SP application ID.`,
        result: 'The SP\'s rows for every user: all regions if the SP has broad access, none if not.',
        audit: 'Audit log: identity = sp-agent application ID. Jane is absent.',
        blastRadius: 'The secret works from anywhere until rotated. Scope is the SP\'s UC grants.',
        failures: ['invalid_client: secret expired.', 'PERMISSION_DENIED: SP lacks USE CATALOG / SELECT.'],
        severity: 'caveat', sources: [SRC.dbxM2m, SRC.dbxRowFilters],
      };
    case 'managed_identity':
      if (ctx.cloud !== 'azure') {
        return failHop('A Lambda has no Azure managed identity. Use Databricks OAuth token federation or M2M instead.',
          ['Fix: token federation (exchange an AWS-trusted OIDC token at /oidc/v1/token), or an SP secret.'], [SRC.dbxFederation, SRC.dbxAzureMi]);
      }
      return {
        caption: 'The container gets an Entra token for the Azure Databricks resource. The MI must be added to the workspace as a service principal.',
        credential: 'Bearer JWT (Entra, managed identity)',
        exchange: IMDS_REQUEST(AUD.databricks),
        wire: DBX_WIRE('eyJ… (Entra token)'),
        claims: appToken(AUD.databricks, MI.oid, '<MI client id>'),
        principal: 'agent', principalLabel: miName(ctx),
        permission: `${DBX_FILTER} current_user() = the MI's application ID.`,
        result: 'The MI\'s rows for every user.',
        audit: 'Audit log: identity = MI application ID.',
        blastRadius: 'No secret to leak. Data scope = the MI\'s UC grants.',
        failures: ['403: MI not added to the workspace.', 'PERMISSION_DENIED on the table.'],
        severity: 'caveat', sources: [SRC.dbxAzureMi, SRC.dbxRowFilters],
      };
    case 'federation':
      return {
        caption: `The ${who(ctx)} exchanges a workload OIDC token at the Databricks token endpoint (OAuth token federation). There is no Databricks secret.`,
        credential: 'Bearer JWT (Databricks, via RFC 8693 token exchange)',
        exchange: `POST https://<workspace>/oidc/v1/token\ngrant_type=urn:ietf:params:oauth:grant-type:token-exchange\n&subject_token=<workload OIDC token>&subject_token_type=urn:ietf:params:oauth:token-type:jwt\n&scope=all-apis`,
        wire: DBX_WIRE('eyJ…'),
        principal: 'agent', principalLabel: 'service principal sp-agent (federated)',
        permission: `A federation policy on sp-agent trusts the workload issuer and subject. ${DBX_FILTER}`,
        result: 'The SP\'s rows for every user.',
        audit: 'Audit log: identity = sp-agent.',
        blastRadius: 'Only the trusted workload can mint tokens.',
        failures: ['Federation policy issuer/subject/audience mismatch.'],
        severity: 'caveat',
        verify: ['Databricks OAuth token federation request parameters and availability on Azure.'],
        sources: [SRC.dbxFederation, SRC.rfc8693, SRC.dbxRowFilters],
      };
    case 'obo': {
      const missing = requireUserToken(ctx, [SRC.entraObo, SRC.dbxEntra]);
      if (missing) return missing;
      return {
        caption: `The ${who(ctx)} exchanges Jane's token for an Azure Databricks token. Unity Catalog evaluates Jane.`,
        credential: 'Bearer JWT (Entra, delegated, via OBO)',
        exchange: OBO_REQUEST(`${AUD.databricks}/user_impersonation`, ctx.caller),
        wire: DBX_WIRE('eyJ… (Entra token)'),
        claims: userToken(AUD.databricks, 'user_impersonation', callerApp(ctx.caller).appId),
        principal: 'user', principalLabel: USER.upn,
        permission: `${DBX_FILTER} current_user() = ${USER.upn}.`,
        result: 'Returns Jane\'s 40 EMEA rows. Column masks apply to her too.',
        audit: `Audit log: user = ${USER.upn}. The calling app is visible in Entra sign-in logs.`,
        blastRadius: 'Limited to Jane\'s grants, for the token\'s lifetime.',
        failures: ['AADSTS65001: admin consent missing for Azure Databricks user_impersonation.', 'Jane is not provisioned in the workspace (SCIM).'],
        severity: 'ok', sources: [SRC.entraObo, SRC.dbxEntra, SRC.dbxRowFilters],
      };
    }
    case 'stored_consent':
      return {
        caption: 'Jane consented once (U2M). The agent redeems her refresh token, so Unity Catalog evaluates Jane even when she is offline.',
        credential: 'Bearer JWT (delegated, from refresh token)',
        exchange: STORED_CONSENT_EXCHANGE(`${AUD.databricks}/user_impersonation`, ctx),
        wire: DBX_WIRE('eyJ…'),
        claims: userToken(AUD.databricks, 'user_impersonation', callerApp(ctx.caller).appId),
        principal: 'user', principalLabel: USER.upn,
        permission: `${DBX_FILTER} current_user() = ${USER.upn}.`,
        result: 'Jane\'s rows, unattended.',
        audit: 'Audit log: Jane. Entra: refresh-token redemption by the agent app.',
        blastRadius: 'Long-lived user credentials sit in the vault.',
        failures: ['Refresh token expired or revoked.', 'Conditional Access blocks a non-interactive refresh.'],
        severity: 'caveat', sources: [SRC.dbxU2m, SRC.entraAuthCode],
      };
    case 'passthrough':
      return passthroughHop(ctx, AUD.databricks, 'Azure Databricks', [SRC.dbxEntra, SRC.mcpSecurity]);
  }
};

// ─── Microsoft Graph ─────────────────────────────────────────────────────────

const GRAPH_WIRE = (path: string) => `GET https://graph.microsoft.com/v1.0/${path}\nAuthorization: Bearer eyJ…`;

const graphAppOnly = (ctx: HopContext, how: string, principalLabel: string, oid: string, exchange: string, severity: 'caveat' | 'ok', extraFail: string[]): HopDetail => ({
  caption: `The ${who(ctx)} calls Graph with an app-only token (${how}). Application permission Mail.Read is tenant-wide.`,
  credential: 'Bearer JWT (app-only, roles claim)',
  exchange,
  wire: GRAPH_WIRE(`users/${USER.upn}/messages?$top=20`),
  claims: appToken(AUD.graph, oid, callerApp(ctx.caller).appId, ['Mail.Read']),
  principal: 'agent', principalLabel,
  permission: 'Application permission Mail.Read, granted by a tenant admin. No user is involved in the check.',
  result: 'Can read Jane\'s inbox, and every other mailbox in the tenant, including the CEO\'s. The agent has to pick a mailbox itself.',
  audit: 'Mailbox audit: access by the app\'s service principal. The person who asked is not recorded.',
  blastRadius: 'Every mailbox in the tenant, unless restricted with Exchange RBAC for Applications (or the older application access policies).',
  failures: ['403: admin consent not granted for Mail.Read (Application).', ...extraFail],
  severity,
  sources: [SRC.graphAppOnly, SRC.graphPerms, SRC.exoAppRbac],
});

const graph: Resolver = (mode, ctx) => {
  switch (mode) {
    case 'api_key':
      return failHop('Microsoft Graph does not accept API keys. It needs an Entra access token.', ['401 InvalidAuthenticationToken.'], [SRC.graphPerms]);
    case 'm2m':
      return graphAppOnly(ctx, 'client secret', `SPN ${callerApp(ctx.caller).name}`, callerApp(ctx.caller).spnOid,
        CLIENT_CREDS_REQUEST('https://graph.microsoft.com/.default', ctx.caller), 'caveat', ['AADSTS7000215: secret expired.']);
    case 'managed_identity':
      if (ctx.cloud !== 'azure') {
        return failHop('A Lambda has no Azure managed identity.', ['Fix: federation, with an Entra federated credential trusting the AWS workload.'], [SRC.entraWif]);
      }
      return graphAppOnly(ctx, 'managed identity', miName(ctx), MI.oid, `${IMDS_REQUEST('https://graph.microsoft.com')}\n(Graph app role assigned to the MI via appRoleAssignments; there is no portal consent UI)`, 'caveat', []);
    case 'federation':
      return graphAppOnly(ctx, 'federated credential', `SPN ${callerApp(ctx.caller).name} (federated)`, callerApp(ctx.caller).spnOid,
        'client_credentials with client_assertion = workload OIDC token (see Entra workload identity federation)', 'caveat', ['AADSTS70021: no matching federated credential.']);
    case 'obo': {
      const missing = requireUserToken(ctx, [SRC.entraObo, SRC.graphPerms]);
      if (missing) return missing;
      return {
        caption: `The ${who(ctx)} exchanges Jane's token for a Graph token with delegated Mail.Read. Graph limits it to Jane's mailbox.`,
        credential: 'Bearer JWT (delegated, scp claim)',
        exchange: OBO_REQUEST('https://graph.microsoft.com/Mail.Read', ctx.caller),
        wire: GRAPH_WIRE('me/messages?$top=20'),
        claims: userToken(AUD.graph, 'Mail.Read', callerApp(ctx.caller).appId),
        principal: 'user', principalLabel: USER.upn,
        permission: 'Delegated Mail.Read: the intersection of what the app was granted and what Jane can access.',
        result: 'Jane\'s inbox only. /users/ceo@…/messages returns 403.',
        audit: 'Mailbox audit: Jane, via the agent app (appId recorded).',
        blastRadius: 'Jane\'s mailbox, for about an hour.',
        failures: ['AADSTS65001: user or admin has not consented to Mail.Read for the agent app.', 'AADSTS50076: MFA required. The OBO caller must bubble up the claims challenge to the client.'],
        severity: 'ok', sources: [SRC.entraObo, SRC.graphPerms],
      };
    }
    case 'stored_consent':
      return {
        caption: 'Jane consented with offline_access. The agent redeems her refresh token for delegated Mail.Read at any time.',
        credential: 'Bearer JWT (delegated, from refresh token)',
        exchange: STORED_CONSENT_EXCHANGE('https://graph.microsoft.com/Mail.Read', ctx),
        wire: GRAPH_WIRE('me/messages?$top=20'),
        claims: userToken(AUD.graph, 'Mail.Read', callerApp(ctx.caller).appId),
        principal: 'user', principalLabel: USER.upn,
        permission: 'Delegated Mail.Read for Jane.',
        result: 'Jane\'s inbox, unattended.',
        audit: 'Mailbox audit: Jane via the agent app. Entra: non-interactive sign-in.',
        blastRadius: 'Jane\'s mailbox for as long as the refresh token lives.',
        failures: ['Refresh token revoked or expired.', 'Conditional Access blocks a non-interactive refresh.'],
        severity: 'caveat', sources: [SRC.entraAuthCode, SRC.graphPerms],
      };
    case 'passthrough':
      return passthroughHop(ctx, AUD.graph, 'Microsoft Graph', [SRC.entraObo, SRC.mcpSecurity]);
  }
};

export const PLATFORM_RESOLVERS: Record<string, Resolver> = { snowflake, databricks, graph };
