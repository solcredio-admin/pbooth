"use client";
import { useEffect, useState, type ReactNode } from "react";
import { Tabs } from "./Tabs";

// Installing the booth agent from a fresh computer, per OS. The enrollment code is filled in when one is showing.
type Os = "windows" | "mac" | "linux";
const OS_TABS: { id: Os; label: string }[] = [{ id: "windows", label: "Windows" }, { id: "mac", label: "macOS" }, { id: "linux", label: "Linux" }];

function Cmd({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(children); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* no clipboard access (http, old browser): the text is still select-all on click */ }
  };
  return (
    <div className="cmd">
      <pre className="code-line">{children}</pre>
      <button type="button" className="cmd-copy" onClick={copy} aria-label={copied ? "Copied" : `Copy: ${children}`}>{copied ? "Copied" : "Copy"}</button>
    </div>
  );
}
const Step = ({ title, children }: { title: string; children?: ReactNode }) => <li><b>{title}</b>{children}</li>;

export function AgentInstall({ origin, code }: { origin: string; code: string | null }) {
  const [os, setOs] = useState<Os>("windows");
  // start on the tab for the computer you're reading this on (after hydration, so server and client agree)
  useEffect(() => {
    const ua = navigator.userAgent;
    setOs(/Mac/.test(ua) ? "mac" : /Linux|X11/.test(ua) && !/Android/.test(ua) ? "linux" : "windows");
  }, []);
  const c = code ?? "XXXX-XXXX";
  const win = `[Net.ServicePointManager]::SecurityProtocol='Tls12'; $env:PBOOTH_SERVER='${origin}'; $env:PBOOTH_CODE='${c}'; irm ${origin}/install-agent.ps1 | iex`;
  const unix = `curl -fsSL ${origin}/install-agent.sh | bash -s -- ${origin} ${c}`;
  const noCode = !code && <p className="cap">Generate an enrollment code above first: it goes into the command.</p>;
  const printer = (how: string) => <Step title="Add the printer."><p>{how} Print a test page from the computer first.</p></Step>;

  return (
    <div className="agent-install">
      <Tabs label="Booth computer" tabs={OS_TABS} value={os} onChange={setOs} />

      <div hidden={os !== "windows"}>
        <p className="cap">Printing only (DSLR cameras aren&apos;t supported on Windows). Windows 10/11 or Server 2019+.</p>
        <ol className="steps-text">
          {printer("Install the printer's own Windows driver.")}
          <Step title="Run this in PowerShell as Administrator.">
            <p>Start → type <i>PowerShell</i> → right-click → <i>Run as administrator</i>, then paste:</p>
            {noCode}
            <Cmd>{win}</Cmd>
          </Step>
        </ol>
      </div>

      <div hidden={os !== "mac"}>
        <p className="cap">Printing through macOS printing. DSLR via gPhoto2: Nikon D3400 tested; other cameras untested on Mac.</p>
        <ol className="steps-text">
          {printer("System Settings → Printers & Scanners → add it.")}
          <Step title="Run this in Terminal.">
            <p>It asks for your Mac password once.</p>
            {noCode}
            <Cmd>{unix}</Cmd>
            <p>Turn on automatic login for this account so the agent starts after a reboot.</p>
          </Step>
        </ol>
      </div>

      <div hidden={os !== "linux"}>
        <p className="cap">Ubuntu 24.04: DSLR (gPhoto2) and printing (CUPS).</p>
        <ol className="steps-text">
          {printer("Settings → Printers, or http://localhost:631.")}
          <Step title="Run this in a Terminal.">
            <p>It asks for your password (sudo).</p>
            {noCode}
            <Cmd>{unix}</Cmd>
          </Step>
        </ol>
      </div>

      <details className="cap">
        <summary>What the command does</summary>
        <p>Installs Node.js 24 if it&apos;s missing, downloads the agent from this server, enrolls this booth with the code, starts the agent
          whenever the computer starts, and lists the printers it can see. Running it again later updates the agent (with a new code).
          Agent folder: <code>C:\pbooth-agent</code>, <code>/Users/Shared/pbooth-agent</code> or <code>/opt/pbooth-agent</code>.</p>
        <p>To try pbooth without any hardware instead, run the simulator from the agent folder:</p>
        <Cmd>{`node tools/simulate-booth.mjs --url ${origin} --code ${c}`}</Cmd>
      </details>
    </div>
  );
}
