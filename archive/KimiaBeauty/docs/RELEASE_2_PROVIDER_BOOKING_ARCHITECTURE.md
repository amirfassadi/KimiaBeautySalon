# Kimia Beauty — Release 2 Provider and Booking Composition

**Status:** Release 2 Architecture Addendum

## Purpose

Clarify the Staff/Provider boundary required before Scheduling and Reservation implementation.

## Composition

```text
SmartCoreIdentity
    Person
      ↓
SmartCoreBusiness
    BusinessPersonRelationship(type=STAFF)
      ↓
SmartCoreBusinessCapability.Service
    ServiceProviderAssignment
      ↓
SmartCoreScheduling
    Provider Schedule / Availability
      ↓
SmartCoreReservation
    Time Commitment
      ↓
KimiaBeauty
    Appointment / Booking Experience
```

## Release 2 Minimum Flow

1. Admin links an existing Person to Kimia as STAFF.
2. Admin assigns that Staff relationship to one or more Services.
3. Admin configures provider working hours.
4. Customer selects Service.
5. Customer selects eligible provider.
6. Customer selects date.
7. Scheduling returns candidate slots.
8. Customer selects slot.
9. Reservation commits the interval.
10. Kimia product orchestration creates/updates Appointment business state.

## Explicit Boundaries

### SmartCoreBusiness

Owns:

- Staff relationship to Business

Does not own:

- Service assignment
- schedule
- reservation

### SmartCoreBusinessCapability.Service

Owns:

- provider eligibility for Service

Does not own:

- Person identity
- employment/payroll
- schedule
- reservation

### SmartCoreScheduling

Owns:

- provider availability

### SmartCoreReservation

Owns:

- committed time interval

### KimiaBeauty

Owns:

- customer-facing booking flow
- Appointment product/business orchestration until a dedicated reusable Appointment domain is justified

## MVP Discipline

Do not create a separate SmartCoreStaff/SmartCoreWorkforce repository for Kimia Release 2.

A workforce module may be extracted later if employment, contract, leave, compensation, payroll, or broader workforce lifecycle becomes a real shared domain.

---

> Release 2 composes relationship, eligibility, availability, and commitment without creating a premature workforce platform.
