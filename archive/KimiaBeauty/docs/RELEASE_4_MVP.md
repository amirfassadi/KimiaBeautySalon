# Kimia Beauty — Release 4 MVP

**Status:** MVP Delivery Scope  
**Product:** KimiaBeauty

## Goal

Give Kimia enough operational tooling to manage customers, understand performance, and calculate simple staff commission after the booking/payment flow is stable.

## 1. Customer Operations

Minimum:

- customer list
- customer detail
- upcoming appointments
- past appointments
- services received
- basic payment summary
- optional salon-specific note
- preferred locale

No duplicated Person identity fields beyond product-required projection/cache behavior.

## 2. Reporting

Minimum reports:

- daily appointment count
- monthly appointment count
- daily revenue
- monthly revenue
- revenue by Service
- revenue by Provider
- cancellation count
- no-show count

Reports may be calculated directly or from read projections depending on expected scale.

## 3. Commission

Initial supported model:

- percentage per completed paid Service, or
- fixed amount per completed Service

Implement only the commission model Kimia actually uses first.

Minimum outputs:

- commission per Appointment
- provider commission total by period
- pending/settled display state

Actual payout/settlement may remain manual in the first Release 4 increment.

## 4. Admin

Minimum admin pages:

- Customers
- Customer Detail
- Appointments
- Payments
- Reports
- Staff Commission

## 5. Multilingual

- UI/report labels localized;
- customer preferred locale respected;
- dates/times/currency localized for display;
- canonical domain values remain language-independent.

## 6. Out of Scope

- payroll
- employee contracts
- loyalty
- marketing campaigns
- advanced BI
- tax reporting
- multi-level commission rules
- automatic payouts
- partner/investor profit sharing

## 7. Definition of Done

Release 4 is complete when Kimia staff can:

```text
find a customer,
see their appointment history,
see basic operational/revenue reports,
and calculate the agreed simple commission for each provider.
```

without duplicating Identity, Appointment, Service, or Finance truth.
