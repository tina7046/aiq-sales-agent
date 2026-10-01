/**
 * Available tools - single source of truth for all AOP steps.
 * Each tool declares which steps it belongs to via the `steps` array.
 * Icons are string ids; render with getToolIconSvg(id) in ui.
 */

export const AVAILABLE_TOOLS = [
  {
    id: "zoominfo_lookup",
    name: "ZoomInfo Lookup",
    description: "Find and enrich contact information from ZoomInfo database",
    icon: "sparkle",
    category: "web",
    color: "color1",
    steps: ["account_research", "find_prospects", "write_messaging"],
    useCase: "Enrich contacts and accounts with ZoomInfo data for outreach and research.",
    tabs: [
      { label: "Org Chart", description: "Navigate organizational hierarchies to find direct contact details for key decision makers and budget holders.", example: "Use {{tool}} to find direct dial and email for decision makers at target accounts.", evidence: { tool: "Research ZoomInfo", search: "Direct dial and email for VP Sales at Acme Corp", result: "Jane Rivera — VP of Sales, +1 (415) 555-0142, j.rivera@acme.com" } },
      { label: "News", description: "Surface recent press coverage and corporate announcements including leadership changes, product launches, and strategic shifts.", example: "Use {{tool}} to surface recent news about leadership changes at a prospect's company.", evidence: { tool: "Research ZoomInfo", search: "Recent leadership changes at Acme Corp", result: "New CRO appointed: Michael Torres joined from Salesforce (Feb 2025)" } },
      { label: "Intent", description: "Detect real-time buying intent signals based on content consumption and research activity across your product category.", example: "Use {{tool}} to identify accounts showing buying intent for your product category.", evidence: { tool: "Research ZoomInfo", search: "Buying intent signals for sales engagement platforms", result: "High intent detected: 12 research spikes in 'sales automation' over last 30 days" } },
      { label: "Scoops", description: "Uncover early-stage intelligence on funding rounds, mergers, acquisitions, and other material corporate events.", example: "Use {{tool}} to uncover funding rounds or M&A activity at key accounts.", evidence: { tool: "Research ZoomInfo", search: "Funding or M&A activity for Acme Corp", result: "Series C: $120M raised led by Sequoia Capital (Jan 2025)" } },
      { label: "Competitors", description: "Identify which competing products and vendors a prospect is currently evaluating or has deployed.", example: "Use {{tool}} to identify which competitors a prospect is currently evaluating or using." },
      { label: "Technographics", description: "See the full technology stack a company runs, including software, infrastructure, and cloud services.", example: "Use {{tool}} to see what software and infrastructure tools a target account has installed." },
      { label: "Revenue", example: "Use {{tool}} to pull estimated annual revenue for an account to validate deal sizing." },
      { label: "Headcount", example: "Use {{tool}} to check how many employees a company has and how fast they are growing." },
      { label: "Departments", example: "Use {{tool}} to break down a company's department sizes and find the right team to sell into." },
      { label: "Board Members", example: "Use {{tool}} to find board members and investors who may influence purchasing decisions." },
      { label: "Company Hierarchy", example: "Use {{tool}} to map out parent-subsidiary relationships for enterprise account planning." },
      { label: "Job Postings", example: "Use {{tool}} to review open job postings that reveal a prospect's strategic priorities." },
    ],
    details: {
      inputs: [
        { name: "Person Name", description: "Full name of the person to look up", type: "Text" },
        { name: "Company", description: "Current or recent company for disambiguation", type: "Text" },
        { name: "Enrich Data", description: "Pull additional profile data and work history", type: "Boolean" },
      ],
      outputs: [
        { name: "Profile", description: "ZoomInfo contact profile information", type: "JSON" },
        { name: "Work History", description: "Employment history and positions", type: "JSON" },
        { name: "Contact Info", description: "Available contact information", type: "JSON" },
      ],
    },
  },
  {
    id: "website_research",
    name: "Website Research",
    description: "Analyze company websites to extract business intelligence and insights",
    icon: "sparkle",
    category: "web",
    color: "color2",
    steps: ["account_research", "find_prospects", "write_messaging"],
    useCase: "Extract business intelligence and insights from company websites.",
    tabs: [
      { label: "Products", description: "Analyze a company's product catalog, feature sets, and pricing tiers to understand their market positioning.", example: "Use {{tool}} to analyze a competitor's product lineup and pricing model.", evidence: { tool: "Website Research", title: "Acme Corp Product Lineup", url: "acme.com/products", snippet: "Acme offers three tiers: Starter ($29/mo), Professional ($99/mo), and Enterprise (custom). The Professional tier includes API access and SSO." } },
      { label: "Tech Stack", description: "Discover the technologies, cloud platforms, and developer frameworks a prospect uses from their public site.", example: "Use {{tool}} to discover what technologies a prospect is running.", evidence: { tool: "Website Research", title: "Acme Corp Technology Stack", url: "acme.com/platform", snippet: "Built on AWS with a React frontend. Integrates with Salesforce, HubSpot, and Marketo. Uses Snowflake for data warehousing." } },
      { label: "Compliance", description: "Check for published security certifications, compliance badges, and data protection commitments.", example: "Use {{tool}} to check if a company has SOC 2 or ISO certifications on their site.", evidence: { tool: "Website Research", title: "Acme Corp SOC 2 Compliance", url: "acme.com/security", snippet: "Acme Corp has achieved SOC 2 Type II compliance, demonstrating commitment to the highest standards of security and data protection for customers." } },
      { label: "Partnerships", description: "Find strategic partnerships, technology alliances, and channel relationships listed on the site.", example: "Use {{tool}} to find a prospect's strategic partnerships and technology alliances." },
      { label: "Case Studies", description: "Extract customer success stories, ROI metrics, and testimonials published by a competitor.", example: "Use {{tool}} to pull customer success stories and ROI metrics from a competitor's site." },
      { label: "Leadership", description: "Identify the executive team, their titles, and professional backgrounds from the company's about page.", example: "Use {{tool}} to identify the executive team and their professional backgrounds." },
      { label: "Careers Page", example: "Use {{tool}} to analyze open roles and hiring trends that signal growth areas." },
      { label: "Company Culture", example: "Use {{tool}} to understand a prospect's mission, values, and workplace culture." },
      { label: "Integrations", example: "Use {{tool}} to see which third-party integrations a product supports natively." },
      { label: "Pricing Changes", example: "Use {{tool}} to track recent pricing page updates or new plan tiers a competitor launched." },
      { label: "News & Blog", example: "Use {{tool}} to review a company's latest blog posts and press releases for strategic themes." },
      { label: "Customer Logos", example: "Use {{tool}} to collect notable customer logos and industry verticals a company serves." },
    ],
    details: {
      inputs: [
        { name: "Website URL", description: "Company website URL to research", type: "URL" },
        { name: "Research Areas", description: "Specific areas to analyze (products, pricing, customers, tech stack)", type: "Long text" },
        { name: "Competitive Analysis", description: "Include competitive positioning insights", type: "Boolean" },
      ],
      outputs: [
        { name: "Business Overview", description: "Company business model and offerings", type: "Long text" },
        { name: "Products/Services", description: "List of products and services offered", type: "JSON" },
        { name: "Key Insights", description: "Strategic insights and talking points", type: "JSON" },
      ],
    },
  },
  {
    id: "crm_lookup",
    name: "CRM Lookup",
    description: "Search and retrieve records from your CRM system",
    icon: "sparkle",
    category: "data",
    color: "color3",
    steps: ["account_research", "find_prospects", "write_messaging"],
    useCase: "Search and retrieve records from your CRM system.",
    tabs: [
      { label: "Accounts", description: "Retrieve key account fields like owner, industry, employee count, and recent activity history.", example: "Use {{tool}} to pull the latest account details and activity history.", evidence: { tool: "Lookup CRM", recordName: "Acme Corporation", fields: [{ label: "Owner", value: "Sarah Chen" }, { label: "Industry", value: "Technology" }, { label: "Employees", value: "2,400" }] } },
      { label: "Contacts", description: "Find all contacts associated with a target account including their titles, roles, and last activity dates.", example: "Use {{tool}} to find all contacts at a target account and their roles.", evidence: { tool: "Lookup CRM", recordName: "Jane Rivera", fields: [{ label: "Title", value: "VP of Sales" }, { label: "Account", value: "Acme Corporation" }, { label: "Last Activity", value: "Mar 15, 2025" }] } },
      { label: "Opportunities", description: "Review open and historical opportunities, their stages, close dates, and owners.", example: "Use {{tool}} to review open opportunities and their current stage.", evidence: { tool: "Lookup CRM", recordName: "Acme Corporation - Enterprise", fields: [{ label: "Stage", value: "Closed Lost" }, { label: "Close Date", value: "Nov 2024" }, { label: "Owner", value: "Freddy Krueger" }] } },
      { label: "Tasks", description: "Find overdue and upcoming tasks, follow-ups, and reminders linked to a specific account.", example: "Use {{tool}} to find overdue tasks and follow-ups associated with a target account." },
      { label: "Cases", description: "Surface open support cases and escalations that may affect deal health or renewal timing.", example: "Use {{tool}} to surface open support cases that may impact an upcoming renewal conversation." },
      { label: "Leads", description: "Check for any inbound leads from a target company that are already sitting in the pipeline.", example: "Use {{tool}} to check if any inbound leads from a target company are already in the pipeline." },
      { label: "Campaigns", example: "Use {{tool}} to see which marketing campaigns a contact has engaged with recently." },
      { label: "Pipeline Value", example: "Use {{tool}} to calculate total pipeline value across all open opportunities for an account." },
      { label: "Last Touch", example: "Use {{tool}} to find when the last meaningful interaction with a prospect occurred." },
      { label: "Deal History", example: "Use {{tool}} to review past closed-won and closed-lost deals to inform your positioning." },
      { label: "Activity Timeline", example: "Use {{tool}} to pull a chronological timeline of all logged activities for an account." },
      { label: "Competitor Mentions", example: "Use {{tool}} to search CRM notes for any mentions of competitors on an account." },
    ],
    details: {
      inputs: [
        { name: "Search Query", description: "Company name, contact name, or deal name", type: "Text" },
        { name: "Record Type", description: "Type of record (Account, Contact, Opportunity)", type: "Text" },
        { name: "Include History", description: "Include activity history and notes", type: "Boolean" },
      ],
      outputs: [
        { name: "Records", description: "Matching CRM records", type: "JSON" },
        { name: "Activities", description: "Related activities and touchpoints", type: "JSON" },
      ],
    },
  },
 
  {
    id: "check_signals",
    name: "Check For Signals",
    description: "Monitor and detect preconfigured buying signals and trigger events",
    icon: "sparkle",
    category: "data",
    color: "color4",
    steps: ["account_research", "find_prospects", "write_messaging"],
    useCase: "Monitor and detect preconfigured buying signals and trigger events.",
    tabs: [
      { label: "Funding", description: "Detect recent funding rounds, investment activity, and capital raises that indicate growth and budget availability.", example: "Use {{tool}} to find accounts that recently closed a funding round.", evidence: { tool: "Check For Signals", search: "Funding or investment activity for company", result: "Series C: $120M raised led by Sequoia Capital (Jan 2025)" } },
      { label: "Hiring", description: "Spot companies rapidly scaling specific teams, signaling investment in new capabilities or initiatives.", example: "Use {{tool}} to spot companies rapidly scaling their sales or engineering teams.", evidence: { tool: "Check For Signals", search: "Hiring activity in sales and engineering departments", result: "32 open roles posted in last 30 days — 18 in Engineering, 14 in Sales" } },
      { label: "Tech Changes", description: "Detect when a prospect adopts, replaces, or drops technology solutions relevant to your competitive landscape.", example: "Use {{tool}} to detect when a prospect adopts or drops a competing solution.", evidence: { tool: "Check For Signals", search: "Technology adoption or removal signals", result: "Dropped Outreach.io from tech stack; evaluating replacements (detected via BuiltWith)" } },
      { label: "Executive Changes", description: "Flag accounts where key decision makers like CRO, CTO, or VP of Sales have recently changed.", example: "Use {{tool}} to flag accounts where a new CRO, CTO, or VP of Sales was recently appointed." },
      { label: "Expansion", description: "Identify companies opening new offices, entering new geographies, or expanding into adjacent markets.", example: "Use {{tool}} to identify companies opening new offices or expanding into new markets." },
      { label: "Layoffs", description: "Detect recent layoffs, restructuring, or headcount reductions that may shift priorities and budgets.", example: "Use {{tool}} to detect recent layoffs or restructuring that may shift budget priorities." },
      { label: "Product Launch", example: "Use {{tool}} to spot when a prospect launches a new product line that aligns with your solution." },
      { label: "Partnerships", example: "Use {{tool}} to surface new strategic partnerships that could create co-selling opportunities." },
      { label: "Earnings", example: "Use {{tool}} to review quarterly earnings reports for mentions of growth initiatives or cost-cutting." },
      { label: "Contract Renewal", example: "Use {{tool}} to find accounts approaching contract renewal dates with a competitor." },
      { label: "Office Moves", example: "Use {{tool}} to detect headquarters relocations or facility consolidations." },
      { label: "Regulatory", example: "Use {{tool}} to identify regulatory changes or compliance mandates affecting a prospect's industry." },
    ],
    details: {
      inputs: [
        { name: "Company ID", description: "Company or account ID to check signals for", type: "Text" },
        { name: "Signal Types", description: "Types of signals to check (funding, hiring, tech changes, news)", type: "Long text" },
        { name: "Time Range", description: "How far back to look for signals (days)", type: "Number" },
      ],
      outputs: [
        { name: "Signals", description: "List of detected signals with details", type: "JSON" },
        { name: "Priority Score", description: "Overall signal strength score", type: "Number" },
        { name: "Recommendations", description: "Suggested actions based on signals", type: "Long text" },
      ],
    },
  },
  {
    id: "analyze_conversations",
    name: "Analyze Past Conversations",
    description: "Extract insights from historical CRM notes and conversation records",
    icon: "sparkle",
    category: "data",
    color: "color5",
    steps: ["account_research", "find_prospects", "write_messaging"],
    useCase: "Tell your agent to gather context from past call transcripts, emails, and notes fields.",
    tabs: [
      { label: "Calls", description: "Review past call transcripts to extract mentions of pain points, requirements, and competitive context.", example: "Use {{tool}} to review past call transcripts for mentions of integration pain points.", evidence: { tool: "Analyze Past Conversations", conversations: [{ title: "Discovery Call — Q4 Review", contact: "Bob Smith", date: "Mar 2, 2025", quote: "\"...We've been struggling with our Salesforce-to-Slack integration for months now...\"" }] } },
      { label: "Emails", description: "Surface relevant email threads that discuss budget timelines, project scope, or decision criteria.", example: "Use {{tool}} to surface accounts that discussed budget timelines in recent threads.", evidence: { tool: "Analyze Past Conversations", conversations: [{ title: "Re: Budget Planning FY26", contact: "Lisa Park", date: "Feb 18, 2025", quote: "\"...We're finalizing our Q3 budget next month and would love to revisit pricing...\"" }] } },
      { label: "Meetings", description: "Extract action items, commitments, and next steps captured in meeting notes and follow-up summaries.", example: "Use {{tool}} to extract action items and commitments from previous meeting notes.", evidence: { tool: "Analyze Past Conversations", conversations: [{ title: "Technical Deep Dive", contact: "David Kim", date: "Jan 10, 2025", quote: "\"...Action item: Send API documentation and schedule a follow-up with their engineering lead...\"" }] } },
      { label: "Objections", description: "Find recurring objections and concerns a prospect has raised so you can proactively address them.", example: "Use {{tool}} to find common objections a prospect has raised across past interactions." },
      { label: "Champions", description: "Identify internal advocates and supporters who have spoken positively about your solution.", example: "Use {{tool}} to identify internal advocates who have spoken positively about your product." },
      { label: "Competitors Mentioned", description: "Surface any references to competing vendors, alternative solutions, or build-vs-buy discussions.", example: "Use {{tool}} to surface any references to competing vendors in past discussions." },
      { label: "Decision Criteria", example: "Use {{tool}} to extract the evaluation criteria a prospect shared during discovery calls." },
      { label: "Timeline", example: "Use {{tool}} to find any mentions of decision timelines or go-live target dates." },
      { label: "Stakeholders", example: "Use {{tool}} to map all stakeholders mentioned across calls, emails, and notes." },
      { label: "Pain Points", example: "Use {{tool}} to compile recurring pain points a prospect has described over time." },
      { label: "Feature Requests", example: "Use {{tool}} to gather specific feature requests or product gaps the prospect has flagged." },
      { label: "Sentiment", example: "Use {{tool}} to gauge overall sentiment trends across recent interactions with an account." },
    ],
    details: {
      inputs: [
        { name: "Account ID", description: "Account or contact ID to analyze", type: "Text" },
        { name: "Conversation Types", description: "Types to analyze (calls, emails, meetings, notes)", type: "Text" },
        { name: "Analysis Focus", description: "What to extract (pain points, objections, interests)", type: "Long text" },
      ],
      outputs: [
        { name: "Summary", description: "Synthesized summary of past conversations", type: "Long text" },
        { name: "Key Themes", description: "Recurring themes and topics", type: "JSON" },
        { name: "Action Items", description: "Outstanding commitments or follow-ups", type: "JSON" },
      ],
    },
  },

];

export function getToolById(id) {
  return AVAILABLE_TOOLS.find((t) => t.id === id);
}

export function getToolsForStep(stepKey) {
  return AVAILABLE_TOOLS.filter((t) => t.steps && t.steps.includes(stepKey));
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Build complete tool-mention badge HTML.
 * @param {object} tool - Tool object (needs at least id, name, category, color, icon)
 * @param {object} [options]
 * @param {boolean} [options.dismissable=false] - Include dismiss (x) button
 */
export function buildToolBadgeHtml(tool, { dismissable = false } = {}) {
  const iconSvg = getToolIconSvg(tool.icon);
  const colorAttr = tool.color ? ` data-color="${escapeHtml(tool.color)}"` : "";
  const dismissHtml = dismissable ? '<span class="tool-dismiss" data-action="dismiss"></span>' : "";
  return `<span class="tool-mention" data-tool-id="${escapeHtml(tool.id)}" data-id="${escapeHtml(tool.id)}" data-name="${escapeHtml(tool.name)}" data-category="${escapeHtml(tool.category || "")}"${colorAttr} contenteditable="false"><span class="slds-icon_container slds-icon_container_circle icon-container"><span class="tool-icon">${iconSvg}</span></span><span class="tool-label">${escapeHtml(tool.name)}</span>${dismissHtml}</span>`;
}

/** Return SVG markup for tool icon (for category or icon id). */
export function getToolIconSvg(iconId) {
  const icons = {
    building: '<svg class="slds-icon slds-icon-text-default" aria-hidden="true"><use xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="/aiq-sales-agent/assets/icons/utility-sprite/svg/symbols.svg#account"></use></svg>',
    userPlus: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>',
    zoominfo: '<svg class="slds-icon " style="fill:#FFF; width:14px; height:14px;" aria-hidden="true"><use xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="/aiq-sales-agent/assets/images/zoominfo.svg"></use></svg>',
    globe: '<svg class="slds-icon  slds-icon-text-default" style="fill:#FFF" aria-hidden="true"><use xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="/aiq-sales-agent/assets/icons/action-sprite/svg/symbols.svg#web_link"></use></svg>',
    mail: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>',
    send: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m22 2-7 20-4-9-9-4 20-7z"/><path d="M22 2 11 13"/></svg>',
    database: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>',
    clipboard: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg>',
    calendar: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    target: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>',
    trendingUp: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>',
    phone: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
    fileSpreadsheet: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h2"/><path d="M8 17h2"/><path d="M14 13h2"/><path d="M14 17h2"/></svg>',
    zap: '<svg class="slds-icon slds-icon-text-default" style="fill:#FFF" aria-hidden="true"><use xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="/aiq-sales-agent/assets/icons/custom-sprite/svg/symbols.svg#custom30"></use></svg>',
    cloud: '<svg class="slds-icon slds-icon-text-default" style="fill:#FFF" aria-hidden="true"><use xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="/aiq-sales-agent/assets/icons/utility-sprite/svg/symbols.svg#salesforce1"></use></svg>',
    sparkle: '<svg class="slds-icon slds-icon-text-default" style="fill:#FFF" aria-hidden="true"><use xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="/aiq-sales-agent/assets/icons/utility-sprite/svg/symbols.svg#sparkle"></use></svg>',
    sparkles: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>',
  };
  return icons[iconId] || icons.zap;
}
