"use client";
import { useEffect, useState, type ReactNode } from "react";
import { Tabs } from "./Tabs";

// Installing the booth agent from a fresh computer, per OS. The enrollment code is filled in when one is showing.
type Os = "windows" | "mac" | "linux";
const OS_TABS: { id: Os; label: string }[] = [{ id: "windows", label: "Windows" }, { id: "mac", label: "macOS" }, { id: "linux", label: "Linux" }];
const REPO = "https://github.com/solcredio-admin/pbooth";

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
  const download = (folder: string) => (
    <Step title="Get the pbooth files.">
      <p>Signed in to GitHub, open <a href={REPO} target="_blank" rel="noreferrer">the repository</a>, then <i>Code → Download ZIP</i>. Unzip it and rename the folder <code>pbooth-main</code> to <code>pbooth</code>, at <code>{folder}</code>.</p>
    </Step>
  );

  return (
    <div className="agent-install">
      <Tabs label="Booth computer" tabs={OS_TABS} value={os} onChange={setOs} />

      <div hidden={os !== "windows"}>
        <p className="cap">Printing only: DSLR cameras aren't supported on Windows. Use <b>PowerShell as Administrator</b> (Start → type PowerShell → right-click → Run as administrator). Run one line at a time.</p>
        <ol className="steps-text">
        <Step title="Install Node.js 24.">
          <p>Windows 10/11: download the Windows installer (LTS) from nodejs.org and run it. Windows Server, or if downloads are blocked:</p>
          <Cmd>{"[Net.ServicePointManager]::SecurityProtocol = 'Tls12'"}</Cmd>
          <Cmd>{"$v = (Invoke-RestMethod https://nodejs.org/dist/index.json | Where-Object { $_.version -like 'v24.*' } | Select-Object -First 1).version; $v"}</Cmd>
          <Cmd>{'Invoke-WebRequest "https://nodejs.org/dist/$v/node-$v-x64.msi" -OutFile "$env:TEMP\\node.msi"'}</Cmd>
          <Cmd>{'Start-Process msiexec -ArgumentList "/i `"$env:TEMP\\node.msi`" /qn" -Wait'}</Cmd>
          <p>Then <b>close PowerShell and open a new one</b> (as Administrator). This should print v24:</p>
          <Cmd>node --version</Cmd>
        </Step>
        <Step title="Install the printer.">
          <p>Install the printer's own Windows driver and print a test page from Windows first.</p>
        </Step>
        {download("C:\\pbooth")}
        <Step title="Build the agent.">
          <p>Answer <b>Y</b> if it asks to download pnpm.</p>
          <Cmd>cd C:\pbooth</Cmd>
          <Cmd>corepack enable</Cmd>
          <Cmd>pnpm install --filter @pbooth/agent</Cmd>
          <Cmd>pnpm --filter @pbooth/agent build</Cmd>
        </Step>
        <Step title="Enroll this booth.">
          <Cmd>{`node apps\\agent\\dist\\main.js enroll --server ${origin} --code ${c}`}</Cmd>
          <p>Check it sees the printer:</p>
          <Cmd>node apps\agent\dist\main.js doctor</Cmd>
        </Step>
        <Step title="Start it with Windows.">
          <Cmd>{"$a = New-ScheduledTaskAction -Execute (Get-Command node).Source -Argument '--disable-warning=ExperimentalWarning C:\\pbooth\\apps\\agent\\dist\\main.js run'"}</Cmd>
          <Cmd>{"$s = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit 0"}</Cmd>
          <Cmd>{'Register-ScheduledTask -TaskName "pbooth agent" -Action $a -Trigger (New-ScheduledTaskTrigger -AtStartup) -Settings $s -User SYSTEM -RunLevel Highest'}</Cmd>
          <Cmd>Start-ScheduledTask -TaskName "pbooth agent"</Cmd>
        </Step>
      </ol></div>

      <div hidden={os !== "mac"}>
        <p className="cap">Printing works through macOS printing (CUPS); DSLR via gPhoto2 is untested on Mac. Use the <b>Terminal</b> app. Run one line at a time.</p>
        <ol className="steps-text">
        <Step title="Install Node.js 24.">
          <p>Download the macOS installer (LTS) from nodejs.org and run it. Then in a new Terminal window this should print v24:</p>
          <Cmd>node --version</Cmd>
        </Step>
        <Step title="Add the printer.">
          <p>System Settings → Printers &amp; Scanners → add it, and print a test page.</p>
        </Step>
        {download("/Users/Shared/pbooth")}
        <Step title="Build the agent.">
          <p>It asks for your Mac password once; answer <b>Y</b> if it asks to download pnpm.</p>
          <Cmd>cd /Users/Shared/pbooth</Cmd>
          <Cmd>sudo corepack enable</Cmd>
          <Cmd>pnpm install --filter @pbooth/agent</Cmd>
          <Cmd>pnpm --filter @pbooth/agent build</Cmd>
        </Step>
        <Step title="Enroll this booth.">
          <Cmd>{`node apps/agent/dist/main.js enroll --server ${origin} --code ${c}`}</Cmd>
          <Cmd>node apps/agent/dist/main.js doctor</Cmd>
        </Step>
        <Step title="Start it when you log in.">
          <Cmd>cp apps/agent/deploy/net.pbooth.agent.plist ~/Library/LaunchAgents/</Cmd>
          <Cmd>launchctl load -w ~/Library/LaunchAgents/net.pbooth.agent.plist</Cmd>
          <p>Turn on automatic login for this account so it starts after a reboot. Log: <code>/tmp/pbooth-agent.log</code>.</p>
        </Step>
      </ol></div>

      <div hidden={os !== "linux"}>
        <p className="cap">Ubuntu 24.04: DSLR (gPhoto2) and printing (CUPS). Use a Terminal. Run one line at a time.</p>
        <ol className="steps-text">
        <Step title="Install Node.js 24, gPhoto2 and CUPS.">
          <p>Ubuntu&apos;s own Node is too old, so it comes from NodeSource:</p>
          <Cmd>curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -</Cmd>
          <Cmd>sudo apt install -y nodejs gphoto2 cups unzip</Cmd>
          <Cmd>node --version</Cmd>
        </Step>
        <Step title="Add the printer.">
          <p>Settings → Printers (or <code>http://localhost:631</code>), and print a test page.</p>
        </Step>
        <Step title="Get the pbooth files.">
          <p>Signed in to GitHub, open <a href={REPO} target="_blank" rel="noreferrer">the repository</a>, then <i>Code → Download ZIP</i> into Downloads, then:</p>
          <Cmd>sudo unzip -q ~/Downloads/pbooth-main.zip -d /opt</Cmd>
          <Cmd>sudo mv /opt/pbooth-main /opt/pbooth</Cmd>
        </Step>
        <Step title="Build the agent.">
          <Cmd>sudo useradd --system --create-home --groups plugdev,lp pbooth</Cmd>
          <Cmd>cd /opt/pbooth</Cmd>
          <Cmd>sudo corepack enable</Cmd>
          <Cmd>sudo pnpm install --filter @pbooth/agent</Cmd>
          <Cmd>sudo pnpm --filter @pbooth/agent build</Cmd>
          <p>Stop the desktop from grabbing the camera:</p>
          <Cmd>gio mount -s gphoto2</Cmd>
        </Step>
        <Step title="Enroll this booth.">
          <Cmd>sudo install -d -o pbooth -g pbooth /var/lib/pbooth-agent</Cmd>
          <Cmd>{`sudo -u pbooth PBOOTH_AGENT_DIR=/var/lib/pbooth-agent node /opt/pbooth/apps/agent/dist/main.js enroll --server ${origin} --code ${c}`}</Cmd>
        </Step>
        <Step title="Start it with the computer.">
          <Cmd>sudo cp /opt/pbooth/apps/agent/deploy/pbooth-agent.service /etc/systemd/system/</Cmd>
          <Cmd>sudo systemctl daemon-reload</Cmd>
          <Cmd>sudo systemctl enable --now pbooth-agent</Cmd>
        </Step>
      </ol></div>

      <details className="cap">
        <summary>Just trying it, without a camera or printer?</summary>
        <p>With Node.js installed and the pbooth files downloaded (steps 1 and 3), run from the pbooth folder. No build needed:</p>
        <Cmd>{`node tools/simulate-booth.mjs --url ${origin} --code ${c}`}</Cmd>
      </details>
    </div>
  );
}
