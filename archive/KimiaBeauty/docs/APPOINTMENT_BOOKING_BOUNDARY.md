# Kimia Beauty — Appointment / Booking Boundary

**Status:** Architecture Decision Candidate / MVP Scope  
**Repository:** KimiaBeauty

## Purpose

Define the business-level meaning of a Kimia appointment without duplicating generic Scheduling or Reservation responsibilities.

## Core Distinction

```text
Scheduling
= when capacity may be available

Reservation
= committed time/capacity allocation

Appointment
= business meaning of a customer receiving a service
```

For Kimia Release 2, Appointment remains a product/domain composition inside KimiaBeauty.

A separate SmartCoreAppointment repository is not required yet.

---

## Why Appointment Belongs Here for MVP

Kimia currently needs Appointment semantics specifically for a service salon flow:

- Customer
- Business
- Service
- Provider
- selected time
- appointment status
- notes
- reservation reference
- later payment reference

These semantics are real business meaning, but they are not yet proven to be generic enough to justify a new SmartCore platform repository.

The architecture should therefore:

1. keep generic allocation in SmartCoreReservation;
2. keep Appointment meaning in KimiaBeauty for now;
3. preserve a clean extraction path if multiple products later require the same Appointment domain.

---

## Conceptual Model

```text
Appointment
- id
- businessId
- customerPersonId
- serviceId
- providerRelationshipId
- reservationId
- startAt
- endAt
- status
- customerNote?
- internalNote?
- createdAt
- updatedAt
```

The exact persistence model may be simplified during implementation.

---

## Minimum Status Model

For Kimia MVP:

```text
Pending
Confirmed
Completed
Cancelled
NoShow
```

Possible flow:

```text
Pending
  ↓
Confirmed
  ↓
Completed

Alternative exits:
Cancelled
NoShow
```

Status names may be refined during implementation, but the business meaning must remain separate from Reservation status.

---

## Reservation Relationship

Appointment references Reservation.

```text
Appointment
    ↓
reservationId
    ↓
SmartCoreReservation
```

Reservation is authoritative for time commitment.

Appointment is authoritative for customer-service business state.

Example:

```text
Reservation = Confirmed
Appointment = Cancelled
```

would normally require orchestration to cancel/release the Reservation as part of the Appointment cancellation workflow.

That coordination belongs to the product/application orchestration layer.

---

## Service Relationship

Appointment references:

- Service
- selected Provider eligibility

It must not duplicate Service name, description, or full Service definition as authoritative domain truth.

Snapshots may later be added for audit/display needs, but that is outside the initial MVP.

---

## Customer Boundary

Customer identity comes from SmartCoreIdentity:

```text
customerPersonId
```

KimiaBeauty may later introduce a Business-specific Customer relationship/profile, but it must not create a second Person identity model.

---

## Provider Boundary

The provider is resolved through:

```text
SmartCoreBusiness
BusinessPersonRelationship(STAFF)
```

and:

```text
SmartCoreBusinessCapability.Service
ServiceProviderAssignment
```

Appointment references the selected provider relationship.

It does not own the Staff relationship itself.

---

## Pricing / Finance Boundary

Appointment may carry or reference a calculated commercial amount for the booking flow.

SmartCoreFinance owns Payment/Transaction truth.

Future flow:

```text
Appointment
    ↓
PaymentIntent
    ↓
SmartCoreFinance
```

Appointment status and Payment status must remain separate state machines.

---

## Communication Boundary

Appointment events can trigger notification policy.

Example:

```text
AppointmentConfirmed
→ Kimia notification policy
→ SmartCoreCommunication
```

Communication does not own Appointment state.

---

## Multilingual Boundary

Appointment core state is locale-independent.

Localized content such as:

- status labels
- customer messages
- date/time formatting
- service display names

is resolved through presentation and referenced domain projections.

Do not store translated appointment status values.

---

## Minimum Commands

For Kimia Release 2:

- CreateAppointment
- ConfirmAppointment
- CancelAppointment
- RescheduleAppointment
- CompleteAppointment
- MarkAppointmentNoShow

Some commands may be delayed until the admin flow needs them.

---

## Minimum Queries

- GetAppointment
- ListMyAppointments
- ListBusinessAppointments
- ListAppointmentsByDate

---

## Creation Flow

Recommended Release 2 orchestration:

```text
Customer selects:
Service
Provider
Date/Time
      ↓
SmartCoreScheduling validates availability
      ↓
SmartCoreReservation commits interval
      ↓
KimiaBeauty creates Appointment
      ↓
Appointment = Pending or Confirmed
```

If Release 3 introduces required payment/deposit:

```text
Create booking intent
→ hold Reservation
→ create Appointment(Pending)
→ Payment
→ confirm Reservation
→ Appointment(Confirmed)
```

The exact transaction/saga boundary should be defined before payment integration.

---

## Cancellation Flow

```text
CancelAppointment
→ validate actor/business policy
→ cancel Appointment
→ cancel/release Reservation
→ later apply refund/cancellation policy if required
→ trigger Communication
```

---

## Reschedule Flow

```text
RescheduleAppointment
→ request new availability
→ Reservation safely moves/replaces commitment
→ Appointment updates start/end/reservation reference
→ Communication event
```

The Reservation operation must remain conflict-safe.

---

## Out of Scope for Initial MVP

- recurring appointments
- group appointments
- multi-service appointments
- package redemption
- waitlist
- complex cancellation penalties
- appointment marketplace
- resource/equipment reservations
- multi-provider appointment
- clinical records
- consent forms
- advanced workflow engine

---

## Extraction Criteria

A future reusable module such as `SmartCoreAppointment` or `SmartCoreBooking` should be considered only if:

1. multiple independent SmartCore products need the same Appointment semantics;
2. lifecycle/rules become clearly reusable;
3. product-specific differences can be separated from a generic core;
4. independent ownership/release provides real value.

Until then, keeping Appointment in KimiaBeauty avoids premature platform abstraction.

---

## Acceptance Criteria

1. Appointment business state is separate from Reservation state.
2. Appointment references Identity, Business, Service, Provider, and Reservation without duplicating them.
3. cancellation releases/cancels Reservation through orchestration.
4. reschedule preserves Reservation conflict safety.
5. localized UI does not change domain status values.
6. Kimia can list customer and business appointments.
7. no new SmartCoreAppointment repository is required for Release 2.
8. the model has a documented extraction path if reuse is proven later.

---

> Reservation commits the time. Appointment explains what that committed time means to the business.
