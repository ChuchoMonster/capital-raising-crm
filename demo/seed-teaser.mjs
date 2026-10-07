#!/usr/bin/env node
/** An invented two-page teaser for the hero raise, so the deal page is whole. */
import pg from "pg";
const db = new pg.Client({ connectionString: process.env.DEMO_DB_URL || "postgres://demo@127.0.0.1:5433/crm_demo" });
await db.connect();

const d = (await db.query(`select id, reference, title, website from deals where raising = 'US$15 million' order by created_at limit 1`)).rows[0];

const teaser = {
  company: d.title,
  tagline: "AUSTRALIAN HARD-ROCK LITHIUM",
  website: d.website,
  headline: `${d.title} develops hard-rock lithium and copper in the Western Australian Goldfields.`,
  intro: "A definitive feasibility study is complete on a 14-year, 1.4Mtpa spodumene operation, with a copper-gold satellite deposit on the same tenement package. The raise funds long-lead items and stage-one plant construction.",
  panelTitle: "The raise",
  panel: [
    { label: "Raising", value: "US$15m" },
    { label: "Pre-money", value: "A$62m" },
    { label: "Instrument", value: "Placement at A$0.42" },
    { label: "Stage", value: "Feasibility complete" },
    { label: "Close", value: "Q4 2026" },
  ],
  problemHeading: "Why now",
  problems: [
    { title: "Conversion capacity is ahead of feedstock", text: "Announced Western spodumene conversion capacity runs ahead of committed concentrate supply through the back half of the decade." },
    { title: "Permitted ground is the constraint", text: "The projects that move are the ones already through approvals with power and haulage in place, not the ones still drilling." },
  ],
  solutionHeading: `What ${d.title} has`,
  solutions: [
    { title: "A finished study, not a concept", text: "DFS delivered in March on a 1.4Mtpa plant, 14-year mine life, and a stripping ratio of 4.1:1 over the first five years." },
    { title: "Offtake already committed", text: "Binding offtake covers 60% of stage-one production, with a floor price mechanism over the first three years." },
    { title: "Infrastructure at the gate", text: "Grid power and a sealed road reach the site boundary; no new corridor is required for stage one." },
  ],
  callouts: ["DFS complete", "60% offtake bound", "Board took 8% of the raise"],
  proofHeading: "The case in figures",
  proofIntro: "The study numbers below are the DFS base case, at a long-run spodumene price of US$1,250/t.",
  achievedHeading: "Delivered to date",
  achieved: [
    "Maiden resource of 44Mt at 1.21% Li2O, upgraded twice since 2024",
    "Definitive feasibility study completed and independently reviewed",
    "Mining lease granted; native title agreement executed",
    "Metallurgical work returning 6.0% concentrate at 71% recovery",
    "Binding offtake signed for 60% of stage-one production",
  ],
  economicsHeading: "Study economics",
  economics: {
    columns: ["Stage one", "Expanded case"],
    rows: [
      { label: "Throughput", values: ["1.4 Mtpa", "2.6 Mtpa"] },
      { label: "Mine life", values: ["14 years", "19 years"] },
      { label: "Capital cost", values: ["A$210m", "A$355m"] },
      { label: "Operating cost", values: ["US$512/t", "US$471/t"] },
      { label: "NPV8 (post-tax)", values: ["A$690m", "A$1.14bn"] },
      { label: "IRR", values: ["34%", "41%"] },
    ],
  },
  planHeading: "Use of funds",
  milestones: [
    { when: "Q4 2026", what: "Long-lead orders placed; crushing circuit deposit paid" },
    { when: "Q1 2027", what: "Earthworks begin; camp expanded to 180 rooms" },
    { when: "Q3 2027", what: "Plant construction start" },
    { when: "Q2 2028", what: "First concentrate" },
  ],
  plan: [
    { title: "Long-lead equipment — US$8.4m", text: "Mill, crushing circuit and the flotation train, all quoted and held." },
    { title: "Early works — US$4.1m", text: "Access roads, site earthworks and the accommodation expansion." },
    { title: "Working capital — US$2.5m", text: "Twelve months of corporate and study costs through to construction." },
  ],
  teamHeading: "Who runs it",
  team: [
    { name: "Marius Ravenscroft", role: "Managing Director", bio: "Twenty-two years in Western Australian hard-rock operations; previously built and commissioned two spodumene concentrators." },
    { name: "Anneke Fothergill", role: "Chief Financial Officer", bio: "Resources finance across Perth and Singapore; raised A$740m of project debt and equity over four transactions." },
    { name: "Declan Harkness", role: "Chief Operating Officer", bio: "Mine manager on three producing operations in the Goldfields; led the DFS mining study." },
  ],
  gaps: ["Closing date is indicative and not yet confirmed in writing"],
  model: "claude-opus-4",
  draftedAt: new Date(Date.now() - 9 * 86400000).toISOString(),
};

await db.query(`update deals set teaser = $1, teaser_at = now(), teaser_model = 'claude-opus-4' where id = $2`,
  [JSON.stringify(teaser), d.id]);
console.log(`teaser written for ${d.reference}`);
await db.end();
