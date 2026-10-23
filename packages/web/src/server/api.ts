import {
  listStudy,
  uploadStudy,
  answerStudy,
  buildStudy,
  adventureStudy,
} from './study';
import { createImageBatch, cancelImageBatch } from './image-batch';
import { uploadImageAsset, artworkPreview } from './image-project';
import {
  paymentAccount,
  createCreditOrder,
  creditOrder,
  creditWebhook,
} from './payments';
import { privySession } from './privy-access';
import { accountQuota, createReferral } from './referrals';
import { gameStats, recordEngagement } from './engagement';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  appOrigin,
  previewOrigin,
  artifactDir,
  projectRepo,
  dataRoot,
  webRoot,
  accessMode,
  authProvider,
  privyAppId,
} from './config';
import { pool, migrate } from './db';
import {
  cancelJob,
  createDraftProject,
  getProject,
  listProjects,
  listMarketplaceProjects,
  publishVersion,
  restoreVersion,
  StudioError,
  submitJob,
} from './store';
import { run } from './process';
import { standardsVersion } from './workspace';
import { loadKnowledge, selectKnowledge } from './knowledge';
import { runtimeStatus } from './project-runtime';
import { canvasSelectionSchema } from '../shared/canvas';
import {
  getCanvas,
  saveCanvas,
  uploadCanvasImage,
  canvasImage,
} from './canvas';
import {
  evolutionOverview,
  submitCandidate,
  reviewCandidate,
  createKnowledgeRelease,
  activateKnowledgeRelease,
} from './evolution';
import {
  gameUrl,
  login,
  logout,
  requireViewer,
  sessionCookie,
  sessionViewer,
} from './access';

import { generationModels } from '../shared/models';

const uuid = z.string().uuid();
const submission = z
  .object({
    prompt: z.string().trim().min(1, '请描述你的想法。').max(8000),
    kind: z.enum(['chat', 'build']).optional(),
    imageAssetId: uuid.optional(),
    sourcePlanId: uuid.optional(),
    model: z.enum(generationModels).optional(),
    requestKey: uuid,
    baseVersionId: uuid.nullable().optional(),
    canvas: canvasSelectionSchema.optional(),
  })
  .strict();
const versionAction = z
  .object({
    versionId: uuid,
    expectedVersionId: uuid.nullable(),
    expectedCanvasRevision: z.number().int().min(0).optional(),
  })
  .strict();
export function assertLocalRequest(request: Request): void {
  if (request.headers.get('host') !== new URL(appOrigin).host)
    throw new StudioError('工作台不接受这个访问地址。', 403);
  if (
    request.method !== 'GET' &&
    (request.headers.get('origin') !== appOrigin ||
      !request.headers.get('content-type')?.startsWith('application/json'))
  )
    throw new StudioError('请求来源无效，请从工作台重试。', 403);
}
async function body(request: Request, maxBytes = 30000) {
  if (Number(request.headers.get('content-length') || 0) > maxBytes)
    throw new StudioError('需求内容过长。', 413);
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  if (reader)
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw new StudioError('需求内容过长。', 413);
      }
      chunks.push(part.value);
    }
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    throw new StudioError('请求格式不正确。');
  }
}
export async function dispatch(
  request: Request,
  route: string[],
): Promise<Response> {
  try {
    // Provider notifications have no browser session/Origin; only this exact route
    // bypasses browser CSRF checks and still requires PayPal signature verification.
    if (route.join('/') === 'payments/webhook' && request.method === 'POST') {
      if (request.headers.get('host') !== new URL(appOrigin).host)
        throw new StudioError('请求地址无效。', 403);
      return Response.json(
        await creditWebhook(request, await body(request, 262144)),
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }
    assertLocalRequest(request);
    const [resource, id, action] = route;
    const method = request.method;
    const privateHeaders = { 'Cache-Control': 'no-store' };
    if (resource === 'session' && !id) {
      if (method === 'GET') {
        const viewer = await sessionViewer(request);
        return Response.json(
          {
            mode: accessMode,
            auth: {
              provider: authProvider,
              appId: authProvider === 'privy' ? privyAppId : null,
            },
            user: viewer
              ? {
                  id: viewer.id,
                  label: viewer.label,
                  linked:
                    authProvider === 'privy' &&
                    !!(
                      await pool().query(
                        "SELECT 1 FROM studio_identities WHERE provider='privy' AND app_id=$1 AND user_id=$2",
                        [privyAppId, viewer.id],
                      )
                    ).rowCount,
                }
              : null,
          },
          { headers: privateHeaders },
        );
      }
      if (method === 'POST') {
        const input = z
          .object({ code: z.string().trim().min(1).max(200) })
          .strict()
          .parse(await body(request));
        const token = await login(input.code);
        return Response.json(
          { ok: true },
          {
            headers: { ...privateHeaders, 'Set-Cookie': sessionCookie(token) },
          },
        );
      }
    }
    if (
      resource === 'session' &&
      id === 'privy' &&
      route.length === 2 &&
      method === 'POST'
    ) {
      const input = z
        .object({
          token: z.string().min(1).max(16000),
          action: z.enum(['login', 'link']),
          userId: uuid.optional(),
        })
        .strict()
        .parse(await body(request));
      const current = await sessionViewer(request);
      if (input.action === 'link' && (!current || input.userId !== current.id))
        throw new StudioError('账号状态已改变，请从原账号重新发起绑定。', 401);
      const token = await privySession(input.token, input.action, current);
      return Response.json(
        { ok: true },
        {
          headers: { ...privateHeaders, 'Set-Cookie': sessionCookie(token) },
        },
      );
    }
    // Logout is idempotent, including when the current session has expired.
    if (resource === 'logout' && route.length === 1 && method === 'POST') {
      await logout(request);
      return Response.json(
        { ok: true },
        {
          headers: { ...privateHeaders, 'Set-Cookie': sessionCookie('', 0) },
        },
      );
    }
    const viewer = await requireViewer(request);
    const ownerId = viewer?.id;
    let result: unknown;
    if (resource === 'study') {
      if (route.length === 1 && method === 'GET')
        result = await listStudy(ownerId);
      else if (route.length === 1 && method === 'POST')
        result = await uploadStudy(ownerId, await body(request, 8_100_000));
      else if (route.length === 3 && action === 'answers' && method === 'POST')
        result = await answerStudy(
          ownerId,
          uuid.parse(id),
          await body(request),
        );
      else if (route.length === 3 && action === 'build' && method === 'POST')
        result = await buildStudy(ownerId, uuid.parse(id), await body(request));
      else if (
        route.length === 3 &&
        action === 'adventure' &&
        method === 'POST'
      )
        result = await adventureStudy(
          ownerId,
          uuid.parse(id),
          await body(request),
        );
      else throw new StudioError('找不到这个学习入口。', 404);
    } else if (resource === 'payments') {
      if (!ownerId) throw new StudioError('请登录后购买额度。', 401);
      if (route.length === 1 && method === 'GET')
        result = await paymentAccount(ownerId);
      else if (id === 'orders' && route.length === 2 && method === 'POST')
        result = await createCreditOrder(ownerId, await body(request));
      else if (
        id === 'orders' &&
        action &&
        route.length === 3 &&
        method === 'GET'
      )
        result = await creditOrder(ownerId, action);
      else if (
        id === 'orders' &&
        action &&
        route.length === 4 &&
        route[3] === 'capture' &&
        method === 'POST'
      )
        result = await creditOrder(ownerId, action, true);
      else throw new StudioError('找不到这个支付入口。', 404);
    } else if (
      resource === 'account' &&
      route.length === 1 &&
      method === 'GET'
    ) {
      if (!ownerId) throw new StudioError('本机模式不限制作次数。', 400);
      result = await accountQuota(ownerId);
    } else if (
      resource === 'invitations' &&
      route.length === 1 &&
      method === 'POST'
    ) {
      if (!ownerId) throw new StudioError('本机模式不需要邀请码。', 400);
      const input = z
        .object({ label: z.string().trim().min(1).max(80) })
        .strict()
        .parse(await body(request));
      result = await createReferral(ownerId, input.label);
    } else if (resource === 'evolution') {
      if (!id && method === 'GET') result = await evolutionOverview(viewer);
      else if (id === 'candidates' && !action && method === 'POST')
        result = await submitCandidate(viewer, await body(request));
      else if (
        id === 'candidates' &&
        action &&
        route[3] === 'review' &&
        route.length === 4 &&
        method === 'POST'
      )
        result = await reviewCandidate(viewer, action, await body(request));
      else if (id === 'releases' && !action && method === 'POST')
        result = await createKnowledgeRelease(viewer, await body(request));
      else if (id === 'activate' && !action && method === 'POST')
        result = await activateKnowledgeRelease(viewer, await body(request));
      else throw new StudioError('找不到这个能力升级操作。', 404);
    } else if (
      resource === 'marketplace' &&
      route.length === 1 &&
      method === 'GET'
    )
      result = {
        projects: (await listMarketplaceProjects()).map((project) => ({
          ...project,
          previewUrl: gameUrl(
            project.released_version_id!,
            viewer,
            'released',
          ).replace(/index\.html$/, 'preview.png'),
        })),
        previewOrigin,
      };
    else if (resource === 'projects' && !id && method === 'GET')
      result = {
        projects: (await listProjects(ownerId)).map((project) => ({
          ...project,
          previewUrl: project.latest_version_id
            ? gameUrl(project.latest_version_id, viewer).replace(
                /index\.html$/,
                'preview.png',
              )
            : undefined,
        })),
        previewOrigin,
      };
    else if (resource === 'projects' && !id && method === 'POST') {
      const input = submission.parse(await body(request));
      result = await submitJob({ ...input, ownerId });
    } else if (
      resource === 'projects' &&
      id === 'drafts' &&
      !action &&
      method === 'POST'
    ) {
      const input = z
        .object({
          requestKey: uuid,
          mediaKind: z.enum(['game', 'image']).default('game'),
        })
        .strict()
        .parse(await body(request));
      result = await createDraftProject(
        input.requestKey,
        ownerId,
        input.mediaKind,
      );
    } else if (resource === 'projects' && id) {
      uuid.parse(id);
      if (
        (action === 'image-download' || action === 'image-preview') &&
        route.length === 3 &&
        method === 'GET'
      ) {
        const versionId = uuid.parse(
          new URL(request.url).searchParams.get('versionId'),
        );
        const detail = await getProject(id, ownerId);
        const version = detail.versions.find((v) => v.id === versionId);
        if (detail.project.media_kind !== 'image' || !version)
          throw new StudioError('找不到图片版本。', 404);
        const item = z.coerce
          .number()
          .int()
          .min(0)
          .max(5)
          .parse(new URL(request.url).searchParams.get('item') || '0');
        const imageFile =
          version.validation.images?.[item]?.file ||
          (item === 0 && !version.validation.images ? 'artwork.png' : null);
        if (!imageFile || !/^artwork(?:-[2-6])?\.png$/.test(imageFile))
          throw new StudioError('找不到这张图片。', 404);
        if (action === 'image-preview') {
          const preview = await artworkPreview(
            await readFile(
              path.join(artifactDir(version.artifact_key), imageFile),
            ),
          );
          return new Response(new Uint8Array(preview), {
            headers: {
              'Content-Type': 'image/webp',
              'Cache-Control': 'private, no-store',
              'X-Content-Type-Options': 'nosniff',
            },
          });
        }
        return new Response(
          new Uint8Array(
            await readFile(
              path.join(artifactDir(version.artifact_key), imageFile),
            ),
          ),
          {
            headers: {
              'Content-Type': 'image/png',
              'Content-Disposition': `attachment; filename="artwork-v${version.number}-${item + 1}.png"`,
              'Cache-Control': 'private, no-store',
              'X-Content-Type-Options': 'nosniff',
            },
          },
        );
      } else if (
        action === 'image-batches' &&
        method === 'POST' &&
        route.length === 3
      ) {
        result = await createImageBatch(id, ownerId, await body(request));
      } else if (
        action === 'image-batches' &&
        method === 'POST' &&
        route.length === 5 &&
        route[4] === 'cancel'
      ) {
        await cancelImageBatch(id, uuid.parse(route[3]), ownerId);
        result = { ok: true };
      } else if (
        action === 'image-assets' &&
        route.length === 3 &&
        method === 'POST'
      ) {
        await getProject(id, ownerId);
        result = await uploadImageAsset(
          id,
          ownerId,
          await body(request, 16_100_000),
        );
      } else if (action === 'canvas') {
        if (route.length === 3 && method === 'GET') {
          const version = new URL(request.url).searchParams.get('versionId');
          if (version) uuid.parse(version);
          result = await getCanvas(id, ownerId, version || undefined);
        } else if (route.length === 3 && method === 'POST')
          result = await saveCanvas(id, ownerId, await body(request, 100000));
        else if (
          route[3] === 'assets' &&
          route.length === 4 &&
          method === 'POST'
        )
          result = await uploadCanvasImage(
            id,
            ownerId,
            await body(request, 2_700_000),
          );
        else if (
          route[3] === 'assets' &&
          route.length === 5 &&
          method === 'GET'
        ) {
          uuid.parse(route[4]);
          const bytes = await canvasImage(id, route[4], ownerId);
          return new Response(new Uint8Array(bytes), {
            headers: {
              ...privateHeaders,
              'Content-Type': 'image/png',
              'X-Content-Type-Options': 'nosniff',
              'Content-Security-Policy': "default-src 'none'",
              'Content-Disposition': 'inline; filename="canvas-image.png"',
            },
          });
        } else throw new StudioError('找不到这个画布操作。', 404);
      } else if (method === 'GET' && !action) {
        const detail = await getProject(id, ownerId);
        result = {
          ...detail,
          jobs: detail.jobs.map(
            ({ canvas_snapshot: _snapshot, ...job }) => job,
          ),
          versions: detail.versions.map((version) => ({
            ...version,
            canvas_snapshot: undefined,
            previewUrl: gameUrl(version.id, viewer),
          })),
        };
      } else if (method === 'POST' && action === 'jobs')
        result = await submitJob({
          ...submission.parse(await body(request)),
          projectId: id,
          ownerId,
        });
      else if (
        method === 'POST' &&
        (action === 'publish' || action === 'restore')
      ) {
        const input = versionAction.parse(await body(request));
        const detail = await getProject(id, ownerId);
        const version = detail.versions.find((v) => v.id === input.versionId);
        if (!version) throw new StudioError('找不到这个版本。', 404);
        await readFile(
          path.join(artifactDir(version.artifact_key), 'index.html'),
        );
        if (action === 'publish') {
          const response = await fetch(gameUrl(version.id, viewer), {
            signal: AbortSignal.timeout(5000),
          });
          if (!response.ok)
            throw new StudioError(
              '试玩服务暂不可用，原发布版本保持不变。',
              503,
            );
          await publishVersion(
            id,
            input.versionId,
            input.expectedVersionId,
            ownerId,
          );
          result = { url: `${appOrigin}/play/${id}` };
        } else
          result = {
            versionId: await restoreVersion(
              id,
              input.versionId,
              input.expectedVersionId,
              ownerId,
              input.expectedCanvasRevision,
            ),
          };
      } else if (method === 'GET' && action === 'memory') {
        const { project, versions } = await getProject(id, ownerId);
        const version = versions.find(
          (v) => v.id === project.latest_version_id,
        );
        result = {
          memory: version
            ? await run(
                'git',
                [
                  '--git-dir',
                  projectRepo(id),
                  'show',
                  `${version.commit_sha}:memory.md`,
                ],
                dataRoot,
              )
            : '首个版本保存后，项目记忆会出现在这里。',
        };
      } else throw new StudioError('找不到这个操作。', 404);
    } else if (
      resource === 'jobs' &&
      id &&
      action === 'cancel' &&
      method === 'POST'
    ) {
      uuid.parse(id);
      await cancelJob(id, ownerId);
      result = { ok: true };
    } else if (resource === 'status' && method === 'GET') {
      await migrate();
      const health = await pool().query(
        "SELECT heartbeat_at > now()-interval '8 seconds' AS ready FROM studio_worker_health WHERE id=1",
      );
      result = {
        workerReady: !!health.rows[0]?.ready,
        local: accessMode === 'local',
        ...(await runtimeStatus()),
      };
    } else if (resource === 'knowledge' && !id && method === 'GET') {
      const query = z
        .string()
        .max(8000)
        .parse(new URL(request.url).searchParams.get('query') || '');
      const entries = await loadKnowledge(ownerId);
      result = {
        entries,
        selectedIds: query.trim()
          ? selectKnowledge(query, entries).map((entry) => entry.id)
          : [],
      };
    } else if (resource === 'standards' && method === 'GET') {
      await migrate();
      const count = await pool().query(
        'SELECT count(*)::int AS count FROM studio_experiences e JOIN studio_projects p ON p.id=e.project_id WHERE ($1::uuid IS NULL OR p.owner_id=$1)',
        [ownerId || null],
      );
      result = {
        version: standardsVersion,
        text: await readFile(
          path.join(webRoot, `resources/standards/${standardsVersion}.md`),
          'utf8',
        ),
        observations: count.rows[0].count,
      };
    } else if (
      resource === 'play' &&
      id &&
      route.length === 3 &&
      (action === 'rating' || action === 'visit') &&
      method === 'POST'
    ) {
      uuid.parse(id);
      const input =
        action === 'rating'
          ? z
              .object({
                rating: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
              })
              .strict()
              .parse(await body(request))
          : z
              .object({ visitId: uuid })
              .strict()
              .parse(await body(request));
      result = await recordEngagement(id, viewer?.id || 'local', input);
    } else if (
      resource === 'play' &&
      id &&
      route.length === 2 &&
      method === 'GET'
    ) {
      uuid.parse(id);
      const { project, versions } = await getProject(id);
      const version = versions.find(
        (v) => v.id === project.released_version_id,
      );
      if (!version) throw new StudioError('这个游戏还没有发布。', 404);
      result = {
        stats: await gameStats(id, viewer?.id || 'local'),
        title: project.title,
        version: version.number,
        url: gameUrl(version.id, viewer, 'released'),
      };
    } else throw new StudioError('找不到这个入口。', 404);
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof z.ZodError)
      return Response.json(
        { error: error.issues[0]?.message || '参数无效。' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      );
    if (error instanceof StudioError)
      return Response.json(
        { error: error.message },
        { status: error.status, headers: { 'Cache-Control': 'no-store' } },
      );
    console.error(
      'Studio request failed:',
      error instanceof Error
        ? error.message.replace(/postgres(?:ql)?:\/\/[^\s]+/g, '[database]')
        : 'unknown',
    );
    return Response.json(
      { error: '服务暂不可用，请稍后重试。' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
