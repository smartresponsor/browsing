const { z } = require('zod');

const webExecutionCorrelationSchema = z.object({
  taskId: z.string().min(1).max(200).optional(),
  runId: z.string().min(1).max(200).optional(),
  invocationId: z.string().min(1).max(200).optional(),
}).strict();

function createWebCoreDomainToolDefinitions() {
  return Object.freeze([
    definition({
      canonicalName: 'web.browser.targets',
      consoleName: 'read_.web.browser.targets',
      route: '/browser-targets',
      capabilityName: 'web.browser_targets',
      access: 'read',
      description: 'List supervised browser pages with stable target identity, URLs, titles, and active-page identity.',
      inputSchema: z.object({}).strict(),
    }),
    definition({
      canonicalName: 'web.browser.bind',
      consoleName: 'write.web.browser.bind',
      route: '/browser-bind',
      capabilityName: 'web.browser_bind',
      access: 'write',
      description: 'Bind Browser MCP semantics to a specific Console-owned browser target by exact target identity or compatibility locator.',
      inputSchema: z.object({
        targetId: z.string().min(1).optional(),
        index: z.number().int().nonnegative().optional(),
        url: z.string().optional(),
        urlContains: z.string().optional(),
      }).strict(),
    }),
    definition({
      canonicalName: 'web.target.open',
      consoleName: 'write.web.target.open',
      route: '/open',
      capabilityName: 'web.open',
      access: 'write',
      description: 'Navigate the bound Console-owned supervised browser target to any policy-allowed HTTP(S) URL.',
      inputSchema: z.object({
        url: z.string().url(),
      }).strict(),
    }),
    definition({
      canonicalName: 'web.job.open',
      consoleName: 'write.web.job.open',
      route: '/open-job',
      legacyName: 'web.open_job',
      capabilityName: 'web.open_job',
      access: 'write',
      description: 'Open a policy-allowed job/career URL using the optional job profile; unknown public hosts remain supported through generic browser semantics.',
      inputSchema: z.object({
        url: z.string().url(),
      }).strict(),
    }),
    definition({
      canonicalName: 'web.chatgpt.snapshot',
      consoleName: 'read_.web.chatgpt.snapshot',
      route: '/chatgpt-snapshot',
      legacyName: 'web.chatgpt_snapshot',
      capabilityName: 'web.chatgpt_snapshot',
      access: 'read',
      description: 'Read the bound ChatGPT Web target URL and message snapshot for semantic execution gating.',
      inputSchema: z.object({}).strict(),
    }),
    definition({
      canonicalName: 'web.page.capture',
      consoleName: 'read_.web.page.capture',
      route: '/page-capture',
      capabilityName: 'web.page_capture',
      access: 'read',
      description: 'Capture page identity, revisions, semantic form state, submit candidates, and optional review screenshot evidence.',
      inputSchema: z.object({
        screenshot: z.boolean().optional(),
      }).strict(),
    }),
    definition({
      canonicalName: 'web.page.wait',
      consoleName: 'read_.web.page.wait',
      route: '/wait-for-ready',
      capabilityName: 'web.wait_for_ready',
      access: 'read',
      description: 'Wait for bounded browser readiness such as DOM content, selector visibility, network idle, or mutation quietness.',
      inputSchema: z.object({
        selector: z.string().optional(),
        state: z.enum(['domcontentloaded', 'load', 'networkidle', 'selector-visible', 'selector-attached', 'mutation-quiet']).optional(),
        timeoutMs: z.number().int().min(250).max(60000).optional(),
        quietMs: z.number().int().min(100).max(10000).optional(),
      }).strict(),
    }),
    definition({
      canonicalName: 'web.form.inspect',
      consoleName: 'read_.web.form.inspect',
      route: '/inspect',
      capabilityName: 'web.inspect',
      access: 'read',
      description: 'Inspect the current semantic form model without mutation.',
      inputSchema: z.object({}).strict(),
    }),
    definition({
      canonicalName: 'web.page.click',
      consoleName: 'write.web.page.click',
      route: '/click',
      capabilityName: 'web.click',
      access: 'write',
      description: 'Perform a revision-bound non-final click and verify the resulting transition.',
      inputSchema: z.object({
        expectedTargetId: z.string().optional(),
        expectedPageRevision: z.string().optional(),
        expectedFormRevision: z.string().optional(),
        correlation: webExecutionCorrelationSchema.optional(),
        text: z.string().optional(),
        selector: z.string().optional(),
        nth: z.number().int().nonnegative().optional(),
      }).strict(),
    }),
    definition({
      canonicalName: 'web.form.extract',
      consoleName: 'read_.web.form.extract',
      route: '/extract-form',
      legacyName: 'web.extract_form',
      capabilityName: 'web.extract_form',
      access: 'read',
      description: 'Extract the current semantic form snapshot.',
      inputSchema: z.object({}).strict(),
    }),
    definition({
      canonicalName: 'web.form.proposal.preview',
      consoleName: 'write.web.form.proposal.preview',
      route: '/propose',
      legacyName: 'web.propose',
      capabilityName: 'web.propose',
      access: 'write',
      description: 'Build normalized answer proposals and mint a revision-bound one-time fill approval receipt.',
      inputSchema: z.object({
        fields: z.array(z.record(z.unknown())),
      }).strict(),
    }),
    definition({
      canonicalName: 'web.form.fill',
      consoleName: 'write.web.form.fill',
      route: '/fill-after-approval',
      legacyName: 'web.fill_after_approval',
      capabilityName: 'web.fill_after_approval',
      access: 'write',
      description: 'Apply an explicitly approved, receipt-bound set of semantic form mutations with postcondition verification.',
      inputSchema: z.object({
        approved: z.boolean(),
        approvalText: z.string(),
        approvalReceiptId: z.string().min(1).optional(),
        expectedTargetId: z.string().optional(),
        expectedPageRevision: z.string().optional(),
        expectedFormRevision: z.string().optional(),
        correlation: webExecutionCorrelationSchema.optional(),
        fields: z.array(z.record(z.unknown())),
      }).strict(),
    }),
    definition({
      canonicalName: 'web.form.upload',
      consoleName: 'write.web.form.upload',
      route: '/upload-artifact',
      legacyName: 'web.upload_artifact',
      capabilityName: 'web.upload_artifact',
      access: 'write',
      description: 'Upload one approved guarded artifact reference to an exact semantic file control.',
      inputSchema: z.object({
        approved: z.boolean(),
        approvalText: z.string(),
        expectedTargetId: z.string().optional(),
        expectedPageRevision: z.string().optional(),
        expectedFormRevision: z.string().optional(),
        correlation: webExecutionCorrelationSchema.optional(),
        controlId: z.string().optional(),
        selector: z.string().optional(),
        artifactRef: z.string().min(1),
        expectedSha256: z.string().regex(/^[A-Fa-f0-9]{64}$/).optional(),
      }).strict(),
    }),
    definition({
      canonicalName: 'web.form.review.snapshot',
      consoleName: 'write.web.form.review.snapshot',
      route: '/review-before-submit',
      legacyName: 'web.review_before_submit',
      capabilityName: 'web.review_before_submit',
      access: 'write',
      description: 'Capture the exact pre-submit review revision and mint its one-time submit approval receipt.',
      inputSchema: z.object({}).strict(),
    }),
    definition({
      canonicalName: 'web.form.submit',
      consoleName: 'write.web.form.submit',
      route: '/submit-after-approval',
      capabilityName: 'web.submit_after_approval',
      access: 'write',
      description: 'Perform the final submit only with explicit approval and exact revision/receipt binding, then verify or explicitly mark the postcondition uncertain.',
      inputSchema: z.object({
        approved: z.boolean(),
        approvalText: z.string(),
        approvalReceiptId: z.string().min(1).optional(),
        expectedTargetId: z.string().optional(),
        expectedPageRevision: z.string().optional(),
        expectedFormRevision: z.string().optional(),
        correlation: webExecutionCorrelationSchema.optional(),
        reviewHash: z.string().optional(),
        text: z.string().optional(),
        selector: z.string().optional(),
        nth: z.number().int().nonnegative().optional(),
      }).strict(),
    }),
  ]);
}

function registerWebCoreDomainToolDefinitions(mcpServer, registry) {
  for (const tool of createWebCoreDomainToolDefinitions()) {
    const config = {
      description: tool.description,
      inputSchema: tool.inputSchema,
    };
    const handler = async (input) => toolResult(await registry.callTool(tool.capabilityName, tool.toPayload(input)));
    mcpServer.registerTool(tool.canonicalName, config, handler);
    for (const alias of tool.aliases) {
      mcpServer.registerTool(alias, config, handler);
    }
  }
}

function definition({ canonicalName, consoleName, route, legacyName = null, capabilityName, access, description, inputSchema, toPayload = identity }) {
  const aliases = [...new Set([capabilityName, legacyName].filter(Boolean))];
  return Object.freeze({
    canonicalName,
    consoleName,
    route,
    aliases: Object.freeze(aliases),
    capabilityName,
    access,
    description,
    inputSchema,
    toPayload,
  });
}

function identity(input) {
  return input ?? {};
}

function toolResult(result) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}


module.exports = {
  webExecutionCorrelationSchema,
  createWebCoreDomainToolDefinitions,
  registerWebCoreDomainToolDefinitions,
};

