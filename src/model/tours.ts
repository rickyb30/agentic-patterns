import type { Selection } from './types';

export interface Tour {
  id: string;
  title: string;
  question: string;
  narrative: string;
  variants: { label: string; sel: Selection; takeaway: string }[];
}

const base: Selection = {
  trigger: 'user', channel: 'teams', runtime: 'azure-container',
  model: 'foundry', tool: 'direct', platform: 'snowflake', identity: 'obo',
};

export const TOURS: Tour[] = [
  {
    id: 'sales-by-region',
    title: '1 · "Show me sales for my region"',
    question: 'Jane, an EMEA analyst, asks the Teams agent for sales. Snowflake has a row access policy by region.',
    narrative: 'The agent path is identical in both variants. Only the identity on the Snowflake hop changes, and it changes which rows come back and who the audit log blames.',
    variants: [
      { label: 'OBO', sel: { ...base, identity: 'obo' }, takeaway: 'Snowflake sees JANE and returns her 40 EMEA rows. The audit log names Jane.' },
      { label: 'Service user (key-pair)', sel: { ...base, identity: 'm2m' }, takeaway: 'Snowflake sees SVC_AGENT. Every user gets the service\'s rows, all 2,000 or none, and Jane is absent from the audit log.' },
    ],
  },
  {
    id: 'summarize-inbox',
    title: '2 · "Summarize my inbox"',
    question: 'Jane asks a web agent to summarize her unread mail through Microsoft Graph.',
    narrative: 'Delegated and application permissions have the same name, Mail.Read, but very different reach.',
    variants: [
      { label: 'Delegated (OBO)', sel: { ...base, channel: 'web', platform: 'graph', identity: 'obo' }, takeaway: 'The token carries scp=Mail.Read. Graph limits it to Jane\'s mailbox.' },
      { label: 'Application (managed identity)', sel: { ...base, channel: 'web', platform: 'graph', identity: 'managed_identity' }, takeaway: 'The token carries roles=[Mail.Read]. The agent can read every mailbox in the tenant, and the agent\'s code decides whose.' },
    ],
  },
  {
    id: 'nightly-report',
    title: '3 · Nightly report agent',
    question: 'A scheduled agent builds a 2 a.m. report from Databricks. Nobody is signed in.',
    narrative: 'Patterns that need a user token break when nobody is present. Each fix trades off differently.',
    variants: [
      { label: 'OBO (breaks)', sel: { ...base, trigger: 'cron', channel: 'scheduler', platform: 'databricks', identity: 'obo' }, takeaway: 'There is no user token to exchange, so the Databricks hop fails.' },
      { label: 'Managed identity', sel: { ...base, trigger: 'cron', channel: 'scheduler', platform: 'databricks', identity: 'managed_identity' }, takeaway: 'Works with no secret. Unity Catalog evaluates the MI, so scope its grants tightly to what the report needs.' },
      { label: 'Stored consent', sel: { ...base, trigger: 'cron', channel: 'scheduler', platform: 'databricks', identity: 'stored_consent' }, takeaway: 'Runs as Jane while she sleeps, but long-lived refresh tokens now sit in a vault and break when she leaves or Conditional Access steps in.' },
    ],
  },
];
