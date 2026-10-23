import type { Metadata } from 'next';
import Link from 'next/link';
import { Gamepad2, ThumbsUp, Eye, ArrowUpRight } from 'lucide-react';
import { listMarketplaceProjects } from '@/server/store';
import { appOrigin } from '@/server/config';
import { approvalLabel } from '@/shared/types';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: '作品广场 Marketplace · OpenGame',
  description:
    '发现 OpenGame 创作者发布的游戏，浏览玩法介绍、好评率与访问量，登录后即可试玩。',
  alternates: { canonical: `${appOrigin}/marketplace` },
  robots: { index: true, follow: true },
  openGraph: {
    title: '作品广场 · OpenGame',
    description: '发现大家的游戏，浏览玩法、评价与访问量。',
    url: `${appOrigin}/marketplace`,
    type: 'website',
  },
};

export default async function Marketplace() {
  const projects = await listMarketplaceProjects();
  return (
    <div className="studio-shell">
      <header className="topbar">
        <Link className="brand" href="/">
          <span className="brandmark">
            <Gamepad2 size={21} />
          </span>
          OpenGame
        </Link>
        <nav className="topnav" aria-label="主导航">
          <Link href="/">创作</Link>
          <Link href="/library">我的作品</Link>
          <Link href="/marketplace" className="active" aria-current="page">
            作品广场
          </Link>
        </nav>
      </header>
      <main className="home">
        <div className="home-heading">
          <span className="eyebrow">Marketplace · 作品广场</span>
          <h1>发现大家的游戏。</h1>
          <p>所有创作者已发布的作品。自由浏览，登录后即可试玩。</p>
        </div>
        <section className="projects-section" aria-label="所有人的作品">
          <div className="section-heading">
            <h2>所有人的作品</h2>
            <span>{projects.length} 个游戏</span>
          </div>
          {projects.length ? (
            <div className="project-grid">
              {projects.map((project) => (
                <Link
                  className="project-card"
                  key={project.id}
                  href={`/play/${project.id}`}
                >
                  <div className="project-cover">
                    <div className="cover-empty">
                      <Gamepad2 size={35} />
                      <span>登录试玩</span>
                    </div>
                    <span className="project-tag">已发布</span>
                  </div>
                  <div className="project-info">
                    <h2>{project.title}</h2>
                    <p>{project.description}</p>
                    <div className="marketplace-stats">
                      <span>
                        <ThumbsUp size={14} />{' '}
                        {approvalLabel({
                          likes: project.likes || 0,
                          dislikes: project.dislikes || 0,
                        })}
                      </span>
                      <span>
                        <Eye size={14} />{' '}
                        {(project.visits || 0).toLocaleString('zh-CN')} 次访问
                      </span>
                    </div>
                    <div>
                      <span>试玩游戏</span>
                      <ArrowUpRight size={16} />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="empty-library">
              <Gamepad2 size={34} />
              <h2>还没有已发布的作品</h2>
              <p>发布游戏后，大家就能在这里看到。</p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
