import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../services/firebase'
import StubScreen from '../components/StubScreen'
import MCQRenderer from '../components/MCQRenderer'
import TypedResponseRenderer from '../components/TypedResponseRenderer'

// One route for all twelve task types, per the scaffold spec: dispatch by
// taskType (read from the toeflItems doc) happens inside this component,
// not in the router.
//
// The five MCQ types share one renderer, per data model v1.15 Collection 1.
// EM and DISC share one typed-response renderer: same {text, wordCount}
// response shape, different stimulus. The other five are separately scheduled
// and deliberately not built here.
const MCQ_TYPES = ['AP', 'AT', 'RDL', 'LCR', 'LTA']
const TYPED_TYPES = ['EM', 'DISC']

export default function ItemScreen() {
  const { itemId } = useParams()
  const [taskType, setTaskType] = useState(null)
  const [error, setError] = useState(null)

  // Dispatch needs taskType, so this reads the item document. MCQRenderer then
  // reads it again for itself — one extra read of a small public document,
  // accepted deliberately to keep the renderer self-contained (it takes an
  // itemId, not a pre-loaded item, per its own spec line).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const snap = await getDoc(doc(db, 'toeflItems', itemId))
        if (cancelled) return
        if (!snap.exists()) {
          setError(`No toeflItems document found for "${itemId}".`)
          return
        }
        setTaskType(snap.data().taskType)
      } catch (err) {
        if (!cancelled) setError(err.message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [itemId])

  if (error) {
    return (
      <StubScreen route={`/item/${itemId}`} title="Item" note={error} />
    )
  }

  if (!taskType) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-500">Loading…</p>
      </div>
    )
  }

  if (MCQ_TYPES.includes(taskType)) {
    return <MCQRenderer itemId={itemId} />
  }

  if (TYPED_TYPES.includes(taskType)) {
    return <TypedResponseRenderer itemId={itemId} />
  }

  return (
    <StubScreen
      route={`/item/${itemId}`}
      title="Item"
      note={`taskType = ${taskType}. Renderer for this type is not built yet — only ${[...MCQ_TYPES, ...TYPED_TYPES].join(', ')} are live.`}
    />
  )
}
