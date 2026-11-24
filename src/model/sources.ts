import type { Source } from './types';

// Public vendor and standards documents. Every hop cites at least one.
// These URLs have not all been re-checked recently; see the `verify` notes on each hop.
const s = (title: string, url: string): Source => ({ title, url });

export const SRC = {
  entraObo: s('Microsoft identity platform: OAuth 2.0 On-Behalf-Of flow', 'https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-on-behalf-of-flow'),
  entraClientCreds: s('Microsoft identity platform: client credentials flow', 'https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-client-creds-grant-flow'),
  entraAuthCode: s('Microsoft identity platform: authorization code flow', 'https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow'),
  entraMi: s('Managed identities for Azure resources', 'https://learn.microsoft.com/en-us/entra/identity/managed-identities-azure-resources/overview'),
  entraWif: s('Microsoft Entra workload identity federation', 'https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation'),
  teamsSso: s('Teams: SSO for bots', 'https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/authentication/bot-sso-overview'),
  rfc8693: s('RFC 8693: OAuth 2.0 Token Exchange', 'https://datatracker.ietf.org/doc/html/rfc8693'),

  aoaiMi: s('Azure OpenAI: configure keyless access with Microsoft Entra ID', 'https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/managed-identity'),
  aiDisableLocalAuth: s('Azure AI services: disable local (key) authentication', 'https://learn.microsoft.com/en-us/azure/ai-services/disable-local-auth'),

  bedrockIam: s('Amazon Bedrock: identity and access management', 'https://docs.aws.amazon.com/bedrock/latest/userguide/security-iam.html'),
  bedrockApiKeys: s('Amazon Bedrock: API keys', 'https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys.html'),
  stsWebIdentity: s('AWS STS: AssumeRoleWithWebIdentity', 'https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRoleWithWebIdentity.html'),
  lambdaRole: s('AWS Lambda: execution role', 'https://docs.aws.amazon.com/lambda/latest/dg/lambda-intro-execution-role.html'),
  sigv4: s('AWS Signature Version 4 for API requests', 'https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv.html'),

  anthropicApi: s('Anthropic API overview', 'https://docs.anthropic.com/en/api/overview'),

  sfKeyPair: s('Snowflake: key-pair authentication', 'https://docs.snowflake.com/en/user-guide/key-pair-auth'),
  sfExtOauthAzure: s('Snowflake: External OAuth with Microsoft Entra ID', 'https://docs.snowflake.com/en/user-guide/oauth-azure'),
  sfPat: s('Snowflake: programmatic access tokens', 'https://docs.snowflake.com/en/user-guide/programmatic-access-tokens'),
  sfWif: s('Snowflake: workload identity federation', 'https://docs.snowflake.com/en/user-guide/workload-identity-federation'),
  sfRap: s('Snowflake: row access policies', 'https://docs.snowflake.com/en/user-guide/security-row-intro'),

  dbxPat: s('Databricks: personal access tokens', 'https://docs.databricks.com/aws/en/dev-tools/auth/pat'),
  dbxM2m: s('Databricks: OAuth machine-to-machine (M2M)', 'https://docs.databricks.com/aws/en/dev-tools/auth/oauth-m2m'),
  dbxU2m: s('Databricks: OAuth user-to-machine (U2M)', 'https://docs.databricks.com/aws/en/dev-tools/auth/oauth-u2m'),
  dbxFederation: s('Databricks: OAuth token federation', 'https://docs.databricks.com/aws/en/dev-tools/auth/oauth-federation'),
  dbxAzureMi: s('Azure Databricks: authenticate with managed identities', 'https://learn.microsoft.com/en-us/azure/databricks/dev-tools/auth/azure-mi'),
  dbxEntra: s('Azure Databricks: Microsoft Entra ID tokens', 'https://learn.microsoft.com/en-us/azure/databricks/dev-tools/auth/'),
  dbxRowFilters: s('Databricks: row filters and column masks', 'https://docs.databricks.com/aws/en/tables/row-and-column-filters'),

  graphPerms: s('Microsoft Graph permissions overview', 'https://learn.microsoft.com/en-us/graph/permissions-overview'),
  graphAppOnly: s('Microsoft Graph: get access without a user', 'https://learn.microsoft.com/en-us/graph/auth-v2-service'),
  exoAppRbac: s('Exchange Online: RBAC for applications', 'https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac'),

  mcpAuth: s('Model Context Protocol: authorization', 'https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization'),
  apimGenAi: s('Azure API Management: AI gateway capabilities', 'https://learn.microsoft.com/en-us/azure/api-management/genai-gateway-capabilities'),
  apimValidateJwt: s('Azure API Management: validate-jwt policy', 'https://learn.microsoft.com/en-us/azure/api-management/validate-jwt-policy'),
  apimMi: s('Azure API Management: authentication-managed-identity policy', 'https://learn.microsoft.com/en-us/azure/api-management/authentication-managed-identity-policy'),
  apimCredMgr: s('Azure API Management: credential manager', 'https://learn.microsoft.com/en-us/azure/api-management/credentials-overview'),
  awsJwtAuthorizer: s('Amazon API Gateway: JWT authorizers for HTTP APIs', 'https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html'),
  mcpSecurity: s('Model Context Protocol: security best practices (token passthrough)', 'https://modelcontextprotocol.io/specification/2025-06-18/basic/security_best_practices'),
} as const;
