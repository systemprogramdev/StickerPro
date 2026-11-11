import { Component, type ReactNode } from 'react'

/** If the map cannot start (e.g. no WebGL), keep the rest of the app usable. */
export class MapErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null }

  static getDerivedStateFromError(e: Error) {
    return { error: e.message }
  }

  render() {
    if (this.state.error)
      return (
        <div className="warnings">
          <div className="warning">⚠ MAP UNAVAILABLE · {this.state.error.split('.')[0]}. Tracking, stats and backup still work.</div>
        </div>
      )
    return this.props.children
  }
}
