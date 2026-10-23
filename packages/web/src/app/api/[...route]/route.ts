import { dispatch } from '@/server/api';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ route: string[] }> };
export async function GET(request: Request, context: Context) {
  return dispatch(request, (await context.params).route);
}
export async function POST(request: Request, context: Context) {
  return dispatch(request, (await context.params).route);
}
