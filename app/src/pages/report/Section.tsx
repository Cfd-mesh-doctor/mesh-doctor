// SPDX-License-Identifier: GPL-3.0-or-later
import { Component, type ReactNode } from "react";
import { Card } from "@/components/ui/card";

/** One card of a report or an A/B test. A damaged part of the answer costs that card, not the page. */
export class Section extends Component<{ title: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <Card className="p-5 text-sm">
        <p className="font-semibold">{this.props.title}</p>
        <p className="mt-1 text-danger">This part of the report couldn't be shown: {this.state.error.message}</p>
      </Card>
    );
  }
}
