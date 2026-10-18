# Triage convention

No separate triage label vocabulary exists in this repo. Tickets are
agent-grabbable by construction; triage state is expressed through the `ticket`
label, issue/ticket state, and comments.

## Mapping

| Intent | How it is expressed |
|---|---|
| ready-for-agent | an OPEN ticket whose `dependencies` edges are all `done` |
| ready-for-human | a comment or `STATE.md` blocker naming the human gate (envelope, approval, UAT) |
| needs-info | a comment stating what is missing |
| wontfix | `status: superseded` or `wontfix` |
| wayfinder states | `.planning/wayfinder/` discovery packets and map entries |
