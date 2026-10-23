import { Studio } from '@/components/studio';
export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const [route, query] = await Promise.all([params, searchParams]);
  return (
    <Studio
      projectId={route.id}
      initialWorkspaceView={
        query.view === 'design'
          ? 'design'
          : query.view === 'process'
            ? 'process'
            : 'play'
      }
    />
  );
}
