declare module '@phylocanvas/phylocanvas.gl' {
  export type PhylocanvasOptions = {
    size: { width: number; height: number }
    source: string
    type: string
    showLabels?: boolean
    showInternalLabels?: boolean
    showLeafLabels?: boolean
    interactive?: boolean
    backgroundColour?: [number, number, number, number] | null
    fillColour?: [number, number, number, number]
    strokeColour?: [number, number, number, number]
    fontColour?: [number, number, number, number]
  }

  export type PhylocanvasModule = {
    PhylocanvasGL: new (element: Element, options: PhylocanvasOptions) => {
      destroy?: () => void
      setProps?: (options: Partial<PhylocanvasOptions>) => void
      render?: () => void
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
}
