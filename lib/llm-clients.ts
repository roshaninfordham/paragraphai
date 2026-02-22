/**
 * Unified LLM client supporting NVIDIA NIM, OpenRouter, and Databricks
 * Primary: NVIDIA NIM for Nemotron (structured output via guided_json)
 * Fallback: OpenRouter for multi-model routing
 * Optional: Databricks for vector search and alternative LLM gateway
 */

// ─── NVIDIA NIM (Direct) ────────────────────────────────────────

export async function nimChat(
  messages: any[],
  options: {
    model?: string
    maxTokens?: number
    temperature?: number
    guidedJson?: any
    minThinkingTokens?: number
    maxThinkingTokens?: number
    stream?: boolean
  } = {}
) {
  const {
    model = 'nvidia/nvidia-nemotron-nano-9b-v2',
    maxTokens = 1024,
    temperature = 0.6,
    guidedJson,
    minThinkingTokens = 0,
    maxThinkingTokens = 0,
    stream = false,
  } = options

  const body: any = {
    model,
    messages,
    max_tokens: maxTokens,
    temperature,
    top_p: 0.95,
    stream,
  }

  // Add thinking tokens for agentic reasoning
  if (maxThinkingTokens > 0) {
    body.extra_body = {
      min_thinking_tokens: minThinkingTokens,
      max_thinking_tokens: maxThinkingTokens,
    }
  }

  // Add structured output constraint
  if (guidedJson) {
    if (!body.extra_body) body.extra_body = {}
    body.extra_body.guided_json = guidedJson
  }

  const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`NIM error ${response.status}: ${error}`)
  }

  return response.json()
}

// ─── OpenRouter (Unified Gateway with Fallback) ──────────────────

export async function openRouterChat(
  messages: any[],
  options: {
    model?: string | string[]
    maxTokens?: number
    temperature?: number
    responseFormat?: any
    route?: 'preferred' | 'random' | 'fallback'
    plugins?: any[]
    stream?: boolean
  } = {}
) {
  const {
    model = 'anthropic/claude-sonnet-4',
    maxTokens = 1024,
    temperature = 0.7,
    responseFormat,
    route = 'fallback',
    plugins = [{ id: 'response-healing' }], // Auto-heal malformed JSON
    stream = false,
  } = options

  const body: any = {
    messages,
    max_tokens: maxTokens,
    temperature,
    stream,
    ...(Array.isArray(model) ? { models: model, route } : { model }),
    ...(responseFormat && { response_format: responseFormat }),
    ...(plugins.length > 0 && { plugins }),
  }

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://paragraph.app',
      'X-Title': 'ParaGraph',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`OpenRouter error ${response.status}: ${error}`)
  }

  return response.json()
}

// ─── Databricks LLM Gateway ────────────────────────────────────────

export async function databricksChat(
  endpoint: string,
  messages: any[],
  options: {
    maxTokens?: number
    temperature?: number
    responseFormat?: any
  } = {}
) {
  const { maxTokens = 1024, temperature = 0.7, responseFormat } = options

  const host = process.env.DATABRICKS_HOST
  const token = process.env.DATABRICKS_TOKEN

  if (!host || !token) {
    throw new Error('Databricks not configured: missing DATABRICKS_HOST or DATABRICKS_TOKEN')
  }

  const body: any = {
    messages,
    max_tokens: maxTokens,
    temperature,
    ...(responseFormat && { response_format: responseFormat }),
  }

  const response = await fetch(`${host}/serving-endpoints/${endpoint}/invocations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Databricks error ${response.status}: ${error}`)
  }

  return response.json()
}

// ─── Databricks Vector Search ──────────────────────────────────────

export async function databricksVectorSearch(
  indexName: string,
  query: string,
  options: {
    numResults?: number
    columns?: string[]
    filters?: Record<string, any>
  } = {}
) {
  const { numResults = 5, columns = [], filters = {} } = options

  const host = process.env.DATABRICKS_HOST
  const token = process.env.DATABRICKS_TOKEN

  if (!host || !token) {
    throw new Error('Databricks not configured: missing DATABRICKS_HOST or DATABRICKS_TOKEN')
  }

  const body: any = {
    query_text: query,
    num_results: numResults,
    ...(columns.length > 0 && { columns }),
    ...(Object.keys(filters).length > 0 && { filters_json: JSON.stringify(filters) }),
  }

  const response = await fetch(`${host}/api/2.0/vector-search/indexes/${indexName}/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Databricks Vector Search error ${response.status}: ${error}`)
  }

  return response.json()
}

// ─── Hybrid Chat: NIM → OpenRouter Fallback ────────────────────────

/**
 * Intelligent routing: use NIM for structured intent parsing (via guided_json),
 * fall back to OpenRouter for general-purpose chat and code generation
 */
export async function hybridChat(
  messages: any[],
  options: {
    purpose?: 'intent-parsing' | 'code-generation' | 'design-reasoning'
    guidedJsonSchema?: any
    useThinking?: boolean
    fallbackToOpenRouter?: boolean
  } = {}
) {
  const {
    purpose = 'code-generation',
    guidedJsonSchema,
    useThinking = false,
    fallbackToOpenRouter = true,
  } = options

  // Use NIM for structured intent parsing with thinking
  if (purpose === 'intent-parsing' && guidedJsonSchema) {
    try {
      const result = await nimChat(messages, {
        model: 'nvidia/nvidia-nemotron-nano-9b-v2',
        temperature: 0.1,
        guidedJson: guidedJsonSchema,
        maxThinkingTokens: useThinking ? 2048 : 0,
        maxTokens: 512,
      })
      return result
    } catch (error) {
      if (!fallbackToOpenRouter) throw error
      console.warn('[llm-clients] NIM intent parsing failed, falling back to OpenRouter')
    }
  }

  // Use NIM with thinking for design reasoning
  if (purpose === 'design-reasoning' && useThinking) {
    try {
      const result = await nimChat(messages, {
        model: 'nvidia/nvidia-nemotron-nano-9b-v2',
        temperature: 0.6,
        minThinkingTokens: 1024,
        maxThinkingTokens: 3000,
        maxTokens: 2048,
      })
      return result
    } catch (error) {
      if (!fallbackToOpenRouter) throw error
      console.warn('[llm-clients] NIM design reasoning failed, falling back to OpenRouter')
    }
  }

  // Default to OpenRouter for code generation and general chat
  return openRouterChat(messages, {
    model:
      purpose === 'code-generation'
        ? 'anthropic/claude-sonnet-4'
        : 'nvidia/nemotron-nano-9b-v2',
    temperature: purpose === 'code-generation' ? 0.3 : 0.7,
    maxTokens: purpose === 'code-generation' ? 2048 : 1024,
    route: 'fallback',
  })
}

// ─── NIM Embeddings for Vector Similarity ──────────────────────────

export async function nimEmbeddings(
  texts: string[],
  options: {
    model?: 'code' | 'qa' // code: nv-embedcode-7b-v1, qa: nv-embedqa-e5-v5
  } = {}
) {
  const { model = 'qa' } = options

  const modelId =
    model === 'code' ? 'nvidia/nv-embedcode-7b-v1' : 'nvidia/nv-embedqa-e5-v5'

  const response = await fetch('https://integrate.api.nvidia.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: modelId,
      input: texts,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`NIM Embeddings error ${response.status}: ${error}`)
  }

  const data = await response.json()
  return data.data // Array of { embedding, index }
}

// ─── Vision-Language: Nemotron 12B VL (sketch analysis) ────────────

export async function nimVisionChat(
  messages: any[], // Can include { role: "user", content: [{ type: "image_url", image_url: { url } }, { type: "text", text }] }
  options: {
    maxTokens?: number
    temperature?: number
    guidedJson?: any
  } = {}
) {
  const { maxTokens = 1024, temperature = 0.6, guidedJson } = options

  const body: any = {
    model: 'nvidia/nemotron-nano-12b-v2-vl',
    messages,
    max_tokens: maxTokens,
    temperature,
  }

  if (guidedJson) {
    body.extra_body = { guided_json: guidedJson }
  }

  const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.NVIDIA_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`NIM Vision error ${response.status}: ${error}`)
  }

  return response.json()
}
