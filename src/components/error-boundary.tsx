"use client";

import { Component, ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="p-8 text-center">
            <h2 className="text-xl font-semibold text-destructive mb-2">
              出错了
            </h2>
            <p className="text-sm text-muted-foreground mb-4">
              {this.state.error?.message || "未知错误"}
            </p>
            <Button onClick={() => window.location.reload()}>刷新页面</Button>
          </div>
        )
      );
    }

    return this.props.children;
  }
}
