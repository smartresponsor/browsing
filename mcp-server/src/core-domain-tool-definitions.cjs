const { z } = require('zod');

const networkExecutionCorrelationSchema = z.object({
  taskId: z.string().min(1).max(200).optional(),
  runId: z.string().min(1).max(200).optional(),
  invocationId: z.string().min(1).max(200).optional(),
}).strict();

function createNetworkCoreDomainToolDefinitions() {
  return Object.freeze([
    definition({
      canonicalName: 'network.browser_targets',
      consoleName: 'console.read_.network.browser.targets',
      route: '/browser-targets',
      capabilityName: 'network.browser_targets',
      access: 'read',
      description: 'List supervised browser pages with stable target identity, URLs, titles, and active-page identity.',
      inputSchema: z.object({}).strict(),
    }),
    definition({
      canonicalName: 'network.browser_bind',
      consoleName: 'console.write.network.browser.bind',
      route: '/browser-bind',
      capabilityName: 'network.browser_bind',
      access: 'write',
      description: 'Bind Network domain semantics to a specific Console-owned browser target by exact target identity or compatibility locator.',
      inputSchema: z.object({
        targetId: z.string().min(1).optional(),
        index: z.number().int().nonnegative().optional(),
        url: z.string().optional(),
        urlContains: z.string().optional(),
      }).strict(),
    }),
    definition({
      canonicalName: 'network.open',
      consoleName: 'console.write.network.target.open',
      route: '/open',
      capabilityName: 'network.open',
      access: 'write',
      description: 'Navigate the Network-bound Console-owned browser target to an HTTP(S) URL.',
      inputSchema: z.object({
        url: z.string().url(),
      }).strict(),
    }),
    definition({
      canonicalName: 'network.job.open',
      consoleName: 'console.write.network.job.open',
      route: '/open-job',
      legacyName: 'network.open_job',
      capabilityName: 'network.open_job',
      access: 'write',
      description: 'Open a normalized job URL through Network domain semantics.',
      inputSchema: z.object({
        url: z.string().url(),
      }).strict(),
    }),
    definition({
      canonicalName: 'network.chatgpt.snapshot',
      consoleName: 'console.read_.network.chatgpt.snapshot',
      route: '/chatgpt-snapshot',
      legacyName: 'network.chatgpt_snapshot',
      capabilityName: 'network.chatgpt_snapshot',
      access: 'read',
      description: 'Read the bound ChatGPT Web target URL and message snapshot for semantic execution gating.',
      inputSchema: z.object({}).strict(),
    }),
    definition({
      canonicalName: 'network.page_capture',
      consoleName: 'console.read_.network.page.capture',
      route: '/page-capture',
      capabilityName: 'network.page_capture',
      access: 'read',
      description: 'Capture page identity, revisions, semantic form state, submit candidates, and optional review screenshot evidence.',
      inputSchema: z.object({
        screenshot: z.boolean().optional(),
      }).strict(),
    }),
    definition({
      canonicalName: 'network.wait_for_ready',
      consoleName: 'console.read_.network.page.wait',
      route: '/wait-for-ready',
      capabilityName: 'network.wait_for_ready',
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
      canonicalName: 'network.inspect',
      consoleName: 'console.read_.network.form.inspect',
      route: '/inspect',
      capabilityName: 'network.inspect',
      access: 'read',
      description: 'Inspect the current semantic form model without mutation.',
      inputSchema: z.object({}).strict(),
    }),
    definition({
      canonicalName: 'network.click',
      consoleName: 'console.write.network.page.click',
      route: '/click',
      capabilityName: 'network.click',
      access: 'write',
      description: 'Perform a revision-bound non-final click and verify the resulting transition.',
      inputSchema: z.object({
        expectedTargetId: z.string().optional(),
        expectedPageRevision: z.string().optional(),
        expectedFormRevision: z.string().optional(),
        correlation: networkExecutionCorrelationSchema.optional(),
        text: z.string().optional(),
        selector: z.string().optional(),
        nth: z.number().int().nonnegative().optional(),
      }).strict(),
    }),
    definition({
      canonicalName: 'network.form.extract',
      consoleName: 'console.read_.network.form.extract',
      route: '/extract-form',
      legacyName: 'network.extract_form',
      capabilityName: 'network.extract_form',
      access: 'read',
      description: 'Extract the current semantic form snapshot.',
      inputSchema: z.object({}).strict(),
    }),
    definition({
      canonicalName: 'network.form.proposal.preview',
      consoleName: 'console.write.network.form.proposal.preview',
      route: '/propose',
      legacyName: 'network.propose',
      capabilityName: 'network.propose',
      access: 'write',
      description: 'Build normalized answer proposals and mint a revision-bound one-time fill approval receipt.',
      inputSchema: z.object({
        fields: z.array(z.record(z.unknown())),
      }).strict(),
    }),
    definition({
      canonicalName: 'network.form.fill',
      consoleName: 'console.write.network.form.fill',
      route: '/fill-after-approval',
      legacyName: 'network.fill_after_approval',
      capabilityName: 'network.fill_after_approval',
      access: 'write',
      description: 'Apply an explicitly approved, receipt-bound set of semantic form mutations with postcondition verification.',
      inputSchema: z.object({
        approved: z.boolean(),
        approvalText: z.string(),
        approvalReceiptId: z.string().min(1).optional(),
        expectedTargetId: z.string().optional(),
        expectedPageRevision: z.string().optional(),
        expectedFormRevision: z.string().optional(),
        correlation: networkExecutionCorrelationSchema.optional(),
        fields: z.array(z.record(z.unknown())),
      }).strict(),
    }),
    definition({
      canonicalName: 'network.form.upload',
      consoleName: 'console.write.network.form.upload',
      route: '/upload-artifact',
      legacyName: 'network.upload_artifact',
      capabilityName: 'network.upload_artifact',
      access: 'write',
      description: 'Upload one approved guarded artifact reference to an exact semantic file control.',
      inputSchema: z.object({
        approved: z.boolean(),
        approvalText: z.string(),
        expectedTargetId: z.string().optional(),
        expectedPageRevision: z.string().optional(),
        expectedFormRevision: z.string().optional(),
        correlation: networkExecutionCorrelationSchema.optional(),
        controlId: z.string().optional(),
        selector: z.string().optional(),
        artifactRef: z.string().min(1),
        expectedSha256: z.string().regex(/^[A-Fa-f0-9]{64}$/).optional(),
      }).strict(),
    }),
    definition({
      canonicalName: 'network.form.review.snapshot',
      consoleName: 'console.write.network.form.review.snapshot',
      route: '/review-before-submit',
      legacyName: 'network.review_before_submit',
      capabilityName: 'network.review_before_submit',
      access: 'write',
      description: 'Capture the exact pre-submit review revision and mint its one-time submit approval receipt.',
      inputSchema: z.object({}).strict(),
    }),
    definition({
      canonicalName: 'network.submit_after_approval',
      consoleName: 'console.write.network.submit',
      route: '/submit-after-approval',
      capabilityName: 'network.submit_after_approval',
      access: 'write',
      description: 'Perform the final submit only with explicit approval and exact revision/receipt binding, then verify or explicitly mark the postcondition uncertain.',
      inputSchema: z.object({
        approved: z.boolean(),
        approvalText: z.string(),
        approvalReceiptId: z.string().min(1).optional(),
        expectedTargetId: z.string().optional(),
        expectedPageRevision: z.string().optional(),
        expectedFormRevision: z.string().optional(),
        correlation: networkExecutionCorrelationSchema.optional(),
        reviewHash: z.string().optional(),
        text: z.string().optional(),
        selector: z.string().optional(),
        nth: z.number().int().nonnegative().optional(),
      }).strict(),
    }),
  ]);
}

function registerNetworkCoreDomainToolDefinitions(mcpServer, registry) {
  for (const tool of createNetworkCoreDomainToolDefinitions()) {
    const config = {
      description: tool.description,
      inputSchema: tool.inputSchema,
    };
    const handler = async (input) => toolResult(await registry.callTool(tool.capabilityName, tool.toPayload(input)));
    mcpServer.registerTool(tool.canonicalName, config, handler);
    if (tool.legacyName) {
      mcpServer.registerTool(tool.legacyName, config, handler);
    }
  }
}

function definition({ canonicalName, consoleName, route, legacyName = null, capabilityName, access, description, inputSchema, toPayload = identity }) {
  return Object.freeze({
    canonicalName,
    consoleName,
    route,
    legacyName,
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
  networkExecutionCorrelationSchema,
  createNetworkCoreDomainToolDefinitions,
  registerNetworkCoreDomainToolDefinitions,
};

