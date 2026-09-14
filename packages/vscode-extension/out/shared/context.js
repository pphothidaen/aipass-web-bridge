"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_CONTEXT_POLICY = void 0;
exports.filterProjectContext = filterProjectContext;
exports.formatProjectContext = formatProjectContext;
exports.DEFAULT_CONTEXT_POLICY = {
    identity: false,
    coding: true,
    projects: true,
    memory: false,
};
function filterProjectContext(context, policy) {
    const filtered = {
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
function formatProjectContext(context) {
    if (!context.sections.length)
        return '';
    return ['[AiPASS project context]', JSON.stringify(context, null, 2), '[/AiPASS project context]'].join('\n');
}
