import { run } from "../exec.js";
import { NotPrinted } from "./types.js";
import type { JobState, PrinterInfo, PrinterProvider, Submit } from "./types.js";

// Windows printing through the Print Spooler, using PowerShell and .NET's System.Drawing
// (built into Windows PowerShell 5.1). Silent: no dialog, no default photo app.
// STATUS: written to the documented APIs but NOT yet run on a Windows machine. Treat as untested.

const ps = (script: string, timeoutMs = 30_000) =>
  run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], { timeoutMs });

// Values go in as JSON (never pasted into the script) so names with quotes can't break it.
const withArgs = (args: unknown, body: string) => `$a = '${JSON.stringify(args).replace(/'/g, "''")}' | ConvertFrom-Json\n${body}`;

const PRINT_SCRIPT = `
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile($a.file)
$doc = New-Object System.Drawing.Printing.PrintDocument
if ($a.printer) { $doc.PrinterSettings.PrinterName = $a.printer }
if (-not $doc.PrinterSettings.IsValid) { throw "Printer not found: $($a.printer)" }
$doc.DocumentName = $a.jobName
$doc.PrinterSettings.Copies = [int]$a.copies
$w = [int]($a.widthIn * 100); $h = [int]($a.heightIn * 100)
$size = $doc.PrinterSettings.PaperSizes | Where-Object { [math]::Abs($_.Width - $w) -le 10 -and [math]::Abs($_.Height - $h) -le 10 } | Select-Object -First 1
if (-not $size) { $size = New-Object System.Drawing.Printing.PaperSize("pbooth", $w, $h) }
$doc.DefaultPageSettings.PaperSize = $size
$doc.DefaultPageSettings.Landscape = [bool]$a.landscape
$doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
$doc.OriginAtMargins = $false
$doc.add_PrintPage({ param($s, $e)
  $b = $e.PageBounds
  $scale = [math]::Max($b.Width / $img.Width, $b.Height / $img.Height)
  $dw = $img.Width * $scale; $dh = $img.Height * $scale
  $e.Graphics.DrawImage($img, $b.X + ($b.Width - $dw) / 2, $b.Y + ($b.Height - $dh) / 2, $dw, $dh)
  $e.HasMorePages = $false
})
$doc.Print()
$img.Dispose()
"ok"
`;

export class WindowsPrinter implements PrinterProvider {
  readonly kind = "windows" as const;

  async discover(): Promise<PrinterInfo[]> {
    const r = await ps("Get-CimInstance Win32_Printer | Select-Object Name, Default, PrinterStatus, WorkOffline | ConvertTo-Json -Compress");
    if (r.code !== 0) throw new Error(r.stderr.trim() || "Could not list printers");
    const rows = JSON.parse(r.stdout || "[]");
    return (Array.isArray(rows) ? rows : [rows]).map((p: { Name: string; Default: boolean; PrinterStatus: number; WorkOffline: boolean }) => ({
      name: p.Name, isDefault: !!p.Default,
      status: p.WorkOffline ? "stopped" : p.PrinterStatus === 4 ? "printing" : p.PrinterStatus === 3 ? "idle" : "unknown",
    }));
  }

  async getStatus(printer: string | null) {
    const all = await this.discover();
    return all.find((x) => (printer ? x.name === printer : x.isDefault)) ?? null;
  }

  async submitPrint(j: Submit) {
    const r = await ps(withArgs(j, PRINT_SCRIPT), 60_000);
    if (r.stderr.includes("Printer not found")) throw new NotPrinted(r.stderr.trim());
    if (r.code !== 0 || !r.stdout.includes("ok")) throw new Error(r.stderr.trim() || "Printing failed");
    return { providerJobId: j.jobName }; // the spooler job is found again by its document name
  }

  async getJobStatus(jobName: string, printer: string | null): Promise<JobState> {
    const r = await ps(withArgs({ printer, jobName }, `
      $name = if ($a.printer) { $a.printer } else { (Get-CimInstance Win32_Printer -Filter "Default=true").Name }
      $j = Get-PrintJob -PrinterName $name | Where-Object { $_.DocumentName -eq $a.jobName } | Select-Object -First 1
      if ($j) { $j.JobStatus.ToString() } else { "gone" }`));
    const s = r.stdout.trim();
    if (s === "gone") return { state: "completed" }; // spooler drops finished jobs (unless "keep printed documents" is on)
    if (/Error|Offline|PaperOut|Blocked/i.test(s)) return { state: "queued", message: `Printer reports: ${s}` };
    return { state: /Printing/i.test(s) ? "printing" : "queued" };
  }

  async cancelPrint(jobName: string, printer: string | null) {
    await ps(withArgs({ printer, jobName }, `
      $name = if ($a.printer) { $a.printer } else { (Get-CimInstance Win32_Printer -Filter "Default=true").Name }
      Get-PrintJob -PrinterName $name | Where-Object { $_.DocumentName -eq $a.jobName } | Remove-PrintJob`));
  }
}
