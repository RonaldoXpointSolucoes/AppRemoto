export const TARGET_PROJECT_ID = '6abc5640003cb361b809';

export function requireTargetProject(projectId: string): void {
  if (projectId !== TARGET_PROJECT_ID) throw new Error('Project does not match the approved target');
}
