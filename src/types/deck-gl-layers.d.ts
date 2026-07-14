declare module '@deck.gl/layers' {
  export class TextLayer<DataT = unknown> {
    constructor(props: Record<string, unknown> & { data?: DataT[] })
  }
}
