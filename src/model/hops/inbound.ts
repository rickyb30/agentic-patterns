import { SRC } from '../sources';
import { AGENT_APP, AUD, USER, userToken } from '../tokens';
import type { HopDetail, Selection } from '../types';

const INTERACTIVE_CHANNELS = ['web', 'teams'];

/** Hop 1: how the request starts. */
export function triggerToChannel(sel: Selection): HopDetail {
  const interactive = sel.trigger === 'user';
  const channelIsInteractive = INTERACTIVE_CHANNELS.includes(sel.channel);

  if (interactive && !channelIsInteractive) {
    return {
      caption: 'A person cannot drive a scheduler. Pick a web app or Teams bot.',
      credential: 'none', principal: 'none', principalLabel: '—',
      permission: '—', audit: '—', blastRadius: '—',
      failures: ['Interactive trigger paired with a non-interactive channel.'],
      severity: 'fail', sources: [SRC.entraAuthCode],
    };
  }
  if (!interactive && channelIsInteractive) {
    return {
      caption: 'A schedule has no person to sign in to a web app or Teams. Pick the scheduler.',
      credential: 'none', principal: 'none', principalLabel: '—',
      permission: '—', audit: '—', blastRadius: '—',
      failures: ['Scheduled trigger paired with an interactive channel.'],
      severity: 'fail', sources: [SRC.entraAuthCode],
    };
  }
  if (!interactive) {
    return {
      caption: 'The timer fires. No person is involved, so no user token exists anywhere on this path.',
      credential: 'none (timer event)', principal: 'none', principalLabel: 'scheduler',
      permission: 'Whoever can edit the schedule controls when the agent runs.',
      audit: 'Scheduler run history (e.g. EventBridge / Logic Apps run log).',
      blastRadius: 'None at this hop.',
      failures: ['Any downstream hop that needs a user (OBO, passthrough) will fail.'],
      severity: 'ok', sources: [SRC.entraClientCreds],
    };
  }
  if (sel.channel === 'teams') {
    return {
      caption: 'Jane chats with the bot. Teams SSO gets her a token for the bot\'s API without a second sign-in.',
      credential: 'Teams SSO token → Bot Framework token exchange',
      exchange: 'Teams client calls getAuthToken() → token with aud = bot app ID URI\nBot Framework: OAuth card / token exchange invoke → user token stored by the Bot Service token store',
      claims: userToken(AUD.agentApi, 'access_as_user', 'Teams client'),
      principal: 'user', principalLabel: USER.upn,
      permission: 'Jane (or an admin) has consented to the bot\'s access_as_user scope.',
      audit: 'Entra sign-in log: user=jane@example.com, app=Microsoft Teams, resource=agent-api',
      blastRadius: 'A stolen token reaches only the agent API, and only until it expires (~60–90 min).',
      failures: ['AADSTS65001: consent missing for access_as_user.', 'Bot app ID URI not set to api://botid-<id>; SSO falls back to an OAuth card.'],
      severity: 'ok',
      verify: ['Exact Teams SSO token flow and audience format.'],
      sources: [SRC.teamsSso],
    };
  }
  return {
    caption: 'Jane signs in to the web app (auth code + PKCE) and gets an access token whose audience is the agent API.',
    credential: 'Bearer JWT (delegated)',
    exchange: `GET /authorize?client_id=<spa-client-id>&response_type=code&scope=${AUD.agentApi}/access_as_user&code_challenge=…\nPOST /token grant_type=authorization_code&code=…&code_verifier=…`,
    claims: userToken(AUD.agentApi, 'access_as_user', '<spa-client-id>'),
    principal: 'user', principalLabel: USER.upn,
    permission: 'Jane has consented to the SPA calling agent-api/access_as_user.',
    audit: 'Entra sign-in log: user=jane@example.com, client=spa, resource=agent-api',
    blastRadius: 'A stolen token reaches only the agent API, until it expires.',
    failures: ['AADSTS65001: consent not granted.', 'Token requested for Graph instead of the agent API: the agent cannot validate or exchange it.'],
    severity: 'ok', sources: [SRC.entraAuthCode],
  };
}

/** Hop 2: the channel calls the agent runtime. */
export function channelToRuntime(sel: Selection): HopDetail {
  if (sel.channel === 'scheduler') {
    return {
      caption: 'The scheduler invokes the agent with its own identity. The agent receives no user token.',
      credential: sel.runtime === 'aws-lambda' ? 'IAM (lambda:InvokeFunction by the scheduler role)' : 'Entra app token or function key, by the scheduler',
      principal: 'agent', principalLabel: 'scheduler identity',
      permission: 'The scheduler identity is allowed to invoke the agent.',
      audit: sel.runtime === 'aws-lambda' ? 'CloudTrail: Invoke by scheduler role' : 'Container ingress / APIM log: caller = scheduler',
      blastRadius: 'Anyone who can edit the schedule can trigger the agent.',
      failures: [],
      severity: 'ok', sources: [SRC.lambdaRole, SRC.entraClientCreds],
    };
  }
  return {
    caption: 'The channel forwards Jane\'s token to the agent API, which validates the issuer, audience, signature and scope.',
    credential: 'Bearer JWT (delegated, aud = agent API)',
    wire: `POST https://agent.example.com/chat\nAuthorization: Bearer eyJ0eXAiOiJKV1Qi…   (aud=${AUD.agentApi})`,
    claims: userToken(AUD.agentApi, 'access_as_user', sel.channel === 'teams' ? 'Teams client' : '<spa-client-id>'),
    principal: 'user', principalLabel: USER.upn,
    permission: `agent-api (${AGENT_APP.appId}) checks scp contains access_as_user.`,
    audit: 'Agent app log: request by oid=jane, correlation id propagated downstream.',
    blastRadius: 'The agent now holds a user token. What it can do with it depends on the identity mode chosen next.',
    failures: ['401: the agent rejects a token whose aud is not its own app ID URI.'],
    severity: 'ok', sources: [SRC.entraAuthCode],
  };
}
