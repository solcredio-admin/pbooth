"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
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

// start on the tab for the computer you're reading this on (after hydration, so server and client agree)
function useThisOs() {
  const state = useState<Os>("windows");
  const setOs = state[1];
  useEffect(() => {
    const ua = navigator.userAgent;
    setOs(/Mac/.test(ua) ? "mac" : /Linux|X11/.test(ua) && !/Android/.test(ua) ? "linux" : "windows");
  }, [setOs]);
  return state;
}

export function AgentInstall({ origin, code }: { origin: string; code: string | null }) {
  const [os, setOs] = useThisOs();
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

// Removing the agent from a computer: stops it, removes the start-up entry, its folder and its saved state.
const REMOVE: Record<Os, { where: string; cmd: string; after: string }> = {
  windows: {
    where: "PowerShell as Administrator",
    cmd: "Stop-ScheduledTask -TaskName 'pbooth agent' -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName 'pbooth agent' -Confirm:$false -ErrorAction SilentlyContinue; Start-Sleep 2; Remove-Item -Recurse -Force C:\\pbooth-agent, \"$env:ProgramData\\pbooth-agent\" -ErrorAction SilentlyContinue; Write-Host 'pbooth agent removed'",
    after: "Node.js stays installed; remove it in Settings → Apps if nothing else uses it.",
  },
  mac: {
    where: "Terminal",
    cmd: "launchctl unload -w ~/Library/LaunchAgents/net.pbooth.agent.plist 2>/dev/null; rm -f ~/Library/LaunchAgents/net.pbooth.agent.plist; rm -rf /Users/Shared/pbooth-agent ~/.local/share/pbooth-agent /tmp/pbooth-agent.log; echo 'pbooth agent removed'",
    after: "Node.js stays installed (sudo rm -rf /usr/local/bin/node /usr/local/lib/node_modules removes it). gPhoto2, if you added it: brew uninstall gphoto2.",
  },
  linux: {
    where: "a Terminal",
    cmd: "sudo systemctl disable --now pbooth-agent 2>/dev/null; sudo rm -f /etc/systemd/system/pbooth-agent.service; sudo systemctl daemon-reload; sudo rm -rf /opt/pbooth-agent /var/lib/pbooth-agent; id pbooth >/dev/null 2>&1 && sudo userdel -r pbooth 2>/dev/null; echo 'pbooth agent removed'",
    after: "Node.js, gPhoto2 and CUPS stay installed (sudo apt remove nodejs gphoto2 removes them; keep CUPS if you print from this computer).",
  },
};

export function AgentRemove() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [os, setOs] = useThisOs();
  return (
    <>
      <button type="button" className="btn ghost" onClick={() => dialog.current?.showModal()}>Remove the agent from a computer</button>
      <dialog ref={dialog} className="setup agent-remove" aria-labelledby="agent-remove-title">
        <span className="cap">Booth agent</span>
        <h2 id="agent-remove-title">Remove the agent from a computer</h2>
        <p>Stops the agent, removes it from start-up, and deletes its folder and saved booth login on that computer.</p>
        <div className="agent-install">
          <Tabs label="Booth computer" tabs={OS_TABS} value={os} onChange={setOs} />
          <ol className="steps-text">
            <Step title={`Run this in ${REMOVE[os].where}.`}><Cmd>{REMOVE[os].cmd}</Cmd><p>{REMOVE[os].after}</p></Step>
            <Step title="Then disconnect it here."><p>If this booth still lists that computer, use <i>Revoke access</i> in the booth&apos;s sidebar, so its old login stops working even if a copy survives.</p></Step>
          </ol>
        </div>
        <div className="actions"><button type="button" className="btn" onClick={() => dialog.current?.close()}>Done</button></div>
      </dialog>
    </>
  );
}
