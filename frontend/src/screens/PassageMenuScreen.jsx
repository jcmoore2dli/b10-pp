import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { passages } from '../data/passages'

/**
 * Screen 2 — Passage Menu
 * Spec §3.3, §5
 *
 * Two views:
 *   - Assigned Set (top / primary): passages tied to access code
 *   - Browse Library (secondary): full corpus
 *
 * Phase 1: No real access code routing — Assigned Set is a hardcoded
 * placeholder set of 3 passages. Browse library shows all passages.
 * Completion status is not tracked yet (Phase 2).
 */

const DOMAIN_CLUSTER_LABELS = {
  'L&W': 'Learning & Work',
  'H&E': 'Health & Environment',
  'G&S': 'Governance & Society',
  'T&S': 'Technology & Science',
  'C&B': 'Culture & Behavior',
}

const LAYER_ORDER = ['ORIENT', 'CORE', 'EXT']

// Phase 1 placeholder: hardcoded assigned set
const PLACEHOLDER_ASSIGNED_IDS = [
  'B10-COR-HLT-001',
  'B10-COR-GOV-001',
  'B10-COR-TEC-001',
]

export default function PassageMenuScreen() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('assigned')
  const [clusterFilter, setClusterFilter] = useState('ALL')
  const [layerFilter, setLayerFilter] = useState('ALL')

  const studentId = sessionStorage.getItem('b10pp_student_id') || 'Student'
  const accessCode = sessionStorage.getItem('b10pp_access_code') || '—'

  const assignedPassages = PLACEHOLDER_ASSIGNED_IDS
    .map((id) => passages.find((p) => p.passage_id === id))
    .filter(Boolean)

  const browsePassages = passages.filter((p) => {
    if (clusterFilter !== 'ALL' && p.domain_cluster !== clusterFilter) return false
    if (layerFilter !== 'ALL' && p.layer !== layerFilter) return false
    return true
  })

  function handleSelectPassage(passage) {
    navigate(`/passage/${passage.passage_id}`)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <header
        className="px-4 py-4 flex items-center justify-between"
        style={{ backgroundColor: '#1e3a5f' }}
      >
        <div>
          <p className="text-white font-bold text-lg leading-tight">B10-PP</p>
          <p className="text-blue-200 text-xs">{studentId} · {accessCode}</p>
        </div>
        <div
          className="text-xs font-semibold px-2 py-1 rounded"
          style={{ backgroundColor: '#c8a84b', color: '#1e3a5f' }}
        >
          PASSAGE MENU
        </div>
      </header>

      {/* Tab switcher */}
      <div className="flex border-b border-gray-200 bg-white">
        <button
          onClick={() => setActiveTab('assigned')}
          className={`flex-1 py-3 text-sm font-semibold border-b-2 transition-colors ${
            activeTab === 'assigned'
              ? 'border-blue-700 text-blue-700'
              : 'border-transparent text-gray-500'
          }`}
        >
          Assigned Set
        </button>
        <button
          onClick={() => setActiveTab('browse')}
          className={`flex-1 py-3 text-sm font-semibold border-b-2 transition-colors ${
            activeTab === 'browse'
              ? 'border-blue-700 text-blue-700'
              : 'border-transparent text-gray-500'
          }`}
        >
          Browse Library
        </button>
      </div>

      <main className="px-4 py-4 max-w-2xl mx-auto">
        {activeTab === 'assigned' && (
          <AssignedSetView passages={assignedPassages} onSelect={handleSelectPassage} />
        )}
        {activeTab === 'browse' && (
          <BrowseLibraryView
            passages={browsePassages}
            clusterFilter={clusterFilter}
            layerFilter={layerFilter}
            onClusterFilter={setClusterFilter}
            onLayerFilter={setLayerFilter}
            onSelect={handleSelectPassage}
          />
        )}
      </main>
    </div>
  )
}

function AssignedSetView({ passages, onSelect }) {
  if (passages.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400">
        No passages assigned. Browse the library for independent practice.
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold mb-1">
        {passages.length} passage{passages.length !== 1 ? 's' : ''} assigned
      </p>
      {passages.map((p) => (
        <PassageCard key={p.passage_id} passage={p} onSelect={onSelect} status="not_started" />
      ))}
    </div>
  )
}

function BrowseLibraryView({ passages, clusterFilter, layerFilter, onClusterFilter, onLayerFilter, onSelect }) {
  return (
    <div>
      {/* Filters */}
      <div className="flex gap-2 flex-wrap mb-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500 font-medium">Domain</label>
          <select
            value={clusterFilter}
            onChange={(e) => onClusterFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
          >
            <option value="ALL">All domains</option>
            {Object.entries(DOMAIN_CLUSTER_LABELS).map(([code, label]) => (
              <option key={code} value={code}>{code} — {label}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500 font-medium">Layer</label>
          <select
            value={layerFilter}
            onChange={(e) => onLayerFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
          >
            <option value="ALL">All layers</option>
            {LAYER_ORDER.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </div>
      </div>

      {passages.length === 0 ? (
        <div className="text-center py-12 text-gray-400">No passages match these filters.</div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold mb-1">
            {passages.length} passage{passages.length !== 1 ? 's' : ''}
          </p>
          {passages.map((p) => (
            <PassageCard key={p.passage_id} passage={p} onSelect={onSelect} status="not_started" />
          ))}
        </div>
      )}
    </div>
  )
}

function PassageCard({ passage, onSelect, status }) {
  const statusConfig = {
    not_started: { label: 'Not Started', color: 'text-gray-400', dot: 'bg-gray-300' },
    in_progress: { label: 'In Progress', color: 'text-yellow-600', dot: 'bg-yellow-400' },
    completed: { label: 'Completed', color: 'text-green-600', dot: 'bg-green-500' },
  }
  const s = statusConfig[status] || statusConfig.not_started

  return (
    <button
      onClick={() => onSelect(passage)}
      className="w-full text-left bg-white rounded-xl border border-gray-200 p-4 shadow-sm active:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-mono text-gray-400 mb-1">{passage.passage_id}</p>
          <p className="font-semibold text-gray-900 text-sm leading-snug">{passage.domain}</p>
          <div className="flex flex-wrap gap-1 mt-2">
            <LayerBadge layer={passage.layer} />
            {passage.layer === 'CORE' && passage.tier && (
              <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                {passage.tier}
              </span>
            )}
            {passage.layer === 'EXT' && passage.ext_band && (
              <>
                <span className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full font-medium">
                  {passage.ext_band}
                </span>
                {passage.pil_level && (
                  <span className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full font-medium">
                    {passage.pil_level}
                  </span>
                )}
              </>
            )}
            <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
              {passage.domain_cluster}
            </span>
          </div>
        </div>
        <div className={`flex items-center gap-1 text-xs font-medium shrink-0 ${s.color}`}>
          <span className={`inline-block w-2 h-2 rounded-full ${s.dot}`} />
          {s.label}
        </div>
      </div>
    </button>
  )
}

function LayerBadge({ layer }) {
  const config = {
    ORIENT: 'bg-green-50 text-green-700',
    CORE: 'bg-blue-50 text-blue-700',
    EXT: 'bg-purple-50 text-purple-700',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${config[layer] || 'bg-gray-100 text-gray-600'}`}>
      {layer}
    </span>
  )
}
