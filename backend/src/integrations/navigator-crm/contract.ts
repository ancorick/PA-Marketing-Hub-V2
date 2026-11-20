/**
 * Navigator CRM (Project 2) contract, as Marketing Hub consumes it (PRD 11.1).
 * The CRM owns the applicant pipeline; Marketing Hub never moves cards between stages.
 */
export const NAVIGATOR_CRM_CONTRACT_VERSION = 'v1';

export type CrmStage = 'new' | 'contacted' | 'applied' | 'interview' | 'accepted' | 'enrolled' | 'rejected' | 'lost';

export type CrmLead = {
  id: string;
  corePersonId: string | null;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  courseInterest: string | null;
  stage: CrmStage;
  /** Channel and campaign tags as recorded by the CRM. */
  sourceChannel: string | null;
  sourceCampaign: string | null;
  /** "How did you hear about us?" answer (ANL-16). */
  selfReportedSource: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CrmStageChange = {
  leadId: string;
  fromStage: CrmStage | null;
  toStage: CrmStage;
  occurredAt: string;
};

export type NewCrmLead = {
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  courseInterest?: string;
  channel: string;
  campaign?: string;
};

export interface NavigatorCrmClient {
  readonly contractVersion: typeof NAVIGATOR_CRM_CONTRACT_VERSION;
  listLeadsChangedSince(since: Date): Promise<CrmLead[]>;
  listStageChangesSince(since: Date): Promise<CrmStageChange[]>;
  /** New leads from website forms, social lead forms and newsletter sign-ups with course interest. */
  createLead(input: NewCrmLead): Promise<{ id: string }>;
}
