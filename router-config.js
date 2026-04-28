// router-config.js — Smart model routing configuration for cocapn.ai
// Maps patterns to cheapest capable models, inspired by manifest/ds2api/semantic-router
//
// Usage: pickModel(userMessage, userPreferences)
// Returns { model, provider, reason }

const MODELS = {
  'deepseek-chat':    { provider:'deepseek', costIn:0.14, costOut:0.28, maxTokens:8192, speed:'fast', capability:['general','code','reasoning'] },
  'deepseek-reasoner':{ provider:'deepseek', costIn:0.55, costOut:2.19, maxTokens:8192, speed:'slow', capability:['math','logic','reasoning','research'] },
  'gemini-2.5-flash': { provider:'google',   costIn:0.15, costOut:0.60, maxTokens:8192, speed:'fast', capability:['general','vision','code','multimodal'] },
  'gemini-2.5-pro':   { provider:'google',   costIn:1.25, costOut:10.0, maxTokens:8192, speed:'medium',capability:['general','vision','code','research','reasoning'] },
  'gpt-4o-mini':      { provider:'openai',   costIn:0.15, costOut:0.60, maxTokens:16384,speed:'fast', capability:['general','vision','code'] },
  'gpt-4o':           { provider:'openai',   costIn:2.50, costOut:10.0, maxTokens:16384,speed:'fast', capability:['general','vision','code','reasoning','multimodal'] },
  'claude-3-5-haiku': { provider:'anthropic',costIn:0.80, costOut:4.00, maxTokens:8192, speed:'fast', capability:['general','code','writing','reasoning'] },
  'claude-3-5-sonnet':{ provider:'anthropic',costIn:3.00, costOut:15.0, maxTokens:8192, speed:'medium',capability:['general','code','writing','reasoning','research','analysis'] },
};

// Pattern → required capability mapping
const PATTERNS = [
  // Math & Logic
  { re: /solve|calculate|compute|equation|math|integral|derivative|theorem|proof/i, caps: ['math','reasoning'], prefer: 'deepseek-reasoner' },
  // Code generation
  { re: /write.*(code|function|class|script|program)|implement.*(in|using)|create.*(function|api|endpoint)|refactor|debug/i, caps: ['code'], prefer: 'claude-3-5-haiku' },
  // Complex reasoning
  { re: /analyze|compare|contrast|evaluate|assess|why|how does|explain.*(in detail|thoroughly)/i, caps: ['reasoning','analysis'], prefer: 'gpt-4o' },
  // Research / Deep context
  { re: /research|paper|academic|study|citation|source|reference|literature/i, caps: ['research'], prefer: 'claude-3-5-sonnet' },
  // Image/vision
  { re: /image|picture|photo|screenshot|diagram|chart|graph|visual|see|look/i, caps: ['vision','multimodal'], prefer: 'gpt-4o' },
  // Simple chat
  { re: /hi|hello|hey|thanks|good|what('s| is) up/i, caps: ['general'], prefer: 'deepseek-chat' },
];

// Task classification patterns (from GenericAgent skill tree concept)
const TASK_CLASSES = {
  code: {
    weight: 3,
    keywords: ['code','function','api','class','module','library','script','program','bug','error','test','deploy','debug','compile','build','refactor','migrate','sql','query'],
  },
  creative: {
    weight: 2,
    keywords: ['write','create','design','story','poem','essay','content','blog','article','marketing','copy','brand','name','brainstorm'],
  },
  analysis: {
    weight: 2,
    keywords: ['analyze','compare','evaluate','review','assess','audit','check','verify','validate','summarize','synthesize'],
  },
};

/**
 * Smart route: pick the cheapest model that can handle the message.
 * @param {string} message - User's message
 * @param {object} opts - { preferSpeed?, maxCost?, preferProvider?, preferModel? }
 * @returns {{ model: string, reason: string, estimatedCost: number }}
 */
function smartRoute(message, opts = {}) {
  if (opts.preferModel && MODELS[opts.preferModel]) {
    const m = MODELS[opts.preferModel];
    return { model: opts.preferModel, reason: 'user preference', estimatedCost: m.costIn / 1e6 * 200 };
  }

  // Score each model
  const scores = Object.entries(MODELS).map(([name, m]) => {
    let score = 0;

    for (const pattern of PATTERNS) {
      if (pattern.re.test(message)) {
        score += pattern.caps.some(c => m.capability.includes(c)) ? 10 : 0;
        if (pattern.prefer === name) score += 5;
      }
    }

    // Token count penalty (long messages → reasoning models)
    const wordCount = message.split(' ').length;
    if (wordCount > 50 && !m.capability.includes('reasoning')) score -= 3;
    if (wordCount > 100 && m.capability.includes('reasoning')) score += 3;

    // Cost bonus (cheaper = higher score)
    const avgCost = (m.costIn + m.costOut) / 2;
    const costScore = Math.max(0, 10 - avgCost);
    score += costScore;

    // Speed preference
    if (opts.preferSpeed && m.speed === 'fast') score += 2;

    return { model: name, score, cost: (m.costIn + m.costOut) / 2 / 1e6 * wordCount * 2 };
  });

  scores.sort((a, b) => b.score - a.score);
  const best = scores[0];
  return { model: best.model, reason: `routed (score:${best.score.toFixed(0)})`, estimatedCost: best.cost };
}

/**
 * Pick from a budget-aware subset of models.
 * @param {string} message
 * @param {number} maxCostPerM - Max acceptable cost per 1M output tokens
 */
function budgetRoute(message, maxCostPerM = 0.60) {
  const available = Object.entries(MODELS).filter(([_, m]) => m.costOut <= maxCostPerM);
  const sorted = available.sort((a, b) => a[1].costOut - b[1].costOut);
  return { model: sorted[0][0], provider: sorted[0][1].provider, costPerM: sorted[0][1].costOut };
}

module.exports = { smartRoute, budgetRoute, MODELS, PATTERNS };
