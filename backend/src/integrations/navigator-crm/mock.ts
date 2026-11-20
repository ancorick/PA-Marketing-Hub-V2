import { randomUUID } from 'node:crypto';
import {
  NAVIGATOR_CRM_CONTRACT_VERSION,
  type CrmLead,
  type CrmStageChange,
  type NavigatorCrmClient,
  type NewCrmLead,
} from './contract.js';

const LEADS: CrmLead[] = [
  { id: 'crm-l-001', corePersonId: 'core-p-003', email: 'maria.applicant@example.test', firstName: 'Maria', lastName: 'Sample', phone: null, courseInterest: 'course-frontend', stage: 'applied', sourceChannel: 'instagram', sourceCampaign: 'autumn-intake-2026', selfReportedSource: 'Instagram', createdAt: '2026-10-20T10:00:00.000Z', updatedAt: '2026-11-02T09:00:00.000Z' },
  { id: 'crm-l-002', corePersonId: null, email: 'gor.lead@example.test', firstName: 'Gor', lastName: 'Sample', phone: '+37400000004', courseInterest: 'course-data', stage: 'new', sourceChannel: 'website', sourceCampaign: null, selfReportedSource: 'A friend', createdAt: '2026-11-10T12:00:00.000Z', updatedAt: '2026-11-10T12:00:00.000Z' },
];

const STAGE_CHANGES: CrmStageChange[] = [
  { leadId: 'crm-l-001', fromStage: null, toStage: 'new', occurredAt: '2026-10-20T10:00:00.000Z' },
  { leadId: 'crm-l-001', fromStage: 'new', toStage: 'applied', occurredAt: '2026-11-02T09:00:00.000Z' },
  { leadId: 'crm-l-002', fromStage: null, toStage: 'new', occurredAt: '2026-11-10T12:00:00.000Z' },
];

export class MockNavigatorCrmClient implements NavigatorCrmClient {
  readonly contractVersion = NAVIGATOR_CRM_CONTRACT_VERSION;
  /** Leads created by Marketing Hub, kept for inspection in tests. */
  readonly createdLeads: CrmLead[] = [];

  async listLeadsChangedSince(since: Date): Promise<CrmLead[]> {
    return [...LEADS, ...this.createdLeads].filter((lead) => new Date(lead.updatedAt) >= since);
  }

  async listStageChangesSince(since: Date): Promise<CrmStageChange[]> {
    return STAGE_CHANGES.filter((change) => new Date(change.occurredAt) >= since);
  }

  async createLead(input: NewCrmLead): Promise<{ id: string }> {
    const now = new Date().toISOString();
    const lead: CrmLead = {
      id: `crm-l-${randomUUID()}`,
      corePersonId: null,
      email: input.email.trim().toLowerCase(),
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone ?? null,
      courseInterest: input.courseInterest ?? null,
      stage: 'new',
      sourceChannel: input.channel,
      sourceCampaign: input.campaign ?? null,
      selfReportedSource: null,
      createdAt: now,
      updatedAt: now,
    };
    this.createdLeads.push(lead);
    return { id: lead.id };
  }
}
