Hi! Let's **run CRM discovery** so I can learn your team's sales motion. I'll inspect your Salesforce org first, then ask only the blocking scope question I can't safely infer.

Ready to start? Just say **yes** and I'll begin the preflight.

## CRM Discovery — Initial Read

| Observation | Evidence | Implication |
| --- | --- | --- |
| Trailing 12-month Opportunity volume is substantial | **5,800** Opportunities | Enough volume for a GTM / selling-behavior analysis. |
| Closed outcomes are available | **526** Closed Won, **2,641** Closed Lost | Standard `IsClosed`, `IsWon`, and `StageName` can support outcome analysis. |
| Open pipeline is also sizable | **2,633** open Opportunities across active stages | We can analyze current-stage behavior, but outcome learning should focus on closed records. |
| Primary motion populations are clear | New Customer **1,280**; Existing Customer - Upgrade **1,264**; Replacement **1,214**; Downgrade **1,204**; blank Type **812** | There are distinct motions; scope selection is the only blocking decision. |
| Activity coverage is usable but incomplete | **3,384 / 5,800** Opportunities have `LastActivityDate` (58.3%) | Activity evidence can be used, with a coverage warning. |
| Stage model is standard enough for defaults | Closed Won / Closed Lost plus common sales stages like Qualification, Needs Analysis, Proposal, Negotiation | Default outcome definition is safe unless you want a custom success metric. |
| Potential Type hygiene issue | `Type` has **812 blank** records and observed values beyond the described picklist values | We should exclude blanks by default unless you want them included. |

## Default Assumptions

- **Window:** Trailing 12 months by `CreatedDate`
- **Outcome definition:** Standard Salesforce outcomes using `IsClosed`, `IsWon`, and `StageName`
- **Scope:** All segments, geographies, owners, and products unless the selected motion requires otherwise
- **Activity evidence:** Use linked activity / conversation evidence where available; carry forward coverage caveats
- **Goal:** Learn what drives better selling / GTM effectiveness

## Blocking Scope Check

I found these Opportunity populations:

| Opportunity Population | Count |
| --- | --- |
| New Customer | 1,280 |
| Existing Customer - Upgrade | 1,264 |
| Existing Customer - Replacement | 1,214 |
| Existing Customer - Downgrade | 1,204 |
| Blank Type | 812 |
| Existing Business | 19 |
| New Business | 7 |

Which population should I study for the selling-behavior analysis?

If you want the default, I'll use **New Customer + Existing Customer - Upgrade** and exclude **Replacement**, **Downgrade**, blank `Type`, and the tiny legacy `Existing Business` / `New Business` groups.
