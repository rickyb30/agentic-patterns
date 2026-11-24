import { SRC } from '../sources';
import { AGENT_APP, AUD, CLIENT_CREDS_REQUEST, IMDS_REQUEST, MI, OBO_REQUEST, USER, appToken, userToken } from '../tokens';
import type { HopContext, HopDetail, IdentityMode } from '../types';
import { failHop, passthroughHop, requireUserToken } from './common';

type Resolver = (mode: IdentityMode, ctx: HopContext) => HopDetail;

const FOUNDRY_WIRE = (auth: string) =>
  `POST https://<resource>.openai.azure.com/openai/deployments/gpt-x/chat/completions?api-version=…\n${auth}`;

const foundry: Resolver = (mode, ctx) => {
  const src = [SRC.aoaiMi, SRC.aiDisableLocalAuth];
  switch (mode) {
    case 'api_key':
      return {
        caption: 'The agent sends the resource key. Foundry sees a valid key, not a person or a workload.',
        credential: 'api-key header (static)',
        wire: FOUNDRY_WIRE('api-key: <32-char key>'),
        principal: 'key', principalLabel: 'resource key 1',
        permission: 'The key grants full data-plane access to every deployment on the resource. No RBAC check.',
        audit: 'Diagnostic logs record the request and caller IP, with no Entra principal.',
        blastRadius: 'Anyone holding the key can call every deployment and spend your quota until the key is rotated.',
        failures: ['401 if local auth is disabled (disableLocalAuth=true).', 'A key copied into a repo or notebook leaks.'],
        severity: 'caveat', sources: src,
      };
    case 'm2m':
      return {
        caption: 'The agent\'s service principal gets an app-only token with a client secret.',
        credential: 'Bearer JWT (app-only, client credentials)',
        exchange: CLIENT_CREDS_REQUEST(`${AUD.cognitive}/.default`, 'agent'),
        wire: FOUNDRY_WIRE('Authorization: Bearer eyJ…'),
        claims: appToken(AUD.cognitive, AGENT_APP.spnOid, AGENT_APP.appId),
        principal: 'agent', principalLabel: `SPN ${AGENT_APP.name}`,
        permission: 'Azure RBAC: the SPN needs "Cognitive Services OpenAI User" (or a Foundry role) on the resource.',
        audit: 'Entra service-principal sign-in log, plus resource diagnostic logs with the object ID.',
        blastRadius: 'The secret works from anywhere until it expires. Scope is limited to the RBAC assignment.',
        failures: ['AADSTS7000215: invalid client secret (expired or rotated).', '403 PermissionDenied: role assignment missing.'],
        severity: 'caveat',
        verify: ['Current Foundry role names.'],
        sources: [SRC.entraClientCreds, ...src],
      };
    case 'managed_identity':
      if (ctx.cloud !== 'azure') {
        return failHop('An AWS Lambda has no Azure managed identity.', ['Managed identities only exist on Azure compute.', 'Fix: workload federation (AWS-issued OIDC token → Entra federated credential), or an SPN secret.'], [SRC.entraMi, SRC.entraWif]);
      }
      return {
        caption: 'The container asks the local identity endpoint for a token. There is no secret anywhere.',
        credential: 'Bearer JWT (managed identity)',
        exchange: IMDS_REQUEST(AUD.cognitive),
        wire: FOUNDRY_WIRE('Authorization: Bearer eyJ…'),
        claims: appToken(AUD.cognitive, MI.oid, '<MI client id>'),
        principal: 'agent', principalLabel: MI.name,
        permission: 'Azure RBAC: the MI needs "Cognitive Services OpenAI User" on the resource.',
        audit: 'Managed-identity sign-in log, plus resource logs with the MI object ID.',
        blastRadius: 'Only code running on that compute can get the token. Usable only within the RBAC scope.',
        failures: ['403: role assignment missing, or not yet propagated (can take minutes).'],
        severity: 'ok', sources: [SRC.entraMi, ...src],
      };
    case 'federation':
      if (ctx.cloud === 'azure') {
        return { ...foundry('managed_identity', ctx), caption: 'On Azure, a managed identity already does this without a separate federation step.', severity: 'ok' };
      }
      return {
        caption: 'The Lambda gets an AWS-issued OIDC token and exchanges it at Entra for a Foundry token. No secret is stored.',
        credential: 'Bearer JWT (app-only via federated credential)',
        exchange: `POST https://login.microsoftonline.com/<tid>/oauth2/v2.0/token\ngrant_type=client_credentials&client_id=${AGENT_APP.appId}\n&client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer\n&client_assertion=<OIDC token issued for the Lambda role>\n&scope=${AUD.cognitive}/.default`,
        claims: appToken(AUD.cognitive, AGENT_APP.spnOid, AGENT_APP.appId),
        principal: 'agent', principalLabel: `SPN ${AGENT_APP.name} (federated)`,
        permission: 'The Entra app trusts the AWS issuer and subject. RBAC is still required on the resource.',
        audit: 'Entra SPN sign-in log shows a federated credential was used.',
        blastRadius: 'Only the trusted AWS role can mint the assertion.',
        failures: ['AADSTS70021: no federated credential matches the issuer/subject/audience.'],
        severity: 'caveat',
        verify: ['How an AWS workload obtains an OIDC token Entra can trust (AWS outbound identity federation or a custom issuer).'],
        sources: [SRC.entraWif, ...src],
      };
    case 'obo': {
      const missing = requireUserToken(ctx, [SRC.entraObo]);
      if (missing) return missing;
      return {
        caption: 'The agent exchanges Jane\'s token so the model call runs as Jane. This works, but it is unusual.',
        credential: 'Bearer JWT (delegated, via OBO)',
        exchange: OBO_REQUEST(`${AUD.cognitive}/user_impersonation`, 'agent'),
        claims: userToken(AUD.cognitive, 'user_impersonation', AGENT_APP.appId),
        principal: 'user', principalLabel: USER.upn,
        permission: 'Jane herself needs an RBAC data role on the Foundry resource.',
        audit: 'Resource logs show Jane\'s object ID, with the agent app as client.',
        blastRadius: 'Limited to Jane\'s RBAC. But every user now needs a role on the model resource.',
        failures: ['403 for any user without a role assignment.', 'Quota and cost attributed per user, which is often not wanted.'],
        severity: 'caveat', sources: [SRC.entraObo, ...src],
      };
    }
    case 'stored_consent':
      return {
        ...foundry('m2m', ctx),
        caption: 'Model calls rarely use stored user consent. Shown with the agent\'s own identity instead.',
        severity: 'caveat',
      };
    case 'passthrough':
      return passthroughHop(ctx, AUD.cognitive, 'Foundry', [SRC.entraObo, ...src]);
  }
};

const BEDROCK_WIRE = 'POST https://bedrock-runtime.us-east-1.amazonaws.com/model/<model-id>/converse';

const bedrock: Resolver = (mode, ctx) => {
  const src = [SRC.bedrockIam, SRC.sigv4];
  switch (mode) {
    case 'api_key':
      return {
        caption: 'The agent sends a Bedrock API key as a bearer token.',
        credential: 'Bearer Bedrock API key',
        wire: `${BEDROCK_WIRE}\nAuthorization: Bearer <bedrock-api-key>`,
        principal: 'key', principalLabel: 'IAM user behind the long-term key',
        permission: 'The key inherits the IAM permissions of the user it is tied to (bedrock:InvokeModel*).',
        audit: 'CloudTrail records the IAM user behind the key.',
        blastRadius: 'Long-term keys work from anywhere until revoked.',
        failures: ['Key expired (short-term keys last hours).', 'An SCP blocks API keys in the organisation.'],
        severity: 'caveat',
        verify: ['Bedrock API key lifetimes and the IAM principal they map to.'],
        sources: [SRC.bedrockApiKeys, ...src],
      };
    case 'm2m':
      return {
        caption: 'The AWS equivalent of an SPN secret: an IAM user\'s long-term access keys, used to sign SigV4.',
        credential: 'SigV4 signature (AKIA… long-term access key)',
        wire: `${BEDROCK_WIRE}\nAuthorization: AWS4-HMAC-SHA256 Credential=AKIA…/…/bedrock/aws4_request, SignedHeaders=…, Signature=…`,
        principal: 'agent', principalLabel: 'IAM user svc-agent',
        permission: 'IAM policy allows bedrock:InvokeModel on specific model ARNs.',
        audit: 'CloudTrail: userIdentity.type=IAMUser, arn=…:user/svc-agent',
        blastRadius: 'Static keys leak through config files and logs, and work from any network.',
        failures: ['AccessDeniedException: model not in the policy, or model access not enabled.'],
        severity: 'caveat', sources: src,
      };
    case 'managed_identity':
      if (ctx.cloud !== 'aws') {
        return failHop('An Azure managed identity is not an AWS principal. Bedrock only accepts SigV4 (or Bedrock API keys).',
          ['Bedrock cannot validate an Entra token.', 'Fix: workload federation (Entra token → STS AssumeRoleWithWebIdentity).'], [SRC.stsWebIdentity, ...src]);
      }
      return {
        caption: 'The Lambda execution role supplies short-lived credentials. There is no secret in config.',
        credential: 'SigV4 signature (ASIA… temporary role credentials)',
        exchange: 'Lambda runtime injects AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN for the execution role',
        wire: `${BEDROCK_WIRE}\nAuthorization: AWS4-HMAC-SHA256 Credential=ASIA…\nX-Amz-Security-Token: …`,
        principal: 'agent', principalLabel: 'assumed-role/agent-lambda-role',
        permission: 'The execution role policy allows bedrock:InvokeModel on specific model ARNs.',
        audit: 'CloudTrail: userIdentity.type=AssumedRole, sessionIssuer=agent-lambda-role',
        blastRadius: 'Short-lived credentials, scoped to the role.',
        failures: ['AccessDeniedException: role policy missing the model ARN.'],
        severity: 'ok', sources: [SRC.lambdaRole, ...src],
      };
    case 'federation':
      if (ctx.cloud === 'aws') {
        return { ...bedrock('managed_identity', ctx), caption: 'On AWS, the execution role already does this. No federation is needed.' };
      }
      return {
        caption: 'The Azure managed identity gets an Entra token and trades it at AWS STS for temporary role credentials. This is cross-cloud with no secrets.',
        credential: 'SigV4 signature (temporary credentials from AssumeRoleWithWebIdentity)',
        exchange: `1) IMDS → Entra token, aud=api://aws-federation\n2) POST https://sts.amazonaws.com/?Action=AssumeRoleWithWebIdentity\n   &RoleArn=arn:aws:iam::<acct>:role/agent-bedrock\n   &WebIdentityToken=<Entra token>&RoleSessionName=agent`,
        claims: appToken('api://aws-federation', MI.oid, '<MI client id>'),
        principal: 'agent', principalLabel: 'assumed-role/agent-bedrock (from Entra MI)',
        permission: 'The IAM role trust policy names the Entra issuer as an OIDC provider and pins aud and sub to the MI.',
        audit: 'CloudTrail: AssumeRoleWithWebIdentity with the Entra sub, then InvokeModel by the assumed role.',
        blastRadius: 'Only that managed identity can assume the role. Credentials are short-lived.',
        failures: ['InvalidIdentityToken: OIDC provider thumbprint or audience mismatch.', 'AccessDenied: the trust policy sub condition does not match the MI object ID.'],
        severity: 'ok', sources: [SRC.stsWebIdentity, SRC.entraMi, ...src],
      };
    case 'obo':
    case 'stored_consent':
      return failHop('Bedrock authorizes IAM principals, not Entra users. A user token cannot reach it.',
        ['There is no Entra OBO target for Bedrock.', 'Closest option: assume a role per user and tag the session with the user (sts:TagSession / SourceIdentity) for attribution.'],
        [SRC.bedrockIam, SRC.stsWebIdentity], ['Per-user attribution via SourceIdentity on federated sessions.']);
    case 'passthrough':
      return failHop('Bedrock expects a SigV4 signature. A forwarded bearer token is meaningless to it.',
        ['UnrecognizedClientException / missing authentication token.'], src);
  }
};

const anthropic: Resolver = (mode) => {
  const src = [SRC.anthropicApi];
  if (mode === 'api_key') {
    return {
      caption: 'The agent sends an Anthropic API key. The API sees the key and its workspace.',
      credential: 'x-api-key header (static)',
      wire: 'POST https://api.anthropic.com/v1/messages\nx-api-key: sk-ant-…\nanthropic-version: 2023-06-01',
      principal: 'key', principalLabel: 'API key in workspace "agents"',
      permission: 'The key can call any model the organisation has access to, within workspace limits.',
      audit: 'Console usage is attributed to the key and workspace. Per-user attribution only if you send it yourself in metadata.',
      blastRadius: 'Anyone with the key spends your credits until it is revoked.',
      failures: ['401 authentication_error: key revoked.', '429 when workspace rate limits are hit.'],
      severity: 'caveat', sources: src,
    };
  }
  return failHop('The direct Anthropic API authenticates with API keys. Cloud identities do not apply.',
    ['Fix: use an API key from a vault, or call Claude through Foundry, Bedrock or Vertex to use cloud identity.'], src,
    ['Whether the direct API offers workload identity federation today.']);
};

export const MODEL_RESOLVERS: Record<string, Resolver> = { foundry, bedrock, anthropic };
