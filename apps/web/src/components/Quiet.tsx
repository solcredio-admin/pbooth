"use client";
import { Component, type ReactNode } from "react";

// No WebGL (old GPU, disabled, context lost) → render nothing; the CSS gradient remains.
export class Quiet extends Component<{ children: ReactNode; onFail?: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onFail?.(); }
  render() { return this.state.failed ? null : this.props.children; }
}
