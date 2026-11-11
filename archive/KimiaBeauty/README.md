# KimiaBeauty

KimiaBeauty is the customer-facing product/solution for Kimia Beauty Salon, composed from reusable SmartCore capabilities.

> KimiaBeauty owns the product experience. SmartCore modules own reusable domain capabilities.

## Purpose

The immediate goal is to launch Kimia Beauty as quickly as possible with a staged MVP.

The first customer journey is:

```text
Register / Login
    ↓
View Kimia Beauty
    ↓
Browse Services and Prices
    ↓
Choose Staff and Time
    ↓
Book Appointment
    ↓
Pay / Deposit when required
    ↓
Receive Confirmation
```

## Product Responsibilities

KimiaBeauty owns:

- Kimia branding
- Kimia-specific UI/UX
- public website
- admin application composition
- product routing/navigation
- Kimia configuration
- product-level orchestration
- customer journey
- composition of SmartCore APIs/contracts
- Kimia-specific content/configuration where appropriate

## Does Not Own

KimiaBeauty must not create competing sources of truth for:

- Person / Session
- Business
- Service
- Schedule
- Reservation
- Payment
- Communication delivery

Those belong to SmartCore modules.

## SmartCore Dependencies

Initial product composition:

```text
SmartCoreIdentity
        ↓
SmartCoreBusiness
        ↓
SmartCoreBusinessCapability / Service
        ↓
SmartCoreScheduling
        ↓
SmartCoreReservation
        ↓
SmartCoreFinance
        ↓
SmartCoreCommunication
```

KimiaBeauty composes these capabilities into one product experience.

## Incremental Release Plan

### Release 1 — Presence and Registration

Goal: get the real site online quickly.

Scope:

- Kimia public landing page
- salon introduction
- contact information
- service categories
- service list
- descriptions
- prices
- registration/login
- basic customer profile

Dependencies:

- SmartCoreIdentity
- SmartCoreBusiness
- SmartCoreBusinessCapability(Service)

### Release 2 — Appointment Booking

Scope:

- staff display/selection
- staff-service assignment
- working hours
- availability
- available slots
- create appointment/booking intent
- reserve slot
- prevent double booking
- cancel
- reschedule
- basic appointment status

Dependencies:

- SmartCoreScheduling
- SmartCoreReservation

### Release 3 — Payment and Communication

Scope:

- appointment price
- PaymentIntent
- payment/deposit if required
- payment result
- appointment confirmation
- SMS confirmation
- reminder
- cancellation message
- basic admin views

Dependencies:

- SmartCoreFinance
- SmartCoreCommunication

## Initial Public Website

Minimum pages/views may include:

- Home
- About Kimia
- Services
- Service Detail
- Login/Register
- My Appointments (when booking is enabled)
- Booking flow
- Contact

The exact frontend stack will be defined separately.

## Initial Admin Experience

Minimum operational needs:

- edit public business information
- manage service categories
- manage services
- manage staff
- manage staff/service relationships
- configure working hours
- view appointments
- confirm/cancel/complete appointments
- view payment state

Admin features should be added only when required for salon operation.

## Product-Specific Configuration

Kimia-specific configuration may include:

- brand name
- logo
- colors/design tokens
- contact details
- address
- business hours
- supported language(s)
- salon-specific content
- selected SmartCore capabilities

These settings must not be hard-coded into reusable SmartCore repositories.

## Business Capability Activation

Initial:

```text
SERVICE = active
```

Future:

```text
COMMERCE = optional
```

If Kimia later sells products, Commerce can be enabled without redefining the Business.

## Future Scope

- product sales
- inventory
- packages
- loyalty
- promotions
- staff commissions
- reports/analytics
- advanced customer relationship features
- multiple locations
- richer notification channels

These are deliberately outside the first launch unless required.

## Architecture Rules

1. KimiaBeauty is a product composition, not a platform module.
2. Reusable domain logic belongs in the relevant SmartCore repository.
3. Kimia-specific branding stays here.
4. No duplicate Person, Business, Service, Reservation, Payment, or Communication persistence.
5. Deliver in small releases.
6. Every SmartCore dependency should expose the minimum contract needed by the current release.
7. Do not block the public website on future platform completeness.

## Current Status

**Status:** Product Foundation / MVP Planning

Immediate target:

```text
Release 1
Identity + Business + Service Catalog + Public Website
```

---

> Launch Kimia quickly, while keeping every reusable capability reusable.
