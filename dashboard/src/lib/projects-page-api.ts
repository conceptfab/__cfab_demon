import { projectsApi } from '@/lib/tauri';

export async function createProjectEntry(
  name: string,
  color: string,
  folderPath: string,
) {
  await projectsApi.createProject(name, color, folderPath);
}

export async function restoreProjectEntry(id: number) {
  await projectsApi.restoreProject(id);
}

export async function freezeProjectEntry(id: number) {
  await projectsApi.freezeProject(id);
}

export async function mergeProjectEntries(sourceId: number, targetId: number) {
  await projectsApi.mergeProject(sourceId, targetId);
}

export async function assignAppToProjectEntry(
  appId: number,
  projectId: number | null,
) {
  await projectsApi.assignAppToProject(appId, projectId);
}
