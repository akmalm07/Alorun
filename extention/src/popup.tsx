import { extensionApi } from "./browser/extension-api";
import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Globe2,
  MousePointer2,
  PanelsTopLeft,
} from "lucide-react";
import { PageTools } from "./components/PageTools";
import { Workspace } from "./components/Workspace";
import { pageAddress } from "./browser/protocol";
import "./popup.css";

export default function Popup() {
  const icon = extensionApi.runtime.getManifest().icons?.[48];
  const [mode, setMode] = useState<"layout" | "action">();
  const [host, setHost] = useState("");
  useEffect(() => {
    void extensionApi.tabs
      .query({ active: true, currentWindow: true })
      .then(([tab]) => {
        const address = pageAddress(tab?.url ?? "");
        if (address) setHost(new URL(address.origin).host);
      })
      .catch(() => undefined);
  }, []);

  return (
    <div className="shell">
      <header className="brandbar">
        <div className="brand">
          {icon && <img src={extensionApi.runtime.getURL(icon)} alt="" />}
          <span>Alorun</span>
        </div>
        {host && (
          <div className="host" title={host}>
            <Globe2 size={14} aria-hidden="true" />
            <span>{host}</span>
          </div>
        )}
      </header>

      {mode && (
        <PageTools key={mode} mode={mode} onBack={() => setMode(undefined)} />
      )}
      <main hidden={Boolean(mode)} className="home">
        <section className="page-tools" aria-labelledby="page-tools-title">
          <h1 id="page-tools-title">Page tools</h1>
          <p>Set up this page for the work you do here.</p>
          <button
            className="tool-card layout-card"
            onClick={() => setMode("layout")}
          >
            <span className="card-icon">
              <PanelsTopLeft size={21} aria-hidden="true" />
            </span>
            <span>
              <strong>Change this for me</strong>
              <small>
                Build a layout with shortcuts and most-visited pages.
              </small>
            </span>
            <ArrowUpRight size={18} aria-hidden="true" />
          </button>
          <button
            className="tool-card action-card"
            onClick={() => setMode("action")}
          >
            <span className="card-icon">
              <MousePointer2 size={21} aria-hidden="true" />
            </span>
            <span>
              <strong>Act on this page</strong>
              <small>Guide a visible cursor to click and type.</small>
            </span>
            <ArrowUpRight size={18} aria-hidden="true" />
          </button>
        </section>
        <Workspace />
      </main>
    </div>
  );
}
