# Kimia Beauty — Release 3 Payment, Deposit, and Communication Orchestration

**Status:** Release 3 Architecture Addendum  
**Repository:** KimiaBeauty

## Purpose

Define how Appointment, Reservation, Finance, and Communication cooperate for paid/deposit-backed bookings without merging their responsibilities.

## Core Separation

```text
Appointment
= business meaning of the booking

Reservation
= committed time/capacity

Finance
= monetary truth

Communication
= message delivery
```

Each owns its own state.

## Supported Booking Policies

Kimia may support one of these per Service or booking policy:

### Policy A — No Payment Required

```text
Reserve slot
→ Create/Confirm Appointment
→ Send confirmation
```

### Policy B — Deposit Required

```text
Create Appointment(Pending)
→ Hold Reservation
→ Create PaymentIntent(deposit)
→ Customer pays
→ Finance confirms payment
→ Confirm Reservation
→ Confirm Appointment
→ Send confirmation
```

### Policy C — Full Prepayment

Same flow as deposit, but PaymentIntent amount equals the required booking amount.

The exact policy belongs to Kimia product/business rules, not SmartCoreFinance.

## State Machines Remain Separate

Example:

```text
AppointmentStatus:
Pending | Confirmed | Completed | Cancelled | NoShow

ReservationStatus:
Held | Confirmed | Cancelled | Expired

PaymentStatus:
Pending | Succeeded | Failed | Cancelled | Refunded
```

Do not collapse them into one "bookingStatus".

## Payment Success Orchestration

Recommended flow:

```text
PaymentSucceeded
→ validate booking context
→ confirm Reservation if still valid
→ confirm Appointment
→ request confirmation communication
```

If Reservation can no longer be confirmed, the system must not silently mark Appointment confirmed.

A compensating path may be required:

```text
Payment succeeded
but reservation unavailable
→ keep Appointment non-confirmed
→ initiate operational recovery/refund workflow
```

Exact compensation behavior should be defined before production payment integration.

## Payment Failure

```text
PaymentFailed
→ Appointment remains Pending or becomes payment-failed/cancelled by product policy
→ Hold may remain until expiry or be released immediately
→ optional failure communication
```

The product policy decides how aggressively to release the hold.

## Hold Expiration

If required payment is not completed before hold expiry:

```text
Reservation = Expired
Appointment = Cancelled/Expired by product orchestration
PaymentIntent = Cancelled/Expired if supported
```

Appointment should not remain operationally bookable after the reservation is gone.

## Cancellation After Payment

```text
CancelAppointment
→ cancel Reservation
→ evaluate refund policy
→ SmartCoreFinance performs Refund if required
→ update Appointment
→ send cancellation communication
```

Refund policy is product/business policy.

Finance only executes the monetary action.

## Reschedule After Payment

Initial Release 3 recommendation:

- keep payment attached to the Appointment/business context;
- move Reservation safely;
- do not create a new payment unless pricing changes;
- if pricing changes later, introduce an explicit price-difference/refund workflow.

Advanced repricing is out of initial Release 3 scope.

## Deposit Representation

Deposit is not a separate identity system.

Conceptually:

```text
BookingPaymentRequirement
- type: NONE | DEPOSIT | FULL
- amount or percentage
```

Kimia product/business policy calculates the required amount.

SmartCoreFinance receives:

```text
PaymentIntent(amount, currency, context)
```

## Communication Triggers

Recommended product-level triggers:

- AppointmentConfirmed
- AppointmentCancelled
- AppointmentRescheduled
- AppointmentReminderDue
- PaymentSucceeded when a separate receipt/message is needed
- RefundSucceeded when a customer-facing message is required

The source domain owns the event.

SmartCoreCommunication owns delivery.

## Multilingual Behavior

For every communication request, product orchestration should provide or resolve:

- recipient
- template key
- locale
- template variables

Fallback:

```text
customer preferred locale
→ Business.defaultLocale
```

Domain state values remain language-independent.

## Idempotency

Release 3 orchestration must tolerate repeated events/callbacks.

At minimum:

- repeated PaymentSucceeded must not confirm twice;
- repeated Reservation confirmation must be safe;
- repeated communication request should use a deduplication/message key where duplicate delivery would be harmful;
- refund operations must be idempotent.

## Auditability

The product should preserve references between:

```text
Appointment
Reservation
PaymentIntent / Payment
Communication delivery
```

without merging their persistence.

## Release 3 Non-Goals

- staff commission settlement
- ledger accounting
- loyalty
- coupons
- dynamic pricing
- marketplace settlement
- multi-party payout
- advanced refund policy engine
- email/push unless required for launch

## Acceptance Criteria

1. Kimia supports no-payment, deposit, or full-prepayment policy without changing Finance ownership.
2. Appointment, Reservation, and Payment statuses remain separate.
3. successful payment confirms Appointment only if Reservation can be validly confirmed.
4. failed/expired payment flow does not leave a phantom confirmed appointment.
5. cancellation can release reservation and invoke refund policy.
6. confirmation/cancellation/reminder communication is locale-aware.
7. repeated provider callbacks/events do not duplicate financial or booking state changes.
8. KimiaBeauty owns orchestration; SmartCore modules remain authoritative for their own data.

---

> Coordinate the states; never merge the owners.
