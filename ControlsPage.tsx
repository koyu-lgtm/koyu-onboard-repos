// Controls: this rig's eval surface — LIBERO sim eval of the cloned ACT
// policy, driven over the bridge (see the primer at the top of
// src/lib/useBridge.ts).
//
// - Both sim cameras stream MJPEG straight from the bridge origin
//   (http://<host>:8765), never through the vite proxy, and img.src is
//   cleared on unmount so the streams end with the page.
// - The robot pose plot accumulates eval/obs/state client-side into a ring
//   buffer (the bridge is latest-value; history is ours to keep) and renders
//   through features/datasets/TimeSeriesPlot.tsx.
// - Text telemetry rides the two blackboard cells: eval/telemetry (driver
//   state machine) and recorder/telemetry (capture identity).
// - Start/Stop/Reset ring eval/control events 1/2/3. STOP kills the episode
//   mid-flight and its partial recording is DISCARDED — nothing touches
//   disk. When the driver lands in STOPPED, Reset pulses: reset before
//   starting a new session.

import { useEffect, useRef, useState } from 'react'

import { ringEvent, useEventFeed, useTopic } from '../../../lib/useBridge'
import { TimeSeriesPlot } from '../../datasets/TimeSeriesPlot'

const BRIDGE_ORIGIN = `http://${location.hostname}:8765`

// eval/control verbs (LIBERO eval.py state machine)
const EV_START = 1
const EV_STOP = 2
const EV_RESET = 3

const EVAL_STATES: Record<number, string> = { 0: 'IDLE', 1: 'RUNNING', 2: 'STOPPED' }
const REC_STATES: Record<number, string> = { 0: 'IDLE', 1: 'RECORDING' }
const EPISODE_EVENTS: Record<number, string> = { 1: 'CAPTURED', 2: 'DISCARDED', 3: 'FAILED' }

// Live provenance: whatever the eval driver armed in recording-context.json
// (rewritten per episode), served by the bridge at GET /context and reached
// same-origin through the vite /bridge proxy — no CORS surface.
type RecordingContext = {
  task?: string
  requested_manifest?: string
  collection_mode?: string
  source_project_id?: string
  source_run_id?: string
  source_checkpoint?: string
  policy_name?: string
}

function useRecordingContext(pollMs = 2000): RecordingContext | null {
  const [ctx, setCtx] = useState<RecordingContext | null>(null)

  useEffect(() => {
    let dead = false
    const tick = async () => {
      try {
        const r = await fetch('/bridge/context')
        if (!r.ok) return
        const data = (await r.json()) as RecordingContext
        if (!dead && Object.keys(data).length > 0) setCtx(data)
      } catch {
        // bridge down or runtime idle — the strip just keeps its last values
      }
    }
    tick()
    const t = setInterval(tick, pollMs)
    return () => {
      dead = true
      clearInterval(t)
    }
  }, [pollMs])

  return ctx
}

const POSE_DIMS = 9 // 7 joint angles + 2 gripper
const POSE_NAMES = ['j0', 'j1', 'j2', 'j3', 'j4', 'j5', 'j6', 'g0', 'g1']
const POSE_HISTORY = 600 // ~30 s at the 20 Hz lockstep

type EvalCell = {
  state: number
  episode: number
  step: number
  successes: number
  trials_done: number
  trials_total: number
  task: string
}

type RecorderCell = {
  state: number
  frames: number
  capture_id: string
}

function CameraTile({ topic, label }: { topic: string; label: string }) {
  const imgRef = useRef<HTMLImageElement>(null)

  // Assign src in the effect (not JSX): React StrictMode double-mounts in dev,
  // so the cleanup's src='' would otherwise blank the JSX-set src for good.
  // Clearing src on unmount still holds: the MJPEG connection dies with the
  // page instead of lingering in the bridge origin's pool.
  useEffect(() => {
    const img = imgRef.current
    if (img) img.src = `${BRIDGE_ORIGIN}/mjpeg/${topic}?fps=15`
    return () => {
      if (img) img.src = ''
    }
  }, [topic])

  return (
    <div className="rig-cam">
      <img ref={imgRef} alt={label} />
      <span className="rig-cam-label">{label}</span>
    </div>
  )
}

export function ControlsPage() {
  const evalTele = useTopic<EvalCell>('eval/telemetry', 'EvalTelemetry', 5)
  const recTele = useTopic<RecorderCell>('recorder/telemetry', 'RecorderTelemetry', 5)
  const episodeFeed = useEventFeed('recorder/episode', 4)

  // Pose history: accumulate the stream client-side, deduped by frame_id.
  const [pose, setPose] = useState<{ frames: number[]; rows: number[][] }>({ frames: [], rows: [] })
  const lastFrameRef = useRef<number>(-1)
  const state = useTopic<{ values: number[] }>('eval/obs/state', 'VecCell', 20)

  useEffect(() => {
    if (!state || state.frame_id === lastFrameRef.current) return
    lastFrameRef.current = state.frame_id
    const vec = (state.values.values ?? []).slice(0, POSE_DIMS).map(Number)
    if (vec.length < POSE_DIMS) return
    setPose((prev) => {
      const frames = [...prev.frames, state.frame_id].slice(-POSE_HISTORY)
      const rows = [...prev.rows, vec].slice(-POSE_HISTORY)
      return { frames, rows }
    })
  }, [state])

  const evalState = evalTele?.values.state
  const stopped = evalState === 2
  const ctx = useRecordingContext()

  return (
    <div className="rig-page">
      <div className="rig-row rig-row-top">
        <div className="rig-cams">
          <CameraTile topic="eval/obs/agentview" label="agentview" />
          <CameraTile topic="eval/obs/wrist" label="wrist" />
        </div>

        <div className="rig-card">
          <div className="rig-card-head">
            <span className="rig-card-title">eval</span>
            <span className={`controls-badge ${evalState === 1 ? 'controls-badge-running' : ''} ${stopped ? 'controls-badge-stopped' : ''}`}>
              {evalState === undefined ? 'OFFLINE' : EVAL_STATES[evalState] ?? `state ${evalState}`}
            </span>
          </div>
          <div className="rig-facts">
            <span>trials <b>{evalTele ? `${evalTele.values.trials_done}/${evalTele.values.trials_total}` : '—'}</b></span>
            <span>success <b>{evalTele?.values.successes ?? '—'}</b></span>
            <span>step <b>{evalTele?.values.step ?? '—'}</b></span>
          </div>
          <p className="rig-task">{evalTele?.values.task || '—'}</p>
          <div className="controls-actions">
            <button
              type="button"
              className={`controls-btn ${stopped ? '' : 'controls-btn-primary'}`}
              onClick={() => ringEvent('eval/control', EV_START)}
            >
              Start
            </button>
            <button type="button" className="controls-btn" onClick={() => ringEvent('eval/control', EV_STOP)}>
              Stop
            </button>
            <button
              type="button"
              className={`controls-btn ${stopped ? 'controls-btn-reset-highlight' : ''}`}
              onClick={() => ringEvent('eval/control', EV_RESET)}
            >
              Reset
            </button>
          </div>
          <p className="rig-note">
            Stop discards this episode's recording. Reset before starting a new session.
          </p>
        </div>

        <div className="rig-card">
          <div className="rig-card-head">
            <span className="rig-card-title">recorder</span>
            <span className={`controls-badge ${recTele?.values.state === 1 ? 'controls-badge-running' : ''}`}>
              {recTele ? REC_STATES[recTele.values.state] ?? `state ${recTele.values.state}` : 'OFFLINE'}
            </span>
          </div>
          <div className="rig-facts">
            <span>frames <b>{recTele?.values.frames ?? '—'}</b></span>
          </div>
          <p className="rig-mono">{recTele?.values.capture_id || 'no capture'}</p>
          {episodeFeed.length > 0 && (
            <div className="rig-feed">
              {episodeFeed.map((e, i) => (
                <p className="rig-feed-row" key={`${e.at}-${i}`}>
                  <span>{EPISODE_EVENTS[e.event_id] ?? `event ${e.event_id}`}</span>
                  <span>{new Date(e.at).toLocaleTimeString()}</span>
                </p>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="rig-row rig-row-plot">
        {pose.rows.length > 1 ? (
          <TimeSeriesPlot
            series={{ key: 'pose — eval/obs/state', names: POSE_NAMES, rows: pose.rows }}
            frameIndices={pose.frames}
          />
        ) : (
          <div className="rig-plot-empty">
            pose — eval/obs/state · start an eval to see the trace
          </div>
        )}
      </div>

      <div className="rig-provenance">
        <span className="rig-card-title">provenance</span>
        {ctx ? (
          <>
            <span className="rig-prov-item"><em>policy</em> {ctx.policy_name ?? '—'}</span>
            <span className="rig-prov-item"><em>checkpoint</em> {ctx.source_checkpoint ?? '—'}</span>
            <span className="rig-prov-item"><em>run</em> <code>{ctx.source_run_id ?? '—'}</code></span>
            <span className="rig-prov-item"><em>project</em> <code>{ctx.source_project_id ?? '—'}</code></span>
            <span className="rig-prov-item"><em>manifest</em> {ctx.requested_manifest ?? '—'}</span>
          </>
        ) : (
          <span className="rig-note">no context armed yet — it appears with the first episode</span>
        )}
      </div>
    </div>
  )
}
