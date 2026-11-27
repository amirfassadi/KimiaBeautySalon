# Staff portal requirements

Start a new planning chat from the consolidated Persian handoff: [FUTURE_STAFF_AND_REFERRALS.md](FUTURE_STAFF_AND_REFERRALS.md). This file retains the detailed planning notes.

Status: FUTURE — requirements capture only; explicitly deferred by the user until later consolidation and implementation.
Source: User instructions, revenue clarification, commission/settlement requirements and mixed fixed-pay/service-line arrangements, 2026-11-22.

Do not start design tasks, implementation, schema changes or executable prompt preparation for these ideas now. The listed rules and roadmap are notes to consolidate later, not an instruction to build them. Further user ideas may be appended without activating this scope.

## Confirmed scope

کارمند به اطلاعات مشتری‌ها دسترسی ندارد. زمان‌های کاری خودش را برای تأیید مدیر ثبت می‌کند، تعداد کارها، مبلغ کل خدمات، سهم خودش و وضعیت تسویه خودش را می‌بیند و نمونه‌کار برای تأیید و انتشار توسط مدیر ارسال می‌کند. ثبت مبالغ، منشأ مشتری، درصد سهم و تسویه فقط در اختیار مدیر است.

The earlier clarification defines «مبلغ کل خدمات انجام‌شده» as gross service value. Later instructions require employee share, manager-recorded settlements and arrangements combining fixed pay with commission on selected service lines (for example color/highlights). Display gross service value, fixed-pay earnings, commission earnings, total earned amount, settled amount and outstanding balance separately. Gross service value is not employee earnings or cash paid.

## Access matrix

| Capability | Customer | Employee | Administrator |
| --- | --- | --- | --- |
| View customer directory, names, phone numbers, profiles, notes or bookings | No directory; existing customer scope remains separate | Never | Existing authorized admin functionality |
| Propose employee work/availability times | No | Own times only | Review/manage |
| Approve employee time submissions | No | No | Yes |
| View performed-work count/value | No employee data | Own aggregates only | Authorized management reports |
| Set service amounts, customer origin, fixed-pay arrangement or service-line percentages | No | No | Yes |
| Record/correct employee settlements | No | No | Yes |
| View earned share, paid amounts and balance | No employee data | Own read-only statement, no customer details | Authorized management scope |
| View another employee's stats/submissions | No | No | Authorized management scope |
| Submit portfolio images/descriptions | No through this employee flow | Own submissions only | Review/manage |
| Publish, approve or reject portfolio content | No | No | Yes |
| Grant employee/admin access | No | No | Administrator-controlled onboarding |

The employee must not receive customer data in an API response even if the UI hides it. Do not reuse the full appointments/booking/admin payload and filter only in the browser. Authentication and ownership checks are server-side on every read, update, upload, media retrieval and aggregate query. Derive employee identity from the authenticated server-side staff mapping, never from a supplied staff_id or selectable role. Changing IDs/filters must not expose another employee or customer.

## Staff identity

Customer, employee and administrator permissions are distinct. Customer signup must never self-assign employee/admin privileges. Existing staff_members records are not authenticated accounts. The proposed employee onboarding is invitation/provisioning controlled by an administrator, with a deliberate staff-account mapping and independent permission enforcement. Its exact authentication/session design belongs to Task 17; do not silently turn a customer cookie into staff authorization or reuse an administrator cookie as an employee account.

## Own time submissions

- An employee creates/edits only their own proposed work/availability times and sees the status of their own submissions.
- Submitted times remain pending until an administrator approves/rejects them. Employee self-approval and direct writes to approved availability are forbidden.
- Proposed times are not customer appointments and contain no customer identity, booking details or contact information.
- Changes to previously approved times require a new review; a field edit must not bypass moderation. Preserve a clearly defined approved version until the administrator changes it, or suspend that version explicitly according to the design decision.
- Record the approver, decision time and relevant status/version. Manager-facing queue and overlap/business-hour checks are part of the implementation plan.
- This requirement does not activate public booking or customer navigation now. Public visibility of approved availability must follow the separately reviewed booking feature.

## Own work count and service value

- Show only aggregate counts and total service amounts attributable to the logged-in employee, with an explicit reporting period. Service-type/date aggregates may be included without customer identifiers.
- Count/value come from authoritative completed work records accepted by management, not numbers the employee can edit or self-declare. Exclude cancelled/no-show/unperformed work.
- Do not expose customer names, phone numbers, account/booking IDs, visit notes, individual customer payment records, employee-to-customer links or other employees' earnings.
- Keep gross completed-service value separate from fixed-pay earnings, service-line commission and actual settlements. Fixed-pay plus commission is now explicitly in scope; tax/insurance/statutory payroll processing, automatic bank transfers and salon-wide collection reports remain outside this feature.
- Exact completed-work unit, historical service pricing, currency/display unit, corrections and refund treatment must be specified before financial reporting implementation. Do not use today's service price to silently rewrite historical totals or invent missing amounts. Distinguish unavailable financial data from a true zero.

## Manager-controlled shares and settlements

- Configure the arrangement per employee, not one global salary type: fixed only, commission only, or fixed plus commission on specified service lines. The explicit user example is an employee with fixed pay who additionally earns commission on color/highlights.
- The administrator defines fixed amount, earning/reporting period, effective dates and applicable service-line rules. For each eligible line, commission may differ by employee-sourced versus salon-sourced customer using the manager's rates. Do not apply the color/highlights percentage automatically to every other line or employee.
- Example: one employee may have a fixed monthly component plus color/highlights shares of 70% for their own customers and 60% for salon customers. These numbers and monthly timing illustrate a configurable arrangement, not a mandated contract for every employee.
- Add approved fixed-pay earnings as their own period-based ledger entries. Prevent duplicate accrual for the same employee/contract/component/period. Approved fixed earnings plus eligible approved service commissions form total earned amount; never silently choose the higher amount, deduct fixed pay from commission, or treat fixed pay as an advance without a separately agreed rule.
- Contract/rate changes have effective dates and preserve prior earning snapshots. Proration for partial periods, attendance deductions, overtime, tax, insurance and similar policies are not supplied by the user; record them as unresolved/out of scope rather than inventing calculations. Managers can approve the actual fixed earning entry while a detailed accrual policy is not yet defined.
- The administrator records/approves performed service amounts and attributes each work record internally to either an employee-sourced customer («مشتری خود کارمند») or a salon-sourced customer («مشتری سالن»). This origin category is a calculation input; it does not grant the employee access to the customer record or contact details.
- Referral attribution is separately defined in [REFERRAL_REQUIREMENTS.md](REFERRAL_REQUIREMENTS.md). Any person, including an external male introducer without a customer/staff account, may introduce a customer. Referral identity alone does not determine this employee's commission category or grant customer-data access; the administrator confirms the financial origin classification explicitly.
- The user's example split is 70% employee / 30% salon for employee-sourced customers and 60% employee / 40% salon for salon-sourced customers. These are administrator-configured examples/default candidates, not immutable percentages hard-coded for every employee. The administrator controls the applicable arrangement; employees cannot edit origin, amounts, rates or earned balances.
- For a service amount of 100 units, the example employee shares are 70 units or 60 units respectively. Salon share is the remainder under the agreed two-party split. No extra deductions, commission rules or automatic payment policy may be invented.
- Store the approved service amount, origin category and applicable share percentage as the calculation basis for that performed work. Later percentage/price changes must not silently recalculate historical earnings or already-settled work. Define exact monetary units, integer/minor-unit arithmetic and rounding consistently; do not use floating-point balances.
- Missing/unconfirmed amount, applicable contract rule or required commission-source category must remain pending/unavailable; do not silently assume a lower rate, zero earnings or a customer source. An administrator-explicit noncommissioned line is distinct from a missing rule; fixed-pay entries do not require customer identity/source. Reporting must distinguish gross totals from finalized fixed/commission earnings.
- The administrator records a settlement/payment to the employee with amount, date, payment method/reference and an appropriate non-customer note. This is recording a payment, not initiating a transfer or connecting banking/payment services. Multiple partial settlements must be supported rather than requiring all earnings to be paid at once.
- The employee sees only their own read-only aggregate/statement: completed-work count, gross service value, fixed-pay earnings, commission by service line, total earned amount, settled amounts and remaining balance for explicit periods. Personal settlement history may show their own payment amounts/dates/methods, never individual customer payments, customer identifiers or other employees' records.
- Keep outstanding balance consistent across periods: carry forward opening balance and distinguish period earnings/payments from lifetime balance. Proposed accounting baseline is opening balance plus approved fixed-pay earnings plus approved commission earnings minus valid settlements, with separately identified administrator-recorded corrections. Do not silently discard previous balances, double-count the opening balance or introduce unrequested deductions.
- Corrections to approved earnings, origin, rates or settlements must retain who changed what and when, with traceable reversal/adjustment rather than silent destructive history edits. Invalid, duplicate or over-settlement behavior and refund treatment must be explicitly designed before implementation; no hidden write-off or negative balance policy.
- Only authorized administrator endpoints can create/correct financial records. Employee requests containing rate/origin/amount/settled flags must not mutate finance. Server-side identity/ownership checks protect both reports and settlement statements.

## Portfolio moderation

- Employee uploads only their own proposed portfolio items and sees their own submission/review state.
- Uploaded originals and pending/rejected revisions are private; they must not be reachable from the public gallery, APIs or guessed media URLs before administrator approval. Employees have no access to others' pending files.
- Only an administrator can approve and publish content to the existing public gallery. Validate ownership and moderation state server-side; no employee-controlled is_published/approved flag.
- Replacement images or edits to published text require review again. Publication refers to the approved revision, not whatever mutable draft currently exists.
- Preserve the existing gallery consent requirement; administrator publication approval is separate from the required recorded permission to publish a recognizable client image. Do not expose customer records/contact details in captions, file metadata or employee UI.
- Administrator can reject or unpublish; rejected content stays private. No automatic publication after a timer or employee resubmission.

## Verification required

Test direct API access, not only hidden UI controls: employee→customer endpoints denied; employee→admin endpoints denied; staff A→staff B records/media/aggregates denied; submitted/edited times cannot self-approve; pending/rejected/revised media cannot become public; aggregates contain no customer identity and include only the employee's authoritative performed work. Test fixed-only/commission-only/mixed arrangements, eligible-line restrictions, both 70/60 example splits, duplicate fixed accrual prevention, effective-dated historical rate preservation, administrator-only finance writes, partial settlements, carried balances, correction history and no cross-employee statement leakage. Verify revocation of disabled employee access and distinguish infrastructure failures from empty reports.

## Current boundary and implementation order

No employee account, portal, schedule approval, finance ledger or employee portfolio moderation was created by recording this document. Customer-batch review corrections remain pending in prompts/BATCH_REVIEW.md. New schema must be append-only; historical migrations 001–006 are not rewritten.

Roadmap: Task 17 designs roles/contracts/data boundaries; 18 staff onboarding/session authorization; 19 own time proposals and manager approval; 20 own count/value aggregates; 20b administrator-controlled fixed-pay and per-line/origin commission arrangements with earnings ledger; 20c administrator-recorded partial settlements and own read-only statements; 21 private portfolio submissions and approved-revision publication; 22 manager review queues; 23 full employee/customer/admin isolation verification. Keep each implementation scoped and reviewable; split further where needed.
