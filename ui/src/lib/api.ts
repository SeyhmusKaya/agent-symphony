import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { basename } from "@tauri-apps/api/path";

export interface Deployment {
  mode: "local" | "remote" | "hibrit";
  serverIds: string[];
  deployScript?: string;
  publicUrl?: string;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  lastOpened: number;
  logoUri?: string;
  deployment?: Deployment;
  reportEnabled?: boolean;
}

export interface Server {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  authType: "password" | "key";
  password?: string;
  privateKeyPath?: string;
  panelUrl?: string;
  tags: string[];
  notes?: string;
}

export function listServers(): Promise<Server[]> {
  return invoke<Server[]>("list_servers");
}

export interface ServerInput {
  name: string;
  host: string;
  port?: number;
  user: string;
  authType: "password" | "key";
  password?: string;
  privateKeyPath?: string;
  panelUrl?: string;
  tags?: string[];
  notes?: string;
}

export function addServer(input: ServerInput): Promise<Server> {
  return invoke<Server>("add_server", { ...input });
}

export function updateServer(id: string, fields: Partial<ServerInput>): Promise<Server> {
  return invoke<Server>("update_server", { id, ...fields });
}

export function deleteServer(id: string): Promise<void> {
  return invoke("delete_server", { id });
}

export function testServerConnection(id: string): Promise<string> {
  return invoke<string>("test_server_connection", { id });
}

export function setProjectReportEnabled(id: string, enabled: boolean): Promise<void> {
  return invoke("set_project_report_enabled", { id, enabled });
}

export function setProjectDeployment(
  id: string,
  deployment: Deployment | null,
): Promise<void> {
  return invoke("set_project_deployment", { id, deployment });
}

export function listProjects(): Promise<Project[]> {
  return invoke<Project[]>("list_projects");
}

export function addProject(name: string, path: string): Promise<Project> {
  return invoke<Project>("add_project", { name, path });
}

export function touchProject(id: string): Promise<void> {
  return invoke("touch_project", { id });
}

export function removeProject(id: string): Promise<void> {
  return invoke("remove_project", { id });
}

export function renameProject(id: string, name: string): Promise<void> {
  return invoke("rename_project", { id, name });
}

export function refreshProjectLogo(id: string): Promise<string | null> {
  return invoke<string | null>("refresh_project_logo", { id });
}

export function refreshAllLogos(): Promise<Project[]> {
  return invoke<Project[]>("refresh_all_logos");
}

export function openProjectWindow(id: string, name: string): Promise<void> {
  return invoke("open_project_window", { id, name });
}

export function startProject(id: string): Promise<number> {
  return invoke<number>("start_project", { id });
}

export function startupProjectPath(): Promise<string | null> {
  return invoke<string | null>("startup_project_path");
}

export interface ReportEntry {
  date: string;
  path: string;
  size: number;
}

export function listReports(): Promise<ReportEntry[]> {
  return invoke<ReportEntry[]>("list_reports");
}

export function readReport(path: string): Promise<string> {
  return invoke<string>("read_report", { path });
}

export function openReportsDir(): Promise<string> {
  return invoke<string>("open_reports_dir");
}

export interface DayUsage {
  date: string;
  input: number;
  output: number;
}

export function aggregateUsage(): Promise<DayUsage[]> {
  return invoke<DayUsage[]>("aggregate_usage");
}

// Items 2 & 3: delegation rate + batch efficiency telemetry.
export interface TurnMetricRecent {
  ts: number;
  sef: number;
  delegate: number;
  task: number;
  spawn_worker: number;
  other: number;
  tool_count: number;
  round_count: number;
}

export interface TurnMetricsSummary {
  delegation_rate: number;       // %
  delegation_total: number;      // total tool calls
  delegation_count: number;      // delegated tools
  batch_efficiency: number;      // average tool/round
  batch_turns: number;
  recent: TurnMetricRecent[];
  window_hours: number;
}

export function turnMetricsSummary(windowHours = 24): Promise<TurnMetricsSummary> {
  return invoke<TurnMetricsSummary>("turn_metrics_summary", { windowHours });
}

export async function pickProjectFolder(): Promise<Project | null> {
  const selected = await open({ directory: true, multiple: false });
  if (typeof selected !== "string") return null;
  const name = await basename(selected);
  return addProject(name, selected);
}

// F2 Skill System (master plan section 3 F2): role-based skill management.
// The backend Tauri command (skill_list / skill_attach / skill_detach) is not
// implemented yet — the wrappers follow the existing style. The component
// (SkillManager.svelte) is ready; it works once the rust handler is added.
export interface SkillEntry {
  name: string;
  description: string;
  path: string;
}

export interface SkillRoleGroup {
  role: string;
  skills: SkillEntry[];
}

export function listSkills(role?: string): Promise<SkillRoleGroup[]> {
  return invoke<SkillRoleGroup[]>("skill_list", role ? { role } : {});
}

export function attachSkill(
  role: string,
  name: string,
  source?: string,
): Promise<SkillEntry> {
  return invoke<SkillEntry>("skill_attach", { role, name, source });
}

export function detachSkill(role: string, name: string): Promise<void> {
  return invoke<void>("skill_detach", { role, name });
}

// F3 (Autonomous 3-Day Mode): JobMonitor right panel actions.
//
// Design note: pause/resume/cancel/list go to the backend over WS
// (orchestrator + UI already talk over WS; an extra Tauri command layer would
// be an unnecessary roundtrip). There is no global session singleton in the UI
// — each ProjectScreen creates its own ProjectSession instance; that is why
// these wrappers take a ProjectSession and call the appropriate method.
//
// The record on the backend side is also covered in autonomousMode.ts comment
// blocks: "UI INTEGRATION: status payload + ws otonom_* kinds".

import type { ProjectSession } from "./store/projectSession.svelte";
import type { AutonomousJob, BudgetReport } from "./store/types";

export function listAutonomousJobs(session: ProjectSession): AutonomousJob[] {
  return session.autonomousJobs;
}

export function pauseAutonomousJob(session: ProjectSession, jobId: string): void {
  session.pauseAutonomousJob(jobId);
}

export function resumeAutonomousJob(session: ProjectSession, jobId: string): void {
  session.resumeAutonomousJob(jobId);
}

export function cancelAutonomousJob(session: ProjectSession, jobId: string): void {
  session.cancelAutonomousJob(jobId);
}

// F4 (Cost Control): budget report + cap edit WS wrappers.
export function getBudgetReport(session: ProjectSession): BudgetReport | null {
  return session.budgets;
}

export function setBudgetCap(
  session: ProjectSession,
  role: "chief" | "mimar" | "specialist" | "advisor" | "worker",
  capUsd: number,
): void {
  session.setBudgetCap(role, capUsd);
}
