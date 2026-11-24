"use client";
import { useState, type ReactNode } from "react";
import { send } from "@/lib/client-api";
import type { BoothDto } from "@/lib/types";
import { Cmd } from "./AgentInstall";
import { Tabs } from "./Tabs";

type Os = "windows" | "mac" | "linux" | "ipad";
const TABS: { id: Os; label: string }[] = [{ id: "windows", label: "Windows" }, { id: "mac", label: "macOS" }, { id: "linux", label: "Linux" }, { id: "ipad", label: "iPad" }];
const Step = ({ title, children }: { title: string; children?: ReactNode }) => <li><b>{title}</b>{children}</li>;

// What to do on the booth's computer so it runs alone: starts by itself, stays awake, stays on the kiosk.
export function Lockdown({ booth, origin }: { booth: BoothDto; origin: string }) {
  const [os, setOs] = useState<Os>("windows");
  const [pin, setPin] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const url = `${origin}/kiosk/${booth.code}`;
  const save = async (value: string | null) => {
    setBusy(true);
    const r = await send("POST", `/booths/${booth.id}/staff-pin`, { pin: value });
    setBusy(false);
    setPin("");
    setMsg(r.ok ? { ok: true, text: value ? "PIN saved." : "PIN removed." } : { ok: false, text: r.fields.pin ?? r.message });
  };
  return (
    <section className="host" aria-labelledby="lock">
      <div className="host-head"><span className="cap">For a booth left running on its own</span><h2 id="lock">Lockdown</h2></div>
      <div className="panel">
        <form className="filters" onSubmit={(e) => { e.preventDefault(); void save(pin); }}>
          <label><span className="cap">Staff PIN · {booth.staffMenu ? "set" : "not set"}</span><input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))} inputMode="numeric" autoComplete="off" placeholder="4 to 8 digits" /></label>
          <button className="btn ghost" type="submit" disabled={busy || pin.length < 4}>{booth.staffMenu ? "Change PIN" : "Set PIN"}</button>
          {booth.staffMenu && <button className="plain cap danger" type="button" disabled={busy} onClick={() => save(null)}>Remove</button>}
        </form>
        {msg && <p className={"cap" + (msg.ok ? "" : " err")} role="status">{msg.text}</p>}
        <p className="cap">On the kiosk, hold the top-left corner for 3 seconds and enter the PIN to reload, leave full screen or open the admin. It needs internet.</p>
        <div className="agent-install">
          <Tabs label="Booth computer" tabs={TABS} value={os} onChange={setOs} />
          <ol className="steps-text">
            {os === "windows" && <>
              <Step title="Use a separate Windows account for the booth, and sign it in automatically."><p>Press Win+R, run <code>netplwiz</code>, untick “Users must enter a user name and password”. (If the box is missing, turn off Windows Hello sign-in first.)</p></Step>
              <Step title="Never sleep (PowerShell as Administrator)."><Cmd>powercfg /change standby-timeout-ac 0; powercfg /change monitor-timeout-ac 0; powercfg /change hibernate-timeout-ac 0</Cmd></Step>
              <Step title="Open the kiosk at sign-in (PowerShell, signed in as the booth account)."><Cmd>{`$s=(New-Object -ComObject WScript.Shell).CreateShortcut("$([Environment]::GetFolderPath('Startup'))\\pbooth kiosk.lnk"); $s.TargetPath='C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'; $s.Arguments='--kiosk --noerrdialogs --disable-session-crashed-bubble --overscroll-history-navigation=0 --disable-pinch ${url}'; $s.Save()`}</Cmd></Step>
              <Step title="No edge swipes or interruptions."><p>Settings → System → Notifications: off. Settings → Windows Update → Active hours: your opening hours. Registry policy <code>AllowEdgeSwipe = 0</code> turns off the touch edge swipe.</p></Step>
            </>}
            {os === "mac" && <>
              <Step title="Use a separate account for the booth, and sign it in automatically."><p>System Settings → Users &amp; Groups → Automatically log in as. (FileVault must be off.)</p></Step>
              <Step title="Never sleep, and start again after a power cut."><Cmd>sudo pmset -a sleep 0 displaysleep 0 disksleep 0 autorestart 1</Cmd></Step>
              <Step title="Open the kiosk at login, and again if it's closed."><Cmd>{`mkdir -p ~/Library/LaunchAgents && printf '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>Label</key><string>net.pbooth.kiosk</string><key>ProgramArguments</key><array><string>/Applications/Google Chrome.app/Contents/MacOS/Google Chrome</string><string>--kiosk</string><string>--noerrdialogs</string><string>--disable-session-crashed-bubble</string><string>--disable-pinch</string><string>${url}</string></array><key>RunAtLoad</key><true/><key>KeepAlive</key><true/></dict></plist>' > ~/Library/LaunchAgents/net.pbooth.kiosk.plist && launchctl load -w ~/Library/LaunchAgents/net.pbooth.kiosk.plist`}</Cmd><p>To stop it: <code>launchctl unload -w ~/Library/LaunchAgents/net.pbooth.kiosk.plist</code></p></Step>
              <Step title="No interruptions."><p>Turn on a Focus that never ends, turn off automatic macOS updates, and turn off Hot Corners and trackpad swipes.</p></Step>
            </>}
            {os === "linux" && <>
              <Step title="Sign the booth account in automatically."><p>Settings → System → Users → Automatic Login.</p></Step>
              <Step title="Never sleep or lock."><Cmd>gsettings set org.gnome.desktop.session idle-delay 0 && gsettings set org.gnome.desktop.screensaver lock-enabled false && gsettings set org.gnome.settings-daemon.plugins.power sleep-inactive-ac-type nothing && gsettings set org.gnome.desktop.notifications show-banners false</Cmd></Step>
              <Step title="Open the kiosk at login."><Cmd>{`mkdir -p ~/.config/autostart && printf '[Desktop Entry]\nType=Application\nName=pbooth kiosk\nExec=google-chrome --kiosk --noerrdialogs --disable-session-crashed-bubble --overscroll-history-navigation=0 --disable-pinch ${url}\n' > ~/.config/autostart/pbooth-kiosk.desktop`}</Cmd></Step>
            </>}
            {os === "ipad" && <>
              <Step title="Keep it awake and plugged in."><p>Settings → Display &amp; Brightness → Auto-Lock → Never.</p></Step>
              <Step title="Open the kiosk full screen."><p>In Safari open <code>{url}</code>, pair it, then Share → Add to Home Screen and open it from there.</p></Step>
              <Step title="Lock it to that app."><p>Settings → Accessibility → Guided Access: on, and set a passcode. In the kiosk, triple-click the top (or Home) button to start. Guided Access restarts need someone there after a reboot.</p></Step>
            </>}
            <Step title="Try it: restart the computer and walk away."><p>The kiosk should come back on its own. In Chrome&apos;s kiosk mode a page can&apos;t close Chrome: use Alt+F4 (Windows/Linux), ⌘Q (Mac) or your remote desktop. The steps haven&apos;t been tested on every system version.</p></Step>
          </ol>
        </div>
      </div>
    </section>
  );
}
