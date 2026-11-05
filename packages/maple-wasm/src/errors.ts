export class MapleError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'MapleError'
  }
}
