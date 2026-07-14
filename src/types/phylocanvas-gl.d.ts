declare module '@phylocanvas/phylocanvas.gl' {
  export type PhylocanvasOptions = {
    size: { width: number; height: number }
    source: string
    type: string
    showLabels?: boolean
    showInternalLabels?: boolean
    showLeafLabels?: boolean
    showMutationLabels?: boolean
    interactive?: boolean
    nodeSize?: number
    backgroundColour?: [number, number, number, number] | null
    fillColour?: [number, number, number, number]
    strokeColour?: [number, number, number, number]
    fontColour?: [number, number, number, number]
    styles?: Record<
      string,
      {
        fillColour?: string | [number, number, number] | [number, number, number, number]
        strokeColour?: string | [number, number, number] | [number, number, number, number]
        label?: string
        shape?: unknown
      }
    >
  }

  export type PhylocanvasModule = {
    PhylocanvasGL: new (
      element: Element,
      options: PhylocanvasOptions,
      plugins?: unknown[],
    ) => {
      destroy?: () => void
      setProps?: (options: Partial<PhylocanvasOptions>) => void
      render?: () => void
    }
    plugins: {
      scalebar: unknown
    }
    TreeTypes: {
      Rectangular: string
      Circular: string
      Diagonal: string
      Hierarchical: string
      Radial: string
    }
  }

  const phylocanvas: PhylocanvasModule
  export default phylocanvas

  export const TreeTypes: {
    Rectangular: string
    Circular: string
    Diagonal: string
    Hierarchical: string
    Radial: string
  }

  export const PhylocanvasGL: PhylocanvasModule['PhylocanvasGL']
  export const plugins: PhylocanvasModule['plugins']
  export const Newick: {
    parse_newick: (input: string, parseNewickAnnotations?: (annotation: string) => unknown) => unknown
  }
}
