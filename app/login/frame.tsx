import type { ReactNode } from "react";

/**
 * The shared shell for every way-in screen — sign in, request access, set a
 * password. Same skyline and dark card as the landing page, so the first
 * screen anyone sees belongs to the same product as the rest.
 */
export function LoginFrame({ children, width = 400 }: { children: ReactNode; width?: number }) {
  return (
    <div className="relative min-h-screen overflow-hidden">
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url(/img/placeholder.svg)" }}
        aria-hidden
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(4,10,20,.70) 0%, rgba(4,10,20,.45) 45%, rgba(4,10,20,.72) 100%)",
        }}
        aria-hidden
      />

      <div className="relative flex min-h-screen items-center justify-center px-6 py-14">
        <div className="w-full" style={{ maxWidth: width }}>
          <div className="mb-7">
            <div className="mb-4 h-[2px] w-[52px] bg-white/50" />
            <h1 className="text-[30px] font-light leading-[1.15] tracking-tight text-white">
              Halden Ridge Advisors
            </h1>
            <p className="mt-1.5 text-[14px] text-white/70">Contact intelligence</p>
          </div>

          <div className="rounded-[10px] border border-white/12 bg-[rgba(8,14,26,0.9)] p-7 shadow-[0_10px_36px_rgba(0,0,0,0.42)]">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
