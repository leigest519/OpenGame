import { Player } from '@/components/player';
export default async function PlayPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <Player projectId={(await params).id} />;
}
