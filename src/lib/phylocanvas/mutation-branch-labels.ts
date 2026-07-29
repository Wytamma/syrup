import { TextLayer } from '@deck.gl/layers'
import { Newick } from '@phylocanvas/phylocanvas.gl'
import { parseCmapleNewick, parseNewick, type ParseNewickAnnotations } from './newick'
import {
  getAnnotationSupportNodes,
  getAnnotationSupportPosition,
  getAnnotationSupportText,
  getMutationBranchNodes,
  getMutationBranchPosition,
  getMutationBranchText,
  getSprtaBranchSupportNodes,
  getSprtaBranchSupportPosition,
  getSprtaBranchSupportText,
  type MutationBranchGraph,
  type MutationBranchNode,
} from './mutation-branch-label-data'

type Colour = [number, number, number, number]

type MutationLabelsTree = {
  props: {
    fontColour?: Colour
    showLabels?: boolean
    showInternalLabels?: boolean
    showMutationLabels?: boolean
  }
  addLayer: (
    id: string,
    isVisible: (props: MutationLabelsTree['props']) => boolean,
    renderer: () => (tree: MutationLabelsTree) => unknown,
  ) => void
  getFontFamily: () => string
  getFontSize: () => number
  getGraphAfterLayout: () => MutationBranchGraph
}

type Decorate = (
  method: string,
  decorator: (delegate: (...args: unknown[]) => unknown, args: unknown[]) => unknown,
) => void

function createRenderer() {
  return (tree: MutationLabelsTree) => {
    const fontSize = tree.getFontSize() * 0.6
    return new TextLayer<MutationBranchNode>({
      id: 'mutation-branch-labels',
      data: getMutationBranchNodes(tree.getGraphAfterLayout()),
      fontFamily: tree.getFontFamily(),
      getAlignmentBaseline: 'bottom',
      getColor: tree.props.fontColour ?? [51, 51, 51, 255],
      getPixelOffset: [0, -fontSize / 8],
      getPosition: getMutationBranchPosition,
      getSize: fontSize,
      getText: getMutationBranchText,
      getTextAnchor: 'middle',
      updateTriggers: {
        getColor: tree.props.fontColour,
        getPixelOffset: fontSize,
        getSize: fontSize,
      },
    })
  }
}

function createSupportRenderer() {
  return (tree: MutationLabelsTree) => {
    const fontSize = tree.getFontSize()
    return new TextLayer<MutationBranchNode>({
      id: 'annotation-support-labels',
      data: getAnnotationSupportNodes(tree.getGraphAfterLayout()),
      fontFamily: tree.getFontFamily(),
      getColor: tree.props.fontColour ?? [51, 51, 51, 255],
      getPixelOffset: [fontSize / 2, 0],
      getPosition: getAnnotationSupportPosition,
      getSize: fontSize,
      getText: getAnnotationSupportText,
      getTextAnchor: 'start',
      updateTriggers: {
        getColor: tree.props.fontColour,
        getPixelOffset: fontSize,
        getSize: fontSize,
      },
    })
  }
}

function createSprtaSupportRenderer() {
  return (tree: MutationLabelsTree) => {
    const fontSize = tree.getFontSize() * 0.65
    return new TextLayer<MutationBranchNode>({
      id: 'sprta-branch-support-labels',
      data: getSprtaBranchSupportNodes(tree.getGraphAfterLayout()),
      fontFamily: tree.getFontFamily(),
      getAlignmentBaseline: 'top',
      getColor: tree.props.fontColour ?? [51, 51, 51, 255],
      getPixelOffset: [0, fontSize / 8],
      getPosition: getSprtaBranchSupportPosition,
      getSize: fontSize,
      getText: getSprtaBranchSupportText,
      getTextAnchor: 'middle',
      updateTriggers: {
        getColor: tree.props.fontColour,
        getPixelOffset: fontSize,
        getSize: fontSize,
      },
    })
  }
}

export default function mutationBranchLabelsPlugin(tree: MutationLabelsTree, decorate: Decorate) {
  decorate('init', (delegate, args) => {
    Newick.parse_newick = (
      input: string,
      parseNewickAnnotations?: ParseNewickAnnotations,
    ) => parseNewickAnnotations ? parseNewick(input, parseNewickAnnotations) : parseCmapleNewick(input)
    const result = delegate(...args)
    tree.addLayer(
      'mutation-branch-labels',
      (props) => props.showLabels === true && props.showMutationLabels === true,
      createRenderer,
    )
    tree.addLayer(
      'annotation-support-labels',
      (props) => props.showLabels === true && props.showInternalLabels === true,
      createSupportRenderer,
    )
    tree.addLayer(
      'sprta-branch-support-labels',
      (props) => props.showLabels === true && props.showInternalLabels === true,
      createSprtaSupportRenderer,
    )
    return result
  })
}
