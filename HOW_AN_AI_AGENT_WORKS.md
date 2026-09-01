# How an AI agent works (high school version)

Imagine a really capable intern. They can think, follow reusable workflows, and work for hours — but only if they have a job setup, reusable workflows, time, a notebook, keys to the right apps, and a place to talk to you.

## Agent harness

The intern’s **brain** is the AI model. The **harness** is the job setup around it: which connections they’re allowed to use, when they must ask you first, how they check their work, how they keep notes mid-task, and the loop of “try something → look at the result → decide the next step.”

Without a harness, you have a smart intern who can only write memos. With a harness, you have someone who can **act**.

The surface is where you talk. Connections are the keys. The harness is **how the intern actually works** between those two.

## Agent skills

A **skill** is a reusable workflow for one job: “Find prospects,” “Write sales emails,” “Prep for a meeting.” It says *when* to use it, *the steps*, *which connections to use*, and *the don’ts* (don’t email customers without review, don’t invent numbers).

It’s the SOP, not today’s shift. The skill stays the same whether it’s idle or currently running. The **run** is this afternoon’s assignment; the **skill** is the reusable workflow on the wall.

## Long running tasks

Some asks are a Slack reply. Some are a **week-long assignment**. Long-running tasks are the week-long kind: they take minutes to hours (or run on a schedule, like every Monday). You need checkpoints, a “here’s where we left off,” progress you can see on the surface, and the ability to pause and resume without starting over.

That’s why an agent “at work” looks like a live sequence of steps — searching accounts, ranking them, drafting cadences — instead of one giant answer that pretends the whole assignment finished in 8 seconds.

The surface is how you watch the assignment. The harness is what keeps it alive. Connections are what the intern is reaching into while you’re in meetings.

## Agent self-learning / knowledge

**Knowledge** is the team notebook: ICP criteria, “Marcus likes short emails,” what worked last quarter. **Skills** are *how we do the job*. **Knowledge** is *what we know about this world*.

**Self-learning** is when, after a run, the intern updates the notebook (or proposes a new reusable workflow) without you rewriting it by hand. Next week’s prospecting is better because last week left residue — facts, preferences, and patterns — not just a finished report.

## Connections

**Connections** are the intern’s **keys to other apps and data**.

Salesforce, Gmail, Calendar, ZoomInfo, Gong, LinkedIn — each connection is permission to read or write in that system: pull open opps, look up a contact, draft an email (usually not send until you say so).

Without connections, the intern can only talk. With connections, they can **go get the facts** instead of guessing. If a Salesforce connection expires mid-run, they should stop rather than invent the other half of the pipeline.

A skill says *which* keys this job needs. The harness is what actually uses them. You don’t hand the intern every key for every job.

## Surface

The **surface** is the **room you meet the intern in**.

It might be Salesforce Lightning (LEX), Slack, or a dedicated chat window. Same intern. Different rooms. You type “find me prospects this week,” they answer, show progress, and drop the finished work back **in that room**.

The surface is not the intern’s brain, and it is not the work itself. It’s the **front door**: where a human starts a job, checks in, approves something, or reads the result. You can start a job in Slack and later open the same run in Salesforce. Different surface, same intern.

**Gotcha:** Slack can be a *surface* (“I chat with the agent in Slack”) **and** a *connection* (“the agent posts to `#pipeline`”). Room vs. keys. Easy to mix up.

## How it fits together


| Piece                         | Intern metaphor                              | Job                                       |
| ----------------------------- | -------------------------------------------- | ----------------------------------------- |
| **Harness**                   | The intern’s job setup                       | Lets them *act* in a loop, not just talk  |
| **Skills**                    | The reusable workflows they follow           | Repeatable ways to do a job               |
| **Long-running tasks**        | A week-long assignment, not a quick reply    | Work that takes time and checkpoints      |
| **Knowledge / self-learning** | The team notebook                            | Remember and improve between runs         |
| **Connections**               | Keys to other apps                           | Where real data lives and actions happen  |
| **Surface**                   | The room you meet them in (LEX, Slack, chat) | Where you talk, check in, and see results |

### Copy for Google Slides

Copy one list at a time and paste into a table column (header is the first item).

**Piece**

<ul>
  <li>Piece</li>
  <li>Harness</li>
  <li>Skills</li>
  <li>Long-running tasks</li>
  <li>Knowledge / self-learning</li>
  <li>Connections</li>
  <li>Surface</li>
</ul>

**Intern metaphor**

<ul>
  <li>Intern metaphor</li>
  <li>The intern’s job setup</li>
  <li>The reusable workflows they follow</li>
  <li>A week-long assignment, not a quick reply</li>
  <li>The team notebook</li>
  <li>Keys to other apps</li>
  <li>The room you meet them in (LEX, Slack, chat)</li>
</ul>

**Job**

<ul>
  <li>Job</li>
  <li>Lets them act in a loop, not just talk</li>
  <li>Repeatable ways to do a job</li>
  <li>Work that takes time and checkpoints</li>
  <li>Remember and improve between runs</li>
  <li>Where real data lives and actions happen</li>
  <li>Where you talk, check in, and see results</li>
</ul>

**One line:** the harness is the intern’s job setup, skills are the reusable workflows they follow, long-running is the week-long assignment, knowledge is the team notebook, connections are the keys, and the surface is the room you meet them in.

## How it fits together (engine metaphor)

| Piece                         | Engine metaphor                         | Job                                          |
| ----------------------------- | --------------------------------------- | -------------------------------------------- |
| **Harness**                   | The engine                              | Makes it run in a loop, not just sit there   |
| **Skills**                    | The jobs the engine is built to run     | Repeatable ways to do a job                  |
| **Long-running tasks**        | A road trip, not a lap around the block | Work that takes time and checkpoints         |
| **Knowledge / self-learning** | The logbook                             | Remember and improve between runs            |
| **Connections**               | The hoses and hitches                   | Where real data lives and actions happen     |
| **Surface**                   | The dashboard (LEX, Slack, chat)        | Where you check in and see results           |

### Copy for Google Slides

Copy one list at a time and paste into a table column (header is the first item).

**Piece**

<ul>
  <li>Piece</li>
  <li>Harness</li>
  <li>Skills</li>
  <li>Long-running tasks</li>
  <li>Knowledge / self-learning</li>
  <li>Connections</li>
  <li>Surface</li>
</ul>

**Engine metaphor**

<ul>
  <li>Engine metaphor</li>
  <li>The engine</li>
  <li>The jobs the engine is built to run</li>
  <li>A road trip, not a lap around the block</li>
  <li>The logbook</li>
  <li>The hoses and hitches</li>
  <li>The dashboard (LEX, Slack, chat)</li>
</ul>

**Job**

<ul>
  <li>Job</li>
  <li>Makes it run in a loop, not just sit there</li>
  <li>Repeatable ways to do a job</li>
  <li>Work that takes time and checkpoints</li>
  <li>Remember and improve between runs</li>
  <li>Where real data lives and actions happen</li>
  <li>Where you check in and see results</li>
</ul>

**One line:** the harness is the engine, skills are the jobs it’s built to run, long-running is the road trip, knowledge is the logbook, connections are the hoses and hitches, and the surface is the dashboard.

## How it fits together (computer metaphor)

| Piece                         | Computer metaphor                              | Job                                          |
| ----------------------------- | ---------------------------------------------- | -------------------------------------------- |
| **Harness**                   | The operating system                           | Makes programs run, not just sit as files    |
| **Skills**                    | Apps / programs                                | Repeatable ways to do a job                  |
| **Long-running tasks**        | A program that keeps working in the background  | Work that takes time and checkpoints         |
| **Auto learning**             | Updating its own apps and recommending new ones  | Improve skills and suggest new skills and long-running tasks |
| **Connections**               | The web — sites, knowledge bases, live systems   | Where external data lives and actions happen |
| **Surface**                   | The screen and keyboard (LEX, Slack, chat)     | Where you check in and see results           |

### Copy for Google Slides

Copy one list at a time and paste into a table column (header is the first item).

**Piece**

<ul>
  <li>Piece</li>
  <li>Harness</li>
  <li>Skills</li>
  <li>Long-running tasks</li>
  <li>Auto learning</li>
  <li>Connections</li>
  <li>Surface</li>
</ul>

**Computer metaphor**

<ul>
  <li>Computer metaphor</li>
  <li>The operating system</li>
  <li>Apps / programs</li>
  <li>A program that keeps working in the background</li>
  <li>Updating its own apps and recommending new ones</li>
  <li>The web — sites, knowledge bases, live systems</li>
  <li>The screen and keyboard (LEX, Slack, chat)</li>
</ul>

**Job**

<ul>
  <li>Job</li>
  <li>Makes programs run, not just sit as files</li>
  <li>Repeatable ways to do a job</li>
  <li>Work that takes time and checkpoints</li>
  <li>Improve skills and suggest new skills and long-running tasks</li>
  <li>Where external data lives and actions happen</li>
  <li>Where you check in and see results</li>
</ul>

**One line:** the harness is the operating system, skills are the apps, long-running is a program that keeps working in the background, auto learning is the computer updating its apps and recommending new ones, connections are the web and knowledge bases, and the surface is the screen and keyboard.

## How it fits together (college version)

| Piece                         | What it is                                          | Job                                                              |
| ----------------------------- | --------------------------------------------------- | ---------------------------------------------------------------- |
| **Harness**                   | Runtime and control loop around the model           | Turns reasoning into a closed act → observe → repeat cycle       |
| **Skills**                    | Versioned, invocable procedures                     | Reusable capabilities the harness can load (not live runs)       |
| **Long-running tasks**        | Durable jobs that outlive a single request          | Keep execution alive with state, progress, and recovery          |
| **Knowledge / self-learning** | Persistent memory plus a write-back loop            | Facts and preferences that make the next run cheaper and better  |
| **Connections**               | Authenticated tool bindings to external systems     | Where the harness reads and writes real data                     |
| **Surface**                   | Human I/O channel (LEX, Slack, chat)                | Where people start, inspect, approve, and receive work           |

### Copy for Google Slides

Copy one list at a time and paste into a table column (header is the first item).

**Piece**

<ul>
  <li>Piece</li>
  <li>Harness</li>
  <li>Skills</li>
  <li>Long-running tasks</li>
  <li>Knowledge / self-learning</li>
  <li>Connections</li>
  <li>Surface</li>
</ul>

**What it is**

<ul>
  <li>What it is</li>
  <li>Runtime and control loop around the model</li>
  <li>Versioned, invocable procedures</li>
  <li>Durable jobs that outlive a single request</li>
  <li>Persistent memory plus a write-back loop</li>
  <li>Authenticated tool bindings to external systems</li>
  <li>Human I/O channel (LEX, Slack, chat)</li>
</ul>

**Job**

<ul>
  <li>Job</li>
  <li>Turns reasoning into a closed act → observe → repeat cycle</li>
  <li>Reusable capabilities the harness can load (not live runs)</li>
  <li>Keep execution alive with state, progress, and recovery</li>
  <li>Facts and preferences that make the next run cheaper and better</li>
  <li>Where the harness reads and writes real data</li>
  <li>Where people start, inspect, approve, and receive work</li>
</ul>

**One line:** the harness is the runtime and control loop, skills are versioned procedures, long-running tasks are durable jobs, knowledge is the memory write-back that makes the next run cheaper and better, connections are authenticated tool bindings, and the surface is the human I/O channel.