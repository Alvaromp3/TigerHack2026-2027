# Hospital Operations Simulation

This document records the agreed simulation concept and current design
recommendations. It is a planning reference, not an implementation contract;
open assumptions must be confirmed before they become behavior in the app.

## Scope

- Planning proceeds in two passes: first make a rough staffing/workflow draft
  for every floor, then return to B1 and work upward to finalize schedules and
  cross-floor handoffs together.
- The current B1 first-shift rough draft estimates 10 workers from 6:00 a.m.
  to 6:00 p.m. This and the other floor drafts are not finalized staffing
  requirements. The second shift will have different workers; its roster
  remains to be designed.
- Use placeholder worker IDs such as S1 for sterile processing and LL1 for
  loading/logistics. Each worker will eventually have an individual profile,
  role qualifications, station assignment, shift, and schedule.
- PostgreSQL is the intended store. Credentials belong in environment
  configuration and must not be copied into this document or committed.

## Map Markers

- Gray: waiting guests.
- Black: desk, general staff, and maintenance roles.
- Blue: doctors, surgeons, and primary operating roles.
- Pink: nurses and supporting roles.
- Red: patients.

Dots represent people, not work items. A person moves when assigned work or
following a defined route; crowd volume alone should not make workers wander.

## Daily Activity Cycle

The cycle repeats every day and controls baseline demand and movement frequency:

| Local time | Tier / transition |
| --- | --- |
| 6:00 a.m. | Low begins |
| 8:00 a.m. | Gradually reaches Low2 |
| 10:00 a.m. | Rises faster to Mid |
| 10:00 a.m.-3:00 p.m. | Mid |
| 4:00 p.m. | Peaks at High |
| 5:00 p.m. | Reaches High2 |
| 5:00 p.m.-midnight | Gradually declines to Low |
| Midnight-6:00 a.m. | Low |

These times are approximate guideposts, not exact transition deadlines. The
descriptions "gradually," "faster," "spiking," and "slowly" express the
intended direction and relative pace as a human estimate; they do not define a
linear interpolation or precise curve. In particular, demand should trend from
Mid toward High around 3:00-4:00 p.m., peak around 4:00, rise toward High2
around 5:00, then trend down toward Low around midnight.

At runtime, use a configurable, smooth-but-variable trend around those
guideposts. Work frequency should be sampled from a configurable distribution
conditioned on the current/transition tier, so the overall daily shape is
recognizable while exact task timing and counts vary between cycles. Do not
hard-code a fixed number of actions per tier or make the schedule deterministic.
Random special events are out of scope for this cycle.

## Recommended Workload Model

Use a hybrid of cycle-driven baseline demand and event-driven dependent work.
Making every role independent of other roles would break operational handoffs;
making all demand a rigid chain would be brittle when tasks are delayed or
skipped.

- The activity tier supplies a baseline demand range for independent activity,
  such as storage requests and guest movement.
- Operational events create linked work. For example, patient admission and
  discharge/bed turnover can create linen pickup, clean-sheet delivery, and
  clothing/linen return work.
- Linked tasks enter queues and are eligible only after their prerequisites
  occur. Delays should wait in the queue rather than silently dropping work.
- Queue pressure and station capacity influence dispatch priority. Randomness
  varies workload within configured tier ranges; it must not bypass task
  prerequisites, qualifications, or capacity limits.
- After completing linked work, workers return to their normal station or
  route, where cycle-driven baseline demand continues.
- Record task state transitions so a task is not duplicated if retried. Keep
  stochastic choices seedable/configurable for reproducible debugging.
- Model handoffs across floors as real dependencies. For example, F1 may need
  an accepting bed on an inpatient floor before an admitted patient can be
  transferred; a completed bed turnover can create linen work for B1. A floor
  can be developed as a module, but end-to-end hospital behavior is only
  validated when its connected floors and handoffs are integrated. Temporary
  mock events are useful during development but are not full-system validation.
- Overload must not silently skip or duplicate work. Keep incoming requests in
  bounded queues, apply explicit priority/capacity rules, and record when work
  is waiting, deferred, or rejected. The cycle supplies baseline demand; it is
  not itself the worker task queue or the server's processing clock.

Example dependency:

`patient admitted -> clinical care -> bed turnover -> linen pickup -> clean linen delivery`

This is a conceptual flow; detailed clinical floors, procedure steps, and exact
task ownership remain to be designed.

## Inactivity and B1 Reassignment

Inactivity means more than two continuous hours of sedentary work or on-call
time without a meaningful contribution. It is not merely a worker standing
still while walking is unnecessary. The timer should reset after a meaningful
task, and the simulation should distinguish active work, travel, break, and
available/on-call states.

For the B1 morgue worker under normal conditions:

1. After the inactivity threshold, notify the shift leader/dock dispatch role
   for a reassignment review.
2. Compare eligible work in Storage and Loading/Logistics using current queued
   demand relative to each station's capacity. Demand reflects both the
   current cycle tier and stochastic variation within it.
3. Assign a qualified worker to one bounded task or temporary assignment at
   the more pressured eligible station. Do not assign the same worker to two
   tasks at once.
4. Preserve minimum morgue coverage. If a morgue task arrives, define whether
   the worker returns immediately or finishes the current safe stopping point.
5. Record the trigger, workload comparison, assignment, and return to the
   primary role for debugging and schedule review.

The two-hour threshold is the only current inactivity constant. Workload
frequencies, queue limits, task durations, and reassignment scoring remain
configurable values to be tuned rather than hard-coded predictions.

## Staffing and Scheduling Drafts

These are rough first-shift planning schedules for the first pass across all
floors, not fixed task counts or finalized rosters. The common first-shift
window is provisionally 6:00 a.m.-6:00 p.m. Task volume follows the daily cycle
and random variation within its tiers. The time blocks below name primary
focus, not guaranteed task start times. Break times are coordination targets
and may move to preserve active coverage. After every floor has a rough draft,
revisit B1 upward to resolve exact schedules, qualifications, and handoffs
across the connected floors. Each shift has different people; no second-shift
individual roster is defined here.

### B1 First Shift: Rough Draft, 10-Worker Estimate

| Worker | Dot / station | Draft schedule |
| --- | --- | --- |
| S1 | Pink / SPD decontamination | 6-8 startup and overnight intake; 8-12 decontamination batches; 12-12:30 break; 12:30-3 routine batches; 3-6 urgent intake and handoff. |
| S2 | Pink / SPD prep and pack | 6-8 equipment check and urgent sets; 8-12 prep/pack; 1-1:30 break; 1:30-3 scheduled batches; 3-6 urgent sets and handoff. |
| S3 | Pink / SPD sterile storage | 6-8 inventory and recalls; 8-12 kit picking and dispatch; 12:30-1 break; 1-3 replenishment; 3-6 urgent picks and closing count. |
| M1 | Black / Mechanical | 6-8 safety round; 8-12 preventive maintenance and queued work orders; 12:30-1 break; 1-3 repairs; 3-6 response coverage and handoff. |
| ST1 | Black / Storage | 6-8 stock check and replenishment; 8-12 picking; 12-12:30 break; 12:30-3 cycle counts and requests; 3-6 peak restocking and closeout. |
| MOR1 | Black / Morgue | 6-7 secure-room and temperature checks; then custody audits/on-call coverage; 12:30-1 break; after more than 2 sedentary/on-call hours, ask C1 to assess Storage vs. Logistics workload for a qualified temporary assignment. |
| LIN1 | Pink / Linen | 6-8 cart setup; 8-12 clean-linen preparation and runs; 12-12:30 break; 12:30-3 returns and restock; 3-6 high-use replenishment and handoff. Respond to linked linen demand from other floors as those workflows are integrated. |
| LL1 | Black / Loading dock | 6-8 receive and verify deliveries; 8-12 sort/stage and scheduled transfers; 12:30-1 break; 1-3 dock requests; 3-6 late deliveries and closeout. |
| LL2 | Black / Logistics runner | 6-8 opening deliveries; 8-12 SPD/linen supply runs; 12-12:30 break; 12:30-3 request-based routes; 3-6 priority runs and handoff. |
| C1 | Black / Dock dispatch and shift lead | 6-8 briefing and assignments; 8-12 queue/workload monitoring; 1-1:30 break; 1:30-3 dispatch and reassignment reviews; 3-6 peak coordination and second-shift handoff. |

The B1 draft is consistent with the current B1 station set: three sterile
processing areas, mechanical, storage, morgue, linen/support, and loading dock.
C1's dispatch point is an assigned function at the dock, not a new map room.
The schedule assumes daytime coverage ends at 6:00 p.m.; the previously stated
goal is that most workers are off after midnight, with pink, blue, and possibly
some black roles retained as needed. Exact overnight minimum coverage remains
open.

### F1 First Shift: Rough Draft, 15-Worker Estimate

F1 includes trauma and ED exam rooms, triage, fast track, observation, CT/X-ray,
the nurse station, registration, EMS bay, resuscitation support, stat lab,
waiting, and restrooms. This estimate assumes two physicians for parallel
general ED and trauma/resuscitation coverage, and that EMS bay support is a
hospital role. If ambulance crews provide that coverage as external visitors,
the estimate can fall to 14.

| Worker | Dot / station | Draft schedule |
| --- | --- | --- |
| D1 | Blue / ED physician | 6-8 handoff and general ED assessments; 8-10 rising arrival/triage support; 10-3 general ED cases and disposition; 3-6 rising/peak arrivals and transfers. Coordinate breaks with D2. |
| D2 | Blue / Trauma-resuscitation physician | 6-8 trauma/resuscitation readiness and cases; 8-3 trauma consults and procedures while backing up ED; 3-6 primary trauma/resuscitation response during peak. Coordinate breaks with D1. |
| CN1 | Pink / Charge nurse, F1-NS | 6-8 staffing and handoff; 8-10 adjust assignments to queues; 10-3 coordinate room coverage, breaks, and cross-floor handoffs; 3-6 rebalance for peak and report unresolved work. |
| TRI1 | Pink / Triage nurse, TRI | 6-8 setup and incoming assessments; 8-10 increasing triage queue; 10-3 prioritize arrivals and route to ED/fast track; 3-6 high-volume triage with CN1 support. |
| RN1 | Pink / Trauma-resuscitation nurse, ED-T1/T2 | 6-8 readiness and handoff; 8-3 trauma/resuscitation cases with D2; 3-6 dedicated peak coverage. |
| RN2 | Pink / ED treatment nurse, ED rooms | 6-8 room readiness and open cases; 8-3 support ED assessments, treatment, and turnover handoffs; 3-6 prioritize active rooms and prepare completed rooms for turnover. |
| FN1 | Pink / Fast-track nurse, FAST rooms | 6-8 opening checks and low-acuity cases; 8-3 fast-track queue and discharge handoffs; 3-6 peak queue support, with reassignment by CN1 if acuity rises. |
| ON1 | Pink / Observation nurse, OBS rooms | 6-8 patient status handoff; 8-3 observation and disposition follow-up; 3-6 reassessments and transfer/discharge coordination. |
| IMG1 | Pink / Imaging technologist, CT/X-ray | 6-8 equipment readiness and queued studies; 8-3 process imaging requests by clinical priority; 3-6 prioritize urgent requests and hand off pending studies. |
| LAB1 | Pink / Stat lab technician, F1-LAB | 6-8 readiness and pending samples; 8-3 process ordered stat work; 3-6 prioritize urgent specimens and hand off pending results. |
| REG1 | Black / Registration, REG | 6-8 opening queue and arriving guests; 8-3 register arrivals and update encounter records; 3-6 manage increased check-in while clinical triage remains the priority. |
| FC1 | Black / Patient-flow coordinator, F1-NS | 6-8 review pending placements; 8-3 coordinate imaging, transport, and receiving-floor bed requests; 3-6 monitor queues and escalate blocked transfers to CN1. |
| PT1 | Black / Patient transporter | 6-8 opening transfers; 8-3 move patients between ED, imaging, and elevator handoffs; 3-6 prioritize clinically cleared transfers and urgent movement requests. |
| EMS1 | Black / EMS-bay transfer support | 6-8 bay readiness and arrival handoffs; 8-3 coordinate ambulance arrivals with TRI/PT1; 3-6 manage peak bay turnover and pending handoffs. |
| TURN1 | Black / Room turnover support | 6-8 check room readiness; 8-3 respond to completed-room turnover requests and create linked linen work; 3-6 prioritize high-demand rooms and hand off unfinished turnover. |

Stagger 30-minute breaks across the 11:30 a.m.-2:00 p.m. window where practical;
defer a break during active critical care and arrange qualified relief. These
are role coverage targets, not fixed predictions of patient or task counts.
Patient registration must not delay triage. Transfers to inpatient floors
require a receiving-floor acceptance/capacity event, and completed turnover
can enqueue linen work for B1. Those cross-floor links are necessary for
end-to-end validation, even while staffing plans are being drafted one floor
at a time.

### F2 First Shift: Rough Draft, 14-Worker Estimate

F2 contains 24 medical/surgical beds, a nurse station, floor pharmacy, clean
and soiled utility rooms, a medication room, 16 generic DAY support rooms, a
family waiting room, a PT gym, and floor storage. This estimate assumes a
daytime ward physician and four nurses, each responsible for a six-bed pod.

| Worker | Dot / station | Draft schedule |
| --- | --- | --- |
| F2-MD1 | Blue / Medicine physician | 6-8 handoff and review of overnight cases; 8-10 rounds and new assessments as activity rises; 10-3 rounds, orders, and consults; 3-6 disposition, transfer decisions, and handoff. |
| F2-CN1 | Pink / Charge nurse, M-NS | 6-8 census and staffing handoff; 8-10 rebalance four nurse pods to the live census; 10-3 coordinate breaks, incoming work, and F1/F3/F4 placement requests; 3-6 manage rising turnover and handoff. |
| F2-RN1 | Pink / North pod, MED-201-206 | 6-8 patient handoff and safety checks; 8-10 assessments and scheduled care; 10-3 ordered care and event-driven patient needs; 3-6 reassessments, discharge/transfer prep, and handoff. |
| F2-RN2 | Pink / North pod, MED-207-212 | 6-8 patient handoff and safety checks; 8-10 assessments and scheduled care; 10-3 ordered care and event-driven patient needs; 3-6 reassessments, discharge/transfer prep, and handoff. |
| F2-RN3 | Pink / South pod, MED-213-218 | 6-8 patient handoff and safety checks; 8-10 assessments and scheduled care; 10-3 ordered care and event-driven patient needs; 3-6 reassessments, discharge/transfer prep, and handoff. |
| F2-RN4 | Pink / South pod, MED-219-224 | 6-8 patient handoff and safety checks; 8-10 assessments and scheduled care; 10-3 ordered care and event-driven patient needs; 3-6 reassessments, discharge/transfer prep, and handoff. |
| F2-PCT1 | Pink / North patient-care tech | 6-8 opening checks and call-bell support; 8-3 delegated mobility, routine observations, and room support for the north pods; 3-6 peak assistance and linen/turnover requests to the proper teams. |
| F2-PCT2 | Pink / South patient-care tech | 6-8 opening checks and call-bell support; 8-3 delegated mobility, routine observations, and room support for the south pods; 3-6 peak assistance and linen/turnover requests to the proper teams. |
| F2-PH1 | Black / Floor pharmacy, M-PH | 6-8 inventory and pending-order review; 8-3 fill/coordinate medication requests tied to valid orders; 3-6 prioritize outstanding requests and hand off stock issues. |
| F2-ST1 | Black / Floor storage, M-ST | 6-8 stock check; 8-3 respond to stochastic supply demand and replenish utility areas; 3-6 handle higher-priority requests and send replenishment requests to B1 storage/logistics when needed. |
| F2-THER1 | Pink / PT gym, M-PT | 6-8 review accepted therapy work; 8-3 provide ordered sessions as patient readiness permits; 3-6 complete or reschedule queued sessions and hand off. Demand depends on clinician orders and patient availability, not only the daily tier. |
| F2-TR1 | Black / Patient transporter | 6-8 opening transfer queue; 8-3 move patients to/from F1 imaging and other floors when accepted; 3-6 prioritize time-sensitive transfers and hand off pending trips. |
| F2-FLOW1 | Black / Patient-flow coordinator, M-NS | 6-8 review expected discharges and incoming placements; 8-3 coordinate F1 admissions, receiving-floor acceptance, and transport; 3-6 resolve capacity bottlenecks with CN1 and receiving floors. |
| F2-TURN1 | Black / Turnover and utility support | 6-8 inspect open/turnover needs; 8-3 respond to completed discharges and clean/soiled utility demand; 3-6 prioritize readying beds and enqueue linked linen pickup/delivery work for B1. |

Stagger 30-minute breaks across the late-morning/early-afternoon window with
qualified coverage; exact times are intentionally deferred to the all-floor
schedule pass. The 16 `DAY-*` rooms are currently generic non-census Support
rooms in the floor data. Proposed use: surge patient rooms when regular
capacity is under pressure. They must not count as staffed beds merely because
they exist on the map; activation requires available qualified staff, required
equipment, and a defined care/monitoring assignment. F2-TURN1 can handle
turnover requests, but does not by itself supply clinical coverage. The rooms'
exact care level, staffing ratio, equipment, and activation process remain to
be decided.

### Surge and Overload Control (Proposal)

Treat overload response as a layer separate from the daily activity cycle:

1. The cycle continues to describe approximate time-of-day baseline demand.
  Observed arrivals, task dependencies, and random variation produce actual
  workload; they are not forced to match a tier's estimate.
2. Monitor each station's pending/active workload against its available
  qualified capacity. Detect sustained pressure using configurable rules,
  rather than a single instantaneous spike or an undocumented magic number.
3. Under pressure, preserve priority and queue work instead of dropping it.
  Patient arrivals may wait for triage/placement; transfers wait for an
  accepting destination; dependent tasks remain pending until prerequisites
  are satisfied. Critical work uses explicit priority rules.
4. If pressure warrants, activate F2 `DAY-*` surge rooms in controlled groups
  only when qualified staffing, equipment, and monitoring are available.
  Record which rooms are active, who covers them, and the event that triggered
  activation. Deactivate them only after load has recovered and occupants/work
  have safe destinations.
5. Return to normal operations after sustained recovery, with hysteresis so
  the system does not repeatedly open/close surge capacity or oscillate
  assignments at a threshold.

Do not slow the whole simulation clock as the first overload safeguard. A
global slowdown also distorts shift boundaries, task durations, and every
floor's cycle, and does not resolve a queue whose arrival rate exceeds its
service capacity. Keep wall-clock/tick performance separate from simulated
hospital time. If a controllable arrival-rate adjustment is later desired for
the synthetic scenario, make it an explicit, logged scenario control; never
silently rewrite the daily cycle or discard already-created work. This policy
is a design recommendation and still needs approval before implementation.

### Simulation Diagnostics (Proposal)

During test runs, emit append-only structured diagnostics (for example,
JSON Lines) that can be downloaded and attached for review. Include a run ID,
simulation time and wall-clock time, floor/station, cycle tier and transition,
queue depth/age, active and available qualified capacity, task/event IDs and
state transitions, dependencies, surge-room state/reason, overload-state
transitions, and the random seed/configuration version. Preserve enough event
ordering to replay or explain a failure.

Use synthetic patient/worker IDs only. Exclude names, medical details, access
tokens, environment values, and database credentials. Do not automatically
send logs or patient-like data to an external service; a user-reviewed local
diagnostic export is the default. A future upload would require explicit
consent, redaction, and a documented secure destination. Diagnostics can be
shared in this conversation by attaching the exported file; they are not
automatically transmitted to the assistant.

F2 cannot be validated alone: admissions may originate on F1, accepted beds
and transfers depend on connected floors, and turnover can generate B1 linen
work. Medication work requires a valid clinical order, PT work requires an
order and available patient, and floor-stock demand is cycle-influenced but
also affected by actual consumption and replenishment. These are linked
workloads, not independent random movement.

### Still To Confirm

Second-shift rosters and exact hours, minimum overnight coverage, F1's final
and F2 staffing counts, whether EMS bay support is hospital staff, the intended
use of F2's DAY rooms, role qualifications, break relief, station capacities,
and task-duration distributions remain open. All counts above are estimates,
not validated staffing requirements. Finalize exact schedules by revisiting
each floor from B1 upward after the rough drafts and shared task dependencies
have been discussed.

## Implementation Boundary

No worker simulation, database schema, API, or frontend movement behavior is
defined by this document as implemented. Before implementation, agree on the
open schedule and dispatch rules, then model workers, shifts, station
qualifications, task definitions, task dependencies, and task history in the
backend/database. Keep floor-specific demand profiles configurable so the
same engine can support later floors.