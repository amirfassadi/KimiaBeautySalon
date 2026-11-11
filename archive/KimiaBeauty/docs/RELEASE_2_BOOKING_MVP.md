# Kimia Beauty — Release 2 Booking MVP

**Status:** MVP Delivery Scope  
**Product:** KimiaBeauty

## Goal

Enable a customer to book a real Kimia service with a selected provider and valid time slot.

## End-to-End Flow

```text
Login
→ Select Service
→ Select Provider
→ Select Date
→ View Available Slots
→ Select Slot
→ Reserve Time
→ Create Appointment
→ View Confirmation
```

## Required Modules

### SmartCoreIdentity
- authenticated customer identity

### SmartCoreBusiness
- Kimia Business
- active Staff relationships

### SmartCoreBusinessCapability.Service
- Service catalog
- ServiceProviderAssignment

### SmartCoreScheduling
- provider working schedule
- exceptions
- available slot calculation

### SmartCoreReservation
- conflict-safe time commitment

### KimiaBeauty
- Appointment business state
- booking orchestration
- UI

## Minimum Customer Features

- select Service
- see eligible Providers
- choose date
- see available slots
- create appointment
- view upcoming appointments
- cancel appointment
- reschedule appointment

## Minimum Admin Features

- list appointments by date
- view appointment detail
- confirm when manual confirmation is required
- cancel appointment
- mark completed
- mark no-show

## Multilingual Requirements

- service content localized through Service translations;
- appointment status labels localized in UI;
- date/time displayed using selected locale;
- scheduling truth remains in canonical date/time values;
- no translated status strings stored in Appointment persistence.

## Non-Goals

Release 2 does not require:

- online payment
- deposit
- SMS
- commission
- reports
- product sales
- inventory
- packages
- loyalty

These arrive in later releases.

## Definition of Done

Release 2 is complete when a real customer can:

```text
choose a Kimia service,
choose an eligible staff member,
see only valid available times,
book exactly one slot without double booking,
and later cancel or reschedule that appointment.
```
