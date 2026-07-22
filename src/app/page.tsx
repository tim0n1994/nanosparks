import { cookies } from 'next/headers';
import Navbar from '@/components/ui/Navbar';
import SubmitBox from '@/components/reader/SubmitBox';
import { getLang } from '@/lib/i18n/getLang';

export default async function HomePage() {
  const lang = getLang((await cookies()).toString());

  return (
    <div className="min-h-[100dvh] bg-[#fafaf9]">
      <Navbar />
      <main className="flex flex-col items-center justify-center px-5 pt-[18vh] pb-20">
        <div className="w-full max-w-[580px]">
          {/* Eyebrow */}
          <p className="mb-3 text-[13px] font-medium text-accent-600">
            播客 · 文字版 · 深度解读
          </p>

          {/* Headline */}
          <h1 className="mb-2 text-[32px] font-semibold leading-[1.15] tracking-tight text-zinc-900">
            贴一条链接
            <br />
            <span className="text-zinc-400">读掉一集播客</span>
          </h1>

          <p className="mb-8 text-[15px] leading-relaxed text-zinc-500">
            支持小宇宙 / YouTube / Apple Podcasts / B站 / RSS
          </p>

          {/* Submit box */}
          <SubmitBox />
        </div>
      </main>
    </div>
  );
}
