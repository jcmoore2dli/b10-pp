/**
 * Passage data loader
 *
 * In Phase 1 this imports the static JSON directly.
 * In later phases this may be replaced with a Firestore fetch.
 */
import passageList from '../../../data/passages.json'

export const passages = passageList

export function getPassageById(id) {
  return passages.find((p) => p.passage_id === id) ?? null
}

export function getPassagesByLayer(layer) {
  return passages.filter((p) => p.layer === layer)
}

export function getPassagesByDomainCluster(cluster) {
  return passages.filter((p) => p.domain_cluster === cluster)
}

/** Returns the subset of passage IDs in a given ordered array, preserving order */
export function getPassageSet(passageIds) {
  return passageIds
    .map((id) => passages.find((p) => p.passage_id === id))
    .filter(Boolean)
}
