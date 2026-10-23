import { isGenerationModel, type GenerationModel } from '../shared/models';
import { lstatSync } from 'node:fs';
import { lstat, mkdir } from 'node:fs/promises';
import path from 'node:path';

// Keep this policy separate from user/game text. Never add a neighboring project,
// credential directory, shared temporary directory, or Docker socket here.
export const generatorProfile = 'opengame-project';
// Linux re-executes this native binary inside the sandbox. A custom installation
// outside the minimal system paths needs exactly this file, never its HOME.
const sandboxExecutable = process.env.OPENGAME_CODEX_SANDBOX_EXECUTABLE;
if (
  sandboxExecutable &&
  (!path.isAbsolute(sandboxExecutable) ||
    !lstatSync(sandboxExecutable).isFile())
)
  throw new Error('生成器沙箱路径必须指向原生可执行文件，不能是目录或链接。');
const executablePermission = sandboxExecutable
  ? `${JSON.stringify(sandboxExecutable)}="read",`
  : '';
export const generatorPermissionConfig = `permissions.${generatorProfile}={filesystem={${executablePermission}":root"="deny",":minimal"="read",":tmpdir"="deny",":slash_tmp"="deny",":workspace_roots"={"."="write",".git"="read",".agents"="deny",".codex"="deny",".aws"="deny",".opengame-context"="read","knowledge.lock.json"="read","standards.lock.json"="read","canvas"="read","assets/canvas"="read"}},network={enabled=false}}`;

export const deniedGeneratorDirectories = ['.agents', '.codex', '.aws'];

export async function prepareGeneratorWorkspace(cwd: string): Promise<void> {
  // Bubblewrap must know these are directories before it builds deny mounts.
  // Never follow a project-supplied symlink while preparing protected paths.
  for (const name of [
    ...deniedGeneratorDirectories,
    'canvas',
    'assets',
    'assets/canvas',
  ]) {
    const directory = path.join(cwd, name);
    try {
      await mkdir(directory, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    if (!(await lstat(directory)).isDirectory())
      throw new Error(`项目的 ${name} 必须是普通目录。`);
  }
}

export function generatorArguments(
  cwd: string,
  readOnly = false,
  model: GenerationModel = 'default',
): string[] {
  if (!isGenerationModel(model)) throw new Error('不支持的制作模型。');
  return [
    'exec',
    ...(model === 'default' ? [] : ['--model', model]),
    '--ignore-user-config',
    '--ignore-rules',
    '--strict-config',
    '--ephemeral',
    '--json',
    '--color',
    'never',
    '-c',
    `default_permissions="${generatorProfile}"`,
    '-c',
    readOnly
      ? generatorPermissionConfig.replace('"."="write"', '"."="read"')
      : generatorPermissionConfig,
    '-c',
    `projects={${JSON.stringify(cwd)}={trust_level="untrusted"}}`,
    '-c',
    'approval_policy="never"',
    '-c',
    'features.multi_agent=false',
    '-c',
    'web_search="disabled"',
    '-c',
    'mcp_servers={}',
    '-c',
    'project_doc_max_bytes=0',
    '-c',
    'shell_environment_policy.experimental_use_profile=false',
    '-C',
    cwd,
    '-',
  ];
}
