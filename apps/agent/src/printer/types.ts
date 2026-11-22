// What every printer integration must provide (matches the platform spec; retry lives in the queue).
export interface PrinterInfo { name: string; isDefault: boolean; status: "idle" | "printing" | "stopped" | "unknown"; message?: string }
export type JobState = { state: "queued" | "printing" | "completed" | "failed" | "unknown"; message?: string };
export interface Submit { file: string; printer: string | null; copies: number; widthIn: number; heightIn: number; landscape: boolean; jobName: string }

export interface PrinterProvider {
  readonly kind: "cups" | "windows" | "simulated";
  discover(): Promise<PrinterInfo[]>;
  getStatus(printer: string | null): Promise<PrinterInfo | null>;
  submitPrint(job: Submit): Promise<{ providerJobId: string }>;
  getJobStatus(providerJobId: string, printer: string | null): Promise<JobState>;
  cancelPrint(providerJobId: string, printer: string | null): Promise<void>;
}
