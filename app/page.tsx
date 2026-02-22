'use client'

import dynamic from 'next/dynamic'
import { useStore } from '@/lib/store'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { Badge } from '@/components/ui/badge'
import PromptPanel from '@/components/parametric/prompt-panel'
import { Boxes } from 'lucide-react'

const NodeGraph = dynamic(
  () => import('@/components/parametric/node-graph'),
  { ssr: false }
)

const Viewport3D = dynamic(
  () => import('@/components/parametric/viewport-3d'),
  { ssr: false }
)

const AgentMonitor = dynamic(
  () => import('@/components/parametric/agent-monitor'),
  { ssr: false }
)

const PHASE_LABELS: Record<string, string> = {
  idle: 'Ready',
  parsing: 'Parsing intent...',
  'building-tree': 'Building graph...',
  'generating-code': 'Generating code...',
  compiling: 'Compiling geometry...',
  validating: 'Validating...',
  scoring: 'Scoring...',
  iterating: 'Iterating...',
  done: 'Complete',
  error: 'Error',
}

type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline'

function getPhaseBadgeVariant(phase: string): BadgeVariant {
  if (phase === 'error') return 'destructive'
  if (phase === 'done' || phase === 'idle') return 'outline'
  return 'secondary'
}

export default function Home() {
  const { phase, iteration } = useStore()

  const isActive = !['idle', 'done', 'error'].includes(phase)

  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">

      {/* ── Header ── */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-border bg-card shrink-0 h-12">
        <div className="flex items-center gap-2.5">
          <Boxes className="w-5 h-5 text-accent" />
          <span className="font-semibold text-sm tracking-tight">
            ParaGraph
          </span>
          <span className="text-muted-foreground text-xs hidden sm:block">
            AI Parametric Design Studio
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Badge
            variant={getPhaseBadgeVariant(phase)}
            className={isActive ? 'animate-pulse' : ''}
          >
            {PHASE_LABELS[phase] ?? phase}
          </Badge>
          {iteration > 0 && (
            <span className="text-muted-foreground text-xs">
              Iteration {iteration}
            </span>
          )}
        </div>
      </header>

      {/* ── Main content: Resizable viewport/graph + fixed sidebar ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left: Viewport and Node Graph (horizontally resizable) */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Top: Viewport and Graph side-by-side */}
          <PanelGroup direction="horizontal" className="flex-1">
            <Panel defaultSize={50} minSize={25}>
              <div className="w-full h-full">
                <Viewport3D />
              </div>
            </Panel>

            <PanelResizeHandle className="w-1.5 bg-border hover:bg-blue-500 transition-colors cursor-col-resize" />

            <Panel defaultSize={50} minSize={25}>
              <div className="w-full h-full overflow-hidden">
                <NodeGraph />
              </div>
            </Panel>
          </PanelGroup>

          {/* Bottom: Prompt Panel */}
          <div className="shrink-0 border-t border-border">
            <PromptPanel />
          </div>
        </div>

        {/* Right: Fixed sidebar with scrollable content */}
        <div className="w-[340px] shrink-0 border-l border-border overflow-y-auto">
          <AgentMonitor />
        </div>

      </div>
    </div>
  )
}
