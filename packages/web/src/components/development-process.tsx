'use client';

import {
  Check,
  Circle,
  Gamepad2,
  LoaderCircle,
  MessageSquare,
  Play,
  ArrowUpRight,
} from 'lucide-react';
import type { DevelopmentPlan } from '@/shared/development';
import type { GameVersion, Job, ProjectDetail } from '@/shared/types';
import { phaseLabels } from '@/shared/types';

export function PlanSummary({
  plan,
  onView,
  onStart,
  disabled,
}: {
  plan: DevelopmentPlan;
  onView: () => void;
  onStart?: () => void;
  disabled: boolean;
}) {
  return (
    <div className="chat-plan">
      <strong>{plan.goal}</strong>
      <ol>
        {plan.tasks.map((task, i) => (
          <li key={i}>{task.title}</li>
        ))}
      </ol>
      <div>
        <button onClick={onView}>
          查看制作过程 <ArrowUpRight size={13} />
        </button>
        {onStart && (
          <button
            className="button primary"
            disabled={disabled}
            onClick={onStart}
          >
            <Play size={12} /> 开始制作
          </button>
        )}
      </div>
    </div>
  );
}

function runLabel(job?: Job, version?: GameVersion) {
  if (version)
    return `版本 ${version.number} · ${version.validation.image ? '图片' : '可试玩'}`;
  if (!job) return '待整理';
  if (job.status === 'cancelled') return '已停止';
  if (job.status === 'failed') return '未完成';
  if (job.kind === 'chat' && job.status === 'succeeded') return '方案待开始';
  return phaseLabels[job.phase];
}

function RunProgress({ job, image }: { job: Job; image: boolean }) {
  if (job.kind === 'chat') return null;
  const steps = image
    ? ['需求已保存', '准备图片', '图片解码检查', '保存图片版本']
    : ['任务已整理', '准备与实施', '启动与重开检查', '保存可玩版本'];
  const phase = job.phase;
  const current =
    phase === 'done'
      ? 4
      : phase === 'saving'
        ? 3
        : phase === 'validating'
          ? 2
          : phase === 'generating'
            ? 1
            : 1;
  const stopped = job.status !== 'running';
  return (
    <div className="process-steps" aria-label="实际执行阶段">
      {steps.map((label, i) => (
        <div
          key={label}
          className={`${i < current ? 'complete' : ''} ${i === current && !stopped ? 'current' : ''}`}
        >
          {i < current ? (
            <Check size={14} />
          ) : i === current && !stopped ? (
            <LoaderCircle size={14} className="spin" />
          ) : (
            <Circle size={14} />
          )}
          <span>{label}</span>
        </div>
      ))}
    </div>
  );
}

export function DevelopmentProcess({
  detail,
  busy,
  ready,
  onStart,
  onPlay,
}: {
  detail?: ProjectDetail;
  busy: boolean;
  ready: boolean;
  onStart: (job: Job) => void;
  onPlay: (id: string) => void;
}) {
  if (!detail) return <div className="process-empty">正在打开制作记录…</div>;
  const latest = detail.jobs[0];
  const active = latest?.status === 'queued' || latest?.status === 'running';
  const entries: Array<{
    id: string;
    created: string;
    plan?: DevelopmentPlan | null;
    job?: Job;
    version?: GameVersion;
  }> = [
    ...detail.jobs
      .filter((j) => j.plan && !j.result_version_id)
      .map((job) => ({
        id: job.id,
        created: job.created_at,
        plan: job.plan,
        job,
      })),
    ...detail.versions.map((version) => ({
      id: version.id,
      created: version.created_at,
      plan: version.development_plan,
      version,
      job: detail.jobs.find((j) => j.result_version_id === version.id),
    })),
  ].sort((a, b) => Date.parse(b.created) - Date.parse(a.created));
  return (
    <div className="development-process">
      <div className="process-heading">
        <span className="eyebrow">从想法到可玩的版本</span>
        <h2>制作过程</h2>
        <p>继续在右侧聊想法。任务、进度和结果会整理在这里。</p>
      </div>
      {active && !latest.plan && (
        <div className="process-thinking" role="status">
          <LoaderCircle size={18} className="spin" />
          <div>
            <strong>
              {latest.kind === 'chat'
                ? latest.status === 'queued'
                  ? '等待梳理本轮想法'
                  : '正在梳理本轮想法'
                : phaseLabels[latest.phase]}
            </strong>
            <p>{detail.events.at(-1)?.message}</p>
          </div>
        </div>
      )}
      {!entries.length && !active && (
        <div className="process-empty">
          <MessageSquare size={27} />
          <h3>先聊聊你想做的游戏</h3>
          <p>
            想法明确后，AI 会整理实施任务。每次制作都会留下结果和可回看的版本。
          </p>
        </div>
      )}
      <div className="process-timeline">
        {entries.map((entry, index) => {
          const { job, version, plan } = entry;
          const canStart =
            !!job &&
            latest.id === job.id &&
            job.kind === 'chat' &&
            job.status === 'succeeded' &&
            job.base_version_id === detail.project.latest_version_id;
          return (
            <details
              className={`process-round ${job?.status === 'failed' ? 'has-error' : ''}`}
              key={entry.id}
              open={index === 0 ? true : undefined}
            >
              <summary>
                <span className="process-round-dot" />
                <div>
                  <small>
                    {new Date(entry.created).toLocaleString('zh-CN', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </small>
                  <h3>
                    {plan?.goal || version?.summary.slice(0, 100) || '本轮制作'}
                  </h3>
                </div>
                <span className="process-round-status">
                  {job?.kind === 'chat' &&
                  job.status === 'succeeded' &&
                  job.id !== latest?.id
                    ? '历史方案'
                    : runLabel(job, version)}
                </span>
              </summary>
              <div className="process-round-body">
                {job?.kind === 'build' && plan && (
                  <RunProgress
                    job={job}
                    image={detail?.project.media_kind === 'image'}
                  />
                )}
                {!!plan?.decisions.length && (
                  <div className="process-decisions">
                    <strong>已经明确</strong>
                    <ul>
                      {plan.decisions.map((d, i) => (
                        <li key={i}>{d}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {plan && (
                  <>
                    <div className="process-section-label">本轮实施范围</div>
                    <div className="process-tasks">
                      {plan.tasks.map((task, i) => (
                        <div className="process-task" key={i}>
                          <span>{String(i + 1).padStart(2, '0')}</span>
                          <div>
                            <strong>{task.title}</strong>
                            <p>{task.detail}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="process-checks">
                      <strong>试玩时关注</strong>
                      <ul>
                        {plan.checks.map((check, i) => (
                          <li key={i}>{check}</li>
                        ))}
                      </ul>
                      <small>这些是本轮验收要点，仍需结合实际试玩确认。</small>
                    </div>
                  </>
                )}
                {job?.error && (
                  <p className="process-error" role="status">
                    {job.error}
                  </p>
                )}
                {job?.status === 'cancelled' && (
                  <p>本轮已停止，已保存的游戏仍可试玩。</p>
                )}
                {canStart && (
                  <div className="process-start">
                    <span>
                      可以继续在聊天中调整，或按这份方案及其参考图开始。
                    </span>
                    <button
                      className="button primary"
                      disabled={busy || active || !ready}
                      onClick={() => onStart(job)}
                    >
                      <Play size={14} /> 开始制作
                    </button>
                  </div>
                )}
                {version && (
                  <div className="process-result">
                    <button
                      className="process-result-image"
                      onClick={() => onPlay(version.id)}
                      aria-label={`试玩版本 ${version.number}`}
                    >
                      {version.previewUrl && (
                        <img
                          alt={`版本 ${version.number} 实际游戏画面`}
                          src={version.previewUrl.replace(
                            /index\.html(?=\?|$)/,
                            'preview.png',
                          )}
                        />
                      )}
                      <span>
                        <Gamepad2 size={16} />{' '}
                        {version.validation.image ? '图片版本' : '试玩版本'}{' '}
                        {version.number}
                      </span>
                    </button>
                    <div>
                      <strong>本轮结果</strong>
                      <p>{version.summary}</p>
                      <span className="process-validation">
                        <Check size={14} />
                        {version.validation.image
                          ? `图片检查通过 · ${version.validation.image.width} × ${version.validation.image.height}`
                          : version.validation.build &&
                              version.validation.start &&
                              version.validation.restart
                            ? '构建、启动与重开检查通过'
                            : '查看此版本的试玩结果'}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}
