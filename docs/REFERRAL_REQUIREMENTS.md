# Referral attribution requirements

Status: Local customer-registration and manager-attribution scope authorized by owner on 2026-11-27; implementation is awaiting independent review. Employee accounts, commissions, rewards, staff portal and financial integration remain FUTURE and out of scope.
Source: Owner authorization, 2026-11-27, superseding the earlier limited deferral below.

The current implementation is intentionally limited to optional new-customer declarations, manager recording/review/correction, and append-only correction history. It does not implement employee authentication, commission origin, rewards, staff albums, payouts or general referral-link issuance.

## Confirmed requirement

باید ثبت شود هر مشتری را چه کسی به سالن معرفی کرده است. معرف می‌تواند هر فردی، از جمله یک مرد، باشد؛ لازم نیست مشتری سالن یا کارمند باشد.

## Person and relationship model

- Represent the referring person independently from customer, employee and administrator roles. No gender-based restriction applies to referral recording; gender need not be a required field.
- An existing customer or employee may be the introducer, and an external person may also introduce someone without becoming a customer or receiving a login account. Reuse a deliberate person/contact identity or controlled linkage rather than creating fake customer accounts for introducers.
- Record the introduced customer's attribution to the referring person, referral date if known, recording actor/time, verification state and correction history. Distinguish unknown/not-yet-recorded from explicitly no personal introducer; do not invent an introducer for incomplete legacy data.
- Use stable identifiers and show a useful display name to authorized administrators. Optional contact details may help distinguish people with the same name, but a name alone must not automatically merge two people. Decide deduplication/identity rules before implementation.
- Whether attribution concerns the customer's first introduction or additional later introductions must be explicit in the design. Preserve history when an administrator corrects an attribution; do not silently overwrite past data.

## Authority and privacy

- Administrator records/confirms/corrects authoritative referral attribution. A later optional customer-provided name/code is a declaration to verify, not authority to edit another person's records.
- Do not expose a searchable people/customer/referrer list during public signup. A referral code or existing account association does not grant access to another person's details.
- Employee and external-introducer roles receive no customer directory, identity, phone, booking or referral-network access by being named as introducer. Existing employee own-statistics-only restrictions remain intact.
- Naming a person as introducer creates no administrator/employee privileges or automatic login. Do not assume an external male introducer is an employee, a customer or a service recipient.

## Relationship to employee commission

- “Who introduced this customer?” is distinct from “employee-sourced or salon-sourced for this employee's performed service.” Do not infer the latter solely from introducer gender, role or whether the introducer has a customer account.
- The administrator must confirm the commission-origin category and applicable arrangement separately. A customer introduced by an external person is not automatically an employee-sourced customer or a reason to assign the higher percentage.
- Preserve historical service-level origin/rate snapshots. Correcting referral attribution does not silently recalculate approved/settled earnings.
- Referral rewards or payments to introducers have not been requested. Do not add them or deduct them from employee/salon shares as an implementation assumption.

## Implementation and checks

The local implementation uses a new append-only migration 007 and a strict optional `referral` object in customer registration. Customer declarations remain `pending` until an administrator records authoritative attribution. Existing people are not auto-matched by name; identical names may represent separate person IDs. The manager interface and API are available only in the restricted standalone-admin surface. No referral rewards or account permissions are added.

Before any later integration with employee commissions, staff accounts, referral URLs or public activation, return to [FUTURE_STAFF_AND_REFERRALS.md](FUTURE_STAFF_AND_REFERRALS.md) and obtain separate owner review. This document records requirements and current local behavior; it does not authorize those future features.

Test external introducers without customer/staff accounts; no gender restriction; referral recording for existing people; name-collision handling; unknown attribution; administrator-only writes/corrections; no customer data access through introducer/staff roles; no auto-role or auto-commission escalation; historical earnings unchanged after referral correction.
