import Link from "next/link";
import { stats } from "./lib/store";
import { requireUser } from "./lib/session";
import {
  IconContacts,
  IconAccounts,
  IconDeals,
  IconOutreach,
} from "./components/section-icons";

/**
 * The landing page. Four choices, nothing else — the team picks a section
 * rather than being dropped into one.
 *
 * Background is a placeholder gradient (public/img/placeholder.svg); the
 * original used a photograph that is not part of this public copy.
 */
/* Guarded like every other data page: the counts below are how many real
   people and firms Halden Ridge holds, which is not for the open web. It sits outside
   the (app) group, so it needs its own gate rather than inheriting one. */
export default async function Home() {
  await requireUser();
  const s = await stats();

  const SECTIONS = [
    {
      href: "/contacts",
      label: "Contacts",
      icon: <IconContacts />,
      blurb: "Find a person by name, email, company or country.",
      count: `${s.people.toLocaleString()} reachable`,
    },
    {
      href: "/accounts",
      label: "Accounts",
      icon: <IconAccounts />,
      blurb: "Investors, intermediaries, companies and government bodies.",
      count: `${s.companies.toLocaleString()} accounts`,
    },
    {
      href: "/deals",
      label: "Deals",
      icon: <IconDeals />,
      blurb: "Each deal's brief and the people on its list.",
      count: s.deals ? `${s.deals.toLocaleString()} ${s.deals === 1 ? "deal" : "deals"}` : "None yet",
    },
    {
      href: "/outreach",
      label: "Outreach",
      icon: <IconOutreach />,
      blurb: "What was drafted, what was sent, and who replied.",
      count: s.outreach ? `${s.outreach.toLocaleString()} sent` : "Nothing sent",
    },
  ];

  return (
    <div className="relative min-h-[calc(100vh-52px)] overflow-hidden">
      {/* Skyline, with a scrim so white cards and text stay readable on it. */}
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url(/img/placeholder.svg)" }}
        aria-hidden
      />
      {/* Light scrim only. A heavier one, or blurred cards, hides the skyline
          exactly where it is most recognisable. Contrast comes from the cards
          being solid, not from drowning the photograph. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(4,10,20,.62) 0%, rgba(4,10,20,.30) 40%, rgba(4,10,20,.55) 100%)",
        }}
        aria-hidden
      />

      <div className="relative mx-auto flex min-h-[calc(100vh-52px)] w-full max-w-[1100px] flex-col justify-center px-6 py-16">
        <div className="mb-9">
          <div className="mb-4 h-[2px] w-[52px] bg-white/50" />
          <h1 className="text-[34px] font-light leading-[1.15] tracking-tight text-white">
            Halden Ridge Advisors
          </h1>
          <p className="mt-1.5 text-[15px] text-white/70">
            Contact intelligence. Choose a section to begin.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {SECTIONS.map((sec) => (
            <Link
              key={sec.href}
              href={sec.href}
              className="group relative flex min-h-[150px] flex-col rounded-[10px] border border-white/12 bg-[rgba(8,14,26,0.88)] p-6 shadow-[0_10px_30px_rgba(0,0,0,0.35)] transition-all hover:-translate-y-0.5 hover:border-accent/70 hover:bg-[rgba(10,18,34,0.9)] focus-visible:border-white"
            >
              <div className="mb-4 flex items-center gap-3">
                <span className="flex h-[44px] w-[44px] items-center justify-center rounded-[9px] bg-accent text-white shadow-[0_2px_10px_rgb(40_116_252/.45)]">
                  {sec.icon}
                </span>
                <span className="text-[21px] font-medium text-white">{sec.label}</span>
                <span className="ml-auto text-[20px] text-white/35 transition-all group-hover:translate-x-0.5 group-hover:text-white/80">
                  →
                </span>
              </div>
              <p className="max-w-[34ch] text-[13.5px] leading-[1.5] text-white/65">{sec.blurb}</p>
              <p className="mt-auto pt-4 text-[11px] font-medium uppercase tracking-[0.07em] text-white/45">
                {sec.count}
              </p>
            </Link>
          ))}
        </div>

        {/* Not a fifth card, at the client's instruction — these people are set
            aside, and giving them equal billing with the four sections Halden Ridge
            works would say the opposite. A line of text, because the top bar
            (where Exclusions lives on every other page) is deliberately hidden
            here, so without this there is no way in from the front door. */}
        <p className="mt-6 text-[12.5px] text-white/45">
          <Link href="/exclusions" className="text-white/70 underline decoration-white/25 underline-offset-4 transition-colors hover:text-white hover:decoration-white/70">
            Exclusions
          </Link>{" "}
          — {s.setAside.toLocaleString()} people set aside, counted in none of the above.
        </p>
      </div>
    </div>
  );
}
