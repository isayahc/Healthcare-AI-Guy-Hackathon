import { Component } from "react";
import { AlertTriangle } from "lucide-react";

export class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Clinical App Studio render failed:", error, info);
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <main className="app-error-page" role="alert">
        <section className="app-error-card">
          <span className="app-error-icon">
            <AlertTriangle size={26} aria-hidden="true" />
          </span>
          <div>
            <p className="eyebrow">Render error</p>
            <h1>Clinical App Studio could not render this view.</h1>
            <p>
              The artifact is saved, but this browser view hit a runtime error.
              Refresh the page or open the patient share link while we capture the
              failing state.
            </p>
            <code>{this.state.error.message}</code>
            <button type="button" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </section>
      </main>
    );
  }
}
