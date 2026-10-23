import {
  ProjectContainer,
  requireRuntimeImage,
} from '../../src/server/project-runtime';
import { randomUUID } from 'node:crypto';

const container = await ProjectContainer.start({
  projectId: randomUUID(),
  jobId: randomUUID(),
  workspace: process.argv[2],
  image: await requireRuntimeImage(),
  signal: new AbortController().signal,
});
console.log(JSON.stringify({ name: container.name }));
setInterval(() => {}, 60000);
