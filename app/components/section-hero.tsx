import type { ReactNode } from "react";

/**
 * The photographic band at the top of a section, carrying the title and the
 * filter cards. The image stops here rather than running behind the list —
 * a photograph under thousands of rows of small type makes the type harder to read
 * and the photograph impossible to see.
 */
export function SectionHero({
  image,
  title,
  subtitle,
  back,
  actions,
  children,
}: {
  image: string;
  title: string;
  subtitle?: ReactNode;
  /** A way out, above the title. Same treatment as the one on a record. */
  back?: ReactNode;
  /** Sits opposite the title, top right. */
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="relative overflow-hidden">
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${image})` }}
        aria-hidden
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(4,10,20,.72) 0%, rgba(4,10,20,.52) 45%, rgba(4,10,20,.80) 100%)",
        }}
        aria-hidden
      />
      {/* Without filter cards the band would be too shallow to read as a
          photograph, so give it a floor. */}
      <div
        className={`relative mx-auto flex w-full max-w-[1180px] flex-col justify-end px-6 pb-7 pt-8 ${
          children ? "" : "min-h-[168px]"
        }`}
      >
        {back ? <div className="mb-4">{back}</div> : <div className="mb-3 h-[2px] w-[44px] bg-white/50" />}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[26px] font-light leading-tight tracking-tight text-white">{title}</h1>
            {subtitle && <p className="mt-1 text-[13.5px] text-white/65">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
        </div>
        {children && <div className="mt-6">{children}</div>}
      </div>
    </div>
  );
}
