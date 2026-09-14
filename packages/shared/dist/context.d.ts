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
    identity?: {
        displayName?: string;
        role?: string;
    };
    coding?: {
        language?: string;
        activeFile?: string;
        selection?: string;
        content?: string;
    };
    projects?: Array<{
        name: string;
        root?: string;
        languages?: string[];
    }>;
    memory?: Record<string, string>;
}
export declare const DEFAULT_CONTEXT_POLICY: ContextPolicy;
export declare function filterProjectContext(context: ProjectContext, policy: ContextPolicy): ProjectContext;
export declare function formatProjectContext(context: ProjectContext): string;
