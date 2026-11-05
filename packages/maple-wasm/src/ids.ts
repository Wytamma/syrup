import { MapleError } from './errors.js'
import type {
  AlignmentFormat,
  BranchSupportMethod,
  SubstitutionModel,
  TreeSearchType,
} from './types.js'

const FORMAT_IDS: Record<AlignmentFormat, number> = {
  auto: 0,
  fasta: 1,
  phylip: 2,
  maple: 3,
}

const BRANCH_SUPPORT_METHOD_IDS: Record<BranchSupportMethod, number> = {
  none: 0,
  sprta: 1,
  'sh-alrt': 2,
}

const SUBSTITUTION_MODEL_IDS: Record<SubstitutionModel, number> = {
  GTR: 0,
  JC: 1,
  UNREST: 2,
  GTR20: 3,
  NONREV: 4,
  LG: 5,
  WAG: 6,
  JTT: 7,
  'Q.PFAM': 8,
  'Q.BIRD': 9,
  'Q.MAMMAL': 10,
  'Q.INSECT': 11,
  'Q.PLANT': 12,
  'Q.YEAST': 13,
  JTTDCMUT: 14,
  DCMUT: 15,
  VT: 16,
  PMB: 17,
  BLOSUM62: 18,
  DAYHOFF: 19,
  MTREV: 20,
  MTART: 21,
  MTZOA: 22,
  MTMET: 23,
  MTVER: 24,
  MTINV: 25,
  MTMAM: 26,
  FLAVI: 27,
  HIVB: 28,
  HIVW: 29,
  FLU: 30,
  RTREV: 31,
  CPREV: 32,
  'NQ.PFAM': 33,
  'NQ.BIRD': 34,
  'NQ.MAMMAL': 35,
  'NQ.INSECT': 36,
  'NQ.PLANT': 37,
  'NQ.YEAST': 38,
}

const TREE_SEARCH_TYPE_IDS: Record<TreeSearchType, number> = {
  fast: 0,
  normal: 1,
  exhaustive: 2,
}

function lookup<T extends string>(table: Record<T, number>, value: T, kind: string): number {
  const id = table[value]
  if (id === undefined) {
    throw new MapleError(`Unknown ${kind}: ${String(value)}`)
  }
  return id
}

export function formatId(format: AlignmentFormat): number {
  return lookup(FORMAT_IDS, format, 'alignment format')
}

export function branchSupportMethodId(method: BranchSupportMethod): number {
  return lookup(BRANCH_SUPPORT_METHOD_IDS, method, 'branch support method')
}

export function substitutionModelId(model: SubstitutionModel): number {
  return lookup(SUBSTITUTION_MODEL_IDS, model, 'substitution model')
}

export function treeSearchTypeId(type: TreeSearchType): number {
  return lookup(TREE_SEARCH_TYPE_IDS, type, 'tree search type')
}
