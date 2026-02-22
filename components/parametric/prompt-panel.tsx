'use client'

import { useState, useRef, useCallback } from 'react'
import type { DesignTree, ScoreResult } from '@/lib/types'
import { useStore } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Send, Loader2, ChevronRight, X } from 'lucide-react'

// ─── Demo prompts ─────────────────────────────────────────────────
const DEMO_PROMPTS = [
  { label: 'Spur Gear', prompt: 'Spur gear with 20 teeth, module 2, pitch diameter 40mm, 10mm thick, 5mm center bore hole, chamfered edges' },
  { label: 'Ribbed Vase', prompt: 'Tall ribbed vase 200mm height, 60mm outer diameter, 3mm wall thickness, 12 evenly spaced vertical ribs, hollow interior, symmetric' },
  { label: 'L-Bracket', prompt: 'L-shaped mounting bracket, 80mm vertical leg, 60mm horizontal leg, 3mm wall thickness, 4 mounting holes 5mm diameter at corners, filleted inner corner radius 5mm' },
  { label: 'Enclosure', prompt: 'Rectangular electronics enclosure box 90x60x30mm, 2mm wall thickness, hollow interior, 4 screw bosses at corners 3mm inner diameter, open top' },
  { label: 'Flanged Bearing', prompt: 'Flanged bearing housing, 50mm outer flange diameter, 20mm bore, 25mm tall cylindrical body, 4 bolt holes on flange 4mm diameter on 40mm bolt circle, 3mm flange thickness' },
]



export default function PromptPanel() {
  const store = useStore()
  const [localPrompt, setLocalPrompt] = useState('')
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [imageBase64, setImageBase64] = useState<string | null>(null)
  const [imageMimeType, setImageMimeType] = useState<string>('image/png')
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const processImage = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) return
    setImageMimeType(file.type)
    const reader = new FileReader()
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string
      setImagePreview(dataUrl)
      const base64 = dataUrl.split(',')[1]
      setImageBase64(base64)
    }
    reader.readAsDataURL(file)
  }, [])

  const analyzeAndGenerate = useCallback(async () => {
    if (!imageBase64) return
    setIsAnalyzing(true)
    store.appendAgentLog({
      agent: 'System',
      message: 'Analyzing image with Nemotron Vision...',
      timestamp: Date.now(),
    })
    try {
      const res = await fetch('/api/analyze-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64, mimeType: imageMimeType }),
      })
      if (!res.ok) {
        const err = await res.json()
        store.appendAgentLog({
          agent: 'System',
          message: `Image analysis failed: ${err.error}`,
          timestamp: Date.now(),
        })
        setIsAnalyzing(false)
        return
      }
      const { description, dir, model } = await res.json()
      setLocalPrompt(description)
      setIsAnalyzing(false)

      store.appendAgentLog({
        agent: 'System',
        message: `Vision analysis complete via ${model || 'VLM'}${dir ? ` — family: ${dir.family} (${(dir.confidence * 100).toFixed(0)}% confidence), ${dir.features?.length || 0} features detected` : ''}`,
        timestamp: Date.now(),
      })

      if (dir) {
        store.appendAgentLog({
          agent: 'System',
          message: `DIR: ratio=${dir.global?.height_width_ratio?.toFixed(1)}, symmetry=${dir.global?.symmetry?.type}(${dir.global?.symmetry?.score?.toFixed(2)}), detail=${dir.global?.detail_level?.toFixed(1)}`,
          timestamp: Date.now(),
        })
      }

      // Auto-generate from the DIR-derived deterministic prompt
      streamGenerate(description)
    } catch (err) {
      store.appendAgentLog({
        agent: 'System',
        message: `Image analysis error: ${err instanceof Error ? err.message : 'unknown'}`,
        timestamp: Date.now(),
      })
      setIsAnalyzing(false)
    }
  }, [imageBase64, imageMimeType])

  const clearImage = () => {
    setImagePreview(null)
    setImageBase64(null)
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) processImage(file)
  }, [processImage])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData.items
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) processImage(file)
        break
      }
    }
  }, [processImage])

  async function compileOnServer(code: string, tree: DesignTree | null, scores: ScoreResult | null) {
    try {
      store.setPhase('compiling')
      store.appendAgentLog({
        agent: 'System',
        message: 'Sending code to Build123d compiler...',
        timestamp: Date.now(),
      })

      const res = await fetch('/api/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })

      if (!res.ok) {
        let errMsg = 'Compilation failed'
        try {
          const errBody = await res.json()
          errMsg = errBody.error || errMsg
        } catch {
          errMsg = await res.text() || errMsg
        }
        store.appendAgentLog({
          agent: 'System',
          message: `Compile error (${res.status}): ${errMsg}`,
          timestamp: Date.now(),
        })
        store.setPhase('done')
        return
      }

      const stlBuffer = await res.arrayBuffer()

      // Extract BREP geometry metrics from compile response
      const metricsHeader = res.headers.get('X-Geometry-Metrics')
      let geometryMetrics = null
      if (metricsHeader) {
        try {
          geometryMetrics = JSON.parse(metricsHeader)
          console.log('[prompt-panel] BREP metrics:', geometryMetrics)
          store.setGeometryMetrics(geometryMetrics)
        } catch {}
      }

      if (stlBuffer.byteLength < 84) {
        store.appendAgentLog({
          agent: 'System',
          message: 'Compile returned empty/invalid STL',
          timestamp: Date.now(),
        })
        store.setPhase('done')
        return
      }

      store.setStlBuffer(stlBuffer)
      store.appendAgentLog({
        agent: 'System',
        message: `3D geometry compiled successfully (${(stlBuffer.byteLength / 1024).toFixed(1)} KB)`,
        timestamp: Date.now(),
      })
      store.addToHistory({
        scadCode: code,
        stlBuffer: stlBuffer,
        scores: scores,
        tree: tree,
        label: `v${(useStore.getState().designHistory?.length || 0) + 1}`,
      })
      // Re-score with real BREP metrics
      if (geometryMetrics && tree) {
        const { scoreDesign } = await import('@/lib/scoring')
        const updatedScores = scoreDesign(tree, store.prompt, geometryMetrics)
        store.setScores(updatedScores)
        store.appendAgentLog({
          agent: 'Evaluation',
          message: 'Re-scored with BREP metrics: ' + updatedScores.overall.toFixed(2) +
            ' (vol=' + (geometryMetrics.volume?.toFixed(1) || '?') +
            ' faces=' + (geometryMetrics.face_count || '?') +
            ' valid=' + (geometryMetrics.is_valid ? 'yes' : 'NO') + ')',
          timestamp: Date.now(),
        })
      }

      store.setPhase('done')
    } catch (err) {
      store.appendAgentLog({
        agent: 'System',
        message: `Compile failed: ${err instanceof Error ? err.message : 'network error'}`,
        timestamp: Date.now(),
      })
      store.setPhase('done')
    }
  }

  // SSE stream handler
  async function streamGenerate(prompt: string) {
    store.reset()
    store.setPrompt(prompt)
    store.clearAgentLog()
    store.setStlBuffer(null)

    let latestCode = ''
    let latestTree = null
    let latestScores = null

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      })

      if (!response.ok || !response.body) {
        store.setPhase('error')
        store.setErrorMessage('API request failed — check your API keys')
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6))
            switch (event.type) {
              case 'phase':
                store.setPhase(event.phase)
                break
              case 'tree':
                latestTree = event.data
                store.setDesignTree(event.data)
                break
              case 'code':
                latestCode = event.data
                store.setScadCode(event.data)
                if (latestCode) {
                  compileOnServer(latestCode, latestTree, latestScores)
                }
                break
              case 'scores':
                latestScores = event.data
                store.setScores(event.data)
                break
              case 'agent_done':
                store.appendAgentLog({
                  agent: event.agent,
                  message: `Completed — ~${event.tokens} tokens, $${event.cost.toFixed(4)}`,
                  timestamp: Date.now(),
                })
                store.setAgentMetrics(event.agent, { tokens: event.tokens, cost: event.cost, endTime: Date.now() })
                break
              case 'agent_log':
                store.appendAgentLog({
                  agent: event.agent,
                  message: event.message,
                  timestamp: Date.now(),
                })
                break
              case 'nemotron_thinking':
                store.setNemotronThinking(event.text ?? '')
                break
              case 'nemotron_reasoning_done':
                store.setNemotronReasoning(event.summary ?? '')
                break
              case 'error':
                store.setPhase('error')
                store.setErrorMessage(event.message ?? 'Unknown error')
                break
            }
          } catch {
            // Malformed SSE line — skip
          }
        }
      }

    } catch (err) {
      store.setPhase('error')
      store.setErrorMessage(
        err instanceof Error ? err.message : 'Network error'
      )
    }
  }

  const handleGenerate = () => {
    if (!localPrompt.trim() || isLoading) return
    streamGenerate(localPrompt.trim())
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handleGenerate()
    }
  }

  const isLoading = !['idle', 'done', 'error'].includes(store.phase)

  return (
    <div className="flex flex-col gap-3 p-4 border-t border-border bg-card">

      {/* ── Template chips + upload ── */}
      <div className="flex flex-wrap items-center gap-1.5">
        {DEMO_PROMPTS.map((dp) => (
          <button
            key={dp.label}
            onClick={() => setLocalPrompt(dp.prompt)}
            className="px-2.5 py-1 rounded-md text-xs bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground border border-border transition-colors"
          >
            {dp.label}
          </button>
        ))}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => { if (e.target.files?.[0]) processImage(e.target.files[0]) }}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          title="Upload image"
          className="w-7 h-7 rounded-md flex items-center justify-center bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground border border-border transition-colors"
        >
          <span className="text-sm leading-none">+</span>
        </button>
      </div>

      {/* ── Image preview ── */}
      {imagePreview && (
        <div className="relative flex items-start gap-2 p-2 rounded-lg bg-muted/50 border border-border w-full">
          <img src={imagePreview} alt="Input" className="h-16 w-16 object-cover rounded" />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground">Image ready for analysis</p>
            <button
              onClick={analyzeAndGenerate}
              disabled={isAnalyzing || isLoading}
              className="mt-1 px-3 py-1 rounded text-xs font-medium bg-white/10 hover:bg-white/20 text-white border border-white/20 disabled:opacity-50 transition-colors"
            >
              {isAnalyzing ? 'Analyzing...' : 'Generate from Image'}
            </button>
          </div>
          <button onClick={clearImage} className="absolute top-1 right-1 p-0.5 rounded-full hover:bg-white/10">
            <X className="w-3 h-3 text-muted-foreground" />
          </button>
        </div>
      )}

      {/* ── Input row ── */}
      <div
        className="flex gap-2"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        <div className="flex-1">
          <Textarea
            value={localPrompt}
            onChange={(e) => setLocalPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="Describe a 3D object, or drop/paste an image... (⌘+Enter to generate)"
            rows={2}
            className="w-full resize-y bg-background text-sm max-h-32 overflow-y-auto"
            disabled={isLoading}
          />
        </div>
        <Button
          onClick={handleGenerate}
          disabled={isLoading || !localPrompt.trim()}
          className="self-end h-10 px-4"
        >
          {isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </Button>
      </div>

      {/* ── Error display ── */}
      {store.phase === 'error' && store.errorMessage && (
        <div className="px-3 py-2 rounded-md bg-red-950/50 border border-red-800 text-red-300 text-xs">
          {store.errorMessage}
        </div>
      )}

    </div>
  )
}
