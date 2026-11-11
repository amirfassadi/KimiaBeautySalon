# Kimia Beauty — Release 3 MVP

**Status:** MVP Delivery Scope  
**Product:** KimiaBeauty

## Goal

Complete the booking journey with payment/deposit and customer communication.

## Customer Flow

```text
Existing Appointment / Booking Intent
→ Payment or Deposit if required
→ Confirm Appointment
→ Receive SMS confirmation
→ Receive reminder
```

## Minimum Features

### Payment

- create PaymentIntent
- show amount/currency
- redirect/invoke payment provider
- process success/failure
- show payment state
- basic refund path if required for launch

### Deposit

Kimia can configure a simple booking requirement:

- no payment
- fixed deposit
- percentage deposit
- full payment

Complex pricing/policy engines are not required.

### Appointment Integration

- Pending appointment while payment is required
- confirm after successful payment + valid reservation
- cancel when business/customer cancellation requires it
- preserve separate payment status

### Communication

Initial channel:

- SMS

Messages:

- booking confirmation
- cancellation
- reschedule confirmation
- appointment reminder
- optional payment/deposit confirmation

### Basic Admin

- view Appointment
- view Reservation state
- view Payment state
- cancel Appointment
- trigger/perform refund when supported
- mark Completed / NoShow
- see communication result where operationally useful

## Multilingual Requirements

- confirmation/cancellation/reminder templates localized;
- customer-facing payment status labels localized in Kimia UI;
- currency/date/time formatted by selected locale;
- domain/payment/reservation statuses remain canonical;
- fallback to Business.defaultLocale.

## Failure Scenarios

Release 3 must explicitly handle:

- payment failed
- payment callback repeated
- payment succeeded but Reservation expired
- communication failed after Appointment confirmed
- refund provider failure

Communication failure must not roll back a valid confirmed Appointment/payment.

## Definition of Done

Release 3 is complete when a real Kimia customer can:

```text
book a valid slot,
pay required deposit/payment,
receive a confirmed appointment,
receive localized confirmation/reminder,
and have the booking safely cancelled/refunded when the supported policy requires it.
```

## Deferred

- commission
- payroll
- advanced reports
- Commerce
- Inventory
- packages/loyalty
- advanced pricing
