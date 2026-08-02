const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Domain-weighted lead-time scoring table.
// To add a new domain (e.g. 'medical', 'academic'), add one key here — no other changes needed.
// Each entry: { max: days_until_due_ceiling, s: lead_time_score }
// Evaluated in order; first bucket where days_remaining <= max wins.
const LEAD_TIME_CURVES = {
  legal: [
    // Legal deadlines: urgent much earlier — consequences compound if not acted on well before the date
    { max: 7,        s: 5 },  // ≤3 days and 4-7 days both score 5 for legal
    { max: 30,       s: 4 },  // 8-14 days and 15-30 days both score 4
    { max: 60,       s: 3 },  // 31-60 days
    { max: Infinity, s: 2 },  // 61+ or no linked deadline
  ],
  grant: [
    // Grant windows are more binary — closer to the date, urgency spikes
    { max: 3,        s: 5 },
    { max: 7,        s: 4 },
    { max: 14,       s: 3 },
    { max: 30,       s: 2 },
    { max: Infinity, s: 1 },  // 31+ or no linked deadline
  ],
  default: [
    { max: 3,        s: 5 },
    { max: 7,        s: 4 },
    { max: 14,       s: 3 },
    { max: 30,       s: 2 },
    { max: Infinity, s: 1 },
  ],
};

// NOTE TO ASIA: The legal curve above (ramps urgency earlier, stays higher longer) is a first pass.
// Revisit after a real legal deadline runs through — confirm Tier 1 triggered at the right moment.

function leadTimeScore(dueDateStr, domain) {
  const curve = LEAD_TIME_CURVES[domain] ?? LEAD_TIME_CURVES.default;
  if (!dueDateStr) return curve.at(-1).s;
  const daysRemaining = (new Date(dueDateStr) - Date.now()) / 86400000;
  for (const { max, s } of curve) {
    if (daysRemaining <= max) return s;
  }
  return curve.at(-1).s;
}

function computeTier(score) {
  if (score >= 20) return { num: 1, label: "Immediate Focus" };
  if (score >= 12) return { num: 2, label: "Near-Term Execution" };
  if (score >= 6)  return { num: 3, label: "Scheduled" };
  return { num: 4, label: "Defer/Delegate" };
}

function parseSignal(sig) {
  return {
    ...sig,
    affects_repos: typeof sig.affects_repos === "string"
      ? JSON.parse(sig.affects_repos || "[]")
      : (sig.affects_repos || []),
  };
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: CORS });
  }

  const [itemsResult, signalsResult, allItemsResult] = await Promise.all([
    env.DB.prepare("SELECT * FROM work_items WHERE status != 'done'").all(),
    env.DB.prepare("SELECT * FROM deadline_signals").all().catch(() => ({ results: [] })),
    env.DB.prepare("SELECT repo_name, status FROM work_items").all(),
  ]);

  const workItems = itemsResult.results ?? [];
  const signals = (signalsResult.results ?? []).map(parseSignal);
  const allItems = allItemsResult.results ?? [];
  const now = Date.now();

  const rows = workItems.map(item => {
    const matching = signals.filter(sig => sig.affects_repos.includes(item.repo_name));

    // Find signal that produces the highest natural score (consequence × lead-time)
    // to identify the driving signal; manual override doesn't change which signal drives
    let drivingSignal = null;
    let drivingLeadTime = 1; // "no deadline" default lead-time

    for (const sig of matching) {
      const lt = leadTimeScore(sig.due_date, sig.domain);
      const natural = sig.consequence_severity * lt;
      if (!drivingSignal || natural > drivingSignal.consequence_severity * leadTimeScore(drivingSignal.due_date, drivingSignal.domain)) {
        drivingSignal = sig;
        drivingLeadTime = lt;
      }
    }

    // Consequence: manual override wins; else use driving signal's severity; else default 3
    const effectiveConsequence = item.manual_consequence_override
      ?? (drivingSignal ? drivingSignal.consequence_severity : 3);

    // Impact score: consequence × lead-time. No-deadline items score consequence × 1 → max 5 → Tier 4
    const impactScore = effectiveConsequence * drivingLeadTime;
    const tierInfo = computeTier(impactScore);

    return {
      id: item.id,
      repo_name: item.repo_name,
      task_description: item.task_description,
      status: item.status,
      assigned_to: item.assigned_to,
      impact_score: impactScore,
      tier_num: tierInfo.num,
      tier_label: tierInfo.label,
      has_deadline_pressure: !!drivingSignal,
      manual_consequence_override: item.manual_consequence_override ?? null,
      driving_signal: drivingSignal ? {
        title: drivingSignal.title,
        due_date: drivingSignal.due_date,
        source_repo: drivingSignal.source_repo,
        domain: drivingSignal.domain,
        days_remaining: Math.ceil((new Date(drivingSignal.due_date) - now) / 86400000),
      } : null,
    };
  });

  rows.sort((a, b) => b.impact_score - a.impact_score);

  // Bottlenecks: signals due within 7 days where no affected repo has in_progress work
  const bottlenecks = signals
    .filter(sig => {
      const days = (new Date(sig.due_date) - now) / 86400000;
      if (days > 7) return false;
      return !sig.affects_repos.some(repo =>
        allItems.some(w => w.repo_name === repo && w.status === "in_progress")
      );
    })
    .map(sig => ({
      title: sig.title,
      due_date: sig.due_date,
      source_repo: sig.source_repo,
      domain: sig.domain,
      consequence_severity: sig.consequence_severity,
      affects_repos: sig.affects_repos,
      days_remaining: Math.ceil((new Date(sig.due_date) - now) / 86400000),
    }))
    .sort((a, b) => a.days_remaining - b.days_remaining);

  return new Response(JSON.stringify({ items: rows, bottlenecks }), { headers: CORS });
}
