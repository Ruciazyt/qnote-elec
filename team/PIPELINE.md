# Team Pipeline Orchestrator

This file is for ME (Claw), not for human consumption.

## How to run the full pipeline

When user sends: `team: qnote-elec:pm: [需求]`

### Step 1: PM
Spawn subagent with:
- task: "Read /home/zyt/.openclaw/workspace/qnote-elec/team/pm/PROMPT.md. Then write the requirement spec to /home/zyt/.openclaw/workspace/qnote-elec/team/pm/spec.md based on user request: [需求]"
- label: `qnote-pm`
- cwd: `/home/zyt/.openclaw/workspace/qnote-elec`
- wait for completion

### Step 2: UI Designer
Spawn subagent with:
- task: "Read /home/zyt/.openclaw/workspace/qnote-elec/team/ui-designer/PROMPT.md. Read /home/zyt/.openclaw/workspace/qnote-elec/team/pm/spec.md. Also explore the existing codebase at /home/zyt/.openclaw/workspace/qnote-elec/renderer/src to understand current component styles and patterns. Then write the UI/UX design to /home/zyt/.openclaw/workspace/qnote-elec/team/ui-designer/design.md"
- label: `qnote-ui`
- cwd: `/home/zyt/.openclaw/workspace/qnote-elec`
- wait for completion

### Step 3: Architect
Spawn subagent with:
- task: "Read /home/zyt/.openclaw/workspace/qnote-elec/team/architect/PROMPT.md. Read /home/zyt/.openclaw/workspace/qnote-elec/team/pm/spec.md. Read /home/zyt/.openclaw/workspace/qnote-elec/team/ui-designer/design.md. Then write the technical plan to /home/zyt/.openclaw/workspace/qnote-elec/team/architect/plan.md"
- label: `qnote-architect`
- cwd: `/home/zyt/.openclaw/workspace/qnote-elec`
- wait for completion

### Step 4: Developer
Spawn subagent with:
- task: "Read /home/zyt/.openclaw/workspace/qnote-elec/team/developer/PROMPT.md. Read /home/zyt/.openclaw/workspace/qnote-elec/team/architect/plan.md. Read /home/zyt/.openclaw/workspace/qnote-elec/team/ui-designer/design.md. Then implement the code in /home/zyt/.openclaw/workspace/qnote-elec/. After implementing, run lint and tests, commit with a proper message starting with 'feat:' or 'fix:', and push to remote."
- label: `qnote-developer`
- cwd: `/home/zyt/.openclaw/workspace/qnote-elec`
- timeout: 600
- wait for completion

### Step 5: QA
Spawn subagent with:
- task: "Read /home/zyt/.openclaw/workspace/qnote-elec/team/qa/PROMPT.md. Read /home/zyt/.openclaw/workspace/qnote-elec/team/pm/spec.md. Read /home/zyt/.openclaw/workspace/qnote-elec/team/architect/plan.md. Run git diff and lint checks to verify the implementation. Write the test report to /home/zyt/.openclaw/workspace/qnote-elec/team/qa/report.md"
- label: `qnote-qa`
- cwd: `/home/zyt/.openclaw/workspace/qnote-elec`
- wait for completion

### Step 6: If QA fails
If report contains issues:
- Read the report
- Re-spawn Developer with the issues, asking to fix them
- Max 3 iterations

### Step 7: Report to user
Summarize the pipeline results for the user.

---

## How to run research-only

When user sends: `team: qnote-elec:research: [调研方向]`

### Step 1: Research
Spawn subagent with:
- task: "Read /home/zyt/.openclaw/workspace/qnote-elec/team/research/PROMPT.md. Then research the topic '[调研方向]' and write the findings to /home/zyt/.openclaw/workspace/qnote-elec/team/research/ideas.md. Cover: user scenarios, competitor analysis, technical feasibility, 3-8 specific feature ideas with implementation hints."
- label: `qnote-research`
- cwd: `/home/zyt/.openclaw/workspace/qnote-elec`
- timeout: 300
- wait for completion

### Step 2: Report to user
Show the user the research output and ask which idea(s) they'd like to pursue with PM.
