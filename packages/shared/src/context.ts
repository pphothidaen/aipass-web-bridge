export type ContextSection = 'identity' | 'coding' | 'projects' | 'memory';

export interface ContextPolicy {
  identity: boolean;
  coding: boolean;
  projects: boolean;
  memory: boolean;
}

export interface ProjectContext {
  version: '1.0.0';
  generatedAt: string;
  consumer: string;
  sections: ContextSection[];
  identity?: { displayName?: string; role?: string };
  coding?: { language?: string; activeFile?: string; selection?: string; content?: string };
  projects?: Array<{ name: string; root?: string; languages?: string[] }>;
  memory?: Record<string, string>;
}

export const DEFAULT_CONTEXT_POLICY: ContextPolicy = {
  identity: false,
  coding: true,
  projects: true,
  memory: false,
};

export function filterProjectContext(context: ProjectContext, policy: ContextPolicy): ProjectContext {
  const filtered: ProjectContext = {
    version: context.version,
    generatedAt: context.generatedAt,
    consumer: context.consumer,
    sections: [],
  };

  if (policy.identity && context.identity) {
    filtered.identity = context.identity;
    filtered.sections.push('identity');
  }
  if (policy.coding && context.coding) {
    filtered.coding = context.coding;
    filtered.sections.push('coding');
  }
  if (policy.projects && context.projects?.length) {
    filtered.projects = context.projects;
    filtered.sections.push('projects');
  }
  if (policy.memory && context.memory && Object.keys(context.memory).length) {
    filtered.memory = context.memory;
    filtered.sections.push('memory');
  }

  return filtered;
}

export function formatProjectContext(context: ProjectContext): string {
  if (!context.sections.length) return '';
  return ['[AiPASS project context]', JSON.stringify(context, null, 2), '[/AiPASS project context]'].join('\n');
}